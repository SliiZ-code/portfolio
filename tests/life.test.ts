import { describe, expect, it } from 'vitest';
import { createWorld, stepBox, stepWorld } from '../src/scripts/board/life';
import { GLIDERS } from '../src/scripts/board/patterns';

const set = (world: ReturnType<typeof createWorld>, x: number, y: number) => {
  world.cells[y * world.w + x] = 1;
};
const alive = (world: ReturnType<typeof createWorld>, x: number, y: number) => world.cells[y * world.w + x] === 1;

describe('Life step', () => {
  it('oscillates a blinker with period two', () => {
    const world = createWorld(5, 5);
    set(world, 1, 2);
    set(world, 2, 2);
    set(world, 3, 2);

    expect(stepWorld(world)).toBe(3);
    expect([alive(world, 2, 1), alive(world, 2, 2), alive(world, 2, 3)]).toEqual([true, true, true]);
    expect(alive(world, 1, 2)).toBe(false);

    stepWorld(world);
    expect([alive(world, 1, 2), alive(world, 2, 2), alive(world, 3, 2)]).toEqual([true, true, true]);
    expect(alive(world, 2, 1)).toBe(false);
  });

  it('translates a glider by one cell diagonally every four generations', () => {
    const world = createWorld(12, 12);
    GLIDERS[0].forEach((row, j) => row.forEach((value, i) => value && set(world, 1 + i, 1 + j)));

    for (let generation = 0; generation < 4; generation++) stepWorld(world);

    const expected = GLIDERS[0].map((row, j) => row.map((value, i) => (value ? [2 + i, 2 + j] : null)));
    expected.flat().forEach((cell) => {
      if (cell) expect(alive(world, cell[0], cell[1])).toBe(true);
    });
    expect(world.cells.reduce((sum, value) => sum + value, 0)).toBe(5);
  });
});

describe('bounded step', () => {
  it('runs a blinker in a private box and clears its edges', () => {
    const cur = new Uint8Array(25);
    const nxt = new Uint8Array(25);
    [1, 2, 3].forEach((x) => (cur[2 * 5 + x] = 1));
    stepBox(cur, nxt, 5, 5);
    expect([nxt[1 * 5 + 2], nxt[2 * 5 + 2], nxt[3 * 5 + 2]]).toEqual([1, 1, 1]);
    expect(nxt[2 * 5 + 1]).toBe(0);
  });
});
