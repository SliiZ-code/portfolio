import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  cellSizeFor,
  coreBox,
  footprint,
  gridFor,
  isProtected,
  namePlacement,
  orientationFor,
  rectToBox,
} from '../src/scripts/board/layout';

const NAME = { cols: 80, rows: 23 };
/** The fine raster the board always draws: 150 × 41 in landscape, 82 × 63 on a phone. */
const FINE_L = { cols: 150, rows: 41 };
const FINE_P = { cols: 82, rows: 63 };

describe('orientation, cell size and name resolution', () => {
  it('is portrait only when clearly taller than wide', () => {
    expect(orientationFor(1440, 900)).toBe('l');
    expect(orientationFor(900, 900)).toBe('l');
    expect(orientationFor(900, 980)).toBe('l');
    expect(orientationFor(390, 844)).toBe('p');
  });

  it('sizes the cells from the fine name, which stays about half the width in landscape', () => {
    expect(cellSizeFor(FINE_L, 1440, 900, 'l')).toBe(4);
    expect(cellSizeFor(FINE_L, 1920, 1080, 'l')).toBe(5);
    expect(cellSizeFor(FINE_L, 1280, 720, 'l')).toBe(3);
    expect(cellSizeFor(FINE_P, 390, 844, 'p')).toBe(3);
    expect(cellSizeFor(FINE_P, 360, 740, 'p')).toBe(3);
    // a tablet is capped by the room the fixed patterns leave around the tall portrait name
    expect(cellSizeFor(FINE_P, 768, 1024, 'p')).toBe(4);
  });

  it('keeps the name near two thirds of a phone and 40% of a landscape screen', () => {
    for (const [vw, vh] of [[1440, 900], [1920, 1080], [1280, 720], [1024, 768]]) {
      const ratio = (FINE_L.cols * cellSizeFor(FINE_L, vw, vh, 'l')) / vw;
      expect(ratio, `landscape ${vw}x${vh}`).toBeGreaterThanOrEqual(0.34);
      expect(ratio, `landscape ${vw}x${vh}`).toBeLessThanOrEqual(0.45);
    }
    for (const [vw, vh] of [[390, 844], [360, 740]]) {
      const ratio = (FINE_P.cols * cellSizeFor(FINE_P, vw, vh, 'p')) / vw;
      expect(ratio, `portrait ${vw}x${vh}`).toBeGreaterThanOrEqual(0.6);
      expect(ratio, `portrait ${vw}x${vh}`).toBeLessThanOrEqual(0.72);
    }
  });

  it('clamps the cell between 3 and 8 pixels', () => {
    // a narrow phone cannot go below 3px: 2px cells would lose the fine raster
    expect(cellSizeFor(FINE_P, 320, 568, 'p')).toBe(3);
    expect(cellSizeFor(FINE_L, 844, 390, 'l')).toBe(3);
    expect(cellSizeFor(FINE_L, 5120, 2880, 'l')).toBe(8);
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
    expect(portrait).toEqual({ x: 19, y: Math.round(169 * 0.34 - 15.5), w: 40, h: 31 });
  });
});

describe('anchors', () => {
  const grid = { cols: 144, rows: 90 };
  const name = { x: 32, y: 23, w: 80, h: 23 };

  it('turns screen fractions into cells', () => {
    expect(anchorFor([0.14, 0.66], grid, name)).toEqual({ cx: 20, ty: 59 });
    expect(anchorFor([0.5, 0.025], grid, name)).toEqual({ cx: 72, ty: 2 });
  });

  it('hangs the CV off the bottom-right of the name, under the note when it has one', () => {
    // no note: three cells under the name
    expect(anchorFor('name', grid, name)).toEqual({ cx: 108, ty: 51 });
    // the note ends on row 60: the CV starts three cells below it
    expect(anchorFor('name', grid, name, 60)).toEqual({ cx: 108, ty: 65 });
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
