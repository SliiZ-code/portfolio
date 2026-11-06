/**
 * Pixel titles: a section title in Geist Pixel assembles from scattered square cells the first time it enters the
 * view, then settles into the crisp heading. The helpers at the top are pure and unit-tested; `initPixelTitles`
 * drives the DOM.
 */

export interface Point {
  x: number;
  y: number;
}

/** A cell of the title's grid, in cell units from the top-left of the glyph grid. */
export interface Cell {
  col: number;
  row: number;
}

/** Half-width and half-height of the area each cell can start in, around its own target. */
export interface Spread {
  x: number;
  y: number;
}

/** Each cell flies for this long, and waits up to MAX_DELAY_MS before it leaves. */
export const FLIGHT_MS = 900;
export const MAX_DELAY_MS = 250;

/** Share of the cells that start beyond the scatter area, so some come in from outside the title. */
export const OFF_EDGE_CHANCE = 0.2;

/** Colour buckets, from newborn to landed: the four tokens a cell passes through. */
export const COLOUR_TOKENS = ['--life-0', '--life-1', '--life-2', '--ink'] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Ease-out: fast at first, then settling onto the target. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** The colour bucket (0 to 3) for a cell's linear progress: the nearest of the four tokens. */
export function bucketColour(progress: number): number {
  return Math.round(clamp01(progress) * (COLOUR_TOKENS.length - 1));
}

/** A cell's linear progress (0 to 1) after `elapsed` ms, for a cell that waits `delay` ms first. */
export function flightProgress(elapsed: number, delay: number, duration = FLIGHT_MS): number {
  return clamp01((elapsed - delay) / duration);
}

/** The size of one cell for a title of this font size: about 6px at the desktop size, 2.5px at the least. */
export function cellSize(fontPx: number): number {
  return Math.max(2.5, fontPx / 22);
}

/**
 * Where a cell starts: a random point around its target, within `spread`. Some cells start beyond it,
 * so they come in from outside the title's edges.
 */
export function scatterStart(target: Point, rng: () => number, bounds: Spread): Point {
  const reach = rng() < OFF_EDGE_CHANCE ? 1.5 : 1;
  return {
    x: target.x + (rng() * 2 - 1) * bounds.x * reach,
    y: target.y + (rng() * 2 - 1) * bounds.y * reach,
  };
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

/* ---- the DOM: one canvas over each title, one rAF loop while it assembles ---- */

const FONT_STACK = '"Geist Pixel", monospace';
/** The title is drawn at this many samples per cell side, then averaged, so cells get their coverage. */
const SUPERSAMPLE = 4;
const THRESHOLD = 128;
const MAX_CANVAS_PIXELS = 4_000_000;
const REDUCED = '(prefers-reduced-motion: reduce)';

/** Stops every title that is still assembling: the resize handler calls these. */
const running = new Set<() => void>();

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

/** Assemble one title: the cells fly from scattered starts onto the glyphs, then the crisp heading returns. */
async function assemble(root: HTMLElement): Promise<void> {
  const heading = root.querySelector<HTMLElement>('.pt-text');
  const canvas = root.querySelector<HTMLCanvasElement>('.pt-canvas');
  if (!heading || !canvas) return;

  try {
    await document.fonts.load('100px "Geist Pixel"');
  } catch {
    // without the font the fallback still assembles, so the title is not lost
  }

  const style = getComputedStyle(heading);
  const fontPx = parseFloat(style.fontSize);
  const lineHeight = parseFloat(style.lineHeight) || fontPx * 1.2;
  const spacing = parseFloat(style.letterSpacing) || 0;
  const raster = rasterTitle(heading.textContent ?? '', fontPx, lineHeight, spacing);
  const ctx = canvas.getContext('2d');
  if (!raster || !ctx || raster.cells.length === 0) return;

  const { cells, cols, rows, cell, top } = raster;
  const spread: Spread = { x: 0.4 * window.innerWidth, y: 0.3 * window.innerHeight };

  // The canvas covers the whole scatter area, so cells can fly in from around the title. It is clipped to the
  // viewport: cells beyond it are not on screen, and a canvas that hangs off the page would widen the scroll.
  const rect = root.getBoundingClientRect();
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  const x0 = Math.max(-spread.x, -rect.left);
  const y0 = Math.max(top - spread.y, -rect.top);
  const x1 = Math.max(x0 + 1, Math.min(cols * cell + spread.x, viewWidth - rect.left));
  const y1 = Math.max(y0 + 1, Math.min(top + rows * cell + spread.y, viewHeight - rect.top));
  const width = x1 - x0;
  const height = y1 - y0;
  // device pixels per CSS pixel: at most 2, and fewer on a large scatter area, to keep the backing store small
  const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  canvas.style.left = `${x0}px`;
  canvas.style.top = `${y0}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const tokens = getComputedStyle(document.documentElement);
  const colours = COLOUR_TOKENS.map((name) => tokens.getPropertyValue(name).trim());

  const count = cells.length;
  const tx = new Float32Array(count);
  const ty = new Float32Array(count);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const delay = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    tx[i] = cells[i].col * cell;
    ty[i] = top + cells[i].row * cell;
    const start = scatterStart({ x: tx[i], y: ty[i] }, Math.random, spread);
    sx[i] = start.x;
    sy[i] = start.y;
    delay[i] = Math.random() * MAX_DELAY_MS;
  }

  const size = cell * 0.9;
  const inset = (cell - size) / 2;
  const bucketOf = new Uint8Array(count);
  const px = new Float32Array(count);
  const py = new Float32Array(count);

  /** Draws one frame, with one fillStyle per colour bucket. Returns true once every cell has landed. */
  const draw = (elapsed: number): boolean => {
    let landed = true;
    for (let i = 0; i < count; i++) {
      const progress = flightProgress(elapsed, delay[i]);
      if (progress < 1) landed = false;
      const eased = easeOutCubic(progress);
      px[i] = sx[i] + (tx[i] - sx[i]) * eased;
      py[i] = sy[i] + (ty[i] - sy[i]) * eased;
      bucketOf[i] = bucketColour(progress);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    for (let b = 0; b < colours.length; b++) {
      ctx.fillStyle = colours[b];
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        if (bucketOf[i] === b) ctx.rect(px[i] + inset, py[i] + inset, size, size);
      }
      ctx.fill();
    }
    return landed;
  };

  let frame = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    running.delete(finish);
    draw(Infinity);
    // the heading's colour returns and the canvas fades out over 150ms (see PixelTitle.astro)
    root.classList.remove('is-assembling');
    window.setTimeout(() => {
      canvas.width = 0;
      canvas.height = 0;
    }, 200);
  };

  // the first frame is drawn before the heading goes transparent, so nothing flashes
  draw(0);
  root.classList.add('is-assembling');
  const started = performance.now();
  const step = () => {
    if (draw(performance.now() - started)) {
      finish();
    } else {
      frame = requestAnimationFrame(step);
    }
  };
  running.add(finish);
  frame = requestAnimationFrame(step);
}

/** Starts each pixel title when it first enters the view, unless motion is reduced. */
export function initPixelTitles(): void {
  if (typeof IntersectionObserver === 'undefined' || typeof matchMedia !== 'function') return;
  if (matchMedia(REDUCED).matches) return;
  const titles = document.querySelectorAll<HTMLElement>('[data-pixel-title]');
  if (titles.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void assemble(entry.target as HTMLElement);
      }
    },
    { threshold: 0.3 },
  );
  titles.forEach((title) => observer.observe(title));

  // a resize mid-flight would misplace the cells: settle the running titles on their final frame
  window.addEventListener(
    'resize',
    () => {
      for (const finish of [...running]) finish();
    },
    { passive: true },
  );
}
