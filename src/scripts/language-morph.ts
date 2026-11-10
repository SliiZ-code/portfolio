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

/**
 * One step of the alignment, in display order. `keep` is a character shared by both texts (it slides from `from` to
 * `to`), `exit` a character of the old text that leaves, `enter` a character of the new text that arrives.
 */
export type AlignStep = { kind: 'keep'; from: number; to: number } | { kind: 'exit'; from: number } | { kind: 'enter'; to: number };

/**
 * The longest common subsequence of the two character lists decides what is kept. Ties favour the exit, so a removed
 * character leaves before its neighbours move. Returns null when either side is too long to align.
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
  return steps;
}

/** When the k-th character of a morph starts, in ms: a short stagger, capped so a long block still lands in time. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * STAGGER_MS, MAX_STAGGER_MS);
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
 * home page, the click plain, and motion not reduced. `from` is the page now shown, `href` the link's absolute URL.
 */
export function morphTarget(from: string, href: string, click: ClickLike, reduced: boolean): string | null {
  if (reduced || !isPlainClick(click)) return null;
  const target = switchTarget(from);
  if (!target) return null;
  const to = new URL(href).pathname;
  return to === target || (target === HOME.en && to === '/en') ? target : null;
}
