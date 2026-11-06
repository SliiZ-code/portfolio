// Ordered dithering for the project media: a source frame becomes two inks, the theme's ink and
// (for the very brightest highlights) the life colour. Pure functions only, so the tests run in node.

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
