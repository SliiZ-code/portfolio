import { describe, expect, it } from 'vitest';
import {
  contactStrength,
  farthest,
  RIPPLE_COOLDOWN_MS,
  RIPPLE_LIFE_MS,
  RIPPLE_MS,
  rippleAmplitude,
  ringContact,
  rippleBucket,
  rippleDue,
  rippleLift,
  ripplePhase,
  rippleSpeed,
} from '../src/scripts/title-ripple';

/** A grid of cols × rows with the given live cells, as [x, y] pairs. */
function grid(cols: number, rows: number, live: [number, number][]) {
  const cells = new Uint8Array(cols * rows);
  for (const [x, y] of live) cells[y * cols + x] = 1;
  return { cols, rows, cells };
}

describe('ringContact', () => {
  // a rock covering cells x 2..4, y 2..3 (its blocked box, pad included)
  const box = { x0: 2, y0: 2, x1: 4, y1: 3 };

  it('finds no contact when no live cell borders the rock', () => {
    expect(ringContact(grid(10, 10, [[0, 0], [8, 8]]), box)).toEqual({ count: 0, x: 0, y: 0 });
  });

  it('counts the live cells of the ring, diagonal corners included', () => {
    const g = grid(10, 10, [[1, 1], [5, 3], [3, 4]]);
    expect(ringContact(g, box).count).toBe(3);
  });

  it('ignores live cells inside the rock and cells two steps away', () => {
    const g = grid(10, 10, [[3, 2], [3, 0], [0, 2]]);
    expect(ringContact(g, box).count).toBe(0);
  });

  it('gives the centre of the touching cells, in cell units', () => {
    // two cells above the rock, at x = 2 and x = 4: their centres are (2.5, 1.5) and (4.5, 1.5)
    const c = ringContact(grid(10, 10, [[2, 1], [4, 1]]), box);
    expect(c.count).toBe(2);
    expect(c.x).toBeCloseTo(3.5, 10);
    expect(c.y).toBeCloseTo(1.5, 10);
  });

  it('clips at the edge of the grid', () => {
    const edge = { x0: 0, y0: 0, x1: 1, y1: 1 };
    const g = grid(4, 4, [[2, 0], [2, 1], [0, 2]]);
    expect(ringContact(g, edge).count).toBe(3);
  });
});

describe('contactStrength', () => {
  it('grows with the cells that touch and stops at full strength', () => {
    expect(contactStrength(1)).toBeGreaterThan(0);
    expect(contactStrength(2)).toBeGreaterThan(contactStrength(1));
    expect(contactStrength(3)).toBe(1);
    expect(contactStrength(30)).toBe(1);
  });
});

describe('farthest', () => {
  it('is the distance to the farthest of the points', () => {
    const xs = Float32Array.from([0, 3, 0]);
    const ys = Float32Array.from([0, 4, 10]);
    expect(farthest(xs, ys, 0, 0)).toBeCloseTo(10, 5);
    expect(farthest(new Float32Array(0), new Float32Array(0), 0, 0)).toBe(0);
  });
});

describe('ripple timing', () => {
  it('lasts about 800 ms, with each cell lit for 360 ms as the front passes', () => {
    expect(RIPPLE_MS).toBeGreaterThanOrEqual(600);
    expect(RIPPLE_MS).toBeLessThanOrEqual(900);
    expect(RIPPLE_LIFE_MS).toBeLessThan(RIPPLE_MS);
  });

  it('brings the front to the farthest cell when the wave has run for RIPPLE_MS - RIPPLE_LIFE_MS', () => {
    const speed = rippleSpeed(440);
    expect(speed).toBeCloseTo(1, 10);
    // the farthest cell is just reached at the start of its pulse, and its pulse ends at RIPPLE_MS
    expect(ripplePhase(440, RIPPLE_MS - RIPPLE_LIFE_MS, speed)).toBeCloseTo(0, 10);
    expect(ripplePhase(440, RIPPLE_MS, speed)).toBe(-1);
  });

  it('never divides by zero when nothing is away from the contact', () => {
    expect(Number.isFinite(rippleSpeed(0))).toBe(true);
  });
});

describe('ripplePhase', () => {
  const speed = 1; // px per ms

  it('is -1 before the front reaches the cell and after its pulse', () => {
    expect(ripplePhase(100, 50, speed)).toBe(-1);
    expect(ripplePhase(100, 100 + RIPPLE_LIFE_MS, speed)).toBe(-1);
  });

  it('runs from 0 to just under 1 while the cell is lit', () => {
    expect(ripplePhase(100, 100, speed)).toBeCloseTo(0, 10);
    expect(ripplePhase(100, 100 + RIPPLE_LIFE_MS / 2, speed)).toBeCloseTo(0.5, 10);
    expect(ripplePhase(100, 100 + RIPPLE_LIFE_MS - 1, speed)).toBeLessThan(1);
  });

  it('reaches a nearer cell first', () => {
    expect(ripplePhase(10, 50, speed)).toBeGreaterThan(ripplePhase(80, 50, speed));
  });
});

describe('rippleLift', () => {
  it('is zero outside the pulse and peaks at the amplitude in the middle of it', () => {
    expect(rippleLift(-1, 1)).toBe(0);
    expect(rippleLift(0.5, 1)).toBe(1);
    expect(rippleLift(0.05, 1)).toBe(0);
  });

  it('is a whole number of pixels, never above one pixel, so the letters stay whole at 2.5 px cells', () => {
    for (let p = 0; p < 1; p += 0.02) {
      const lift = rippleLift(p, 1);
      expect(Number.isInteger(lift)).toBe(true);
      expect(lift).toBeLessThanOrEqual(1);
    }
  });
});

describe('rippleAmplitude', () => {
  it('lifts a glancing touch not at all and a full front by one pixel, never more', () => {
    expect(rippleAmplitude(0)).toBe(0);
    expect(rippleAmplitude(1 / 3)).toBeCloseTo(1 / 3, 10);
    expect(rippleAmplitude(1)).toBe(1);
    expect(rippleAmplitude(5)).toBe(1);
  });
});

describe('rippleBucket', () => {
  it('is -1 (plain ink) outside the pulse and in its quiet ends', () => {
    expect(rippleBucket(-1)).toBe(-1);
    expect(rippleBucket(0.01)).toBe(-1);
    expect(rippleBucket(0.99)).toBe(-1);
  });

  it('walks through the life colours from life-0 to life-3 as the pulse runs', () => {
    expect(rippleBucket(0.2)).toBe(0);
    expect(rippleBucket(0.4)).toBe(1);
    expect(rippleBucket(0.6)).toBe(2);
    expect(rippleBucket(0.8)).toBe(3);
  });
});

describe('rippleDue', () => {
  it('is due when the title has never rippled', () => {
    expect(rippleDue(1000, undefined)).toBe(true);
  });

  it('holds off for the cooldown after the last ripple', () => {
    expect(rippleDue(1000 + RIPPLE_COOLDOWN_MS - 1, 1000)).toBe(false);
    expect(rippleDue(1000 + RIPPLE_COOLDOWN_MS, 1000)).toBe(true);
  });
});
