// Pure geometry of the one-screen board. Everything is in cells unless a name says pixels.

export type Orientation = 'l' | 'p';

/** Screen fractions [centre x, pattern top y], or 'name' for "hanging off the bottom-right of the name". */
export type Anchor = readonly [number, number] | 'name';
export type At = Partial<Record<Orientation, Anchor>>;

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
 * Cells have a size of their own, about 6px on a laptop: a bigger screen shows more board,
 * not bigger cells.
 */
export const cellSizeFor = (vw: number, vh: number): number => Math.max(4, Math.min(8, Math.round(Math.min(vw / 240, vh / 150))));

/**
 * The name at the font's half-pixel resolution when it stays modest: half the width at most in
 * landscape, a bit more on a narrow phone, where the coarse raster would almost vanish. Everywhere
 * else the double raster is too loud, so the name keeps the coarse one.
 */
export const fineNameFits = (coarse: Grid, vw: number, vh: number, cell: number, orientation: Orientation): boolean => {
  const portrait = orientation === 'p';
  return coarse.cols * 2 * cell <= vw * (portrait ? 0.62 : 0.5) && coarse.rows * 2 * cell <= vh * (portrait ? 0.3 : 0.32);
};

export const gridFor = (vw: number, vh: number, cell: number): Grid => ({
  cols: Math.ceil(vw / cell),
  rows: Math.ceil(vh / cell),
});

export const namePlacement = (grid: Grid, name: Grid, orientation: Orientation): Rect => ({
  x: Math.round(grid.cols / 2 - name.cols / 2),
  y: Math.round(grid.rows * (orientation === 'p' ? 0.37 : 0.38) - name.rows / 2),
  w: name.cols,
  h: name.rows,
});

/** Centre column and pattern top row of a structure. */
export const anchorFor = (at: Anchor | undefined, grid: Grid, name: Rect): { cx: number; ty: number } => {
  if (at === 'name' || at === undefined) return { cx: name.x + name.w - 4, ty: name.y + name.h + 3 };
  return { cx: Math.round(grid.cols * at[0]), ty: Math.round(grid.rows * at[1]) };
};

export interface Footprint extends Rect {
  /** The part that counts for intrusion and hit testing; the gun's board is wider than its mouth. */
  core: Rect;
}

const GUN_BOARD = { w: 52, h: 34 };
const GUN_CORE = { w: 37, h: 10 };

/** Where a structure's private board sits: the pattern plus its padding, or the gun's wider board. */
export const footprint = (pattern: { w: number; h: number }, pad: number, anchor: { cx: number; ty: number }, gun = false): Footprint => {
  const x0 = gun ? Math.max(1, anchor.cx - 18) : anchor.cx - Math.floor(pattern.w / 2);
  if (gun) return { x: x0, y: anchor.ty, ...GUN_BOARD, core: { x: 0, y: 0, ...GUN_CORE } };
  const w = pattern.w + pad * 2;
  const h = pattern.h + pad * 2;
  return { x: x0 - pad, y: anchor.ty - pad, w, h, core: { x: 0, y: 0, w, h } };
};

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

export const inBox = (box: Box, x: number, y: number, margin = 0): boolean =>
  x >= box.x - margin && x < box.x2 + margin && y >= box.y - margin && y < box.y2 + margin;

export const isProtected = (x: number, y: number, margin: number, boxes: Box[]): boolean =>
  boxes.some((box) => inBox(box, x, y, margin));
