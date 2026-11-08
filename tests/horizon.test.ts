import { describe, expect, it } from 'vitest';
import { BAYER8, HORIZON_ROWS, density, fillHorizon, shoreline } from '../src/scripts/horizon';

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
