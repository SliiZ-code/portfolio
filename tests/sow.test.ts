import { describe, expect, it } from 'vitest';
import { createSowPlan, createWorld, sowWithin } from '../src/scripts/board/life';
import { isProtected } from '../src/scripts/board/layout';

const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};

const total = (world: ReturnType<typeof createWorld>) => world.cells.reduce((sum, value) => sum + value, 0);
const alive = (world: ReturnType<typeof createWorld>, x: number, y: number) => world.cells[y * world.w + x] === 1;
const dist2 = (x: number, y: number, centre: { x: number; y: number }) => (x - centre.x) ** 2 + (y - centre.y) ** 2;

describe('the wave sowing life', () => {
  it('sows every free cell at or inside the front and leaves the rest untouched', () => {
    const world = createWorld(9, 9);
    const centre = { x: 4, y: 4 };
    const plan = createSowPlan(world, centre);
    const front = 2.5;
    sowWithin(world, plan, front, () => false, 1, () => 0);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        expect(alive(world, x, y), `${x},${y}`).toBe(dist2(x, y, centre) <= front * front);
      }
    }
  });

  it('gives each cell one chance: a second call with the same front sows nothing new', () => {
    const world = createWorld(5, 5);
    const plan = createSowPlan(world, { x: 2, y: 2 });
    let calls = 0;
    // every first-pass draw fails, every retry would succeed: a re-scan would fill the board
    const rnd = () => (calls++ < 25 ? 0.9 : 0);
    expect(sowWithin(world, plan, 10, () => false, 0.5, rnd)).toBe(0);
    expect(total(world)).toBe(0);
    expect(sowWithin(world, plan, 10, () => false, 0.5, () => 0)).toBe(0);
    expect(total(world)).toBe(0);
  });

  it('advances with the front, and never rewinds when the front shrinks', () => {
    const world = createWorld(9, 9);
    const plan = createSowPlan(world, { x: 4, y: 4 });
    expect(sowWithin(world, plan, 0, () => false, 1, () => 0)).toBe(0);
    expect(total(world)).toBe(0);
    sowWithin(world, plan, 1.5, () => false, 1, () => 0);
    const insideNear = total(world);
    expect(insideNear).toBeGreaterThan(0);
    expect(alive(world, 4, 4)).toBe(true);
    expect(alive(world, 0, 0)).toBe(false);
    sowWithin(world, plan, 1, () => false, 1, () => 0);
    expect(total(world)).toBe(insideNear);
    sowWithin(world, plan, 100, () => false, 1, () => 0);
    expect(total(world)).toBe(81);
  });

  it('never sows protected cells, even when they are the first the front reaches', () => {
    const world = createWorld(9, 9);
    const plan = createSowPlan(world, { x: 4, y: 4 });
    const protectedCell = (x: number, y: number) => y === 4 || (x === 0 && y === 0);
    sowWithin(world, plan, Infinity, protectedCell, 1, () => 0);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        expect(alive(world, x, y), `${x},${y}`).toBe(!protectedCell(x, y));
      }
    }
  });

  it('sows the same density seedWorld does, once the front covers the board', () => {
    const world = createWorld(100, 60);
    const box = { x: 20, y: 10, x2: 60, y2: 40 };
    const plan = createSowPlan(world, { x: 50, y: 30 });
    sowWithin(world, plan, Infinity, (x, y) => isProtected(x, y, 5, [box]), 0.3, seeded(7));
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

  it('is deterministic with an injected rnd, however the front is stepped', () => {
    const oneShot = createWorld(20, 14);
    const stepped = createWorld(20, 14);
    const centre = { x: 7.5, y: 6.5 };
    const a = createSowPlan(oneShot, centre);
    const b = createSowPlan(stepped, centre);
    const rndA = seeded(11);
    const rndB = seeded(11);
    sowWithin(oneShot, a, Infinity, () => false, 0.08, rndA);
    for (let front = 0; front <= 20; front += 0.5) sowWithin(stepped, b, front, () => false, 0.08, rndB);
    expect(Array.from(stepped.cells)).toEqual(Array.from(oneShot.cells));
  });

  it('plans every cell once, nearest first', () => {
    const world = createWorld(13, 7);
    const centre = { x: 6, y: 3 };
    const plan = createSowPlan(world, centre);
    expect(plan.order.length).toBe(13 * 7);
    expect(new Set(plan.order).size).toBe(13 * 7);
    let previous = -1;
    for (const i of plan.order) {
      const d = dist2(i % world.w, (i / world.w) | 0, centre);
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
  });
});
