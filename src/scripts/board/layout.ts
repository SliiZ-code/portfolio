// Pure geometry of the one-screen board. Everything is in cells unless a name says pixels.

export type Orientation = 'l' | 'p';

export interface Grid {
  cols: number;
  rows: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

export const orientationFor = (vw: number, vh: number): Orientation => (vh > vw * 1.1 ? 'p' : 'l');

/**
 * The name is always drawn at the font's half-pixel resolution, so the cell size is chosen from
 * that raster: about 40% of the width in landscape and two thirds on a phone, small enough to leave
 * room for the board, never below 3px (the fine curves need it) or above 8px (more screen = more board).
 */
const NAME_WIDTH: Record<Orientation, number> = { l: 0.42, p: 0.7 };
const NAME_HEIGHT: Record<Orientation, number> = { l: 0.3, p: 0.25 };

export const cellSizeFor = (name: Grid, vw: number, vh: number, orientation: Orientation = orientationFor(vw, vh)): number =>
  Math.max(
    3,
    Math.min(8, Math.floor(Math.min((vw * NAME_WIDTH[orientation]) / name.cols, (vh * NAME_HEIGHT[orientation]) / name.rows))),
  );

export const gridFor = (vw: number, vh: number, cell: number): Grid => ({
  cols: Math.ceil(vw / cell),
  rows: Math.ceil(vh / cell),
});

export const namePlacement = (grid: Grid, name: Grid, orientation: Orientation): Rect => ({
  x: Math.round(grid.cols / 2 - name.cols / 2),
  // portrait sits a touch higher: the fine name, its note and the project list need the room below it
  y: Math.round(grid.rows * (orientation === 'p' ? 0.34 : 0.38) - name.rows / 2),
  w: name.cols,
  h: name.rows,
});

export interface Footprint extends Rect {
  /** The part that counts for intrusion and for what must stay clear of the structure. */
  core: Rect;
}

export const coreBox = (fp: Footprint): Box => ({
  x: fp.x + fp.core.x,
  y: fp.y + fp.core.y,
  x2: fp.x + fp.core.x + fp.core.w,
  y2: fp.y + fp.core.y + fp.core.h,
});

/** A DOM rectangle (pixels) as a keep-clear box: one cell of margin on each side. */
export const rectToBox = (r: { left: number; top: number; right: number; bottom: number }, cell: number): Box => ({
  x: Math.floor(r.left / cell) - 1,
  y: Math.floor(r.top / cell),
  x2: Math.ceil(r.right / cell) + 1,
  y2: Math.ceil(r.bottom / cell),
});

/** The part of `outer` that `inner` does not cover, as four boxes: top, bottom, left and right. */
export const boxMinus = (outer: Box, inner: Box): Box[] => [
  { x: outer.x, y: outer.y, x2: outer.x2, y2: inner.y },
  { x: outer.x, y: inner.y2, x2: outer.x2, y2: outer.y2 },
  { x: outer.x, y: inner.y, x2: inner.x, y2: inner.y2 },
  { x: inner.x2, y: inner.y, x2: outer.x2, y2: inner.y2 },
];

export const inBox = (box: Box, x: number, y: number, margin = 0): boolean =>
  x >= box.x - margin && x < box.x2 + margin && y >= box.y - margin && y < box.y2 + margin;

export const isProtected = (x: number, y: number, margin: number, boxes: Box[]): boolean =>
  boxes.some((box) => inBox(box, x, y, margin));
