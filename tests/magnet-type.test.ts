import { describe, expect, it } from 'vitest';
import { PEAK_WEIGHT, RADIUS, REST_WEIGHT, magnetWeight } from '../src/scripts/magnet-type';

describe('magnetWeight', () => {
  it('peaks at the pointer and rests beyond the radius', () => {
    expect(magnetWeight(0)).toBe(PEAK_WEIGHT);
    expect(magnetWeight(RADIUS)).toBe(REST_WEIGHT);
    expect(magnetWeight(RADIUS * 3)).toBe(REST_WEIGHT);
  });

  it('falls off smoothly and never rises with distance', () => {
    let prev = Infinity;
    for (let d = 0; d <= RADIUS; d += 10) {
      const w = magnetWeight(d);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
    expect(magnetWeight(RADIUS / 2)).toBeCloseTo((REST_WEIGHT + PEAK_WEIGHT) / 2, 5);
  });
});
