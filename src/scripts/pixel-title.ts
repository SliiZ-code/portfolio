/**
 * Pixel titles: the first time a section title enters the view, a soup of Game of Life cells boils around it and the
 * title emerges from it: each generation runs B3/S23, then the glyph cells lock in one by one and the stray cells die
 * off, until only the word is left and the crisp heading returns. The helpers at the top are pure and unit-tested;
 * `initPixelTitles` drives the DOM. Life that reaches a title sends a ripple through its glyphs (title-ripple.ts).
 */

import {
  farthest,
  groupIndices,
  inkTiles,
  type LifeTouch,
  RIPPLE_MS,
  rippleAmplitude,
  rippleBucket,
  rippleDue,
  rippleLift,
  ripplePhase,
  rippleSpeed,
  rippleTile,
  type Tile,
} from './title-ripple';

/** A cell of the title's grid, in cell units from the top-left of the glyph grid. */
export interface Cell {
  col: number;
  row: number;
}

/** Generations in the emergence, and how long each one shows. */
export const GENERATIONS = 22;
export const GENERATION_MS = 48;
/** Share of the soup that is alive at the start. */
export const SOUP_DENSITY = 0.32;
/** Cells of soup around the title on each side. */
export const MARGIN = 10;

/** Colour buckets: young, older and old stray cells, then a locked glyph cell. */
export const COLOUR_TOKENS = ['--life-0', '--life-1', '--life-2', '--ink'] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** The size of one cell for a title of this font size: about 6px at the desktop size, 2.5px at the least. */
export function cellSize(fontPx: number): number {
  return Math.max(2.5, fontPx / 22);
}

/** The emergence state on a cols × rows grid: alive cells, their age in generations, and the glyph cells locked in. */
export interface Soup {
  cols: number;
  rows: number;
  alive: Uint8Array;
  age: Uint8Array;
  locked: Uint8Array;
}

/** A soup of the given density, with nothing locked yet. */
export function makeSoup(cols: number, rows: number, rng: () => number, density = SOUP_DENSITY): Soup {
  const alive = new Uint8Array(cols * rows);
  for (let i = 0; i < alive.length; i++) alive[i] = rng() < density ? 1 : 0;
  return { cols, rows, alive, age: new Uint8Array(cols * rows), locked: new Uint8Array(cols * rows) };
}

/**
 * One generation toward the title. `k` (0 to 1) is how far along the emergence is: B3/S23 runs on the free cells,
 * then each glyph cell locks in with a chance that grows with `k` (a locked cell stays alive), and each stray cell
 * dies with the same chance. At `k` = 1 the soup is exactly the title.
 */
export function emergeStep(soup: Soup, target: Uint8Array, k: number, rng: () => number): void {
  const { cols, rows, alive, age, locked } = soup;
  const next = new Uint8Array(alive.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (locked[i]) {
        next[i] = 1;
        continue;
      }
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx || dy) && xx >= 0 && xx < cols) n += alive[yy * cols + xx];
        }
      }
      next[i] = n === 3 || (n === 2 && alive[i]) ? 1 : 0;
    }
  }
  const chance = clamp01(k) ** 1.6;
  for (let i = 0; i < next.length; i++) {
    if (target[i]) {
      if (k >= 1 || (!locked[i] && rng() < chance)) locked[i] = 1;
      if (locked[i]) next[i] = 1;
    } else if (k >= 1 || rng() < chance) {
      next[i] = 0;
    }
    age[i] = next[i] ? Math.min(255, alive[i] ? age[i] + 1 : 0) : 0;
    alive[i] = next[i];
  }
}

/** The colour bucket of cell `i`: ink once locked, else by age (newborn, young, older). */
export function soupBucket(soup: Soup, i: number): number {
  if (soup.locked[i]) return 3;
  return soup.age[i] < 1 ? 0 : soup.age[i] < 3 ? 1 : 2;
}

/** The cells whose alpha reaches the threshold (0 to 255), in row-major order. */
export function maskToCells(alpha: Uint8ClampedArray, w: number, h: number, threshold: number): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (alpha[row * w + col] >= threshold) cells.push({ col, row });
    }
  }
  return cells;
}

/**
 * Coverage per cell: `rgba` is a supersampled image, `factor` samples per cell side, `cols`×`rows` cells. Each cell gets
 * the mean alpha of its block of samples, one value per cell, ready for `maskToCells`.
 */
export function coverage(rgba: Uint8ClampedArray, cols: number, rows: number, factor: number): Uint8ClampedArray {
  const sw = cols * factor;
  const out = new Uint8ClampedArray(cols * rows);
  const samples = factor * factor;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          sum += rgba[((row * factor + dy) * sw + col * factor + dx) * 4 + 3];
        }
      }
      out[row * cols + col] = Math.round(sum / samples);
    }
  }
  return out;
}

/** How long the cells take to hand back to the real glyphs at the end of the assembly. */
export const HANDOFF_MS = 100;

/**
 * The end of the assembly: the cells fade out and the real glyphs fade in over HANDOFF_MS, so the last frame of the
 * assembly is the heading's own text. `elapsed` is ms since the handoff began.
 */
export function handoffMix(elapsed: number, duration = HANDOFF_MS): { cells: number; glyphs: number } {
  const t = clamp01(elapsed / duration);
  return { cells: 1 - t, glyphs: t };
}

/* ---- the DOM: one canvas over each title, one rAF loop while it assembles or ripples ---- */

const FONT_STACK = '"Geist Pixel", monospace';
/** The title is drawn at this many samples per cell side, then averaged, so cells get their coverage. */
const SUPERSAMPLE = 4;
/** A cell is drawn once a quarter of it is covered: at half, the thin strokes of the font lost their cells. */
const THRESHOLD = 64;
const MAX_CANVAS_PIXELS = 4_000_000;
/** The most device px per css px a canvas draws at: the hand-back must match the heading's own text, so no lower cap. */
const MAX_SCALE = 4;
const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * The stop of each title that is still assembling or rippling: a language switch stops the title whose word changed,
 * the resize handler stops them all. A title runs at most one animation at a time.
 */
const running = new Map<HTMLElement, () => void>();

/** Titles that have assembled: only these can ripple, the assembly owns the canvas until then. */
const assembled = new WeakSet<HTMLElement>();
/** The last ripple of each title, for the cooldown. */
const lastRipple = new WeakMap<HTMLElement, number>();
/** The rasterised glyphs of each title, kept while the font and the box stay the same. */
const rasters = new WeakMap<HTMLElement, { key: string; raster: Raster }>();
/**
 * Room around the heading's text box for the glyphs' ink and the one-pixel lift, in css px. The ripple's canvas is the
 * text box plus this margin, so the text on it sits exactly where the heading sets it.
 */
const RIPPLE_PAD = 6;
/** The colours of a ripple: the four life colours by the pulse, then the resting ink. */
const RIPPLE_TOKENS = ['--life-0', '--life-1', '--life-2', '--life-3', '--ink'] as const;
const INK = 4;

interface Raster {
  cells: Cell[];
  cols: number;
  rows: number;
  cell: number;
  /** The y of the glyph grid's top edge, in the title's own coordinates (it can sit above the heading). */
  top: number;
}

/**
 * Draw the text at the cell scale on a scratch canvas, then read its coverage per cell. The baseline follows CSS:
 * the leading is split evenly around the font's ascent and descent.
 */
function rasterTitle(text: string, fontPx: number, lineHeight: number, spacing: number): Raster | null {
  const cell = cellSize(fontPx);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const setFont = () => {
    ctx.font = `${fontPx}px ${FONT_STACK}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  };
  setFont();
  const metrics = ctx.measureText(text);
  const ascent = metrics.fontBoundingBoxAscent ?? fontPx * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? fontPx * 0.2;
  const baseline = (lineHeight - (ascent + descent)) / 2 + ascent;
  const top = baseline - ascent;
  const cols = Math.ceil(metrics.width / cell) + 1;
  const rows = Math.ceil((baseline + descent - top) / cell);

  const canvas = ctx.canvas;
  canvas.width = cols * SUPERSAMPLE;
  canvas.height = rows * SUPERSAMPLE;
  setFont();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  const k = SUPERSAMPLE / cell;
  ctx.setTransform(k, 0, 0, k, 0, -top * k);
  ctx.fillText(text, 0, baseline);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = coverage(data, cols, rows, SUPERSAMPLE);
  return { cells: maskToCells(alpha, cols, rows, THRESHOLD), cols, rows, cell, top };
}

/**
 * The glyph cells of a title, rasterised once and kept until its font, size or text changes (the key holds the text, so
 * a language switch misses and draws the new word).
 */
function glyphRaster(root: HTMLElement, heading: HTMLElement): Raster | null {
  const style = getComputedStyle(heading);
  const fontPx = parseFloat(style.fontSize);
  const lineHeight = parseFloat(style.lineHeight) || fontPx * 1.2;
  const spacing = parseFloat(style.letterSpacing) || 0;
  const text = heading.textContent ?? '';
  const key = [fontPx, lineHeight, spacing, text].join('|');
  const hit = rasters.get(root);
  if (hit && hit.key === key) return hit.raster;
  const raster = rasterTitle(text, fontPx, lineHeight, spacing);
  if (raster) rasters.set(root, { key, raster });
  return raster;
}

/** The device px per css px of a canvas of this size on the screen: the device's ratio, and a size cap. */
function canvasScale(width: number, height: number): number {
  return Math.min(window.devicePixelRatio || 1, MAX_SCALE, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
}

/** Places the canvas over the title, in the title's own px, and sizes its buffer for the screen. Returns the scale. */
function fitCanvas(canvas: HTMLCanvasElement, x0: number, y0: number, width: number, height: number): number {
  const scale = canvasScale(width, height);
  canvas.style.left = `${x0}px`;
  canvas.style.top = `${y0}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return scale;
}

/** Frees the canvas's buffer once its fade is over, unless the assembly or a new ripple has taken it. */
function releaseSoon(root: HTMLElement, canvas: HTMLCanvasElement): void {
  window.setTimeout(() => {
    if (root.classList.contains('is-assembling') || root.classList.contains('is-rippling')) return;
    canvas.width = 0;
    canvas.height = 0;
  }, 200);
}

/**
 * The heading's own text as an alpha mask on a canvas of `width` × `height` css px, whose top-left is (`ox`, `oy`) in
 * the title's px. It is drawn with the heading's font, size, tracking and baseline, at device resolution, so where the
 * canvas shows it, it is the heading's own rendering: the same glyphs, not a raster of cells.
 */
function textMask(
  root: HTMLElement,
  heading: HTMLElement,
  ox: number,
  oy: number,
  width: number,
  height: number,
  scale: number,
): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = Math.round(width * scale);
  mask.height = Math.round(height * scale);
  const ctx = mask.getContext('2d');
  if (!ctx) return mask;
  const style = getComputedStyle(heading);
  const text = heading.textContent ?? '';
  const spacing = parseFloat(style.letterSpacing) || 0;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  // the DOM's inline box of the text starts one ascent above the baseline: that is where the glyphs sit
  const host = root.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(heading);
  const box = range.getClientRects()[0] ?? heading.getBoundingClientRect();
  const ascent = Math.round(ctx.measureText(text).fontBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.8);
  const x = box.left - host.left - ox;
  const baseline = box.top - host.top + ascent - oy;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawText(ctx, text, x, baseline, spacing);
  return mask;
}

/**
 * Draws the text with its tracking: the canvas's own letterSpacing, else glyph by glyph where the canvas has none. Each
 * glyph then starts where the shaped text before it ends (kerning included), plus the tracking of the glyphs before it.
 */
function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  if (typeof ctx.letterSpacing === 'string') {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    return;
  }
  let index = 0;
  let glyphs = 0;
  for (const ch of text) {
    ctx.fillText(ch, x + ctx.measureText(text.slice(0, index)).width + glyphs * spacing, y);
    index += ch.length;
    glyphs++;
  }
}

/** The mask in one colour: the glyphs, opaque where the mask has ink. */
function tint(mask: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = mask.width;
  out.height = mask.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/**
 * Hands the title back to the heading in one frame. The canvas and the heading show the same glyphs, so the switch must
 * not fade: the heading's colour and the canvas's opacity change together, with no transition.
 */
function snapBack(root: HTMLElement, heading: HTMLElement, canvas: HTMLCanvasElement): void {
  heading.style.transition = 'none';
  canvas.style.transition = 'none';
  root.classList.remove('is-assembling', 'is-rippling');
  // reading a layout property applies the new classes now, so the instant change is not animated
  void heading.offsetWidth;
  heading.style.transition = '';
  canvas.style.transition = '';
}

/** Assemble one title: the soup boils, the glyph cells lock in, then the crisp heading returns. */
async function assemble(root: HTMLElement): Promise<void> {
  const heading = root.querySelector<HTMLElement>('.pt-text');
  const canvas = root.querySelector<HTMLCanvasElement>('.pt-canvas');
  if (!heading || !canvas) return;

  try {
    await document.fonts.load('100px "Geist Pixel"');
  } catch {
    // without the font the fallback still assembles, so the title is not lost
  }
  // a switch during the font wait can queue a second run: the first one that resumed owns the title
  if (root.classList.contains('is-assembling')) return;

  // the text this title is drawn with: a language switch changes it, and the title then assembles again
  root.dataset.ptText = heading.textContent ?? '';
  const raster = glyphRaster(root, heading);
  const ctx = canvas.getContext('2d');
  if (!raster || !ctx || raster.cells.length === 0) return;

  const { cells, cols: glyphCols, rows: glyphRows, cell, top } = raster;
  const cols = glyphCols + MARGIN * 2;
  const rows = glyphRows + MARGIN * 2;
  const target = new Uint8Array(cols * rows);
  for (const c of cells) target[(c.row + MARGIN) * cols + c.col + MARGIN] = 1;

  // the canvas covers the title and its margin of soup, in the title's own coordinates
  const x0 = -MARGIN * cell;
  const y0 = top - MARGIN * cell;
  const width = cols * cell;
  const height = rows * cell;
  const scale = fitCanvas(canvas, x0, y0, width, height);

  const tokens = getComputedStyle(document.documentElement);
  const colours = COLOUR_TOKENS.map((name) => tokens.getPropertyValue(name).trim());
  // the real glyphs, in ink: the last frame of the assembly cross-fades into them
  const glyphs = tint(textMask(root, heading, x0, y0, width, height, scale), colours[colours.length - 1]!);

  const soup = makeSoup(cols, rows, Math.random);
  const size = cell * 0.9;
  const inset = (cell - size) / 2;

  // the soup's cells at `cells` alpha, then the real glyphs at `glyphs` alpha, both on the canvas's own px
  const draw = (cells: number, glyphAlpha: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (cells > 0) {
      ctx.globalAlpha = cells;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (let b = 0; b < colours.length; b++) {
        ctx.fillStyle = colours[b]!;
        ctx.beginPath();
        for (let i = 0; i < soup.alive.length; i++) {
          if (soup.alive[i] && soupBucket(soup, i) === b) {
            ctx.rect((i % cols) * cell + inset, Math.floor(i / cols) * cell + inset, size, size);
          }
        }
        ctx.fill();
      }
    }
    if (glyphAlpha > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = glyphAlpha;
      ctx.drawImage(glyphs, 0, 0);
    }
    ctx.globalAlpha = 1;
  };

  let frame = 0;
  let generation = 0;
  let handoffAt: number | null = null;
  const finish = () => {
    cancelAnimationFrame(frame);
    running.delete(root);
    emergeStep(soup, target, 1, Math.random);
    draw(0, 1);
    snapBack(root, heading, canvas);
    assembled.add(root);
    releaseSoon(root, canvas);
  };

  // the first frame is drawn before the heading goes transparent, so nothing flashes
  draw(1, 0);
  root.classList.add('is-assembling');
  let last = performance.now();
  const step = (now: number) => {
    if (handoffAt !== null) {
      const mix = handoffMix(now - handoffAt);
      if (mix.glyphs >= 1) {
        finish();
        return;
      }
      draw(mix.cells, mix.glyphs);
    } else if (now - last >= GENERATION_MS) {
      last = now;
      generation++;
      if (generation >= GENERATIONS) {
        // the soup is the title now: it hands back to the real glyphs over HANDOFF_MS
        emergeStep(soup, target, 1, Math.random);
        handoffAt = now;
        draw(1, 0);
      } else {
        emergeStep(soup, target, generation / GENERATIONS, Math.random);
        draw(1, 0);
      }
    }
    frame = requestAnimationFrame(step);
  };
  running.set(root, finish);
  frame = requestAnimationFrame(step);
}

/**
 * Life touched the title at `touch` (its own px): a wave runs through the heading's own glyphs from there. Each tile of
 * the font's grid lights in the life colours as the front passes and lifts by a pixel at most, then falls back to ink.
 * The canvas draws the heading's text, so it matches the heading at rest: the heading's text hides while the canvas
 * draws (the same switch as the assembly), and comes back on the same plain text when the wave is done.
 */
function ripple(root: HTMLElement, touch: LifeTouch): void {
  const heading = root.querySelector<HTMLElement>('.pt-text');
  const canvas = root.querySelector<HTMLCanvasElement>('.pt-canvas');
  if (!heading || !canvas || !assembled.has(root)) return;
  if (root.classList.contains('is-assembling') || root.classList.contains('is-rippling')) return;
  const now = performance.now();
  if (!rippleDue(now, lastRipple.get(root))) return;
  const ctx = canvas.getContext('2d');
  const text = heading.textContent ?? '';
  if (!ctx || !text) return;

  // the canvas covers the heading's text box and a margin: the glyphs are the heading's own, drawn in each life colour
  const fontPx = parseFloat(getComputedStyle(heading).fontSize);
  const range = document.createRange();
  range.selectNodeContents(heading);
  const textWidth = Math.ceil(range.getBoundingClientRect().width);
  const width = textWidth + RIPPLE_PAD * 2;
  const height = heading.offsetHeight + RIPPLE_PAD * 2;
  const scale = canvasScale(width, height);
  const tokens = getComputedStyle(document.documentElement);
  const colours = RIPPLE_TOKENS.map((name) => tokens.getPropertyValue(name).trim());
  const mask = textMask(root, heading, -RIPPLE_PAD, -RIPPLE_PAD, width, height, scale);

  // the tiles of the font's own grid that hold ink: the wave steps through them, and each one copies from its colour layer
  const maskCtx = mask.getContext('2d');
  if (!maskCtx) return;
  const pixels = maskCtx.getImageData(0, 0, mask.width, mask.height).data;
  const tiles: Tile[] = inkTiles(pixels, mask.width, mask.height, rippleTile(fontPx, scale));
  if (tiles.length === 0) return;
  lastRipple.set(root, now);
  fitCanvas(canvas, -RIPPLE_PAD, -RIPPLE_PAD, width, height);
  const layers = colours.map((colour) => tint(mask, colour));

  // the tile centres and the contact point, in the canvas's css px (its origin is the text box less the margin)
  const n = tiles.length;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  tiles.forEach((t, i) => {
    cx[i] = (t.x + t.w / 2) / scale;
    cy[i] = (t.y + t.h / 2) / scale;
  });
  const px = touch.x + RIPPLE_PAD;
  const py = touch.y + RIPPLE_PAD;
  const speed = rippleSpeed(farthest(cx, cy, px, py));
  const amplitude = rippleAmplitude(touch.strength);

  // a tile's group is its colour, unlifted groups first, then the lifted ones: a lifted tile covers the row above it
  const groups = colours.length * 2;
  const liftPx = Math.floor(scale); // rippleLift is 0 or one css px, so a lifted tile moves up by this many device px
  const keys = new Int32Array(n);
  const order = new Int32Array(n);
  const start = new Int32Array(groups + 1);
  const cursor = new Int32Array(groups);

  // the tiles of each group are one clip and one copy of its colour layer: a copy per tile was too slow per frame
  const draw = (elapsed: number) => {
    for (let i = 0; i < n; i++) {
      const phase = ripplePhase(Math.hypot(cx[i]! - px, cy[i]! - py), elapsed, speed);
      const b = rippleBucket(phase);
      const lifted = rippleLift(phase, amplitude) > 0 ? colours.length : 0;
      keys[i] = lifted + (b < 0 ? INK : b);
    }
    groupIndices(keys, groups, order, start, cursor);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let g = 0; g < groups; g++) {
      const from = start[g]!;
      const to = start[g + 1]!;
      if (from === to) continue;
      const shift = g >= colours.length ? liftPx : 0;
      ctx.save();
      ctx.beginPath();
      for (let k = from; k < to; k++) {
        const t = tiles[order[k]!]!;
        ctx.rect(t.x, t.y - shift, t.w, t.h);
      }
      ctx.clip();
      ctx.drawImage(layers[g % colours.length]!, 0, -shift);
      ctx.restore();
    }
  };

  let frame = 0;
  const started = performance.now();
  const finish = () => {
    cancelAnimationFrame(frame);
    running.delete(root);
    // every tile back to ink and in place: the canvas is then the heading's own text, so the hand-back does not show
    draw(RIPPLE_MS);
    snapBack(root, heading, canvas);
    releaseSoon(root, canvas);
    // the tinted layers and the mask are this ripple's alone: free their buffers now
    for (const layer of layers) {
      layer.width = 0;
      layer.height = 0;
    }
    mask.width = 0;
    mask.height = 0;
  };
  const step = (at: number) => {
    const elapsed = at - started;
    if (elapsed >= RIPPLE_MS) {
      finish();
      return;
    }
    draw(elapsed);
    frame = requestAnimationFrame(step);
  };
  // the first frame is drawn before the heading goes transparent, so nothing flashes
  draw(0);
  root.classList.add('is-rippling');
  running.set(root, finish);
  frame = requestAnimationFrame(step);
}

let observer: IntersectionObserver | null = null;
let wired = false;

/** Life reaching the title's text bubbles a 'life-touch' from the heading (living-paper.ts): a ripple starts there. */
const onLifeTouch = (event: Event): void => {
  ripple(event.currentTarget as HTMLElement, (event as CustomEvent<LifeTouch>).detail);
};

/**
 * Starts each pixel title when it first enters the view, unless motion is reduced. Safe to call again: the listeners are
 * the same function each time, so they are not added twice.
 */
export function initPixelTitles(): void {
  if (typeof IntersectionObserver === 'undefined' || typeof matchMedia !== 'function') return;
  if (matchMedia(REDUCED).matches) return;
  const titles = document.querySelectorAll<HTMLElement>('[data-pixel-title]');
  if (titles.length === 0) return;

  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        void assemble(entry.target as HTMLElement);
      }
    },
    { threshold: 0.3 },
  );
  titles.forEach((title) => {
    // a title already assembled waits for refreshPixelTitles, not for the next scroll
    if (title.dataset.ptText === undefined) observer?.observe(title);
    title.addEventListener('life-touch', onLifeTouch);
  });

  if (wired) return;
  wired = true;
  // a resize mid-way would misplace the cells: settle the running titles on their final frame
  window.addEventListener(
    'resize',
    () => {
      for (const finish of [...running.values()]) finish();
    },
    { passive: true },
  );
}

/**
 * After a language switch the headings may hold new text. A title whose word changed stops whatever it is doing, is no
 * longer rippled (its glyphs are the old word's) and is observed again, so it assembles from the new word once it is in
 * view. The others keep their word and stay as they are.
 */
export function refreshPixelTitles(): void {
  const io = observer;
  if (!io) return;
  document.querySelectorAll<HTMLElement>('[data-pixel-title]').forEach((title) => {
    const text = title.querySelector('.pt-text')?.textContent ?? '';
    if (title.dataset.ptText === undefined || title.dataset.ptText === text) return;
    running.get(title)?.();
    assembled.delete(title);
    rasters.delete(title);
    io.observe(title);
  });
}
