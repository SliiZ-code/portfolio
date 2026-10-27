import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  cellSizeFor,
  fineNameFits,
  coreBox,
  footprint,
  gridFor,
  isProtected,
  namePlacement,
  orientationFor,
  rectToBox,
} from '../src/scripts/board/layout';

const NAME = { cols: 80, rows: 23 };

describe('orientation, cell size and name resolution', () => {
  it('is portrait only when clearly taller than wide', () => {
    expect(orientationFor(1440, 900)).toBe('l');
    expect(orientationFor(900, 900)).toBe('l');
    expect(orientationFor(900, 980)).toBe('l');
    expect(orientationFor(390, 844)).toBe('p');
  });

  it('gives cells a size of their own: about 6px on a laptop, more board on a bigger screen', () => {
    expect(cellSizeFor(1440, 900)).toBe(6);
    expect(cellSizeFor(1920, 1080)).toBe(7);
    expect(cellSizeFor(390, 844)).toBe(4);
  });

  it('clamps the cell between 4 and 8 pixels', () => {
    expect(cellSizeFor(5120, 2880)).toBe(8);
    expect(cellSizeFor(320, 568)).toBe(4);
  });

  it('draws the name at half-pixel resolution only when it still fits', () => {
    expect(fineNameFits({ cols: 75, rows: 23 }, 1440, 900, 6, 'l')).toBe(true);
    expect(fineNameFits({ cols: 75, rows: 23 }, 844, 390, 4, 'l')).toBe(false);
    expect(fineNameFits({ cols: 41, rows: 31 }, 390, 844, 4, 'p')).toBe(true);
  });

  it('covers the viewport with whole cells', () => {
    expect(gridFor(1440, 900, 10)).toEqual({ cols: 144, rows: 90 });
    expect(gridFor(390, 844, 5)).toEqual({ cols: 78, rows: 169 });
    expect(gridFor(1445, 905, 10)).toEqual({ cols: 145, rows: 91 });
  });
});

describe('name placement', () => {
  const grid = { cols: 144, rows: 90 };

  it('centres the name horizontally, a little above the middle', () => {
    expect(namePlacement(grid, NAME, 'l')).toEqual({ x: 32, y: 23, w: 80, h: 23 });
  });

  it('sits slightly higher on a phone', () => {
    const portrait = namePlacement({ cols: 78, rows: 169 }, { cols: 40, rows: 31 }, 'p');
    expect(portrait).toEqual({ x: 19, y: Math.round(169 * 0.37 - 15.5), w: 40, h: 31 });
  });
});

describe('anchors', () => {
  const grid = { cols: 144, rows: 90 };
  const name = { x: 32, y: 23, w: 80, h: 23 };

  it('turns screen fractions into cells', () => {
    expect(anchorFor([0.14, 0.66], grid, name)).toEqual({ cx: 20, ty: 59 });
    expect(anchorFor([0.5, 0.025], grid, name)).toEqual({ cx: 72, ty: 2 });
  });

  it('hangs the CV off the bottom-right of the name', () => {
    expect(anchorFor('name', grid, name)).toEqual({ cx: 108, ty: 49 });
  });
});

describe('footprint', () => {
  const pulsar = { w: 13, h: 13 };

  it('is the pattern plus its padding, centred on the anchor', () => {
    const fp = footprint(pulsar, 3, { cx: 20, ty: 59 });
    expect(fp).toMatchObject({ x: 11, y: 56, w: 19, h: 19 });
    expect(fp.core).toEqual({ x: 0, y: 0, w: 19, h: 19 });
  });

  it('gives the gun a wider private board, a 37×10 core and a left edge kept on screen', () => {
    const gun = footprint({ w: 36, h: 9 }, 0, { cx: 72, ty: 2 }, true);
    expect(gun).toMatchObject({ x: 54, y: 2, w: 52, h: 34 });
    expect(gun.core).toEqual({ x: 0, y: 0, w: 37, h: 10 });
    expect(footprint({ w: 36, h: 9 }, 0, { cx: 5, ty: 2 }, true).x).toBe(1);
  });

  it('exposes the core as a box in board cells', () => {
    const fp = footprint(pulsar, 3, { cx: 20, ty: 59 });
    expect(coreBox(fp)).toEqual({ x: 11, y: 56, x2: 30, y2: 75 });
  });
});

describe('boxes', () => {
  it('turns a DOM rectangle into cells with a one-cell side margin', () => {
    const box = rectToBox({ left: 105, top: 203, right: 251, bottom: 240 }, 10);
    expect(box).toEqual({ x: 9, y: 20, x2: 27, y2: 24 });
  });

  it('protects a margin around boxes', () => {
    const boxes = [{ x: 10, y: 10, x2: 20, y2: 20 }];
    expect(isProtected(9, 9, 0, boxes)).toBe(false);
    expect(isProtected(9, 9, 5, boxes)).toBe(true);
    expect(isProtected(25, 15, 5, boxes)).toBe(false);
    expect(isProtected(24, 15, 5, boxes)).toBe(true);
    expect(isProtected(15, 15, 0, boxes)).toBe(true);
  });
});
