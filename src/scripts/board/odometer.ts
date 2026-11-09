// The HUD counters roll like a mechanical odometer: each digit is a column whose ribbon holds two stacked slots
// behind a window. A digit that changes slides its ribbon to the next slot in 90 ms; the others stay put. A tick
// that lands while a roll is still running snaps to the new value rather than queueing. `diffDigits` and `rollPlan`
// are pure and tested; `createOdometer` is the one DOM driver.

export type Direction = 'up' | 'down' | 'none';

export interface DigitDiff {
  from: string;
  to: string;
  changed: boolean;
}

export interface DiffResult {
  direction: Direction;
  /** One entry per column of `next`, right-aligned against `prev`: a longer `next` has columns with no `from`. */
  digits: DigitDiff[];
}

export function diffDigits(prev: string, next: string): DiffResult {
  const prevNum = Number(prev);
  const nextNum = Number(next);
  const direction: Direction = nextNum > prevNum ? 'up' : nextNum < prevNum ? 'down' : 'none';
  const shift = next.length - prev.length;
  const digits = Array.from(next, (to, i) => {
    const from = prev[i - shift] ?? '';
    return { from, to, changed: from !== to };
  });
  return { direction, digits };
}

export interface RollPlan {
  /** The slot at the top of the ribbon. */
  top: string;
  /** The slot below it. */
  bottom: string;
  /** Ribbon offset (% of the ribbon, which is two slots tall) at the start and at the end of the roll. */
  start: number;
  end: number;
}

/** Slot texts and offsets for one digit rolling from `from` to `to`. Up: the old digit leaves at the top and the new one rises from below. Down: the reverse. */
export function rollPlan(from: string, to: string, direction: 'up' | 'down'): RollPlan {
  return direction === 'up'
    ? { top: from, bottom: to, start: 0, end: -50 }
    : { top: to, bottom: from, start: -50, end: 0 };
}

export interface Odometer {
  set(value: number | string): void;
}

/** Keep in step with the tick interval (120 ms): a roll must finish before the next tick. */
const ROLL_MS = 90;
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)';
/** A new column starts with no digit above it; an empty top slot has no line box, so the counter would lose its baseline. */
const BLANK = ' ';

interface Column {
  el: HTMLElement;
  rolling(): boolean;
  show(digit: string): void;
  roll(from: string, to: string, direction: 'up' | 'down'): void;
}

function createColumn(digit: string): Column {
  const el = document.createElement('span');
  el.className = 'odometer-digit';
  const ribbon = document.createElement('span');
  ribbon.className = 'odometer-ribbon';
  const top = document.createElement('span');
  top.className = 'odometer-num';
  top.textContent = digit || BLANK;
  const bottom = document.createElement('span');
  bottom.className = 'odometer-num';
  ribbon.append(top, bottom);
  el.append(ribbon);

  let anim: Animation | null = null;

  const show = (digit: string) => {
    anim?.cancel();
    anim = null;
    el.classList.remove('is-rolling');
    top.textContent = digit || BLANK;
    bottom.textContent = '';
  };

  const roll = (from: string, to: string, direction: 'up' | 'down') => {
    anim?.cancel();
    const plan = rollPlan(from, to, direction);
    top.textContent = plan.top || BLANK;
    bottom.textContent = plan.bottom;
    // the window clips the slots only while a digit is travelling: at rest the paper halo must reach the glyphs
    el.classList.add('is-rolling');
    anim = ribbon.animate(
      [{ transform: `translateY(${plan.start}%)` }, { transform: `translateY(${plan.end}%)` }],
      { duration: ROLL_MS, easing: EASE_OUT },
    );
    // the finished roll is written as the resting state, in the same frame the animation lets go
    anim.onfinish = () => show(to);
  };

  show(digit);
  return { el, rolling: () => anim !== null, show, roll };
}

export function createOdometer(el: HTMLElement): Odometer {
  const initial = el.textContent?.trim() || '0';
  el.textContent = '';

  // the whole number for assistive tech: updated each tick but not a live region, so it is not announced
  const plain = document.createElement('span');
  plain.className = 'sr-only';
  plain.textContent = initial;
  const digits = document.createElement('span');
  digits.className = 'odometer';
  digits.setAttribute('aria-hidden', 'true');
  el.append(plain, digits);

  const columns: Column[] = [];
  for (const ch of initial) {
    const column = createColumn(ch);
    digits.append(column.el);
    columns.push(column);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let value = initial;

  return {
    set(next: number | string) {
      const text = String(next);
      if (text === value) return;
      const diff = diffDigits(value, text);
      plain.textContent = text;

      // a longer number adds columns on the left, a shorter one drops the leftmost
      while (columns.length < text.length) {
        const column = createColumn('');
        digits.prepend(column.el);
        columns.unshift(column);
      }
      while (columns.length > text.length) columns.shift()?.el.remove();

      diff.digits.forEach((d, i) => {
        if (!d.changed) return;
        const column = columns[i];
        // reduced motion, or a tick that lands mid-roll: show the new digit now, nothing queues
        if (reduced.matches || column.rolling() || diff.direction === 'none') column.show(d.to);
        else column.roll(d.from, d.to, diff.direction);
      });
      value = text;
    },
  };
}
