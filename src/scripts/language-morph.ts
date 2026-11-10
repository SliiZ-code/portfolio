// Language morph: the pure part. Switching the home page's language morphs the visible text in place: each character
// shared by the old and the new text slides to its new place, the others fade out or roll in. Here: the character
// alignment (which characters are kept, which leave and which arrive), the stagger, and the rules for when a click
// may morph at all. The DOM driver is language-switch.ts; these helpers have no DOM and are unit-tested.

import type { Lang } from '../lib/resume';

/** Longest block (in characters, on either side) that is aligned; longer blocks are swapped instantly. */
export const MAX_ALIGN = 800;
/** Delay between two neighbouring characters, and the most any character waits. */
export const STAGGER_MS = 8;
export const MAX_STAGGER_MS = 180;
/** How long a kept character takes to slide, and a new one to roll in. */
export const MOVE_MS = 360;
/** How long a removed character takes to fade out: quicker than the move, so it is gone before the new text lands. */
export const EXIT_MS = 150;
/** New characters wait this long before they roll in, so the removed ones have mostly faded by then. */
export const ENTER_AFTER_MS = 120;

/** Threshold in characters (inclusive) for short, single-line texts to morph letter-by-letter. Longer blocks crossfade. */
export const SHORT_TEXT_THRESHOLD = 60;
/** Crossfade timing for blocks that are too long or multi-line to letter-morph cleanly. */
export const FADE_OUT_MS = 180;
export const FADE_IN_AFTER_MS = 120;
export const FADE_IN_MS = 280;

/** When the fade-out and fade-in of a crossfading block start and how long they run, in ms. */
export function fadeTiming(): { out: { delay: number; duration: number }; in: { delay: number; duration: number } } {
  return {
    out: { delay: 0, duration: FADE_OUT_MS },
    in: { delay: FADE_IN_AFTER_MS, duration: FADE_IN_MS },
  };
}

/**
 * Chooses the morph style: short single-line texts (titles, labels, nav, the name note, dates) morph letter by letter,
 * while longer visible blocks crossfade cleanly instead of crossing letters across multiple lines.
 */
export function morphStyle(oldText: string, newText: string): 'letters' | 'fade' {
  const oldClean = oldText.trim();
  const newClean = newText.trim();
  const isSingleLine = !oldClean.includes('\n') && !newClean.includes('\n');
  const isShort = Array.from(oldClean).length <= SHORT_TEXT_THRESHOLD && Array.from(newClean).length <= SHORT_TEXT_THRESHOLD;
  return isSingleLine && isShort ? 'letters' : 'fade';
}

/**
 * One step of the alignment, in display order. `keep` is a character shared by both texts (it slides from `from` to
 * `to`), `exit` a character of the old text that leaves, `enter` a character of the new text that arrives.
 */
export type AlignStep = { kind: 'keep'; from: number; to: number } | { kind: 'exit'; from: number } | { kind: 'enter'; to: number };

/**
 * The longest common subsequence of the two character lists decides what is kept. Ties favour the exit, so a removed
 * character leaves before its neighbours move. A kept character with no kept neighbour is a coincidence (a letter
 * shared by two unrelated texts), so it leaves and arrives instead of sliding across the line. Returns null when either
 * side is too long to align.
 */
export function alignChars(from: readonly string[], to: readonly string[]): AlignStep[] | null {
  const n = from.length;
  const m = to.length;
  if (n > MAX_ALIGN || m > MAX_ALIGN) return null;

  // suffix[i][j]: the length of the longest common subsequence of from[i..] and to[j..]
  const width = m + 1;
  const suffix = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      suffix[i * width + j] =
        from[i] === to[j] ? suffix[(i + 1) * width + j + 1] + 1 : Math.max(suffix[(i + 1) * width + j], suffix[i * width + j + 1]);
    }
  }

  const steps: AlignStep[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && from[i] === to[j] && suffix[i * width + j] === suffix[(i + 1) * width + j + 1] + 1) {
      steps.push({ kind: 'keep', from: i, to: j });
      i++;
      j++;
    } else if (i < n && (j >= m || suffix[(i + 1) * width + j] >= suffix[i * width + j + 1])) {
      steps.push({ kind: 'exit', from: i });
      i++;
    } else {
      steps.push({ kind: 'enter', to: j });
      j++;
    }
  }
  const out: AlignStep[] = [];
  steps.forEach((step, index) => {
    const lone = steps[index - 1]?.kind !== 'keep' && steps[index + 1]?.kind !== 'keep';
    if (step.kind === 'keep' && lone) out.push({ kind: 'exit', from: step.from }, { kind: 'enter', to: step.to });
    else out.push(step);
  });
  return out;
}

/** When the k-th character of a morph starts, in ms: a short stagger, capped so a long block still lands in time. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * STAGGER_MS, MAX_STAGGER_MS);
}

/** When a step starts and how long it runs, in ms. The whole morph lands within about 660 ms, however long the text. */
export function glyphTiming(kind: AlignStep['kind'], index: number): { delay: number; duration: number } {
  const stagger = staggerDelay(index);
  if (kind === 'exit') return { delay: stagger, duration: EXIT_MS };
  if (kind === 'enter') return { delay: ENTER_AFTER_MS + stagger, duration: MOVE_MS };
  return { delay: stagger, duration: MOVE_MS };
}

/** A block morphs only if its text changed, it has text on both sides, and it is short enough to align. */
export function isMorphable(oldText: string, newText: string): boolean {
  if (oldText === newText || oldText.length === 0 || newText.length === 0) return false;
  return Array.from(oldText).length <= MAX_ALIGN && Array.from(newText).length <= MAX_ALIGN;
}

/** The home page of each language. The CV pages are not part of the morph. */
const HOME: Record<Lang, string> = { fr: '/', en: '/en/' };

/** The language of a home page path (`/` or `/en/`), or null for any other page. */
export function langOfPath(pathname: string): Lang | null {
  if (pathname === HOME.fr) return 'fr';
  if (pathname === HOME.en || pathname === '/en') return 'en';
  return null;
}

/** The other home page for a home page path, or null off the home pages. */
export function switchTarget(pathname: string): string | null {
  const lang = langOfPath(pathname);
  if (!lang) return null;
  return HOME[lang === 'fr' ? 'en' : 'fr'];
}

/** The part of a mouse or keyboard click that decides whether the browser should keep its own behaviour. */
export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A plain primary click: a modifier or a middle click asks for a new tab or window, so the browser keeps it. */
export function isPlainClick(click: ClickLike): boolean {
  return click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;
}

/**
 * The path a click should morph to, or null when the browser should navigate as usual: the link must be the other
 * home page of this site, the click plain, and motion not reduced. `here` is the page now shown, `href` the link.
 */
export function morphTarget(here: string, href: string, click: ClickLike, reduced: boolean): string | null {
  if (reduced || !isPlainClick(click)) return null;
  const current = new URL(here);
  const link = new URL(href, current);
  // the fetched page is injected into this one: another origin is never read
  if (link.origin !== current.origin) return null;
  const target = switchTarget(current.pathname);
  if (!target) return null;
  return link.pathname === target || (target === HOME.en && link.pathname === '/en') ? target : null;
}
