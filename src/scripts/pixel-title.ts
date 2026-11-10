/**
 * Pixel titles: the first time a section title enters the view, a soup of Game of Life cells boils around it and the
 * title emerges from it: each generation runs B3/S23, then the glyph cells lock in one by one and the stray cells die
 * off, until only the word is left and the crisp heading returns. The helpers at the top are pure and unit-tested;
 * `initPixelTitles` drives the DOM.
 */

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

/** Assemble one title: the soup boils, the glyph cells lock in, then the crisp heading returns. */
async function assemble(root: HTMLElement): Promise<void> {
  const heading = root.querySelector<HTMLElement>('.pt-text');
  const canvas = root.querySelector<HTMLCanvasElement>('.pt-canvas');
  if (!heading || !canvas) return;
  // the text this title was drawn with: a language switch changes it, and the title then assembles again
  root.dataset.ptText = heading.textContent ?? '';

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
  const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  canvas.style.left = `${x0}px`;
  canvas.style.top = `${y0}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const tokens = getComputedStyle(document.documentElement);
  const colours = COLOUR_TOKENS.map((name) => tokens.getPropertyValue(name).trim());

  const soup = makeSoup(cols, rows, Math.random);
  const size = cell * 0.9;
  const inset = (cell - size) / 2;

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (let b = 0; b < colours.length; b++) {
      ctx.fillStyle = colours[b];
      ctx.beginPath();
      for (let i = 0; i < soup.alive.length; i++) {
        if (soup.alive[i] && soupBucket(soup, i) === b) {
          ctx.rect((i % cols) * cell + inset, Math.floor(i / cols) * cell + inset, size, size);
        }
      }
      ctx.fill();
    }
  };

  let frame = 0;
  let generation = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    running.delete(finish);
    emergeStep(soup, target, 1, Math.random);
    draw();
    // the heading's colour returns and the canvas fades out over 150ms (see PixelTitle.astro)
    root.classList.remove('is-assembling');
    window.setTimeout(() => {
      canvas.width = 0;
      canvas.height = 0;
    }, 200);
  };

  // the first frame is drawn before the heading goes transparent, so nothing flashes
  draw();
  root.classList.add('is-assembling');
  let last = performance.now();
  const step = (now: number) => {
    if (now - last >= GENERATION_MS) {
      last = now;
      generation++;
      if (generation >= GENERATIONS) {
        finish();
        return;
      }
      emergeStep(soup, target, generation / GENERATIONS, Math.random);
      draw();
    }
    frame = requestAnimationFrame(step);
  };
  running.add(finish);
  frame = requestAnimationFrame(step);
}

let observer: IntersectionObserver | null = null;
let settleOnResize = false;

/** Starts each pixel title when it first enters the view, unless motion is reduced. Safe to call again. */
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
  });

  if (settleOnResize) return;
  settleOnResize = true;
  // a resize mid-way would misplace the cells: settle the running titles on their final frame
  window.addEventListener(
    'resize',
    () => {
      for (const finish of [...running]) finish();
    },
    { passive: true },
  );
}

/**
 * After a language switch the headings may hold new text: each assembled title whose text changed is observed again,
 * so it assembles from the new word once it is in view (the others keep their word and stay as they are).
 */
export function refreshPixelTitles(): void {
  if (!observer) return;
  document.querySelectorAll<HTMLElement>('[data-pixel-title]').forEach((title) => {
    const text = title.querySelector('.pt-text')?.textContent ?? '';
    if (title.dataset.ptText !== undefined && title.dataset.ptText !== text) observer?.observe(title);
  });
}
