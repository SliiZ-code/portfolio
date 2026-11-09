export type Direction = 'up' | 'down' | 'none';

export interface DigitDiff {
  index: number;
  from: string;
  to: string;
  changed: boolean;
}

export interface DiffResult {
  direction: Direction;
  changed: number[];
  digits: DigitDiff[];
}

export function diffDigits(prev: string, next: string): DiffResult {
  if (prev === next) {
    const digits: DigitDiff[] = Array.from(next).map((ch, i) => ({
      index: i,
      from: ch,
      to: ch,
      changed: false,
    }));
    return { direction: 'none', changed: [], digits };
  }

  const prevNum = Number(prev);
  const nextNum = Number(next);
  let direction: Direction = 'none';
  if (!Number.isNaN(prevNum) && !Number.isNaN(nextNum)) {
    if (nextNum > prevNum) direction = 'up';
    else if (nextNum < prevNum) direction = 'down';
  }

  const changed: number[] = [];
  const digits: DigitDiff[] = [];
  const diffLen = next.length - prev.length;

  for (let i = 0; i < next.length; i++) {
    const prevIdx = i - diffLen;
    const from = prevIdx >= 0 && prevIdx < prev.length ? prev[prevIdx] : '';
    const to = next[i];
    const isChanged = from !== to;
    if (isChanged) {
      changed.push(i);
    }
    digits.push({ index: i, from, to, changed: isChanged });
  }

  return { direction, changed, digits };
}

export interface Odometer {
  set(value: number | string): void;
}

interface Column {
  el: HTMLElement;
  ribbon: HTMLElement;
  slotA: HTMLElement;
  slotB: HTMLElement;
  currentDigit: string;
  snap(): void;
  roll(from: string, to: string, dir: Direction): void;
}

const TRANSITION_MS = 90;

export function createOdometer(el: HTMLElement): Odometer {
  const initialText = el.textContent?.trim() || '0';
  el.textContent = '';

  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = initialText;
  el.appendChild(sr);

  const container = document.createElement('span');
  container.className = 'odometer';
  container.setAttribute('aria-hidden', 'true');
  el.appendChild(container);

  function createColumn(digit: string): Column {
    const colEl = document.createElement('span');
    colEl.className = 'odometer-digit';

    const ribbon = document.createElement('span');
    ribbon.className = 'odometer-ribbon';

    const slotA = document.createElement('span');
    slotA.className = 'odometer-num';
    slotA.textContent = digit;

    const slotB = document.createElement('span');
    slotB.className = 'odometer-num';
    slotB.textContent = '';

    ribbon.appendChild(slotA);
    ribbon.appendChild(slotB);
    colEl.appendChild(ribbon);

    let currentDigit = digit;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const snap = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      ribbon.style.transition = 'none';
      ribbon.style.transform = 'none';
      slotA.textContent = currentDigit;
      slotB.textContent = '';
    };

    const roll = (from: string, to: string, dir: Direction) => {
      snap();
      currentDigit = to;
      if (dir === 'up') {
        slotA.textContent = from;
        slotB.textContent = to;
        ribbon.style.transition = 'none';
        ribbon.style.transform = 'translateY(0)';
        void ribbon.offsetHeight; // force reflow
        ribbon.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0, 0, 0.2, 1)`;
        ribbon.style.transform = 'translateY(-50%)';
      } else if (dir === 'down') {
        slotA.textContent = to;
        slotB.textContent = from;
        ribbon.style.transition = 'none';
        ribbon.style.transform = 'translateY(-50%)';
        void ribbon.offsetHeight; // force reflow
        ribbon.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0, 0, 0.2, 1)`;
        ribbon.style.transform = 'translateY(0)';
      } else {
        slotA.textContent = to;
        slotB.textContent = '';
        return;
      }
      timerId = setTimeout(() => {
        snap();
      }, TRANSITION_MS);
    };

    return {
      el: colEl,
      ribbon,
      slotA,
      slotB,
      get currentDigit() {
        return currentDigit;
      },
      set currentDigit(val: string) {
        currentDigit = val;
      },
      snap,
      roll,
    };
  }

  const columns: Column[] = [];
  for (const ch of initialText) {
    const col = createColumn(ch);
    container.appendChild(col.el);
    columns.push(col);
  }

  let currentValue = initialText;

  const motionQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  return {
    set(value: number | string) {
      const nextStr = String(value);
      if (nextStr === currentValue) return;

      sr.textContent = nextStr;
      const reduced = motionQuery ? motionQuery.matches : false;
      const diff = diffDigits(currentValue, nextStr);

      // Adjust column count
      while (columns.length < nextStr.length) {
        const col = createColumn('');
        container.insertBefore(col.el, container.firstChild);
        columns.unshift(col);
      }
      while (columns.length > nextStr.length) {
        const col = columns.shift();
        if (col) {
          col.snap();
          col.el.remove();
        }
      }

      for (let i = 0; i < nextStr.length; i++) {
        if (!diff.changed.includes(i)) continue;
        const col = columns[i];
        const from = diff.digits[i].from;
        const to = diff.digits[i].to;

        if (reduced) {
          col.snap();
          col.currentDigit = to;
          col.slotA.textContent = to;
        } else {
          col.roll(from, to, diff.direction);
        }
      }

      currentValue = nextStr;
    },
  };
}
