// Life in the side margins of the home page (docs/plan-home-v3.md, wave 3, I).
// The text column keeps clear. In the gutters beside it, every section boundary fires a stream of gliders that
// travel down and outward, away from the text. The same rules as the hero's board, run sparsely: a strip is a
// narrow gutter the height of the section, and a generation touches only the live cells and their neighbours, so
// its cost follows what is alive, not the page's area. Each living cell is an element in its gutter, so a
// generation repaints only the cells that changed. Nothing runs while the section is off screen, the tab is hidden
// or the reader asked for less motion.
import { rectToBox, type Box } from './board/layout';
import { GLIDER_HEADINGS } from './board/patterns';
import { ageBucket } from './board/render';

/** Below this width the gutters are too thin to hold anything: the layer stays hidden. */
export const MIN_VIEWPORT = 900;
/** Cells kept free between the text and the life, on each side of the column. */
export const CLEARANCE = 2;
/** A gutter narrower than this many cells stays empty. */
export const MIN_GUTTER = 6;
/** Generations between two gliders from one source (wide enough that neighbouring gliders never touch). */
export const EMIT_EVERY = 18;
/** Twelve generations a second, like the board. */
export const STEP_MS = 1000 / 12;
/** Size changes under this (mobile toolbars, a small height drift) keep the world as it is. */
export const REBUILD_PX = 120;
/** Ambient: the margins are a texture behind the text, not a second board. */
export const LIFE_OPACITY = 0.7;
/** Generations run before the first frame, so a reader never sees an empty margin. */
export const PRE_ROLL = 200;

const FALLBACK_CELL = 10;

export type Side = 'left' | 'right';
/** Page cell columns [x0, x1) of one gutter. */
export interface Span {
  x0: number;
  x1: number;
}
export type Gutters = Record<Side, Span | null>;
/** Horizontal extent in pixels, relative to the section. */
export interface Extent {
  left: number;
  right: number;
}
/** A glider source: one per section boundary. `row` is in cells, from the top of the section. */
export interface Source {
  index: number;
  side: Side;
  row: number;
}
export interface Frame {
  width: number;
  height: number;
  viewport: number;
}

/**
 * One gutter as a world. The outer ring is always dead (a glider leaves the strip instead of wrapping), and cells
 * under the keep-clear mask never live. `live` lists the living cells, so a generation costs what is alive.
 */
export interface Strip {
  w: number;
  h: number;
  mask: Uint8Array;
  cells: Uint8Array;
  age: Uint8Array;
  live: Int32Array;
  count: number;
  /** Scratch space for one generation: live neighbours per touched cell, the touched cells, the next generation. */
  counts: Uint8Array;
  touched: Int32Array;
  nextLive: Int32Array;
  nextAge: Uint8Array;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The `--c` value on <html> (the hero's cell), or the fallback when it is missing or broken. */
export function parseCell(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_CELL;
}

/** The horizontal extent of a set of rectangles: the column's reading width. */
export function extentOf(rects: { left: number; right: number }[]): Extent | null {
  if (!rects.length) return null;
  let left = Infinity;
  let right = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return { left, right };
}

/**
 * The two gutters beside the column, in page cells. Each keeps CLEARANCE cells from the text. No gutters below
 * MIN_VIEWPORT, and a side too thin to hold a glider stays empty.
 */
export function gutterSpans(viewport: number, cols: number, column: Extent | null, cell: number): Gutters {
  if (viewport < MIN_VIEWPORT || !column || !(cell > 0)) return { left: null, right: null };
  const colL = Math.floor(column.left / cell) - CLEARANCE;
  const colR = Math.ceil(column.right / cell) + CLEARANCE;
  return {
    left: colL >= MIN_GUTTER ? { x0: 0, x1: Math.min(colL, cols) } : null,
    right: cols - colR >= MIN_GUTTER ? { x0: colR, x1: cols } : null,
  };
}

/**
 * One source per boundary, alternating sides. When only one gutter has room, every source goes there.
 * No room at all: no sources.
 */
export function sourcesFor(rows: number[], gutters: Gutters): Source[] {
  const sides = (['left', 'right'] as const).filter((side) => gutters[side]);
  if (!sides.length) return [];
  return rows.map((row, index) => ({ index, side: sides[index % sides.length], row }));
}

/** Each source fires on its own beat, so the streams do not start in step. */
export const emitsAt = (gen: number, index: number): boolean => (gen + index * 7) % EMIT_EVERY === 0;

/** A cell row from a pixel offset in the section, clamped to the world. */
export const rowAt = (px: number, cell: number, rows: number): number =>
  Math.min(rows - 1, Math.max(0, Math.floor(px / cell)));

/** The glider that flies outward and down: the left gutter's flies left, the right gutter's flies right. */
export function gliderCells(side: Side): number[][] {
  const [dx, dy] = side === 'left' ? [-1, 1] : [1, 1];
  return GLIDER_HEADINGS.find((entry) => entry.heading[0] === dx && entry.heading[1] === dy)!.cells;
}

/** The keep-clear mask over a strip: 1 where the text's boxes (page cells) fall. `x0` is the strip's first page column. */
export function keepClearMask(width: number, height: number, boxes: Box[], x0 = 0): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const box of boxes) {
    const y1 = Math.min(height, box.y2);
    const x1 = Math.min(width, box.x2 - x0);
    for (let y = Math.max(0, box.y); y < y1; y++) {
      for (let x = Math.max(0, box.x - x0); x < x1; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function createStrip(w: number, h: number, mask: Uint8Array): Strip {
  const n = w * h;
  return {
    w,
    h,
    mask,
    cells: new Uint8Array(n),
    age: new Uint8Array(n),
    live: new Int32Array(n),
    count: 0,
    counts: new Uint8Array(n),
    touched: new Int32Array(n),
    nextLive: new Int32Array(n),
    nextAge: new Uint8Array(n),
  };
}

/** The outer ring of a strip: never alive, so nothing wraps and gliders leave. */
const isEdge = (s: Strip, k: number): boolean => {
  const x = k % s.w;
  const y = (k - x) / s.w;
  return x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1;
};

/** Makes a cell alive and newborn, unless it is on the edge or under the keep-clear mask. */
export function spawnCell(s: Strip, k: number): void {
  if (s.cells[k] || s.mask[k] || isEdge(s, k)) return;
  s.cells[k] = 1;
  s.age[k] = 0;
  s.live[s.count++] = k;
}

/** Stamps the live cells of a pattern into a strip, clipped to it (never wrapped). */
export function stamp(s: Strip, cells: number[][], x0: number, y0: number): void {
  cells.forEach((line, j) =>
    line.forEach((on, i) => {
      const x = x0 + i;
      const y = y0 + j;
      if (on && x >= 0 && x < s.w && y >= 0 && y < s.h) spawnCell(s, y * s.w + x);
    }),
  );
}

/** A glider is born against the column and flies away from it. */
export function emitGlider(s: Strip, side: Side, row: number): void {
  stamp(s, gliderCells(side), side === 'left' ? s.w - 4 : 1, row);
}

/**
 * One generation of a strip, with the board's rules (3 neighbours to be born, 2 or 3 to live). Only the live cells
 * and their neighbours are visited. Ages count the generations a cell has lived, as in the board.
 */
export function stepStrip(s: Strip): void {
  const { w, h, cells, age, live, counts, touched, nextLive, nextAge, mask } = s;
  let touchedN = 0;
  for (let n = 0; n < s.count; n++) {
    const i = live[n];
    const x = i % w;
    const y = (i - x) / w;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const j = yy * w + xx;
        if (j !== i && counts[j]++ === 0) touched[touchedN++] = j;
      }
    }
  }
  let nextN = 0;
  for (let t = 0; t < touchedN; t++) {
    const j = touched[t];
    const around = counts[j];
    counts[j] = 0;
    const alive = cells[j] === 1;
    if (around !== 3 && !(around === 2 && alive)) continue;
    if (mask[j] || isEdge(s, j)) continue;
    nextLive[nextN] = j;
    nextAge[nextN] = alive ? Math.min(255, age[j] + 1) : 0;
    nextN++;
  }
  for (let n = 0; n < s.count; n++) {
    const i = live[n];
    cells[i] = 0;
    age[i] = 0;
  }
  for (let n = 0; n < nextN; n++) {
    const j = nextLive[n];
    cells[j] = 1;
    age[j] = nextAge[n];
    live[n] = j;
  }
  s.count = nextN;
}

/** Cells are drawn this far beyond the viewport, so a scroll never shows them arriving. */
export const WINDOW_MARGIN_PX = 240;

/**
 * The first and last cell rows to draw: the rows in the viewport, plus a margin each side. The simulation runs on
 * every row; only these get elements.
 */
export function rowWindow(
  sectionTop: number,
  sectionHeight: number,
  viewport: number,
  cell: number,
  margin = WINDOW_MARGIN_PX,
): { first: number; last: number } {
  const from = Math.max(0, -sectionTop - margin);
  const to = Math.min(sectionHeight, viewport - sectionTop + margin);
  return { first: Math.floor(from / cell), last: Math.ceil(to / cell) - 1 };
}

/** Rebuild on a width change, or on a height change big enough to be more than a toolbar. */
export function needsRebuild(built: Frame, now: Frame): boolean {
  return (
    built.width !== now.width ||
    Math.abs(built.height - now.height) >= REBUILD_PX ||
    Math.abs(built.viewport - now.viewport) >= REBUILD_PX
  );
}

interface Stripe {
  side: Side;
  span: Span;
  strip: Strip;
  /** The gutter's element: one <i> per living cell, positioned in cells. */
  gutter: HTMLElement;
  /** Living cell → its element. */
  els: Map<number, HTMLElement>;
  /** The colour class each cell shows now (b1…b5, see MarginLife.astro), 0 when it has none. */
  shown: Uint8Array;
}
interface Measured {
  column: Extent | null;
  keep: Rect[];
}

/**
 * The margins: one column of cells per gutter. Each living cell is a small element in its gutter, coloured by age
 * through the --life-* tokens (so a theme switch needs no script). A generation only touches the cells that were born,
 * died or changed colour, so the browser repaints a few small rectangles, not the gutter.
 */
export function initMarginLife(section: HTMLElement): void {
  const layer = section.querySelector<HTMLElement>(':scope > .margin-life');
  const hc = section.querySelector<HTMLElement>(':scope > .hc');
  if (!layer || !hc) return;
  const gutters: Record<Side, HTMLElement | null> = {
    left: layer.querySelector<HTMLElement>('.margin-gutter[data-side="left"]'),
    right: layer.querySelector<HTMLElement>('.margin-gutter[data-side="right"]'),
  };
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');

  let built: Frame | null = null;
  /** The section's top in the document: fixed between rebuilds, so painting never has to ask the layout for it. */
  let docTop = 0;
  let cell = FALLBACK_CELL;
  let rows = 0;
  let stripes: Stripe[] = [];
  let sources: (Source & { stripe: Stripe })[] = [];
  let gen = 0;
  let inView = false;
  let timer = 0;
  let resizeQueued = 0;
  let scrollQueued = 0;

  /** The text's reading column (section numbers left out) and every box the text and media occupy. */
  function measure(origin: DOMRect): Measured {
    const rel = (r: DOMRect): Rect => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    });
    const column: Rect[] = [];
    const keep: Rect[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(hc!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || parent?.closest('script, style')) continue;
      range.selectNodeContents(node);
      const numbered = !!parent?.closest('.hc-num');
      for (const r of Array.from(range.getClientRects())) {
        if (!r.width || !r.height) continue;
        const b = rel(r);
        keep.push(b);
        if (!numbered) column.push(b);
      }
    }
    hc!.querySelectorAll<HTMLElement>('img, video, picture, canvas, svg').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const b = rel(r);
      keep.push(b);
      column.push(b);
    });
    return { column: extentOf(column), keep };
  }

  function stop(): void {
    clearInterval(timer);
    timer = 0;
  }

  function clearGutters(): void {
    for (const side of ['left', 'right'] as const) {
      gutters[side]?.replaceChildren();
      if (gutters[side]) gutters[side]!.hidden = true;
    }
  }

  function hide(): void {
    stop();
    clearGutters();
    layer!.hidden = true;
    built = null;
    stripes = [];
    sources = [];
  }

  /** Advances the margins one generation: a glider per source when its beat comes, then the rules. */
  function tick(): void {
    for (const source of sources) if (emitsAt(gen, source.index)) emitGlider(source.stripe.strip, source.side, source.row);
    for (const stripe of stripes) stepStrip(stripe.strip);
    gen++;
  }

  /**
   * Shows the living cells in the window: new ones get an element, cells that die or leave the window lose theirs,
   * and a changed colour changes the class. The rules run on every row; only the window is drawn.
   */
  function paint(): void {
    if (!built) return;
    const { first, last } = rowWindow(docTop - scrollY, built.height, innerHeight, cell);
    for (const { strip, gutter, els, shown } of stripes) {
      const { w, age, live, cells } = strip;
      for (let n = 0; n < strip.count; n++) {
        const k = live[n];
        const row = Math.floor(k / w);
        if (row < first || row > last) continue;
        const bucket = ageBucket(age[k]) + 1;
        let el = els.get(k);
        if (!el) {
          el = document.createElement('i');
          el.style.left = `${(k - row * w) * cell}px`;
          el.style.top = `${row * cell}px`;
          gutter.append(el);
          els.set(k, el);
        }
        if (shown[k] !== bucket) {
          el.className = `b${bucket}`;
          shown[k] = bucket;
        }
      }
      for (const [k, el] of els) {
        const row = Math.floor(k / w);
        if (cells[k] && row >= first && row <= last) continue;
        el.remove();
        els.delete(k);
        shown[k] = 0;
      }
    }
  }

  function build(): void {
    if (innerWidth < MIN_VIEWPORT) return hide();
    const box = section.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    cell = parseCell(getComputedStyle(root).getPropertyValue('--c'));
    const cols = Math.ceil(width / cell);
    rows = Math.ceil(height / cell);

    const { column, keep } = measure(box);
    const gutterSpansFound = gutterSpans(innerWidth, cols, column, cell);
    if (!gutterSpansFound.left && !gutterSpansFound.right) return hide();

    // a source at each section boundary: the intro, then every section with an id
    const boundaries = new Set<Element>();
    if (hc!.firstElementChild) boundaries.add(hc!.firstElementChild);
    hc!.querySelectorAll(':scope > [id], section[id^="hc-"]').forEach((el) => boundaries.add(el));
    const rowsAt = [...boundaries].map((el) => rowAt(el.getBoundingClientRect().top - box.top, cell, rows));

    const keepBoxes = keep.map((r) => rectToBox(r, cell));
    clearGutters();
    stripes = [];
    for (const side of ['left', 'right'] as const) {
      const span = gutterSpansFound[side];
      const gutter = gutters[side];
      if (!span || !gutter) continue;
      const w = span.x1 - span.x0;
      const left = span.x0 * cell;
      // the gutter element covers exactly its gutter, at the section's height; its cells are laid out inside it
      gutter.style.left = `${left}px`;
      gutter.style.width = `${Math.min(width - left, w * cell)}px`;
      gutter.style.height = `${height}px`;
      gutter.style.setProperty('--cell', `${cell}px`);
      gutter.style.setProperty('--gap', `${cell >= 4 ? 1 : 0}px`);
      gutter.hidden = false;
      stripes.push({
        side,
        span,
        strip: createStrip(w, rows, keepClearMask(w, rows, keepBoxes, span.x0)),
        gutter,
        els: new Map(),
        shown: new Uint8Array(w * rows),
      });
    }
    sources = sourcesFor(rowsAt, gutterSpansFound).map((source) => ({
      ...source,
      stripe: stripes.find((stripe) => stripe.side === source.side)!,
    }));

    built = { width, height, viewport: innerHeight };
    docTop = box.top + scrollY;
    gen = 0;
    if (motion.matches) {
      // reduced motion: a few gliders, frozen where they were born, and no loop
      for (const source of sources) emitGlider(source.stripe.strip, source.side, source.row);
    } else {
      for (let g = 0; g < PRE_ROLL; g++) tick();
    }
    layer!.hidden = false;
    paint();
  }

  /** The loop runs only while the section is on screen, the tab is visible and the reader is not asking for less motion. */
  function sync(): void {
    const want = !!built && inView && !document.hidden && !motion.matches;
    if (want && !timer) {
      timer = window.setInterval(() => {
        tick();
        paint();
      }, STEP_MS);
    } else if (!want) {
      stop();
    }
  }

  function rebuild(): void {
    stop();
    build();
    updateView();
  }

  // on screen: the section overlaps the viewport. Arithmetic on the cached position, so scrolling never asks for layout
  // (an IntersectionObserver misses the exit when a scroll jumps past the edge)
  const updateView = (): void => {
    inView = !!built && docTop - scrollY < innerHeight && docTop - scrollY + built.height > 0;
    sync();
  };

  // the window moves with the page: one update per frame at most; a repaint only while the section is on screen
  addEventListener(
    'scroll',
    () => {
      if (scrollQueued) return;
      scrollQueued = requestAnimationFrame(() => {
        scrollQueued = 0;
        updateView();
        if (inView) paint();
      });
    },
    { passive: true },
  );

  // the first build, once every listener it relies on is in place
  rebuild();

  // a resize, zoom or rotation moves the text: measure again (a toolbar sliding in and out does not count)
  addEventListener(
    'resize',
    () => {
      if (resizeQueued) return;
      resizeQueued = requestAnimationFrame(() => {
        resizeQueued = 0;
        const box = section.getBoundingClientRect();
        const now = { width: Math.round(box.width), height: Math.round(box.height), viewport: innerHeight };
        if (!built || needsRebuild(built, now) || innerWidth < MIN_VIEWPORT) rebuild();
        else updateView();
      });
    },
    { passive: true },
  );

  motion.addEventListener('change', rebuild);
  document.addEventListener('visibilitychange', () => sync());
  // the section numbers and text settle once the fonts land: measure again
  document.fonts?.ready.then(rebuild);
}
