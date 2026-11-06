import { describe, expect, it } from 'vitest';
import {
  bucketColour,
  cellSize,
  coverage,
  easeOutCubic,
  flightProgress,
  maskToCells,
  scatterStart,
} from '../src/scripts/pixel-title';

/** A seeded generator (mulberry32), so the scatter is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('easeOutCubic', () => {
  it('starts at 0 and lands on 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is fast at first: half way through the time it is most of the way', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });

  it('never goes back, and clamps outside 0 to 1', () => {
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const value = easeOutCubic(i / 100);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('bucketColour', () => {
  it('maps the four tokens: newborn, growing, grown, ink', () => {
    expect(bucketColour(0)).toBe(0);
    expect(bucketColour(1 / 3)).toBe(1);
    expect(bucketColour(2 / 3)).toBe(2);
    expect(bucketColour(1)).toBe(3);
  });

  it('picks the nearest token for the progress in between', () => {
    expect(bucketColour(0.16)).toBe(0);
    expect(bucketColour(0.2)).toBe(1);
    expect(bucketColour(0.5)).toBe(2);
    expect(bucketColour(0.9)).toBe(3);
  });

  it('clamps progress outside 0 to 1', () => {
    expect(bucketColour(-1)).toBe(0);
    expect(bucketColour(2)).toBe(3);
  });
});

describe('flightProgress', () => {
  it('waits out the delay, then runs for the flight time', () => {
    expect(flightProgress(100, 200)).toBe(0);
    expect(flightProgress(650, 200)).toBeCloseTo(0.5, 10);
    expect(flightProgress(2000, 200)).toBe(1);
    expect(flightProgress(Infinity, 200)).toBe(1);
  });
});

describe('cellSize', () => {
  it('is about 6px at the desktop size and scales down with the font', () => {
    expect(cellSize(132)).toBeCloseTo(6, 10);
    expect(cellSize(66)).toBeCloseTo(3, 10);
  });

  it('never goes below 2.5px', () => {
    expect(cellSize(20)).toBe(2.5);
  });
});

describe('scatterStart', () => {
  const spread = { x: 400, y: 200 };

  it('starts a cell on its target when the random draw is the middle', () => {
    expect(scatterStart({ x: 10, y: 20 }, () => 0.5, spread)).toEqual({ x: 10, y: 20 });
  });

  it('keeps most starts within the spread around the target', () => {
    const rng = seeded(7);
    const target = { x: 300, y: 80 };
    let inside = 0;
    for (let i = 0; i < 2000; i++) {
      const start = scatterStart(target, rng, spread);
      if (Math.abs(start.x - target.x) <= spread.x && Math.abs(start.y - target.y) <= spread.y) inside++;
    }
    // most starts fall inside the spread (about 89%); the off-edge ones fall outside it
    expect(inside / 2000).toBeGreaterThan(0.8);
    expect(inside / 2000).toBeLessThan(0.95);
  });

  it('is never further than 1.5 times the spread from its target', () => {
    const rng = seeded(11);
    const target = { x: 0, y: 0 };
    for (let i = 0; i < 2000; i++) {
      const start = scatterStart(target, rng, spread);
      expect(Math.abs(start.x)).toBeLessThanOrEqual(spread.x * 1.5);
      expect(Math.abs(start.y)).toBeLessThanOrEqual(spread.y * 1.5);
    }
  });

  it('is repeatable for the same seed', () => {
    const a = scatterStart({ x: 1, y: 2 }, seeded(3), spread);
    const b = scatterStart({ x: 1, y: 2 }, seeded(3), spread);
    expect(a).toEqual(b);
  });
});

describe('maskToCells', () => {
  it('returns the cells whose alpha reaches the threshold, in row order', () => {
    // 3 columns, 2 rows
    const alpha = Uint8ClampedArray.from([0, 128, 255, 127, 0, 200]);
    expect(maskToCells(alpha, 3, 2, 128)).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
    ]);
  });

  it('returns nothing for an empty mask', () => {
    expect(maskToCells(new Uint8ClampedArray(4), 2, 2, 128)).toEqual([]);
  });
});

describe('coverage', () => {
  it('averages each block of supersamples into one alpha per cell', () => {
    // 2 cells by 1 row at 2 samples a side: the image is 4 samples wide and 2 high
    const rgba = new Uint8ClampedArray(4 * 2 * 4);
    const put = (x: number, y: number, alpha: number) => {
      rgba[(y * 4 + x) * 4 + 3] = alpha;
    };
    put(0, 0, 255);
    put(1, 0, 255);
    put(2, 0, 255);
    const alpha = coverage(rgba, 2, 1, 2);
    expect(alpha[0]).toBe(128); // 510 / 4, rounded
    expect(alpha[1]).toBe(64); // 255 / 4, rounded
  });
});
