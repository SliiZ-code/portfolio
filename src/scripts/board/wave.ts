// The opening shockwave: how far its front travels and how it decelerates. Cells.
import type { Grid } from './layout';

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
