/**
 * Life moves the type: when living cells of the paper reach a section title, a ripple runs through the title's own
 * pixel cells from the contact point. These helpers are pure and unit-tested: `ringContact` finds the life that
 * borders a rock, the ripple functions give each cell its lift and colour as a function of distance and time.
 * living-paper.ts reports contacts and pixel-title.ts draws the wave.
 */

/** The cells a rock blocks, inclusive, with its padding already in. */
export interface CellBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A grid as the paper sees it: only its size and which cells are alive matter here. */
export interface LiveGrid {
  cols: number;
  rows: number;
  cells: Uint8Array;
}

/** How much life touches a rock: how many live cells border it, and where they sit (cell units, centres). */
export interface Contact {
  count: number;
  x: number;
  y: number;
}

export const NO_CONTACT: Contact = { count: 0, x: 0, y: 0 };

/**
 * The live cells on the ring of cells that border a rock, corners included, and their centre. The rock's own cells
 * are rock, so life can only meet it from the ring. Only the ring is read: a few hundred cells per rock.
 */
export function ringContact(grid: LiveGrid, box: CellBox): Contact {
  const { cols, rows, cells } = grid;
  let count = 0;
  let sx = 0;
  let sy = 0;
  const touch = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows || !cells[y * cols + x]) return;
    count++;
    sx += x + 0.5;
    sy += y + 0.5;
  };
  for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
    touch(x, box.y0 - 1);
    touch(x, box.y1 + 1);
  }
  for (let y = box.y0; y <= box.y1; y++) {
    touch(box.x0 - 1, y);
    touch(box.x1 + 1, y);
  }
  return count ? { count, x: sx / count, y: sy / count } : NO_CONTACT;
}

/** Live cells on the ring that make a full-strength contact. */
export const RING_FULL = 3;

/** How hard the life hit, from 1 cell (a glancing touch) to three or more (a full front): 0 to 1. */
export function contactStrength(count: number): number {
  return Math.min(1, count / RING_FULL);
}

/** Total time of one ripple, from the contact to the last cell going back to ink. */
export const RIPPLE_MS = 800;
/** How long each cell stays lit while the front passes it. */
export const RIPPLE_LIFE_MS = 360;
/** A title takes a new ripple no sooner than this after the last one: no constant shimmer. */
export const RIPPLE_COOLDOWN_MS = 1200;
/** Below this share of the pulse's peak a cell is drawn in plain ink. */
const QUIET = 0.12;

/** Whether a title may start a ripple now. */
export function rippleDue(now: number, last: number | undefined): boolean {
  return last === undefined || now - last >= RIPPLE_COOLDOWN_MS;
}

/** The distance (px) from (x, y) to the farthest of the points. */
export function farthest(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number, y: number): number {
  let max = 0;
  for (let i = 0; i < xs.length; i++) max = Math.max(max, Math.hypot(xs[i]! - x, ys[i]! - y));
  return max;
}

/**
 * The front's speed in px per ms, so that it reaches the farthest cell `reach` px away when the ripple has run for
 * RIPPLE_MS - RIPPLE_LIFE_MS: the last cell lights in time and the whole wave ends at RIPPLE_MS.
 */
export function rippleSpeed(reach: number): number {
  return Math.max(reach, 1) / (RIPPLE_MS - RIPPLE_LIFE_MS);
}

/**
 * How far through its pulse a cell is, 0 to 1, when the front started at `distance` px from the contact and `elapsed`
 * ms have passed. -1 before the front reaches the cell and after its pulse has run.
 */
export function ripplePhase(distance: number, elapsed: number, speed: number): number {
  const phase = (elapsed - distance / speed) / RIPPLE_LIFE_MS;
  return phase < 0 || phase >= 1 ? -1 : phase;
}

/** The lift of a cell, in whole px: it rises by up to `amplitude` at the middle of its pulse. */
export function rippleLift(phase: number, amplitude: number): number {
  return phase < 0 ? 0 : Math.round(amplitude * Math.sin(Math.PI * phase));
}

/**
 * The life colour of a cell: 0 to 3 (life-0 to life-3) as its pulse runs, so the front flashes warm and the tail cools.
 * -1 is plain ink: before the front, after the pulse, and in the quiet ends of the pulse.
 */
export function rippleBucket(phase: number): number {
  if (phase < 0 || Math.sin(Math.PI * phase) < QUIET) return -1;
  return Math.min(3, Math.floor(phase * 4));
}

/**
 * The most a cell lifts at the peak of its pulse, in px: one pixel at most, a glancing touch none. A title cell is only
 * 2.5 px, so a bigger lift lifts the cell most of the way to the next row and tears the letters apart.
 */
export function rippleAmplitude(strength: number): number {
  return Math.min(1, Math.max(0, strength));
}

/** What a title sends from a contact: the life's strength, and the contact point in its own px. */
export interface LifeTouch {
  strength: number;
  x: number;
  y: number;
}

/** The font's pixel unit: Geist Pixel's glyphs step on a grid of em/13, so the wave steps in tiles of that size. */
export const GLYPH_GRID = 13;

/**
 * The side of one wave tile in device px: em/13 of the title's font at the canvas's scale, in whole device pixels so
 * that a tile copies onto the canvas without a seam.
 */
export function rippleTile(fontPx: number, scale: number): number {
  return Math.max(1, Math.round((fontPx / GLYPH_GRID) * scale));
}

/** A tile of the device-px grid over a canvas: its column, row, top-left and size, clipped at the canvas's edge. */
export interface Tile {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The tiles of a w × h RGBA image, `tile` device px square, that hold any ink (alpha above zero), in row order. A glyph
 * is copied tile by tile, so only the tiles that hold it are visited.
 */
export function inkTiles(rgba: Uint8ClampedArray, w: number, h: number, tile: number): Tile[] {
  const tiles: Tile[] = [];
  const cols = Math.ceil(w / tile);
  const rows = Math.ceil(h / tile);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * tile;
      const y = row * tile;
      const x1 = Math.min(w, x + tile);
      const y1 = Math.min(h, y + tile);
      if (blockHasInk(rgba, w, x, y, x1, y1)) tiles.push({ col, row, x, y, w: x1 - x, h: y1 - y });
    }
  }
  return tiles;
}

/** Whether any pixel of the block [x0, x1) × [y0, y1) of the image has alpha. */
function blockHasInk(rgba: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (rgba[(y * w + x) * 4 + 3]) return true;
    }
  }
  return false;
}

/**
 * Sorts the indices of `keys` (each in 0 to groups - 1) into `order`, by key and in their own order within a key: group
 * g is order[start[g] .. start[g + 1]). A counting sort into the caller's arrays, so a frame allocates nothing.
 */
export function groupIndices(
  keys: ArrayLike<number>,
  groups: number,
  order: Int32Array,
  start: Int32Array,
  cursor: Int32Array,
): void {
  start.fill(0, 0, groups + 1);
  for (let i = 0; i < keys.length; i++) start[keys[i]! + 1]!++;
  for (let g = 0; g < groups; g++) start[g + 1]! += start[g]!;
  cursor.set(start.subarray(0, groups));
  for (let i = 0; i < keys.length; i++) order[cursor[keys[i]!]!++] = i;
}
