import type { Box, Grid } from './layout';

interface SlotOptions {
  /** Free cells kept around the rectangle. */
  margin?: number;
  /** Distance kept from the screen edges. */
  edge?: number;
  /** Where the rectangle would like to be (cells); defaults to the middle of the screen. */
  prefer?: { x: number; y: number };
}

/**
 * A free `need.w × need.h` rectangle (top-left in cells) that avoids every occupied box and
 * stays inside the screen, the one nearest to `prefer`. Null when nothing fits: the caller
 * leaves that entity off the board rather than drawing it over something else.
 */
export function findFreeSlot(
  need: { w: number; h: number },
  occupied: Box[],
  grid: Grid,
  { margin = 1, edge = 2, prefer }: SlotOptions = {},
): { x: number; y: number } | null {
  const px = prefer?.x ?? grid.cols / 2;
  const py = prefer?.y ?? grid.rows / 2;
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let y = edge; y + need.h <= grid.rows - edge; y++) {
    for (let x = edge; x + need.w <= grid.cols - edge; x++) {
      const distance = (x + need.w / 2 - px) ** 2 + (y + need.h / 2 - py) ** 2;
      if (distance >= bestDistance) continue;
      const hit = occupied.some(
        (box) => x - margin < box.x2 && x + need.w + margin > box.x && y - margin < box.y2 && y + need.h + margin > box.y,
      );
      if (hit) continue;
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best;
}
