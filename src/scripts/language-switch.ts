// Language morph: the DOM driver. On a home page, the other language's flag keeps you here: the other home page is fetched,
// its text is written into the live page, and the blocks in view morph (language-morph.ts decides the alignment). The
// page is not rebuilt: canvases and the hero board's counters keep their identity, and the scripts that bind to changed
// parts are run again. Anything unexpected returns false and the caller navigates as usual.

import {
  alignChars,
  FADE_IN_AFTER_MS,
  FADE_IN_MS,
  FADE_OUT_MS,
  glyphTiming,
  isMorphable,
  langOfPath,
  morphStyle,
  morphTarget,
} from './language-morph';
import { initCommandPalette } from './command-palette';
import { initMagnetType } from './magnet-type';
import { refreshPixelTitles } from './pixel-title';
import { syncThemeLabels } from './ui';

const REDUCED = '(prefers-reduced-motion: reduce)';
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/** The fetch of the other page gives up after this long: the flag then navigates as usual, so it never hangs. */
const FETCH_TIMEOUT_MS = 4000;
/** The head elements whose content depends on the language. */
const HEAD = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:locale"]',
  'meta[property="og:url"]',
  'link[rel="canonical"]',
];
/** Attributes the page's own scripts set or own: the swap never copies them over. */
const OWN_ATTRIBUTES = new Set([
  'class',
  'style',
  'hidden',
  'open',
  'width',
  'height',
  'value',
  'aria-expanded',
  'aria-selected',
  'aria-activedescendant',
  'aria-haspopup',
  // set at runtime: the board's entry, and the text a pixel title was drawn with (pixel-title.ts)
  'data-entry',
  'data-pt-text',
]);
/** Elements that are not page content. */
const NOT_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);

interface Glyph {
  ch: string;
  left: number;
  top: number;
}

interface LetterJob {
  style: 'letters';
  host: HTMLElement;
  before: Glyph[];
  typography: Record<string, string>;
  colour: string;
}

interface FadeJob {
  style: 'fade';
  host: HTMLElement;
  snapshot: HTMLElement;
  beforeRect: DOMRect;
  colour: string;
  opacity: string;
  height: string;
  overflow: string;
}

/** A block whose text changes and is morphed: either letter-by-letter (short text) or crossfaded (long/multiline). */
type Job = LetterJob | FadeJob;

let initialised = false;
let busy = false;

/* ---- the tree: the parts of a node that are page content ---- */

const isPart = (node: Node): boolean => {
  if (node.nodeType === Node.COMMENT_NODE) return false;
  if (node.nodeType === Node.ELEMENT_NODE) return !NOT_CONTENT.has((node as Element).tagName);
  return node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim() !== '';
};
const parts = (node: Node): ChildNode[] => [...node.childNodes].filter(isPart);
const kindOf = (node: ChildNode): string => (node.nodeType === Node.TEXT_NODE ? '#text' : (node as Element).tagName);
/** The same parts in the same order: the two blocks pair up child by child. */
const sameShape = (a: ChildNode[], b: ChildNode[]): boolean => a.length === b.length && a.every((node, i) => kindOf(node) === kindOf(b[i]));
/** A canvas, or an element a script owns (the hero's counters, the palette's key): its attributes follow, its content stays. */
const keep = (el: Element): boolean => el.tagName === 'CANVAS' || el.hasAttribute('data-keep');

const syncAttributes = (live: Element, next: Element): void => {
  // the theme toggle's title and label follow the theme (syncThemeLabels), not the page
  const toggle = live.hasAttribute('data-theme-toggle');
  const owned = (name: string) => OWN_ATTRIBUTES.has(name) || (toggle && (name === 'title' || name === 'aria-label'));
  for (const { name } of [...live.attributes]) {
    if (!owned(name) && !next.hasAttribute(name)) live.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    // an inline handler would run fetched markup as script: the pages carry none, so none is copied
    if (name.startsWith('on') || owned(name)) continue;
    if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
};

/** Writes the next page's content into the live one, child by child; a block whose parts differ is replaced whole. */
function syncChildren(live: Element, next: Element): void {
  const a = parts(live);
  const b = parts(next);
  if (!sameShape(a, b)) {
    const fresh = [...next.childNodes]
      .filter((node) => !(node.nodeType === Node.ELEMENT_NODE && NOT_CONTENT.has((node as Element).tagName)))
      .map((node) => document.importNode(node, true));
    // the fetched page's scripts are not run: the page's own scripts are already here
    for (const node of fresh) {
      if (node instanceof Element) node.querySelectorAll('script').forEach((script) => script.remove());
    }
    live.replaceChildren(...fresh);
    return;
  }
  a.forEach((node, i) => {
    const other = b[i];
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data !== (other as Text).data) (node as Text).data = (other as Text).data;
      return;
    }
    syncAttributes(node as Element, other as Element);
    if (!keep(node as Element)) syncChildren(node as Element, other as Element);
  });
}

/* ---- the glyphs: the visible characters of a block, each with its box in the viewport ---- */

const inView = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
};

function glyphsOf(host: Element): Glyph[] {
  const out: Glyph[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // the visually hidden copy of a split name is not a glyph: the letters are
    const hidden = node.parentElement?.closest('.sr-only');
    if (hidden && host.contains(hidden)) continue;
    const text = node.nodeValue ?? '';
    let offset = 0;
    for (const ch of text) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + ch.length);
      const r = range.getBoundingClientRect();
      out.push({ ch, left: r.left, top: r.top });
      offset += ch.length;
    }
  }
  return out;
}

const typographyOf = (host: HTMLElement): Record<string, string> => {
  const cs = getComputedStyle(host);
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontVariationSettings: cs.fontVariationSettings,
    letterSpacing: cs.letterSpacing,
    textTransform: cs.textTransform,
    color: cs.color,
  };
};

function styleSnapshot(snapshot: HTMLElement, host: HTMLElement, rect: DOMRect): void {
  const cs = getComputedStyle(host);
  snapshot.removeAttribute('id');
  snapshot.setAttribute('aria-hidden', 'true');
  Object.assign(snapshot.style, {
    position: 'absolute',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    padding: cs.padding,
    border: cs.border,
    boxSizing: 'border-box',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontVariationSettings: cs.fontVariationSettings,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    textAlign: cs.textAlign,
    textTransform: cs.textTransform,
    color: cs.color,
    background: 'transparent',
    pointerEvents: 'none',
  });
  const textWrap = cs.getPropertyValue('text-wrap');
  if (textWrap) snapshot.style.setProperty('text-wrap', textWrap);
}

/** A text block that changes and is in view: its old characters or snapshot are measured before the swap. */
function blockJob(host: Element, nextText: string): Job | null {
  if (!(host instanceof HTMLElement) || host.closest('[data-pixel-title], .sr-only') || !inView(host)) return null;
  const oldText = host.textContent ?? '';
  if (!isMorphable(oldText, nextText)) return null;
  const style = morphStyle(oldText, nextText);
  if (style === 'letters') {
    const before = glyphsOf(host);
    if (before.length === 0) return null;
    return { style: 'letters', host, before, typography: typographyOf(host), colour: host.style.color };
  }
  const beforeRect = host.getBoundingClientRect();
  const snapshot = host.cloneNode(true) as HTMLElement;
  styleSnapshot(snapshot, host, beforeRect);
  return {
    style: 'fade',
    host,
    snapshot,
    beforeRect,
    colour: host.style.color,
    opacity: host.style.opacity,
    height: host.style.height,
    overflow: host.style.overflow,
  };
}

/** The blocks to morph: the leaves (text only in the next page) in view whose text changes. Read only. */
function collect(live: Element, next: Element, jobs: Job[]): void {
  if (keep(live)) return;
  const nextParts = parts(next);
  if (nextParts.length > 0 && nextParts.every((node) => node.nodeType === Node.TEXT_NODE)) {
    const job = blockJob(live, next.textContent ?? '');
    if (job) jobs.push(job);
    return;
  }
  const liveParts = parts(live);
  if (!sameShape(liveParts, nextParts)) return;
  liveParts.forEach((node, i) => {
    if (node.nodeType === Node.ELEMENT_NODE) collect(node as Element, nextParts[i] as Element, jobs);
  });
}

/* ---- the morph: the characters slide, fade or roll over the new text ---- */

/** Puts back styles the morph modified, leaving no empty style attribute behind (the page had none there). */
const restoreHost = (job: Job): void => {
  if (job.style === 'letters') {
    if (job.colour) job.host.style.color = job.colour;
    else job.host.style.removeProperty('color');
  } else {
    if (job.colour) job.host.style.color = job.colour;
    else job.host.style.removeProperty('color');
    if (job.opacity) job.host.style.opacity = job.opacity;
    else job.host.style.removeProperty('opacity');
    if (job.height) job.host.style.height = job.height;
    else job.host.style.removeProperty('height');
    if (job.overflow) job.host.style.overflow = job.overflow;
    else job.host.style.removeProperty('overflow');
  }
  if (job.host.style.length === 0 || job.host.getAttribute('style') === '') {
    job.host.removeAttribute('style');
  }
};

/**
 * Runs the moves of the given blocks. The real text is already the new one; short blocks morph letter by letter,
 * while longer visible blocks crossfade cleanly (old text fades out over ~180 ms, new text fades in over ~280 ms
 * starting ~120 ms, height animating smoothly if it changes).
 */
async function animate(jobs: Job[]): Promise<void> {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10', overflow: 'hidden' });
  const animations: Animation[] = [];
  const shown: Job[] = [];
  let end = 0;

  // read first, then write: measure the new state of every block in one layout
  const measured = jobs
    // a block the page swapped out (its parent's children were replaced) has no place to morph
    .filter((job) => job.host.isConnected)
    .map((job) => {
      if (job.style === 'letters') {
        return { job, afterGlyphs: glyphsOf(job.host), afterRect: null };
      }
      return { job, afterGlyphs: null, afterRect: job.host.getBoundingClientRect() };
    });

  for (const item of measured) {
    if (item.job.style === 'letters') {
      const { job, afterGlyphs } = item;
      const steps = alignChars(
        job.before.map((g) => g.ch),
        afterGlyphs!.map((g) => g.ch),
      );
      if (!steps) continue;
      shown.push(job);
      const size = parseFloat(job.typography.fontSize) || 16;
      const drop = `translateY(${0.4 * size}px)`;

      const glyphSpan = (g: Glyph): HTMLSpanElement => {
        const span = document.createElement('span');
        span.textContent = g.ch;
        Object.assign(span.style, job.typography, {
          position: 'absolute',
          left: `${g.left}px`,
          top: `${g.top}px`,
          margin: '0',
          padding: '0',
          whiteSpace: 'pre',
          lineHeight: 'normal',
        });
        layer.append(span);
        return span;
      };

      steps.forEach((step, index) => {
        const { delay, duration } = glyphTiming(step.kind, index);
        end = Math.max(end, delay + duration);
        let span: HTMLSpanElement;
        let frames: Keyframe[];
        let easing = EASE;
        if (step.kind === 'keep') {
          // a shared character slides from where it was to where it is now (FLIP)
          const from = job.before[step.from]!;
          const to = afterGlyphs![step.to]!;
          span = glyphSpan(from);
          frames = [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }];
        } else if (step.kind === 'exit') {
          span = glyphSpan(job.before[step.from]!);
          // a removed character fades out at once: it leaves rather than lingering over the new text
          frames = [{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: drop }];
          easing = 'ease-out';
        } else {
          span = glyphSpan(afterGlyphs![step.to]!);
          frames = [{ opacity: 0, transform: drop }, { opacity: 1, transform: 'translateY(0px)' }];
        }
        animations.push(span.animate(frames, { duration, delay, easing, fill: 'both' }));
      });
    } else {
      const { job, afterRect } = item;
      shown.push(job);
      layer.append(job.snapshot);

      // Old snapshot overlay fades out (~180 ms)
      animations.push(
        job.snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: FADE_OUT_MS,
          easing: 'ease-out',
          fill: 'both',
        }),
      );

      // Real element fades in (~280 ms, starting ~120 ms)
      job.host.style.opacity = '0';
      animations.push(
        job.host.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_IN_MS,
          delay: FADE_IN_AFTER_MS,
          easing: 'ease-out',
          fill: 'both',
        }),
      );

      // Animate height smoothly if it changes
      const hBefore = job.beforeRect.height;
      const hAfter = afterRect!.height;
      if (Math.abs(hBefore - hAfter) > 0.5) {
        job.host.style.overflow = 'hidden';
        animations.push(
          job.host.animate([{ height: `${hBefore}px` }, { height: `${hAfter}px` }], {
            duration: FADE_IN_AFTER_MS + FADE_IN_MS,
            easing: EASE,
            fill: 'both',
          }),
        );
      }
      end = Math.max(end, FADE_IN_AFTER_MS + FADE_IN_MS);
    }
  }

  if (animations.length === 0) return;
  for (const job of shown) {
    if (job.style === 'letters') job.host.style.color = 'transparent';
  }
  document.body.append(layer);
  // a safety net: the morph ends on time even if an animation never reports finished
  let timer = 0;
  const timeout = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, end + 200);
  });
  try {
    await Promise.race([Promise.allSettled(animations.map((a) => a.finished)), timeout]);
  } finally {
    clearTimeout(timer);
    layer.remove();
    for (const job of shown) restoreHost(job);
  }
}

/* ---- the swap: head, content, and the scripts that bind to what changed ---- */

const syncHead = (next: Document): void => {
  document.title = next.title;
  for (const selector of HEAD) {
    const live = document.head.querySelector(selector);
    const other = next.head.querySelector(selector);
    if (live && other) syncAttributes(live, other);
  }
};

/** Runs again what binds to changed parts. The hero board is not among them: it keeps running. */
const rebind = (): void => {
  syncThemeLabels();
  initCommandPalette();
  document.querySelectorAll<HTMLElement>('[data-hover-index]').forEach((list) => initMagnetType(list));
  refreshPixelTitles();
  // the name note's text changed: the board measures its keep-clear box again (board/index.ts)
  document.dispatchEvent(new Event('languageswap'));
};

async function apply(next: Document): Promise<void> {
  const focusOnFlag = document.activeElement?.matches('a[data-lang-switch]') ?? false;
  const y = scrollY;
  document.querySelector<HTMLDialogElement>('dialog.cmdk')?.close();
  // the language is set before the swap: the page reads as the new language from here on
  document.documentElement.lang = next.documentElement.lang;
  syncHead(next);

  const jobs: Job[] = [];
  collect(document.body, next.body, jobs);
  syncChildren(document.body, next.body);
  rebind();
  // the page keeps its place: a change above the view must not move what is in it
  if (scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' });
  // the flag that was focused is now the link back: focus stays on the flags
  if (focusOnFlag) document.querySelector<HTMLElement>('a[data-lang-switch]')?.focus({ preventScroll: true });

  await animate(jobs);
}

/** Fetches the other home page; null when anything is off (the caller then navigates as usual). */
async function fetchHome(href: string): Promise<Document | null> {
  try {
    const res = await fetch(href, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const next = new DOMParser().parseFromString(await res.text(), 'text/html');
    const lang = langOfPath(new URL(href).pathname);
    return lang && next.documentElement.lang === lang && next.querySelector('main') && next.body ? next : null;
  } catch {
    return null;
  }
}

/**
 * Morphs the page to the home page at `href`. Resolves false, without touching the page, when the morph cannot run:
 * the caller then navigates. `push` adds a history entry (a click); popstate passes false.
 */
export async function morphTo(href: string, push: boolean): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const next = await fetchHome(href);
    if (!next || !sameShape(parts(document.body), parts(next.body))) return false;
    if (push) history.pushState(null, '', new URL(href).pathname);
    await apply(next);
    return true;
  } catch {
    // the page may be half swapped. Once the URL is the target's, a reload shows the target page whole; before that,
    // the page is untouched and the caller navigates as usual
    if (location.pathname !== new URL(href).pathname) return false;
    location.reload();
    return true;
  } finally {
    busy = false;
  }
}

const onClick = (event: MouseEvent): void => {
  if (event.defaultPrevented) return;
  const link = (event.target as Element | null)?.closest?.('a[data-lang-switch]') as HTMLAnchorElement | null | undefined;
  if (!link) return;
  const reduced = matchMedia(REDUCED).matches;
  if (!morphTarget(location.href, link.href, event, reduced)) return;
  event.preventDefault();
  void morphTo(link.href, true).then((done) => {
    if (!done) location.assign(link.href);
  });
};

const onPopState = (): void => {
  const lang = langOfPath(location.pathname);
  if (!lang || lang === document.documentElement.lang) return;
  if (matchMedia(REDUCED).matches) return location.reload();
  void morphTo(location.href, false).then((done) => {
    if (!done) location.reload();
  });
};

/** Once per page: the flags morph, and back and forward move between the two languages the same way. */
export function initLanguageSwitch(): void {
  if (initialised || typeof history === 'undefined' || typeof DOMParser === 'undefined') return;
  initialised = true;
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', onPopState);
}
