// Ordered dithering for the project media: a source frame becomes two inks, the theme's ink and
// (for the very brightest highlights) the life colour. The dithered mask is also the seed of a Game of
// Life burst on hover (see ProjectMedia.astro). Pure functions only, so the tests run in node.

import { AGE_STEPS } from './board/render';

export { ageBucket, BUCKET_ALPHA, BUCKETS } from './board/render';

/** Mask value: the pixel stays paper. */
export const DITHER_PAPER = 0;
/** Mask value: the pixel is drawn in `--ink`. */
export const DITHER_INK = 1;
/** Mask value: a sparse highlight drawn in `--life-0`. */
export const DITHER_HIGHLIGHT = 2;

/** The 4×4 Bayer matrix: each position's rank 0–15 in the dither order. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Luminance from which a pixel can become a highlight. */
const HIGHLIGHT_FROM = 0.97;
/** Only the cells whose threshold is below this (2 of 16) show a highlight, so they stay sparse. */
const HIGHLIGHT_BELOW = 2 / 16;

/**
 * The ordered-dither threshold for pixel (x, y), in (0, 1): the Bayer rank, centred in its cell so
 * no threshold is exactly 0 or 1. Negative coordinates wrap, so the tile repeats everywhere.
 */
export function bayer4(x: number, y: number): number {
  const col = ((x % 4) + 4) % 4;
  const row = ((y % 4) + 4) % 4;
  return (BAYER_4[row * 4 + col] + 0.5) / 16;
}

/** Relative luminance in [0, 1] from 8-bit channels (Rec. 601 weights, applied to the encoded values). */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Two-level ordered dither of an RGBA buffer (`w × h` pixels, row-major). Dark pixels turn into ink
 * on a denser share of cells, so the ink coverage follows the darkness. Transparent pixels stay paper.
 * Returns one mask value per pixel: DITHER_PAPER, DITHER_INK or DITHER_HIGHLIGHT.
 */
export function ditherToMask(rgba: Uint8ClampedArray, w: number, h: number, invert = false): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (rgba[p + 3] < 128) continue;
      // light ink on dark paper (night): bright pixels take the ink, so the picture is not a negative
      const lum = luminance(rgba[p], rgba[p + 1], rgba[p + 2]);
      const value = invert ? 1 - lum : lum;
      const threshold = bayer4(x, y);
      if (value < threshold) mask[i] = DITHER_INK;
      else if (!invert && value >= HIGHLIGHT_FROM && threshold < HIGHLIGHT_BELOW) mask[i] = DITHER_HIGHLIGHT;
    }
  }
  return mask;
}

/** Generations a hover, focus or touch burst runs for. */
export const BURST_GENERATIONS = 24;
/** The burst's tempo, in generations per second. */
export const BURST_RATE = 30;
/**
 * The age a seeded cell starts with: the oldest colour bucket, so the picture starts as the dither's ink
 * and only the newborn cells take the life colours. Set it to 0 to start the whole picture in `--life-0`.
 */
export const SEED_AGE = AGE_STEPS[AGE_STEPS.length - 1];

/**
 * The Life world for a dithered mask: ink cells are alive, paper and highlight cells are dead (the
 * highlights are sparse and only show on the still dither). Returns `w × h` cells, 1 alive, 0 dead.
 */
export function maskToWorldCells(mask: Uint8Array, w: number, h: number): Uint8Array {
  const cells = new Uint8Array(w * h);
  const n = Math.min(mask.length, w * h);
  for (let i = 0; i < n; i++) if (mask[i] === DITHER_INK) cells[i] = 1;
  return cells;
}

/** How many generations a burst has run after `elapsedMs`, at `perSecond` (never negative). */
export function generationAt(elapsedMs: number, perSecond = BURST_RATE): number {
  return Math.max(0, Math.floor((elapsedMs * perSecond) / 1000));
}
