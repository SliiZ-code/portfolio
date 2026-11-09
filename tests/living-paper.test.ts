import { describe, expect, it } from 'vitest';
import {
  blockRect,
  bucketCells,
  createGrid,
  lineCells,
  PAD,
  paperBucket,
  paperTuning,
  plant,
  plantGlider,
  seedBlob,
  SETTLED_BUCKET,
  stepGrid,
  visibleRows,
} from '../src/scripts/living-paper';

const live = (grid: ReturnType<typeof createGrid>) => {
  const out: string[] = [];
  grid.cells.forEach((age, k) => age && out.push(`${k % grid.cols},${Math.floor(k / grid.cols)}`));
  return out.sort();
};

describe('stepGrid', () => {
  it('turns a blinker and ages the centre cell', () => {
    const grid = createGrid(5, 5);
    [[1, 2], [2, 2], [3, 2]].forEach(([x, y]) => plant(grid, x!, y!));
    const scratch = new Uint8Array(25);
    expect(stepGrid(grid, scratch)).toBe(3);
    expect(live(grid)).toEqual(['2,1', '2,2', '2,3']);
    expect(grid.cells[2 * 5 + 2]).toBe(2);
    expect([grid.lo, grid.hi]).toEqual([1, 3]);
    stepGrid(grid, scratch);
    expect(live(grid)).toEqual(['1,2', '2,2', '3,2']);
  });

  it('kills a cell born on a rock', () => {
    const grid = createGrid(5, 5);
    [[1, 2], [2, 2], [3, 2]].forEach(([x, y]) => plant(grid, x!, y!));
    grid.blocked[1 * 5 + 2] = 1;
    stepGrid(grid, new Uint8Array(25));
    expect(live(grid)).toEqual(['2,2', '2,3']);
  });

  it('empties the band when everything dies', () => {
    const grid = createGrid(4, 4);
    plant(grid, 1, 1);
    expect(stepGrid(grid, new Uint8Array(16))).toBe(0);
    expect(grid.lo > grid.hi).toBe(true);
    expect(stepGrid(grid, new Uint8Array(16))).toBe(0);
  });

  it('moves a glider one cell diagonally every four generations', () => {
    const grid = createGrid(12, 12);
    plantGlider(grid, 2, 2, 1, 1);
    const before = live(grid).map((c) => c.split(',').map(Number));
    const scratch = new Uint8Array(144);
    for (let i = 0; i < 4; i++) stepGrid(grid, scratch);
    const after = live(grid).map((c) => c.split(',').map(Number));
    const shifted = before.map(([x, y]) => `${x! + 1},${y! + 1}`).sort();
    expect(after.map(([x, y]) => `${x},${y}`).sort()).toEqual(shifted);
  });
});

describe('plant and seedBlob', () => {
  it('never plants off the grid or on a rock', () => {
    const grid = createGrid(3, 3);
    grid.blocked[4] = 1;
    expect(plant(grid, -1, 0)).toBe(false);
    expect(plant(grid, 3, 0)).toBe(false);
    expect(plant(grid, 1, 1)).toBe(false);
    expect(plant(grid, 0, 0)).toBe(true);
    expect(plant(grid, 0, 0)).toBe(false);
  });

  it('plants every open cell of the blob when the dice always say yes', () => {
    const grid = createGrid(5, 5);
    expect(seedBlob(grid, 2, 2, () => 0)).toBe(9);
    expect(seedBlob(createGrid(5, 5), 2, 2, () => 0.99)).toBe(0);
  });
});

describe('blockRect', () => {
  it('blocks the cells under a box with padding, clamped to the grid', () => {
    const grid = createGrid(10, 10);
    blockRect(grid, 6, 12, 12, 24, 18); // cells x 2..3, y 2
    const blocked: string[] = [];
    grid.blocked.forEach((b, k) => b && blocked.push(`${k % 10},${Math.floor(k / 10)}`));
    expect(blocked).toContain(`${2 - PAD},${2 - PAD}`);
    expect(blocked).toContain(`${3 + PAD},${2 + PAD}`);
    expect(blocked).toHaveLength((2 + 2 * PAD) * (1 + 2 * PAD));
    blockRect(grid, 6, -50, -50, 1000, 1000);
    expect(grid.blocked.every((b) => b === 1)).toBe(true);
  });
});

describe('lineCells', () => {
  it('joins two cells without gaps', () => {
    expect(lineCells(0, 0, 3, 1)).toHaveLength(4);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
  });
});

describe('stepGrid on a window of rows', () => {
  it('leaves life outside the window frozen and keeps the live band honest', () => {
    const grid = createGrid(8, 30);
    // a blinker near the top, another far below
    [[1, 3], [2, 3], [3, 3]].forEach(([x, y]) => plant(grid, x!, y!));
    [[1, 24], [2, 24], [3, 24]].forEach(([x, y]) => plant(grid, x!, y!));
    stepGrid(grid, new Uint8Array(240), 0, 10);
    expect(live(grid)).toEqual(['1,24', '2,2', '2,24', '2,3', '2,4', '3,24']);
    // the frozen blinker still lies inside the band, so a later full step finds it
    expect(grid.hi).toBeGreaterThanOrEqual(24);
    expect(grid.lo).toBeLessThanOrEqual(2);
    stepGrid(grid, new Uint8Array(240));
    expect(live(grid)).toEqual(['1,3', '2,23', '2,24', '2,25', '2,3', '3,3']);
  });

  it('does nothing when the window misses the live band', () => {
    const grid = createGrid(6, 30);
    [[1, 20], [2, 20], [3, 20]].forEach(([x, y]) => plant(grid, x!, y!));
    expect(stepGrid(grid, new Uint8Array(180), 0, 5)).toBe(0);
    expect(live(grid)).toEqual(['1,20', '2,20', '3,20']);
    expect([grid.lo, grid.hi]).toEqual([20, 20]);
  });

  it('matches the full step when the window covers the band', () => {
    const a = createGrid(10, 12);
    const b = createGrid(10, 12);
    plantGlider(a, 2, 2, 1, 1);
    plantGlider(b, 2, 2, 1, 1);
    for (let i = 0; i < 6; i++) {
      stepGrid(a, new Uint8Array(120));
      stepGrid(b, new Uint8Array(120), 0, 11);
    }
    expect(live(b)).toEqual(live(a));
  });
});

describe('visibleRows', () => {
  it('gives the rows under the viewport, clamped to the grid', () => {
    // section top at -120px, 6px cells, 600px viewport: rows 20..120
    expect(visibleRows(-120, 6, 600, 500)).toEqual([20, 120]);
    expect(visibleRows(40, 6, 600, 500)).toEqual([0, 94]);
    expect(visibleRows(-120, 6, 600, 100)).toEqual([20, 99]);
  });

  it('widens by a margin of rows on both sides', () => {
    expect(visibleRows(-120, 6, 600, 500, 10)).toEqual([10, 130]);
    expect(visibleRows(-120, 6, 600, 125, 10)).toEqual([10, 124]);
  });

  it('is empty when the section is out of the viewport', () => {
    const [first, last] = visibleRows(-6000, 6, 600, 100);
    expect(first > last).toBe(true);
    const [f2, l2] = visibleRows(900, 6, 600, 100);
    expect(f2 > l2).toBe(true);
  });
});

describe('bucketCells', () => {
  it('lists each live cell of the rows once, under its colour bucket', () => {
    const grid = createGrid(4, 6);
    grid.cells[0 * 4 + 1] = 1; // young, outside the rows asked
    grid.cells[2 * 4 + 0] = 1;
    grid.cells[3 * 4 + 3] = 255; // settled
    grid.cells[4 * 4 + 2] = 2;
    const lists = Array.from({ length: SETTLED_BUCKET + 1 }, () => new Int32Array(24));
    const counts = new Int32Array(SETTLED_BUCKET + 1);
    grid.lo = 0;
    grid.hi = 5;
    bucketCells(grid, 2, 4, lists, counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    const at = (bucket: number) => Array.from(lists[bucket]!.subarray(0, counts[bucket]));
    expect(at(paperBucket(1))).toContain(2 * 4 + 0);
    expect(at(paperBucket(2))).toContain(4 * 4 + 2);
    expect(at(SETTLED_BUCKET)).toEqual([3 * 4 + 3]);
  });

  it('clears the counts of an earlier frame', () => {
    const grid = createGrid(4, 4);
    const lists = Array.from({ length: SETTLED_BUCKET + 1 }, () => new Int32Array(16));
    const counts = new Int32Array(SETTLED_BUCKET + 1).fill(7);
    bucketCells(grid, 0, 3, lists, counts);
    expect(counts.every((c) => c === 0)).toBe(true);
  });
});

describe('paperTuning', () => {
  it('keeps the desktop paper as it was', () => {
    const t = paperTuning({ coarse: false, cores: 8 });
    expect(t.stepMs).toBeCloseTo(1000 / 12);
    expect(t.maxDpr).toBe(2);
    expect(t.pauseWhileScrolling).toBe(false);
  });

  it('lightens the paper on a touch screen: slower, one pixel per cell pixel, still while the finger scrolls', () => {
    const t = paperTuning({ coarse: true, cores: 8 });
    expect(t.stepMs).toBeGreaterThan(1000 / 12);
    expect(t.maxDpr).toBe(1);
    expect(t.pauseWhileScrolling).toBe(true);
  });

  it('slows down a weak desktop and ignores an unknown core count', () => {
    expect(paperTuning({ coarse: false, cores: 2 }).stepMs).toBeGreaterThan(1000 / 12);
    expect(paperTuning({ coarse: false, cores: 0 }).stepMs).toBeCloseTo(1000 / 12);
  });
});
