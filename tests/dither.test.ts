import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  BURST_GENERATIONS,
  DITHER_HIGHLIGHT,
  DITHER_INK,
  DITHER_PAPER,
  SEED_AGE,
  ageBucket,
  bayer4,
  ditherToMask,
  generationAt,
  luminance,
  maskToWorldCells,
} from '../src/scripts/dither';
import { createWorld, stepWorld } from '../src/scripts/board/life';

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

describe('maskToWorldCells', () => {
  it('makes ink cells alive and everything else dead, row-major', () => {
    const mask = Uint8Array.from([DITHER_INK, DITHER_PAPER, DITHER_INK, DITHER_PAPER, DITHER_PAPER, DITHER_INK]);
    expect(Array.from(maskToWorldCells(mask, 3, 2))).toEqual([1, 0, 1, 0, 0, 1]);
  });

  it('leaves the sparse highlights dead: only the ink lives', () => {
    const mask = Uint8Array.from([DITHER_HIGHLIGHT, DITHER_HIGHLIGHT, DITHER_INK, DITHER_PAPER]);
    expect(Array.from(maskToWorldCells(mask, 2, 2))).toEqual([0, 0, 1, 0]);
  });

  it('returns a world-sized array of 0s and 1s', () => {
    const cells = maskToWorldCells(ditherToMask(solid(93, 70, 40, 40, 40), 93, 70), 93, 70);
    expect(cells).toHaveLength(93 * 70);
    expect(new Set(cells)).toEqual(new Set([0, 1]));
  });

  it('is empty for a mask with no ink', () => {
    const cells = maskToWorldCells(ditherToMask(solid(8, 8, 255, 255, 255), 8, 8), 8, 8);
    expect(cells.every((c) => c === 0)).toBe(true);
  });

  it('gives a world that Life can step: a blinker from the mask oscillates', () => {
    // a 3-cell bar of ink in a 5×5 mask
    const mask = new Uint8Array(25);
    [11, 12, 13].forEach((k) => (mask[k] = DITHER_INK));
    const world = createWorld(5, 5);
    world.cells.set(maskToWorldCells(mask, 5, 5));
    stepWorld(world);
    expect(Array.from(world.cells).reduce((a, b) => a + b, 0)).toBe(3);
    expect(world.cells[7] + world.cells[12] + world.cells[17]).toBe(3);
  });
});

describe('ageBucket (the board’s colour buckets)', () => {
  it('colours a newborn cell and the young ones with the first three life colours', () => {
    expect([0, 1, 2].map(ageBucket)).toEqual([0, 0, 0]);
    expect([3, 6].map(ageBucket)).toEqual([1, 1]);
    expect([7, 11].map(ageBucket)).toEqual([2, 2]);
    expect([12, 17].map(ageBucket)).toEqual([3, 3]);
  });

  it('turns every cell from age 18 on into the calm ink bucket', () => {
    expect([18, 19, 100, 255].map(ageBucket)).toEqual([BUCKETS - 1, BUCKETS - 1, BUCKETS - 1, BUCKETS - 1]);
  });

  it('starts the seeded cells in the calm bucket, so the first frame reads as the dither', () => {
    expect(ageBucket(SEED_AGE)).toBe(BUCKETS - 1);
    expect(ageBucket(SEED_AGE - 1)).toBeLessThan(BUCKETS - 1);
  });
});

describe('generationAt', () => {
  it('runs the burst at 30 generations a second by default', () => {
    expect(generationAt(0)).toBe(0);
    expect(generationAt(1000)).toBe(30);
    expect(generationAt(999)).toBe(29);
  });

  it('reaches the full burst after its length in generations', () => {
    expect(generationAt((BURST_GENERATIONS * 1000) / 30)).toBe(BURST_GENERATIONS);
  });

  it('takes a tempo, and never goes negative', () => {
    expect(generationAt(2000, 8)).toBe(16);
    expect(generationAt(-50)).toBe(0);
  });
});
