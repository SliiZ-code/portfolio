import { GLIDER_HEADINGS } from './patterns';
import type { Box, Grid } from './layout';

export interface World {
  w: number;
  h: number;
  cells: Uint8Array;
  next: Uint8Array;
  heat: Uint8Array;
  heatNext: Uint8Array;
}

export const createWorld = (w: number, h: number): World => ({
  w,
  h,
  cells: new Uint8Array(w * h),
  next: new Uint8Array(w * h),
  heat: new Uint8Array(w * h),
  heatNext: new Uint8Array(w * h),
});

/** Toroidal index; keeps negative coordinates inside the board. */
export const idx = (w: number, h: number, x: number, y: number): number =>
  (((y % h) + h) % h) * w + (((x % w) + w) % w);

/** One step of the free world. Returns the new population. */
export function stepWorld(world: World): number {
  const { w, h, cells, next, heat, heatNext } = world;
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
        heatNext[i] = 0;
        continue;
      }
      population++;
      if (cells[i]) heatNext[i] = heat[i] > 5 ? heat[i] - 5 : 0;
      else
        heatNext[i] = Math.max(
          heat[up + left], heat[up + x], heat[up + right],
          heat[mid + left], heat[mid + right],
          heat[down + left], heat[down + x], heat[down + right],
        ) * 0.9;
    }
  }
  world.cells = next;
  world.next = cells;
  world.heat = heatNext;
  world.heatNext = heat;
  return population;
}

/** Bounded step used by a structure's private simulation (edges are dead). */
export function stepBox(cur: Uint8Array, nxt: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) n += cur[yy * w + xx];
        }
      }
      const i = y * w + x;
      nxt[i] = n === 3 || (n === 2 && cur[i]) ? 1 : 0;
    }
  }
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
  cells.forEach((row, j) => row.forEach((value, i) => value && (world.cells[idx(world.w, world.h, x + i, y + j)] = 1)));
}
