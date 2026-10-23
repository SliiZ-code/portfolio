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
 * Geist Pixel is drawn on a grid of em/13. Render big, then sample the centre of each
 * design pixel, so one font pixel becomes exactly k×k cells (no broken glyphs).
 */
export function rasterize(text: string, k = 1, factory: MakeCanvas = makeCanvas): number[][] {
  const U = 32;
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

  // find the grid phase from the first inked row / column
  let px = off.width;
  let py = off.height;
  for (let y = 0; y < off.height; y++) {
    for (let x = 0; x < off.width; x++) {
      if (d[(y * off.width + x) * 4 + 3] > 128) {
        px = Math.min(px, x);
        py = Math.min(py, y);
      }
    }
  }
  px %= U;
  py %= U;
  const cols = Math.floor((off.width - px) / U);
  const rows = Math.floor((off.height - py) / U);
  const out: number[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < cols; i++) row.push(on(px + (i + 0.5) * U, py + (j + 0.5) * U) ? 1 : 0);
    for (let a = 0; a < k; a++) out.push(row.flatMap((value) => Array(k).fill(value)));
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
