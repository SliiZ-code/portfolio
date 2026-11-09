// Text flows round a cell: the intro paragraph keeps its box and its words, but its lines are re-broken every time the
// reader drags a small Game of Life pattern (a pulsar) through it, so the text runs on both sides of the cell.
// The browser lays the paragraph out once; pretext then breaks each line to the room left beside the pattern, with no
// DOM reflow. Desktop with a fine pointer only, never under reduced motion: anywhere else the paragraph stays as it is.
// The pure helpers (clamping, the free runs of a blocked row, line fitting, the pulsar) are tested; `initFlowText` is
// the DOM driver, the way magnet-type.ts pairs its helpers with one `init*`.

import {
  clearCache,
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';
import { createWorld, idx, spawn, stepWorld, type World } from './board/life';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Air (px) between the cell and the words round it. */
export const GAP = 12;
/** A run beside the cell narrower than this stays empty: a sliver of one or two letters reads as a mistake. */
export const MIN_SLOT = 56;
/** Life runs slowly so the pulse reads as a pattern, not as noise. */
export const GENS_PER_SECOND = 7;

/** Conway's pulsar: a period-3 oscillator, 48 live cells in a 13-cell square. It never dies out. */
const PULSAR_ROWS = [
  '..###...###..',
  '.............',
  '#....#.#....#',
  '#....#.#....#',
  '#....#.#....#',
  '..###...###..',
  '.............',
  '..###...###..',
  '#....#.#....#',
  '#....#.#....#',
  '#....#.#....#',
  '.............',
  '..###...###..',
];
/** The square the pulsar is drawn in: it breathes out to 15 cells on its middle generation, so the cell is 15 wide. */
export const PULSAR_WINDOW = 15;
/** The torus the pulsar lives on. Seventeen cells keep its wrap-around neighbours empty; a smaller one lets it touch itself. */
export const WORLD_SIZE = 17;
/** Where the 13-cell pulsar sits in its window, so the breathing has room on every side. */
const PULSAR_OFFSET = 1;

/** A fresh world with the pulsar centred in its window: the 15-cell square the cell is drawn from. */
export function newPulsarWorld(): World {
  const world = createWorld(WORLD_SIZE, WORLD_SIZE);
  PULSAR_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') spawn(world, idx(WORLD_SIZE, WORLD_SIZE, x + PULSAR_OFFSET, y + PULSAR_OFFSET));
    });
  });
  return world;
}

/** `value` pinned into [min, max]; an inverted range pins to `min`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Where a `w`×`h` box can sit inside an `areaW`×`areaH` area: its top-left, kept inside. A box wider than the area pins to the left. */
export function clampBox(x: number, y: number, w: number, h: number, areaW: number, areaH: number): { x: number; y: number } {
  return { x: clamp(x, 0, areaW - w), y: clamp(y, 0, areaH - h) };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The first spot for a `box` in an `area` where the text still takes `goal` rows, or the spot that takes the fewest
 * when none does. Spots are tried nearest `preferred` first, so the default spot wins whenever it works; `rowsAt`
 * says how many rows the text takes with the box at a spot, and `step` is the grid the spots are cut on.
 */
export function settleSpot(
  preferred: Point,
  area: { width: number; height: number },
  box: { w: number; h: number },
  rowsAt: (x: number, y: number) => number,
  goal: number,
  step: number,
): Point {
  const spots: Point[] = [preferred];
  for (let y = 0; y <= area.height - box.h; y += step) {
    for (let x = 0; x <= area.width - box.w; x += step) spots.push({ x, y });
  }
  const dist = (p: Point) => (p.x - preferred.x) ** 2 + (p.y - preferred.y) ** 2;
  spots.sort((a, b) => dist(a) - dist(b));
  let best = preferred;
  let bestRows = Infinity;
  for (const spot of spots) {
    const rows = rowsAt(spot.x, spot.y);
    if (rows <= goal) return spot;
    if (rows < bestRows) {
      best = spot;
      bestRows = rows;
    }
  }
  return best;
}

/**
 * The horizontal runs of a row `width` wide that a box leaves free, each cut back by `gap` from the box. Call it for a
 * row the box blocks; runs narrower than `minSlot` are dropped.
 */
export function freeSlots(width: number, box: Box | null, gap: number, minSlot: number): Array<[number, number]> {
  const runs: Array<[number, number]> = box ? [[0, box.x - gap], [box.x + box.w + gap, width]] : [[0, width]];
  return runs
    .map(([from, to]): [number, number] => [Math.max(0, from), Math.min(width, to)])
    .filter(([from, to]) => to - from >= minSlot);
}

export interface Placed {
  x: number;
  y: number;
  text: string;
  width: number;
}

export interface Piece<C> {
  width: number;
  end: C;
  text: string;
  /** True when the piece ends inside a word: the word did not fit, so it was cut. */
  broken?: boolean;
}

export interface FlowOptions<C> {
  width: number;
  lineHeight: number;
  /** The cell, or null for plain text. */
  box: Box | null;
  gap: number;
  minSlot: number;
  start: C;
  /** The next line that fits `maxWidth` from `from`, or null once the text is spent. */
  next: (maxWidth: number, from: C) => Piece<C> | null;
  /** A guard for a box so large no row is free; the paragraph is never this long. */
  maxRows?: number;
}

/**
 * Breaks a paragraph into lines that avoid `box`. A row the box meets is cut into the runs beside it, and the text
 * carries on through them in order, so the words read left to right on both sides of the cell. A line too wide for a
 * narrow run, or one that cuts a word, waits for a wider run; only a row with no box at all may hold a word wider than
 * the paragraph.
 */
export function flowLines<C>(options: FlowOptions<C>): { lines: Placed[]; rows: number } {
  const { width, lineHeight, box, gap, minSlot, next } = options;
  const maxRows = options.maxRows ?? 400;
  const lines: Placed[] = [];
  let cursor = options.start;
  let lastRow = -1;
  for (let row = 0; row < maxRows; row++) {
    const top = row * lineHeight;
    const blocked = box !== null && top < box.y + box.h + gap && top + lineHeight > box.y - gap;
    const slots: Array<[number, number]> = blocked ? freeSlots(width, box, gap, minSlot) : [[0, width]];
    for (const [from, to] of slots) {
      const piece = next(to - from, cursor);
      if (!piece) return { lines, rows: lastRow + 1 };
      if (blocked && (piece.broken || piece.width > to - from + 1e-6)) continue;
      lines.push({ x: from, y: top, text: piece.text, width: piece.width });
      cursor = piece.end;
      lastRow = row;
    }
  }
  return { lines, rows: lastRow + 1 };
}

/** The driver's font, line height and letter spacing, read from the paragraph (the browser is the source of truth). */
function readType(paragraph: HTMLElement): { font: string; lineHeight: number; spacing: number } {
  const style = getComputedStyle(paragraph);
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
    spacing: parseFloat(style.letterSpacing) || 0,
  };
}

/**
 * Turns the paragraph into a flowing one on a fine pointer, and back to the plain paragraph otherwise. The paragraph's
 * own text stays in the DOM (accessibility, find, copy), only made transparent; the flowing lines are drawn over it,
 * hidden from assistive tech, and the paragraph's height is kept, so turning the effect on does not move the page.
 */
export function initFlowText(paragraph: HTMLElement): void {
  const text = (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;

  const canvas = document.createElement('canvas');
  canvas.className = 'hf-cells';
  const flow = document.createElement('span');
  flow.className = 'hf-flow';
  flow.setAttribute('aria-hidden', 'true');
  flow.append(canvas);
  const lineEls: HTMLElement[] = [];

  let on = false;
  let fontsReady = false;
  let prepared: PreparedTextWithSegments | null = null;
  let font = '';
  let spacing = 0;
  let lineHeight = 0;
  let width = 0;
  let height = 0;
  let cell = 3;
  let pos: { x: number; y: number } | null = null;
  let ink = '';
  let minHeight = '';
  let frame = 0;
  let life = 0;
  let onScreen = true;
  let drag: { id: number; sx: number; sy: number; ox: number; oy: number } | null = null;
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('is-grabbing');
  };
  let world = newPulsarWorld();

  const cells = () => PULSAR_WINDOW * cell;

  function prepareText(): PreparedTextWithSegments {
    const type = readType(paragraph);
    font = type.font;
    spacing = type.spacing;
    lineHeight = type.lineHeight;
    prepared = prepareWithSegments(text, font, spacing ? { letterSpacing: spacing } : undefined);
    return prepared;
  }

  /** Reads the sizes the flow depends on: the paragraph's width and type, and the board's cell (--c). On enable, resize and font change. */
  function measure(): void {
    const type = readType(paragraph);
    const current = !prepared || type.font !== font || type.spacing !== spacing ? prepareText() : prepared;
    lineHeight = type.lineHeight;
    // the paragraph's width and height as the browser has them now (one layout, on resize and on enable only)
    width = paragraph.clientWidth;
    height = paragraph.clientHeight;
    cell = Math.max(2, Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--c')) || 3));
    const px = cells();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the start spot is chosen on enable, while the paragraph is still its plain height (see startSpot)
    const start = pos ?? startSpot(current);
    pos = clampBox(start.x, start.y, px, px, width, height);
  }

  /** Draws the live cells of the pulsar window in the ink colour. */
  function paint(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cells(), cells());
    ctx.fillStyle = ink;
    for (let y = 0; y < PULSAR_WINDOW; y++) {
      for (let x = 0; x < PULSAR_WINDOW; x++) {
        if (world.cells[idx(WORLD_SIZE, WORLD_SIZE, x, y)]) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  /** The lines of the text round a cell at `box` (null for none), and the rows they take. `words` false: rows only, no text. */
  function layOut(current: PreparedTextWithSegments, box: Box | null, words = true) {
    return flowLines<LayoutCursor>({
      width,
      lineHeight,
      box,
      gap: GAP,
      minSlot: MIN_SLOT,
      start: { segmentIndex: 0, graphemeIndex: 0 },
      next: (maxWidth, from) => {
        const range = layoutNextLineRange(current, maxWidth, from);
        if (!range) return null;
        // a line that ends inside a word (grapheme above zero) is one the run cannot hold whole
        const text = words ? materializeLineRange(current, range).text : '';
        return { width: range.width, end: range.end, text, broken: range.end.graphemeIndex > 0 };
      },
    });
  }

  /** The first spot for the pattern: its default (centred, first row), or the nearest that keeps the paragraph's height. */
  function startSpot(current: PreparedTextWithSegments): Point {
    const px = cells();
    const preferred = clampBox(Math.round((width - px) / 2), Math.round(lineHeight), px, px, width, height);
    const goal = Math.round(height / lineHeight);
    // a trial only counts rows, so it builds no words; a 4px grid finds the spots that a 12px one steps over
    const rowsAt = (x: number, y: number) => layOut(current, { x, y, w: px, h: px }, false).rows;
    return settleSpot(preferred, { width, height }, { w: px, h: px }, rowsAt, goal, 4);
  }

  /** Breaks the text round the cell and places the lines. Runs on drag and resize, never on a generation. */
  function relayout(): void {
    if (!on || !prepared || !pos) return;
    const px = cells();
    const { lines, rows } = layOut(prepared, { x: pos.x, y: pos.y, w: px, h: px });
    lines.forEach((line, i) => {
      let el = lineEls[i];
      if (!el) {
        el = document.createElement('span');
        el.className = 'hf-line';
        lineEls[i] = el;
        flow.append(el);
      }
      // each line ends with one space, so copying the flow reads its words apart (the lines are separate boxes with no
      // space between them); the space paints nothing. pretext leaves the space out of the line's width.
      const shown = `${line.text.trimEnd()} `;
      if (el.textContent !== shown) el.textContent = shown;
      el.style.left = `${Math.round(line.x)}px`;
      el.style.top = `${Math.round(line.y)}px`;
    });
    for (let i = lines.length; i < lineEls.length; i++) lineEls[i].remove();
    lineEls.length = lines.length;
    // the paragraph keeps the height of its own wrapped text; a longer flow may need more room, never less
    const needed = rows * lineHeight;
    const next = `${needed}px`;
    if (next !== minHeight) {
      minHeight = next;
      paragraph.style.minHeight = next;
    }
    canvas.style.left = `${Math.round(pos.x)}px`;
    canvas.style.top = `${Math.round(pos.y)}px`;
  }

  function scheduleRelayout(): void {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        relayout();
      });
    }
  }

  function step(): void {
    stepWorld(world);
    paint();
  }

  function startLife(): void {
    if (!life && on && onScreen) life = window.setInterval(step, 1000 / GENS_PER_SECOND);
  }

  function stopLife(): void {
    clearInterval(life);
    life = 0;
  }

  function enable(): void {
    if (on) return;
    on = true;
    paragraph.classList.add('is-flowing');
    paragraph.append(flow);
    measure();
    ink = getComputedStyle(canvas).color;
    relayout();
    paint();
    startLife();
  }

  function disable(): void {
    if (!on) return;
    on = false;
    stopLife();
    endDrag();
    paragraph.classList.remove('is-flowing');
    paragraph.style.minHeight = '';
    minHeight = '';
    flow.remove();
    flow.replaceChildren(canvas);
    lineEls.length = 0;
  }

  function sync(): void {
    if (!fontsReady) return;
    if (fine.matches && !still.matches) enable();
    else disable();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!on || !pos || event.button !== 0) return;
    // no text selection starts under the drag
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: pos.x, oy: pos.y };
    canvas.classList.add('is-grabbing');
  });
  canvas.addEventListener('pointermove', (event) => {
    // the pattern follows the pointer's travel, so nothing reads the paragraph's box mid-drag
    if (!drag || event.pointerId !== drag.id) return;
    const px = cells();
    pos = clampBox(drag.ox + event.clientX - drag.sx, drag.oy + event.clientY - drag.sy, px, px, width, height);
    scheduleRelayout();
  });
  // the capture ends on release, on a cancel, or when the window loses the pointer (alt-tab): no button, no drag
  canvas.addEventListener('lostpointercapture', (event) => {
    if (drag?.id === event.pointerId) endDrag();
  });

  // the page scrolls under a still pointer, and the paragraph is only drawn while on screen
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) startLife();
    else stopLife();
  }).observe(paragraph);

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    // the board sets --c in its own resize handler: read the new cell a frame later
    if (!on || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!on) return;
      measure();
      relayout();
      paint();
    });
  });

  // the board's and the page's colours follow the theme attribute and the system scheme (the variables change under us)
  const recolour = () => {
    if (!on) return;
    ink = getComputedStyle(canvas).color;
    paint();
  };
  new MutationObserver(recolour).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  scheme.addEventListener('change', recolour);

  // pretext measures with the font it is given: once a web font is in, its widths replace the fallback's, and the
  // font name does not change, so the text is prepared again here rather than by `measure`
  const remeasure = () => {
    clearCache();
    if (!fontsReady) return;
    prepareText();
    if (!on) return;
    measure();
    relayout();
    paint();
  };
  fine.addEventListener('change', sync);
  still.addEventListener('change', sync);
  document.fonts.addEventListener('loadingdone', remeasure);
  document.fonts.ready.then(() => {
    fontsReady = true;
    prepareText();
    sync();
  });
}
