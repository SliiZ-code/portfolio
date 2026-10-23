import { describe, expect, it } from 'vitest';
import { rasterize, type MakeCanvas } from '../src/scripts/board/rasterize';

const U = 32;

/** A canvas stub that inks one U×U block per non-space glyph, on the design grid. */
const fakeCanvas: MakeCanvas = () => {
  let width = 10;
  let height = 10;
  let pixels = new Uint8ClampedArray(width * height * 4);
  const context = {
    font: '',
    textBaseline: '',
    fillStyle: '',
    measureText: (text: string) => ({ width: text.length * U }),
    fillText: (text: string, x: number, y: number) => {
      [...text].forEach((char, index) => {
        if (char === ' ') return;
        for (let dy = 0; dy < U; dy++) {
          for (let dx = 0; dx < U; dx++) {
            const px = x + index * U + dx;
            const py = y + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            pixels[(py * width + px) * 4 + 3] = 255;
          }
        }
      });
    },
    getImageData: () => ({ data: pixels }),
  };
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      pixels = new Uint8ClampedArray(width * height * 4);
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      pixels = new Uint8ClampedArray(width * height * 4);
    },
    getContext: () => context,
  };
};

describe('rasterize', () => {
  it('returns non-empty rows for visible text', () => {
    const rows = rasterize('AB', 1, fakeCanvas);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual([1, 1]);
  });

  it('scales every design pixel to k×k cells', () => {
    const rows = rasterize('AB', 2, fakeCanvas);
    expect(rows).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
  });

  it('keeps a text line per input line and trims empty edges', () => {
    const rows = rasterize('A\nB', 1, fakeCanvas);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.some((row) => row.some(Boolean))).toBe(true);
    expect(rows[0].some(Boolean)).toBe(true);
    expect(rows.at(-1)!.some(Boolean)).toBe(true);
  });

  it('does not crash on blank text', () => {
    expect(rasterize('', 1, fakeCanvas)).toEqual([]);
  });
});
