import { describe, expect, it } from 'vitest';
import {
  cellSize,
  coverage,
  emergeStep,
  HANDOFF_MS,
  handoffMix,
  makeSoup,
  maskToCells,
  soupBucket,
} from '../src/scripts/pixel-title';

/** A seeded generator (mulberry32), so the soup is the same on every run. */
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

describe('cellSize', () => {
  it('is about 6px at the desktop size and scales down with the font', () => {
    expect(cellSize(132)).toBeCloseTo(6, 10);
    expect(cellSize(66)).toBeCloseTo(3, 10);
  });

  it('never goes below 2.5px', () => {
    expect(cellSize(20)).toBe(2.5);
  });
});

describe('emergeStep', () => {
  const cols = 12;
  const rows = 8;
  const target = new Uint8Array(cols * rows);
  for (let x = 3; x < 9; x++) target[4 * cols + x] = 1;

  it('ends exactly on the title at k = 1', () => {
    const soup = makeSoup(cols, rows, seeded(7));
    emergeStep(soup, target, 1, seeded(8));
    expect([...soup.alive]).toEqual([...target]);
    expect(soupBucket(soup, 4 * cols + 3)).toBe(3);
  });

  it('runs plain B3/S23 at k = 0: a blinker turns', () => {
    const soup = makeSoup(5, 5, () => 1);
    soup.alive[2 * 5 + 1] = soup.alive[2 * 5 + 2] = soup.alive[2 * 5 + 3] = 1;
    emergeStep(soup, new Uint8Array(25), 0, () => 1);
    expect([1, 2, 3].map((y) => soup.alive[y * 5 + 2])).toEqual([1, 1, 1]);
    expect(soup.alive[2 * 5 + 1]).toBe(0);
  });

  it('keeps a locked cell alive and clears stray cells as k grows', () => {
    const soup = makeSoup(cols, rows, seeded(3), 0.5);
    const rng = seeded(4);
    let strays = Infinity;
    for (let g = 1; g <= 20; g++) {
      const before = [...soup.locked];
      emergeStep(soup, target, g / 21, rng);
      before.forEach((l, i) => l && expect(soup.alive[i]).toBe(1));
      if (g === 20) strays = soup.alive.reduce((n, a, i) => n + (a && !target[i] ? 1 : 0), 0);
    }
    expect(strays).toBeLessThan(cols * rows * 0.1);
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

describe('handoffMix', () => {
  it('starts on the cells and ends on the real glyphs', () => {
    expect(handoffMix(0)).toEqual({ cells: 1, glyphs: 0 });
    expect(handoffMix(HANDOFF_MS)).toEqual({ cells: 0, glyphs: 1 });
  });

  it('crossfades in between, and stays put beyond either end', () => {
    const mid = handoffMix(HANDOFF_MS / 2);
    expect(mid.cells).toBeCloseTo(0.5, 10);
    expect(mid.glyphs).toBeCloseTo(0.5, 10);
    expect(handoffMix(-5)).toEqual({ cells: 1, glyphs: 0 });
    expect(handoffMix(HANDOFF_MS * 3)).toEqual({ cells: 0, glyphs: 1 });
  });

  it('lasts about 100 ms', () => {
    expect(HANDOFF_MS).toBe(100);
  });
});
