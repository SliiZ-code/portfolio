import { describe, expect, it } from 'vitest';
import { DITHER_HIGHLIGHT, DITHER_INK, DITHER_PAPER, bayer4, ditherToMask, luminance } from '../src/scripts/dither';

/** An RGBA buffer where every pixel has the same colour. */
const solid = (w: number, h: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
  return data;
};

const count = (mask: Uint8Array, value: number) => mask.filter((v) => v === value).length;

describe('bayer4', () => {
  it('gives thresholds strictly between 0 and 1', () => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const t = bayer4(x, y);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });

  it('uses each of the 16 thresholds once per 4×4 tile', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer4(x, y));
    expect(seen.size).toBe(16);
  });

  it('repeats every four pixels, also for negative coordinates', () => {
    expect(bayer4(5, 2)).toBe(bayer4(1, 2));
    expect(bayer4(0, 7)).toBe(bayer4(0, 3));
    expect(bayer4(-1, -1)).toBe(bayer4(3, 3));
  });

  it('starts the matrix at the darkest threshold', () => {
    expect(bayer4(0, 0)).toBeCloseTo(1 / 32);
    expect(bayer4(3, 3)).toBeCloseTo(5.5 / 16);
  });
});

describe('luminance', () => {
  it('runs from 0 for black to 1 for white', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(1);
  });

  it('weighs green over red over blue, as the eye does', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });

  it('keeps a mid grey at about half', () => {
    expect(luminance(128, 128, 128)).toBeCloseTo(0.5, 1);
  });
});

describe('ditherToMask', () => {
  it('returns one value per pixel', () => {
    expect(ditherToMask(solid(5, 3, 0, 0, 0), 5, 3)).toHaveLength(15);
  });

  it('turns black into solid ink', () => {
    const mask = ditherToMask(solid(8, 8, 0, 0, 0), 8, 8);
    expect(count(mask, DITHER_INK)).toBe(64);
  });

  it('leaves mid-white paper with no ink, and highlights only the sparse cells', () => {
    const mask = ditherToMask(solid(8, 8, 255, 255, 255), 8, 8);
    expect(count(mask, DITHER_INK)).toBe(0);
    // 2 of the 16 cells in each 4×4 tile: 8 × 8 / 16 × 2 = 8
    expect(count(mask, DITHER_HIGHLIGHT)).toBe(8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (mask[y * 8 + x] === DITHER_HIGHLIGHT) expect(bayer4(x, y)).toBeLessThan(2 / 16);
    }
  });

  it('gives about half the cells to a mid grey', () => {
    // 128 → luminance 0.502: exactly 8 of the 16 thresholds sit below it
    const mask = ditherToMask(solid(4, 4, 128, 128, 128), 4, 4);
    expect(count(mask, DITHER_INK)).toBe(8);
    expect(count(mask, DITHER_HIGHLIGHT)).toBe(0);
  });

  it('draws darker areas with more ink', () => {
    const dark = count(ditherToMask(solid(8, 8, 60, 60, 60), 8, 8), DITHER_INK);
    const light = count(ditherToMask(solid(8, 8, 200, 200, 200), 8, 8), DITHER_INK);
    expect(dark).toBeGreaterThan(light);
  });

  it('keeps transparent pixels on the paper', () => {
    const mask = ditherToMask(solid(4, 4, 0, 0, 0, 0), 4, 4);
    expect(count(mask, DITHER_PAPER)).toBe(16);
  });

  it('only ever returns the three mask values', () => {
    const data = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) data.set([i * 17, 255 - i * 17, 90, 255], i * 4);
    for (const v of ditherToMask(data, 4, 4)) expect([DITHER_PAPER, DITHER_INK, DITHER_HIGHLIGHT]).toContain(v);
  });
});

describe('ditherToMask on light ink (night)', () => {
  it('inks the bright pixels instead of the dark ones', () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    expect(ditherToMask(white, 1, 1, true)[0]).toBe(DITHER_INK);
    expect(ditherToMask(black, 1, 1, true)[0]).toBe(DITHER_PAPER);
  });
});
