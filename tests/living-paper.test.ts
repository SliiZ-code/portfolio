import { describe, expect, it } from 'vitest';
import { blockRect, createGrid, lineCells, PAD, plant, plantGlider, seedBlob, stepGrid } from '../src/scripts/living-paper';

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
