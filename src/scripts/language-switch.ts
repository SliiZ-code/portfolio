// Language morph: the DOM driver. On a home page, the other language's flag keeps you here: the other home page is fetched,
// its text is written into the live page, and the blocks in view morph (language-morph.ts decides the alignment). The
// page is not rebuilt: canvases and the hero board's counters keep their identity, and the scripts that bind to changed
// parts are run again. Anything unexpected returns false and the caller navigates as usual.

import { alignChars, isMorphable, langOfPath, MAX_STAGGER_MS, morphTarget, staggerDelay } from './language-morph';
import { initCommandPalette } from './command-palette';
import { initMagnetType } from './magnet-type';
import { refreshPixelTitles } from './pixel-title';
import { syncThemeLabels } from './ui';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** How long one character takes to slide, fade or roll in; the stagger comes on top. */
const MOVE_MS = 420;
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
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

/** A block whose text changes and is morphed: its characters where they were, and how it is styled. */
interface Job {
  host: HTMLElement;
  before: Glyph[];
  typography: Record<string, string>;
  colour: string;
}

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
/** A canvas, or an element a script owns (the hero's counters): its attributes follow, its content stays. */
const keep = (el: Element): boolean => el.tagName === 'CANVAS' || el.hasAttribute('data-keep');

const syncAttributes = (live: Element, next: Element): void => {
  // the theme toggle's title and label follow the theme (syncThemeLabels), not the page
  const toggle = live.hasAttribute('data-theme-toggle');
  const owned = (name: string) => OWN_ATTRIBUTES.has(name) || (toggle && (name === 'title' || name === 'aria-label'));
  for (const { name } of [...live.attributes]) {
    if (!owned(name) && !next.hasAttribute(name)) live.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    if (!owned(name) && live.getAttribute(name) !== value) live.setAttribute(name, value);
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

/** A text block that changes and is in view: its old characters are measured before the swap. */
function blockJob(host: Element, nextText: string): Job | null {
  if (!(host instanceof HTMLElement) || host.closest('[data-pixel-title], .sr-only') || !inView(host)) return null;
  const before = glyphsOf(host);
  if (!isMorphable(before.map((g) => g.ch).join(''), nextText)) return null;
  return { host, before, typography: typographyOf(host), colour: host.style.color };
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

/** Runs the moves of the given blocks. The real text is already the new one; it is hidden until the characters land. */
async function animate(jobs: Job[]): Promise<void> {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10', overflow: 'hidden' });
  const animations: Animation[] = [];
  const shown: Job[] = [];

  // read first, then write: the new glyphs of every block are measured in one layout
  const measured = jobs
    // a block the page swapped out (its parent's children were replaced) has no place to morph
    .filter((job) => job.host.isConnected)
    .map((job) => ({ job, after: glyphsOf(job.host) }));

  for (const { job, after } of measured) {
    const steps = alignChars(
      job.before.map((g) => g.ch),
      after.map((g) => g.ch),
    );
    if (!steps) continue;
    shown.push(job);
    job.host.style.color = 'transparent';
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
      const delay = staggerDelay(index);
      if (step.kind === 'keep') {
        const from = job.before[step.from]!;
        const to = after[step.to]!;
        const span = glyphSpan(from);
        const move = `translate(${to.left - from.left}px, ${to.top - from.top}px)`;
        animations.push(span.animate([{ transform: 'translate(0px, 0px)' }, { transform: move }], { duration: MOVE_MS, delay, easing: EASE, fill: 'both' }));
      } else if (step.kind === 'exit') {
        const span = glyphSpan(job.before[step.from]!);
        animations.push(
          span.animate([{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: drop }], {
            duration: MOVE_MS * 0.7,
            delay,
            easing: 'ease-in',
            fill: 'both',
          }),
        );
      } else {
        const span = glyphSpan(after[step.to]!);
        animations.push(
          span.animate([{ opacity: 0, transform: drop }, { opacity: 1, transform: 'translateY(0px)' }], { duration: MOVE_MS, delay, easing: EASE, fill: 'both' }),
        );
      }
    });
  }

  if (animations.length === 0) return;
  document.body.append(layer);
  // a safety net: the morph ends on time even if an animation never reports finished
  const timeout = new Promise((resolve) => setTimeout(resolve, MOVE_MS + MAX_STAGGER_MS + 200));
  await Promise.race([Promise.allSettled(animations.map((a) => a.finished)), timeout]);
  layer.remove();
  for (const job of shown) job.host.style.color = job.colour;
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
    const res = await fetch(href, { headers: { accept: 'text/html' } });
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
  } finally {
    busy = false;
  }
}

const onClick = (event: MouseEvent): void => {
  if (event.defaultPrevented) return;
  const link = (event.target as Element | null)?.closest?.('a[data-lang-switch]') as HTMLAnchorElement | null | undefined;
  if (!link) return;
  const reduced = matchMedia(REDUCED).matches;
  if (!morphTarget(location.pathname, link.href, event, reduced)) return;
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
