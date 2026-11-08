// The horizon: where the board meets the paper, the paper comes in like a tide of ordered-dither cells. Each column's
// shoreline rolls on a sum of slow waves; below it the cells fill in through an 8×8 Bayer matrix, so the edge reads
// as halftone, not as a blur. Scrolling fast swells the waves. The helpers are pure and tested; `initHorizon`
// drives one canvas.

/** 8×8 Bayer matrix, as thresholds in (0, 1). */
export const BAYER8: Float32Array = (() => {
  const base = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  const out = new Float32Array(64);
  for (let i = 0; i < 64; i++) out[i] = (base[i >> 3][i & 7] + 0.5) / 64;
  return out;
})();

/** Rows of board cells in the band. */
export const HORIZON_ROWS = 40;
/** Frames per second while the band is on screen. */
export const HORIZON_FPS = 30;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The shoreline of column `x` at time `t` (s), as a share of the band's height: 0 is the board edge, 1 the paper. */
export function shoreline(x: number, t: number, swell: number, phase = 0): number {
  const wave =
    0.55 * Math.sin(x * 0.045 + t * 0.6 + phase) +
    0.3 * Math.sin(x * 0.11 - t * 0.9 + phase * 1.7) +
    0.15 * Math.sin(x * 0.23 + t * 1.7 - phase);
  const amp = 0.26 + 0.2 * clamp(swell, 0, 1);
  return clamp(0.36 + amp * wave, 0, 0.82);
}

/** Paper density (0 to 1) of row `y` of `rows`, for a column whose shoreline is `lo`. The last row is always 1. */
export function density(y: number, rows: number, lo: number): number {
  const d = clamp(((y + 1) / rows - lo) / (1 - lo), 0, 1);
  return d ** 1.4;
}

/**
 * Fills `out` (cols × rows, one byte per cell, row-major) with 1 where the cell is paper. Row 0 faces the board.
 */
export function fillHorizon(out: Uint8Array, cols: number, rows: number, t: number, swell: number, phase = 0): void {
  for (let x = 0; x < cols; x++) {
    const lo = shoreline(x, t, swell, phase);
    for (let y = 0; y < rows; y++) {
      out[y * cols + x] = density(y, rows, lo) > BAYER8[((y & 7) << 3) | (x & 7)] ? 1 : 0;
    }
  }
}

/* ---- the DOM ---- */

/** Drives one horizon canvas. `flip` draws the band upside down, for the bottom of the paper. */
export function initHorizon(canvas: HTMLCanvasElement, flip: boolean, phase: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  let cols = 0;
  let cell = 3;
  let mask = new Uint8Array(0);
  let image: ImageData | null = null;
  let paper: [number, number, number] = [255, 255, 255];
  let visible = false;
  let frame = 0;
  let last = 0;
  let swell = 0;
  let lastY = window.scrollY;

  const readPaper = () => {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return;
    probe.fillStyle = getComputedStyle(root).getPropertyValue('--paper').trim() || '#fff';
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    paper = [r, g, b];
  };

  const size = () => {
    cell = parseFloat(getComputedStyle(root).getPropertyValue('--c')) || 3;
    const width = canvas.parentElement?.clientWidth ?? window.innerWidth;
    cols = Math.ceil(width / cell);
    canvas.width = cols;
    canvas.height = HORIZON_ROWS;
    canvas.style.width = `${cols * cell}px`;
    canvas.style.height = `${HORIZON_ROWS * cell}px`;
    mask = new Uint8Array(cols * HORIZON_ROWS);
    image = ctx.createImageData(cols, HORIZON_ROWS);
  };

  const draw = (t: number) => {
    if (!image) return;
    fillHorizon(mask, cols, HORIZON_ROWS, t, swell, phase);
    const data = image.data;
    const [r, g, b] = paper;
    for (let y = 0; y < HORIZON_ROWS; y++) {
      const row = flip ? HORIZON_ROWS - 1 - y : y;
      for (let x = 0; x < cols; x++) {
        const o = (row * cols + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = mask[y * cols + x] ? 255 : 0;
      }
    }
    ctx.putImageData(image, 0, 0);
  };

  const tick = (now: number) => {
    frame = 0;
    if (!visible || still.matches) return;
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / HORIZON_FPS) return;
    last = now;
    // the board sets --c inline on <html>; a cheap read catches a change that came without a resize
    if ((parseFloat(root.style.getPropertyValue('--c')) || cell) !== cell) size();
    swell *= 0.94;
    draw(now / 1000);
  };

  const start = () => {
    if (!frame && visible && !still.matches) frame = requestAnimationFrame(tick);
  };

  readPaper();
  size();
  draw(0);
  canvas.hidden = false;
  canvas.closest('.home-content')?.classList.add('has-horizon');

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    start();
  }).observe(canvas);
  new ResizeObserver(() => {
    size();
    draw(last / 1000);
  }).observe(canvas.parentElement ?? root);
  new MutationObserver(() => {
    readPaper();
    draw(last / 1000);
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      swell = Math.min(1, swell + Math.abs(y - lastY) / 600);
      lastY = y;
    },
    { passive: true },
  );
  still.addEventListener('change', start);
}
