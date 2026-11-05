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
      const left = (x - 1 + w) % w;
      const right = (x + 1) % w;
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

/** The board starts busy: `density` of every cell that `isProtected` doesn't claim. */
export function seedWorld(world: World, isProtected: (x: number, y: number) => boolean, density: number, rnd: () => number = Math.random): void {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (!isProtected(x, y) && rnd() < density) world.cells[y * world.w + x] = 1;
    }
  }
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
