// Language morph: the DOM driver. On a home page, the other language's flag keeps you here: the other home page is fetched,
// its text is written into the live page, and the blocks in view change. A short line of text morphs letter by letter, a
// longer block crossfades (language-morph.ts decides which, and the alignment). The page is not rebuilt: canvases and the
// hero board's counters keep their identity, and the scripts that bind to changed parts are run again. Anything
// unexpected returns false and the caller navigates as usual.

import {
  alignChars,
  FADE_IN_AFTER_MS,
  FADE_IN_MS,
  FADE_OUT_MS,
  glyphTiming,
  isMorphable,
  isOneLine,
  isShortText,
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
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
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

/** A block whose text changes: its old text and how it looked, read before the swap. */
interface Job {
  host: HTMLElement;
  oldText: string;
  /** The old characters, for a letter morph: empty unless the old text is short. */
  before: Glyph[];
  typography: Record<string, string>;
  /** Where the old block was, in the viewport. */
  box: DOMRect;
  /** A copy of the old block, for a crossfade. */
  snapshot: HTMLElement;
  /** The page's own inline values for the styles the morph may change; put back afterwards. */
  inline: Record<string, string>;
}

/** The inline styles the morph may change on a block. */
const MORPHED_STYLES = ['color', 'opacity', 'height', 'overflow'];

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
  // a video's source is set when the video is first needed (ProjectMedia): the fetched page has none, so it stays
  const video = live.tagName === 'VIDEO';
  const owned = (name: string) =>
    OWN_ATTRIBUTES.has(name) || (toggle && (name === 'title' || name === 'aria-label')) || (video && name === 'src');
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

/** The text nodes a reader sees in `root`: the visually hidden copy of a split name (magnet-type) is not one. */
function visibleNodes(root: Element): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const hidden = (node as Text).parentElement?.closest('.sr-only');
    if (!hidden || !root.contains(hidden)) out.push(node as Text);
  }
  return out;
}

const visibleText = (root: Element): string => visibleNodes(root).map((node) => node.nodeValue ?? '').join('');

function glyphsOf(host: Element): Glyph[] {
  const out: Glyph[] = [];
  for (const node of visibleNodes(host)) {
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

/**
 * A copy of the old block, to fade out while the new text fades in. It takes the block's computed style, so it wraps
 * exactly as the block did; only what would place it or animate it is left out. It is not focusable and not read out.
 */
const OWN_LAYOUT = /^(position|inset|top|left|right|bottom|margin|width|height|inline-size|block-size|min-|max-|transform|transition|animation|opacity|visibility|pointer-events|z-index|display|contain|will-change)/;

function copyOf(host: HTMLElement, box: DOMRect): HTMLElement {
  const cs = getComputedStyle(host);
  const copy = host.cloneNode(true) as HTMLElement;
  // ids would duplicate the page's while both exist
  for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    if (!OWN_LAYOUT.test(prop)) copy.style.setProperty(prop, cs.getPropertyValue(prop));
  }
  Object.assign(copy.style, {
    position: 'absolute',
    margin: '0',
    boxSizing: 'border-box',
    width: `${box.width}px`,
    height: `${box.height}px`,
    background: 'transparent',
    pointerEvents: 'none',
  });
  return copy;
}

const inlineOf = (host: HTMLElement): Record<string, string> =>
  Object.fromEntries(MORPHED_STYLES.map((prop) => [prop, host.style.getPropertyValue(prop)]));

/** A text block that changes and is in view: its old text, characters and look are read before the swap. */
function blockJob(host: Element, next: Element): Job | null {
  if (!(host instanceof HTMLElement) || host.closest('[data-pixel-title], .sr-only') || !inView(host)) return null;
  const oldText = visibleText(host);
  if (!isMorphable(oldText, visibleText(next))) return null;
  const box = host.getBoundingClientRect();
  return {
    host,
    oldText,
    before: isShortText(oldText) ? glyphsOf(host) : [],
    typography: typographyOf(host),
    box,
    snapshot: copyOf(host, box),
    inline: inlineOf(host),
  };
}

/** The blocks to morph: the leaves (text only in the next page) in view whose text changes. Read only. */
function collect(live: Element, next: Element, jobs: Job[]): void {
  if (keep(live)) return;
  const nextParts = parts(next);
  if (nextParts.length > 0 && nextParts.every((node) => node.nodeType === Node.TEXT_NODE)) {
    const job = blockJob(live, next);
    if (job) jobs.push(job);
    return;
  }
  const liveParts = parts(live);
  if (!sameShape(liveParts, nextParts)) return;
  liveParts.forEach((node, i) => {
    if (node.nodeType === Node.ELEMENT_NODE) collect(node as Element, nextParts[i] as Element, jobs);
  });
}

/* ---- the morph: letters slide, fade or roll over the new text; a longer block crossfades ---- */

/** Puts back the inline styles the morph changed, and leaves no empty style attribute behind (the page had none there). */
function restoreInline(host: HTMLElement, saved: Record<string, string>): void {
  for (const prop of MORPHED_STYLES) {
    if (saved[prop]) host.style.setProperty(prop, saved[prop]);
    else host.style.removeProperty(prop);
  }
  if (host.getAttribute('style') === '') host.removeAttribute('style');
}

/**
 * Runs the morph of the given blocks. The real text is already the new one. A short text on one line morphs letter by
 * letter; any other block crossfades: the old copy fades out (~180 ms), the new text fades in (~280 ms from ~120 ms),
 * and the height eases if it changed. Everything the morph adds is removed, and every style it touched is put back,
 * in `finally`: even when it fails part way, or an animation never ends.
 */
async function animate(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;
  // a layer in the page (not the viewport): the morph scrolls with the text it covers, and stays where the text is
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '10', pointerEvents: 'none' });
  const animations: Animation[] = [];
  let shown: Job[] = [];
  let timer = 0;
  try {
    document.body.append(layer);
    const origin = layer.getBoundingClientRect();

    // read first, then write: the new state of every block is measured in one pass
    const plans = jobs
      // a block the page swapped out (its parent's children were replaced) has no place to morph
      .filter((job) => job.host.isConnected)
      .map((job) => {
        const newText = visibleText(job.host);
        const size = parseFloat(job.typography.fontSize) || 16;
        const after = isShortText(newText) && job.before.length > 0 ? glyphsOf(job.host) : [];
        const style = morphStyle(
          job.oldText,
          newText,
          isOneLine(job.before.map((g) => g.left), size),
          isOneLine(after.map((g) => g.left), size),
        );
        const steps = style === 'letters' ? alignChars(job.before.map((g) => g.ch), after.map((g) => g.ch)) : null;
        return { job, steps, after, newHeight: job.host.getBoundingClientRect().height };
      });
    shown = plans.map((plan) => plan.job);

    let end = 0;
    for (const { job, steps, after, newHeight } of plans) {
      if (steps) {
        const size = parseFloat(job.typography.fontSize) || 16;
        const drop = `translateY(${0.4 * size}px)`;
        job.host.style.color = 'transparent';
        const span = (g: Glyph): HTMLSpanElement => {
          const el = document.createElement('span');
          el.textContent = g.ch;
          // a character of the old or new text, placed over its own spot in the layer
          Object.assign(el.style, job.typography, {
            position: 'absolute',
            left: `${g.left - origin.left}px`,
            top: `${g.top - origin.top}px`,
            margin: '0',
            padding: '0',
            whiteSpace: 'pre',
            lineHeight: 'normal',
          });
          layer.append(el);
          return el;
        };

        steps.forEach((step, index) => {
          const { delay, duration } = glyphTiming(step.kind, index);
          end = Math.max(end, delay + duration);
          let el: HTMLSpanElement;
          let frames: Keyframe[];
          let easing = EASE;
          if (step.kind === 'keep') {
            // a shared character slides from where it was to where it is now (FLIP)
            const from = job.before[step.from]!;
            const to = after[step.to]!;
            el = span(from);
            frames = [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }];
          } else if (step.kind === 'exit') {
            el = span(job.before[step.from]!);
            // a removed character fades out at once: it leaves rather than lingering over the new text
            frames = [{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: drop }];
            easing = 'ease-out';
          } else {
            el = span(after[step.to]!);
            frames = [{ opacity: 0, transform: drop }, { opacity: 1, transform: 'translateY(0px)' }];
          }
          animations.push(el.animate(frames, { duration, delay, easing, fill: 'both' }));
        });
        continue;
      }

      // the old copy is laid over the block's old place and fades out; the new text fades in beneath it
      job.snapshot.style.left = `${job.box.left - origin.left}px`;
      job.snapshot.style.top = `${job.box.top - origin.top}px`;
      layer.append(job.snapshot);
      animations.push(job.snapshot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: 'ease-out', fill: 'both' }));
      job.host.style.opacity = '0';
      animations.push(
        job.host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, delay: FADE_IN_AFTER_MS, easing: 'ease-out', fill: 'both' }),
      );
      // the height eases to the new one, so the blocks below move smoothly rather than in one jump
      if (Math.abs(job.box.height - newHeight) > 0.5) {
        job.host.style.overflow = 'hidden';
        animations.push(
          job.host.animate([{ height: `${job.box.height}px` }, { height: `${newHeight}px` }], {
            duration: FADE_IN_AFTER_MS + FADE_IN_MS,
            easing: EASE,
            fill: 'both',
          }),
        );
      }
      end = Math.max(end, FADE_IN_AFTER_MS + FADE_IN_MS);
    }

    // a safety net: the morph ends on time even if an animation never reports finished
    const timeout = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, end + 200);
    });
    await Promise.race([Promise.allSettled(animations.map((a) => a.finished)), timeout]);
  } finally {
    clearTimeout(timer);
    // the animations end first, so the page's own styles are back, then the overlay goes and the blocks are restored
    for (const animation of animations) animation.cancel();
    layer.remove();
    for (const job of shown) restoreInline(job.host, job.inline);
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
