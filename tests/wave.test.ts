import { describe, expect, it } from 'vitest';
import { waveFront, waveTravel } from '../src/scripts/board/wave';

describe('the opening wave', () => {
  it('travels past the farthest corner and the trailing bands', () => {
    const travel = waveTravel({ x: 180, y: 85 }, { cols: 360, rows: 225 }, 4, 3);
    expect(travel).toBeCloseTo(Math.hypot(180, 140) + 12, 5);
  });

  it('starts at the centre, ends at the travel, never goes backwards and decelerates', () => {
    expect(waveFront(0, 200)).toBe(0);
    expect(waveFront(1, 200)).toBeCloseTo(200, 5);
    expect(waveFront(2, 200)).toBeCloseTo(200, 5);
    expect(waveFront(-1, 200)).toBe(0);
    let previous = -1;
    let previousStep = Infinity;
    for (let n = 0; n <= 20; n++) {
      const front = waveFront(n / 20, 200);
      expect(front).toBeGreaterThanOrEqual(previous);
      if (n > 0) {
        expect(front - previous).toBeLessThanOrEqual(previousStep + 1e-9);
        previousStep = front - previous;
      }
      previous = front;
    }
  });
});
