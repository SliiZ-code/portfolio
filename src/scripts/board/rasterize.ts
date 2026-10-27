interface RasterContext {
  font: string;
  textBaseline: string;
  fillStyle: string;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

interface RasterCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): RasterContext | null;
}

export type MakeCanvas = (width: number, height: number) => RasterCanvas;

const makeCanvas: MakeCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) as unknown as RasterCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as RasterCanvas;
};

/**
 * Geist Pixel is drawn on a grid of em/13, with half steps in its curves (the J, the C, the o).
 * Render big, then sample the centre of each design pixel: one cell per pixel, or with `fine`,
 * one cell per half pixel, which keeps the curves and doubles the size.
 */
export function rasterize(text: string, fine = false, factory: MakeCanvas = makeCanvas): number[][] {
  const U = 32;
  const P = fine ? U / 2 : U;
  const S = U * 13;
  const lines = text.split('\n');
  const LH = 11 * U;
  const off = factory(10, 10);
  const o = off.getContext('2d');
  if (!o) return [];

  o.font = `${S}px "Geist Pixel"`;
  off.width = Math.ceil(Math.max(...lines.map((line) => o.measureText(line).width))) + U * 2;
  off.height = LH * lines.length + U * 2;
  o.font = `${S}px "Geist Pixel"`;
  o.textBaseline = 'top';
  o.fillStyle = '#000';
  lines.forEach((line, i) => o.fillText(line, U, U + i * LH));

  const d = o.getImageData(0, 0, off.width, off.height).data;
  const on = (x: number, y: number) => d[(Math.round(y) * off.width + Math.round(x)) * 4 + 3] > 128;

  // find the grid phase from the edges of the ink: the most common one wins, because a few glyphs
  // (the C) start half a design pixel off the grid, and one of them must not shift every other glyph
  const ink = (x: number, y: number) => d[(y * off.width + x) * 4 + 3] > 128;
  const votesX = new Array<number>(P).fill(0);
  const votesY = new Array<number>(P).fill(0);
  for (let y = 1; y < off.height; y++) {
    for (let x = 1; x < off.width; x++) {
      if (!ink(x, y)) continue;
      if (!ink(x - 1, y)) votesX[x % P]++;
      if (!ink(x, y - 1)) votesY[y % P]++;
    }
  }
  const mode = (votes: number[]) => votes.indexOf(Math.max(...votes));
  const px = mode(votesX);
  const py = mode(votesY);
  const cols = Math.floor((off.width - px) / P);
  const rows = Math.floor((off.height - py) / P);
  const out: number[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < cols; i++) row.push(on(px + (i + 0.5) * P, py + (j + 0.5) * P) ? 1 : 0);
    out.push(row);
  }

  while (out.length && !out[0].some(Boolean)) out.shift();
  while (out.length && !out.at(-1)!.some(Boolean)) out.pop();
  if (!out.length) return [];

  let left = Infinity;
  let right = 0;
  out.forEach((row) =>
    row.forEach((value, i) => {
      if (value) {
        left = Math.min(left, i);
        right = Math.max(right, i);
      }
    }),
  );
  return out.map((row) => row.slice(left, right + 1));
}
