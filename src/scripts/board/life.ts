import { GLIDER_HEADINGS } from './patterns';
import type { Box, Grid } from './layout';

export interface World {
  w: number;
  h: number;
  cells: Uint8Array;
  next: Uint8Array;
  /** Generations each live cell has survived: 0 on birth (or when painted), saturating at 255. Zero on dead cells. */
  age: Uint8Array;
  ageNext: Uint8Array;
}

export const createWorld = (w: number, h: number): World => ({
  w,
  h,
  cells: new Uint8Array(w * h),
  next: new Uint8Array(w * h),
  age: new Uint8Array(w * h),
  ageNext: new Uint8Array(w * h),
});

/** Toroidal index; keeps negative coordinates inside the board. */
export const idx = (w: number, h: number, x: number, y: number): number =>
  (((y % h) + h) % h) * w + (((x % w) + w) % w);

/** Makes a cell alive and newborn (painted, dropped, stamped or released by a structure). */
export const spawn = (world: World, k: number): void => {
  world.cells[k] = 1;
  world.age[k] = 0;
};

/** One step of the free world. Returns the new population. */
export function stepWorld(world: World): number {
  const { w, h, cells, next, age, ageNext } = world;
  let population = 0;
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const mid = y * w;
    const down = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      // wrap by comparison: a modulo per cell is the slowest part of this loop on a phone
      const left = x === 0 ? w - 1 : x - 1;
      const right = x === w - 1 ? 0 : x + 1;
      const i = mid + x;
      const n =
        cells[up + left] + cells[up + x] + cells[up + right] +
        cells[mid + left] + cells[mid + right] +
        cells[down + left] + cells[down + x] + cells[down + right];
      const alive = n === 3 || (n === 2 && cells[i]) ? 1 : 0;
      next[i] = alive;
      if (!alive) {
        ageNext[i] = 0;
        continue;
      }
      population++;
      ageNext[i] = cells[i] ? (age[i] < 255 ? age[i] + 1 : 255) : 0;
    }
  }
  world.cells = next;
  world.next = cells;
  world.age = ageNext;
  world.ageNext = age;
  return population;
}

/** How many cells live: a plain loop, because the HUD asks every generation and `reduce` on a big typed array is slow on a phone. */
export function countLive(cells: Uint8Array): number {
  let live = 0;
  for (let i = 0; i < cells.length; i++) live += cells[i]!;
  return live;
}

/** The board starts busy at once: `density` of every cell that `isProtected` doesn't claim. Used when there is no opening wave. */
export function seedWorld(world: World, isProtected: (x: number, y: number) => boolean, density: number, rnd: () => number = Math.random): void {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (!isProtected(x, y) && rnd() < density) world.cells[y * world.w + x] = 1;
    }
  }
}

/**
 * The opening wave's sowing order: every cell index once, nearest the front's centre first, with its
 * squared distance. Sorted once per layout, so a frame only walks the ring the front just crossed
 * instead of measuring the whole grid.
 */
export interface SowPlan {
  order: Uint32Array;
  /** Squared distance of each entry in `order`. */
  dist2: Float32Array;
  /** How far into `order` the wave has got: every entry before it had its one chance. */
  cursor: number;
}

export function createSowPlan(world: World, centre: { x: number; y: number }): SowPlan {
  const n = world.w * world.h;
  const order = new Uint32Array(n);
  const dist2 = new Float32Array(n);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const i = y * world.w + x;
      order[i] = i;
      dist2[i] = (x - centre.x) ** 2 + (y - centre.y) ** 2;
    }
  }
  order.sort((a, b) => dist2[a] - dist2[b]);
  return { order, dist2, cursor: 0 };
}

/**
 * Sows the soup inside the wave's front, each cell once: `density` of the free cells it newly reaches
 * turn alive, protected cells are skipped for good. The cursor only moves forward, so a second call
 * with the same (or a smaller) front does nothing, and `Infinity` sows whatever the wave has not reached.
 * Returns how many cells were newly sown.
 */
export function sowWithin(
  world: World,
  plan: SowPlan,
  front: number,
  isProtected: (x: number, y: number) => boolean,
  density: number,
  rnd: () => number = Math.random,
): number {
  // also rejects NaN and a wave that has not started
  if (!(front > 0)) return 0;
  const limit = front * front;
  const { order, dist2 } = plan;
  let cursor = plan.cursor;
  let sown = 0;
  while (cursor < order.length && dist2[order[cursor]] <= limit) {
    const i = order[cursor++];
    const x = i % world.w;
    const y = (i / world.w) | 0;
    // one chance per cell: a protected cell is never retried as the front grows
    if (isProtected(x, y) || !(rnd() < density)) continue;
    world.cells[i] = 1;
    world.age[i] = 0;
    sown++;
  }
  plan.cursor = cursor;
  return sown;
}

/** Free cells die inside keep-clear boxes, so labels stay readable. */
export function clearBoxes(world: World, boxes: Box[]): void {
  for (const box of boxes) {
    for (let y = Math.max(0, box.y); y < Math.min(world.h, box.y2); y++) {
      for (let x = Math.max(0, box.x); x < Math.min(world.w, box.x2); x++) world.cells[y * world.w + x] = 0;
    }
  }
}

/** A glider on a random edge, flying toward the middle of the board. */
export function feedGlider(grid: Grid, rnd: () => number = Math.random) {
  const side = Math.floor(rnd() * 4);
  const x = side === 0 ? 1 : side === 1 ? grid.cols - 4 : Math.floor(rnd() * (grid.cols - 4));
  const y = side === 2 ? 1 : side === 3 ? grid.rows - 4 : Math.floor(rnd() * (grid.rows - 4));
  const dx = x + 1 < grid.cols / 2 ? 1 : -1;
  const dy = y + 1 < grid.rows / 2 ? 1 : -1;
  const glider = GLIDER_HEADINGS.find((entry) => entry.heading[0] === dx && entry.heading[1] === dy)!;
  return { x, y, heading: glider.heading, cells: glider.cells };
}

export function addFeedGlider(world: World, rnd: () => number = Math.random): void {
  const { x, y, cells } = feedGlider({ cols: world.w, rows: world.h }, rnd);
  cells.forEach((row, j) => row.forEach((value, i) => value && spawn(world, idx(world.w, world.h, x + i, y + j))));
}
