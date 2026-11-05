// Pure geometry of the project list and of the seeds it fires. Pixels unless a name says cells.
import type { Box, Grid, Orientation } from './layout';

export interface PxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ListPlacement {
  left: number;
  top: number;
  width: number;
  /** The height the list gets; smaller than its natural height when it has to scroll. */
  height: number;
  /** True when the list is taller than the room it has: tighten it, then let it scroll. */
  overflow: boolean;
  /** True when the room is narrower than the list: drop the meta column. */
  narrow: boolean;
}

interface ListInput {
  vw: number;
  vh: number;
  orientation: Orientation;
  /** The list's size when nothing constrains it. */
  natural: { w: number; h: number };
  /** Everything the list must stay clear of: the name, its note, the CV and the contact. */
  obstacles: PxRect[];
  /** Top of the room below the top-right corner, bottom of the room above the bottom-right one. */
  topLimit: number;
  bottomLimit: number;
  gutter?: number;
  /** Space kept between the list and what it avoids. */
  gap?: number;
}

/**
 * Landscape: a column hugging the right gutter, vertically centred between the corners and
 * right of everything on the board. Portrait: full content width under the name, its note and
 * the CV, down to the bottom corner.
 */
export function placeProjects({ vw, vh, orientation, natural, obstacles, topLimit, bottomLimit, gutter = 16, gap = 20 }: ListInput): ListPlacement {
  if (orientation === 'p') {
    const top = Math.max(topLimit, ...obstacles.map((r) => r.bottom + 14));
    const room = Math.max(0, bottomLimit - top);
    const width = vw - gutter * 2;
    return { left: gutter, top, width, height: Math.min(natural.h, room), overflow: natural.h > room, narrow: natural.w > width };
  }
  const room = Math.max(0, bottomLimit - topLimit);
  const height = Math.min(natural.h, room);
  const top = Math.min(Math.max(Math.round((vh - height) / 2), topLimit), topLimit + room - height);
  const bound = Math.max(0, ...obstacles.filter((r) => r.bottom > top && r.top < top + height).map((r) => r.right + gap));
  const left = Math.max(bound, vw - gutter - natural.w);
  const width = Math.max(0, Math.min(natural.w, vw - gutter - left));
  return { left, top, width, height, overflow: natural.h > room, narrow: natural.w > width };
}

interface SpotOptions {
  /** Cells kept between the stamp and the list. */
  gap?: number;
  /** Cells kept between the stamp and anything else that is off limits. */
  margin?: number;
}

/**
 * Where a seed of `seed.w × seed.h` cells lands: just outside the list on the side with the
 * most open board, level with the row (`rowY`, in cells). When the row's own level is taken
 * (by the name, the CV…) it slides up or down to the nearest free rows, then tries the other
 * side. Null when nothing is free: the seed is not fired rather than drawn over something.
 */
export function stampSpot(
  seed: { w: number; h: number },
  rowY: number,
  list: Box,
  blocked: Box[],
  grid: Grid,
  { gap = 2, margin = 3 }: SpotOptions = {},
): { x: number; y: number } | null {
  const left = list.x >= grid.cols - list.x2;
  const y0 = Math.round(rowY - seed.h / 2);
  for (const side of left ? [-1, 1] : [1, -1]) {
    const x = side < 0 ? list.x - gap - seed.w : list.x2 + gap;
    if (x < 1 || x + seed.w > grid.cols - 1) continue;
    for (let d = 0; d <= grid.rows; d++) {
      for (const y of d ? [y0 - d, y0 + d] : [y0]) {
        if (y < 1 || y + seed.h > grid.rows - 1) continue;
        const hit = blocked.some((b) => x - margin < b.x2 && x + seed.w + margin > b.x && y - margin < b.y2 && y + seed.h + margin > b.y);
        if (!hit) return { x, y };
      }
    }
  }
  return null;
}

/** Distance (cells) from the wave's centre to the farthest corner of the grid, plus the trailing bands. */
export const waveTravel = (centre: { x: number; y: number }, grid: Grid, bands: number, band: number): number =>
  Math.max(
    Math.hypot(centre.x, centre.y),
    Math.hypot(grid.cols - centre.x, centre.y),
    Math.hypot(centre.x, grid.rows - centre.y),
    Math.hypot(grid.cols - centre.x, grid.rows - centre.y),
  ) +
  bands * band;

/** The front decelerates like a shockwave: fast out of the name, slow at the edges. */
export const waveFront = (progress: number, travel: number): number => Math.sin((Math.min(1, Math.max(0, progress)) * Math.PI) / 2) * travel;
