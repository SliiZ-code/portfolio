import { describe, expect, it } from 'vitest';
import { addFeedGlider, clearBoxes, createWorld, feedGlider, seedWorld, spawn, stepBox, stepWorld } from '../src/scripts/board/life';
import { isProtected } from '../src/scripts/board/layout';
import { GLIDERS } from '../src/scripts/board/patterns';
import { AGE_STEPS, BUCKETS, ageBucket } from '../src/scripts/board/render';

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

describe('v2 world helpers', () => {
  const total = (world: ReturnType<typeof createWorld>) => world.cells.reduce((sum, value) => sum + value, 0);
  const seeded = (seed: number) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  };

  it('seeds about 30% of the free cells and none of the protected ones', () => {
    const world = createWorld(100, 60);
    const box = { x: 20, y: 10, x2: 60, y2: 40 };
    seedWorld(world, (x, y) => isProtected(x, y, 5, [box]), 0.3, seeded(7));
    let inside = 0;
    let free = 0;
    let alive = 0;
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 100; x++) {
        if (isProtected(x, y, 5, [box])) inside += world.cells[y * 100 + x];
        else {
          free++;
          alive += world.cells[y * 100 + x];
        }
      }
    expect(inside).toBe(0);
    expect(alive / free).toBeGreaterThan(0.26);
    expect(alive / free).toBeLessThan(0.34);
  });

  it('kills free cells inside keep-clear boxes only', () => {
    const world = createWorld(10, 10);
    world.cells.fill(1);
    clearBoxes(world, [{ x: 2, y: 3, x2: 5, y2: 6 }]);
    expect(total(world)).toBe(100 - 9);
    expect(world.cells[3 * 10 + 2]).toBe(0);
    expect(world.cells[6 * 10 + 5]).toBe(1);
  });

  it('clips keep-clear boxes that leave the board', () => {
    const world = createWorld(10, 10);
    world.cells.fill(1);
    clearBoxes(world, [{ x: -5, y: -5, x2: 2, y2: 2 }, { x: 8, y: 8, x2: 30, y2: 30 }]);
    expect(total(world)).toBe(100 - 4 - 4);
  });

  it('feeds a glider that starts on an edge and heads for the middle', () => {
    for (let n = 0; n < 400; n++) {
      const rnd = seeded(n + 1);
      const { x, y, heading } = feedGlider({ cols: 144, rows: 90 }, rnd);
      const onEdge = x === 1 || x === 144 - 4 || y === 1 || y === 90 - 4;
      expect(onEdge, `${x},${y}`).toBe(true);
      expect(Math.sign(heading[0])).toBe(x + 1 < 72 ? 1 : -1);
      expect(Math.sign(heading[1])).toBe(y + 1 < 45 ? 1 : -1);
    }
  });

  it('uses every edge', () => {
    const seen = new Set<string>();
    const rnd = seeded(3);
    for (let n = 0; n < 200; n++) {
      const { x, y } = feedGlider({ cols: 144, rows: 90 }, rnd);
      if (x === 1) seen.add('left');
      if (x === 140) seen.add('right');
      if (y === 1) seen.add('top');
      if (y === 86) seen.add('bottom');
    }
    expect(seen.size).toBe(4);
  });

  it('draws the fed glider into the world', () => {
    const world = createWorld(144, 90);
    addFeedGlider(world, seeded(5));
    expect(total(world)).toBe(5);
  });
});

describe('cell age', () => {
  const ageAt = (world: ReturnType<typeof createWorld>, x: number, y: number) => world.age[y * world.w + x];

  it('is 0 on birth and goes up by one for each generation survived', () => {
    const world = createWorld(9, 9);
    // a block: four cells that survive forever, next to an empty corner
    [[3, 3], [4, 3], [3, 4], [4, 4]].forEach(([x, y]) => spawn(world, y * 9 + x));
    // one more cell far away that dies at once
    spawn(world, 8 * 9 + 8);
    stepWorld(world);
    expect(ageAt(world, 3, 3)).toBe(1);
    expect(ageAt(world, 8, 8)).toBe(0);
    expect(alive(world, 8, 8)).toBe(false);
    stepWorld(world);
    stepWorld(world);
    expect(ageAt(world, 4, 4)).toBe(3);
  });

  it('starts a cell born from three neighbours at 0, and keeps counting for the old ones', () => {
    const world = createWorld(7, 7);
    [1, 2, 3].forEach((x) => spawn(world, 3 * 7 + x));
    stepWorld(world);
    // the blinker's middle survived, its vertical arms were born
    expect(ageAt(world, 2, 3)).toBe(1);
    expect([ageAt(world, 2, 2), ageAt(world, 2, 4)]).toEqual([0, 0]);
    stepWorld(world);
    // the middle survived again, the ends are newborn again
    expect(ageAt(world, 2, 3)).toBe(2);
    expect([ageAt(world, 1, 3), ageAt(world, 3, 3)]).toEqual([0, 0]);
  });

  it('saturates instead of wrapping around', () => {
    const world = createWorld(6, 6);
    [[2, 2], [3, 2], [2, 3], [3, 3]].forEach(([x, y]) => spawn(world, y * 6 + x));
    for (let n = 0; n < 300; n++) stepWorld(world);
    expect(ageAt(world, 2, 2)).toBe(255);
  });

  it('is reset to 0 when a cell is painted over a living one', () => {
    const world = createWorld(6, 6);
    [[2, 2], [3, 2], [2, 3], [3, 3]].forEach(([x, y]) => spawn(world, y * 6 + x));
    for (let n = 0; n < 5; n++) stepWorld(world);
    expect(ageAt(world, 2, 2)).toBe(5);
    spawn(world, 2 * 6 + 2);
    expect(ageAt(world, 2, 2)).toBe(0);
  });
});

describe('age buckets', () => {
  it('start bright and settle on the calm grey after about twelve to twenty generations', () => {
    expect(ageBucket(0)).toBe(0);
    expect(ageBucket(AGE_STEPS[0] - 1)).toBe(0);
    expect(ageBucket(AGE_STEPS[0])).toBe(1);
    expect(ageBucket(AGE_STEPS[2])).toBe(3);
    expect(ageBucket(AGE_STEPS[3] - 1)).toBe(3);
    expect(ageBucket(AGE_STEPS[3])).toBe(BUCKETS - 1);
    expect(ageBucket(255)).toBe(BUCKETS - 1);
    expect(AGE_STEPS[3]).toBeGreaterThanOrEqual(12);
    expect(AGE_STEPS[3]).toBeLessThanOrEqual(20);
  });

  it('never go backwards as a cell ages', () => {
    let previous = 0;
    for (let age = 0; age < 256; age++) {
      const bucket = ageBucket(age);
      expect(bucket).toBeGreaterThanOrEqual(previous);
      previous = bucket;
    }
  });
});
