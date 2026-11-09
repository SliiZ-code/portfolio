import { describe, expect, it } from 'vitest';
import { BAYER8, HORIZON_ROWS, density, fillHorizon, horizonFps, paintMask, shoreline } from '../src/scripts/horizon';

describe('horizon', () => {
  it('Bayer thresholds are 64 distinct values in (0, 1)', () => {
    expect(new Set(BAYER8).size).toBe(64);
    for (const v of BAYER8) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('the shoreline stays inside the band, even on a full swell', () => {
    for (let x = 0; x < 400; x += 7) {
      for (const swell of [0, 1, 5]) {
        const lo = shoreline(x, x * 0.37, swell);
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(lo).toBeLessThanOrEqual(0.82);
      }
    }
  });

  it('density rises toward the paper and the last row is solid', () => {
    expect(density(HORIZON_ROWS - 1, HORIZON_ROWS, 0.8)).toBe(1);
    expect(density(0, HORIZON_ROWS, 0.5)).toBe(0);
    expect(density(20, HORIZON_ROWS, 0.3)).toBeGreaterThan(density(12, HORIZON_ROWS, 0.3));
  });

  it('fills the paper side solid and leaves the board side open', () => {
    const cols = 64;
    const out = new Uint8Array(cols * HORIZON_ROWS);
    fillHorizon(out, cols, HORIZON_ROWS, 1.5, 0);
    const rowSum = (y: number) => out.subarray(y * cols, (y + 1) * cols).reduce((a, b) => a + b, 0);
    expect(rowSum(HORIZON_ROWS - 1)).toBe(cols);
    expect(rowSum(0)).toBe(0);
    expect(rowSum(HORIZON_ROWS - 4)).toBeGreaterThan(rowSum(6));
  });
});

describe('horizonFps', () => {
  it('runs at 30 on a fine pointer and halves on touch', () => {
    expect(horizonFps(false)).toBe(30);
    expect(horizonFps(true)).toBe(15);
  });
});

describe('paintMask', () => {
  it('writes only the alpha of the paper colour, flipped for the bottom band', () => {
    const cols = 2;
    const rows = 3;
    const mask = Uint8Array.from([1, 0, 0, 0, 0, 1]);
    const data = new Uint8ClampedArray(cols * rows * 4);
    paintMask(data, mask, cols, rows, false);
    expect(Array.from(data).filter((_, i) => i % 4 === 3)).toEqual([255, 0, 0, 0, 0, 255]);
    expect(Array.from(data).filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
    paintMask(data, mask, cols, rows, true);
    expect(Array.from(data).filter((_, i) => i % 4 === 3)).toEqual([0, 255, 0, 0, 255, 0]);
  });
});

describe('fillHorizon agrees with the per-cell definition', () => {
  it('marks a cell exactly where density beats its Bayer threshold', () => {
    const cols = 90;
    const rows = HORIZON_ROWS;
    const out = new Uint8Array(cols * rows);
    for (const [t, swell, phase] of [[0, 0, 0], [3.7, 0.6, 2.3], [41.2, 1, 4.6]] as const) {
      fillHorizon(out, cols, rows, t, swell, phase);
      for (let x = 0; x < cols; x++) {
        const lo = shoreline(x, t, swell, phase);
        for (let y = 0; y < rows; y++) {
          const want = density(y, rows, lo) > BAYER8[((y & 7) << 3) | (x & 7)]! ? 1 : 0;
          expect(out[y * cols + x]).toBe(want);
        }
      }
    }
  });
});

