import { describe, expect, it } from 'vitest';
import { createWorld, spawn, stepWorld, type World } from '../src/scripts/board/life';
import { GLIDER_HEADINGS } from '../src/scripts/board/patterns';
import {
  createStrip,
  emitGlider,
  emitsAt,
  EMIT_EVERY,
  extentOf,
  gliderCells,
  gutterSpans,
  keepClearMask,
  needsRebuild,
  parseCell,
  rowAt,
  rowWindow,
  sourcesFor,
  spawnCell,
  stepStrip,
  type Strip,
} from '../src/scripts/margin-life';

/** Live cells as sorted "x,y" keys, so shapes compare regardless of order. */
const liveOf = (s: Strip): string[] => {
  const out: string[] = [];
  for (let n = 0; n < s.count; n++) {
    const k = s.live[n];
    out.push(`${k % s.w},${Math.floor(k / s.w)}`);
  }
  return out.sort();
};

const empty = (w: number, h: number) => new Uint8Array(w * h);

/** The board's own engine, with the same edge and keep-clear rules applied after each generation. */
function denseStep(world: World, mask: Uint8Array): void {
  stepWorld(world);
  for (let k = 0; k < world.cells.length; k++) {
    const x = k % world.w;
    const y = (k - x) / world.w;
    if (mask[k] || x === 0 || y === 0 || x === world.w - 1 || y === world.h - 1) {
      world.cells[k] = 0;
      world.age[k] = 0;
    }
  }
}

const denseLive = (world: World): string[] => {
  const out: string[] = [];
  for (let k = 0; k < world.cells.length; k++) {
    if (world.cells[k]) out.push(`${k % world.w},${Math.floor(k / world.w)}:${world.age[k]}`);
  }
  return out.sort();
};

const sparseLive = (s: Strip): string[] => {
  const out: string[] = [];
  for (let n = 0; n < s.count; n++) {
    const k = s.live[n];
    out.push(`${k % s.w},${Math.floor(k / s.w)}:${s.age[k]}`);
  }
  return out.sort();
};

describe('the hero cell', () => {
  it('reads --c from the root, and falls back to 10px when it is missing or broken', () => {
    expect(parseCell('6px')).toBe(6);
    expect(parseCell(' 8px')).toBe(8);
    expect(parseCell('')).toBe(10);
    expect(parseCell('nope')).toBe(10);
    expect(parseCell('0px')).toBe(10);
  });
});

describe('gutters from the column', () => {
  const cols = 240; // 1440px at a 6px cell

  it('leaves a gutter on each side of the reading column, with clearance from the text', () => {
    // column 128px..848px: left gutter cells [0, 21 - 2) = [0, 19); right from ceil(848/6)=142 + 2 = 144 to 240
    expect(gutterSpans(1440, cols, { left: 128, right: 848 }, 6)).toEqual({
      left: { x0: 0, x1: 19 },
      right: { x0: 144, x1: 240 },
    });
  });

  it('has no gutters below the viewport floor', () => {
    expect(gutterSpans(800, cols, { left: 72, right: 700 }, 6)).toEqual({ left: null, right: null });
  });

  it('has no gutters without a column (nothing to frame)', () => {
    expect(gutterSpans(1440, cols, null, 6)).toEqual({ left: null, right: null });
  });

  it('drops a side too thin to hold a glider, and keeps the other', () => {
    // the column starts at 10px: no room on the left; the right is still open
    expect(gutterSpans(1440, cols, { left: 10, right: 848 }, 6).left).toBeNull();
    expect(gutterSpans(1440, cols, { left: 10, right: 848 }, 6).right).not.toBeNull();
  });

  it('has no right gutter when the text runs to the edge', () => {
    expect(gutterSpans(1440, cols, { left: 128, right: 1424 }, 6).right).toBeNull();
  });

  it('measures the column from its rectangles', () => {
    expect(extentOf([])).toBeNull();
    expect(
      extentOf([
        { left: 40, right: 300 },
        { left: 128, right: 848 },
        { left: 128, right: 600 },
      ]),
    ).toEqual({ left: 40, right: 848 });
  });
});

describe('glider sources at the section boundaries', () => {
  it('alternates sides when both gutters have room', () => {
    const gutters = { left: { x0: 0, x1: 19 }, right: { x0: 144, x1: 240 } };
    const sources = sourcesFor([0, 40, 90, 130], gutters);
    expect(sources.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right']);
    expect(sources.map((s) => s.row)).toEqual([0, 40, 90, 130]);
    expect(sources.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('puts every source on the only gutter that has room', () => {
    const sources = sourcesFor([10, 60, 120], { left: null, right: { x0: 144, x1: 240 } });
    expect(sources.map((s) => s.side)).toEqual(['right', 'right', 'right']);
  });

  it('has no sources without a gutter', () => {
    expect(sourcesFor([10, 60], { left: null, right: null })).toEqual([]);
  });

  it('fires each source once every EMIT_EVERY generations, on its own beat', () => {
    const firsts = [0, 1, 2, 3].map((index) => {
      const gens = Array.from({ length: EMIT_EVERY * 2 }, (_, g) => g).filter((g) => emitsAt(g, index));
      expect(gens.length).toBe(2);
      expect(gens[1] - gens[0]).toBe(EMIT_EVERY);
      return gens[0];
    });
    // index 0 leads; the others start at different generations
    expect(firsts[0]).toBe(0);
    expect(new Set(firsts).size).toBe(firsts.length);
  });

  it('maps a pixel row to a cell row inside the world', () => {
    expect(rowAt(-10, 6, 100)).toBe(0);
    expect(rowAt(29, 6, 100)).toBe(4);
    expect(rowAt(99999, 6, 100)).toBe(99);
  });
});

describe('the glider that flies outward and down', () => {
  it('uses the heading that goes down and away from the column on each side', () => {
    expect(gliderCells('left')).toEqual(GLIDER_HEADINGS.find((g) => g.heading[0] === -1 && g.heading[1] === 1)!.cells);
    expect(gliderCells('right')).toEqual(GLIDER_HEADINGS.find((g) => g.heading[0] === 1 && g.heading[1] === 1)!.cells);
  });

  it('is born against the column: the left gutter at its right edge, the right gutter at its left edge', () => {
    const left = createStrip(10, 10, empty(10, 10));
    emitGlider(left, 'left', 3);
    // the glider's pattern .O. / O.. / OOO, stamped at x 6..8, y 3..5
    expect(liveOf(left)).toEqual(['6,4', '6,5', '7,3', '7,5', '8,5']);
    const right = createStrip(10, 10, empty(10, 10));
    emitGlider(right, 'right', 3);
    expect(liveOf(right).length).toBe(5);
    expect(liveOf(right).every((key) => Number(key.split(',')[0]) <= 3)).toBe(true);
  });

  it('travels one cell left and one cell down every four generations (left gutter)', () => {
    const strip = createStrip(12, 20, empty(12, 20));
    emitGlider(strip, 'left', 2);
    const before = liveOf(strip);
    for (let g = 0; g < 4; g++) stepStrip(strip);
    const moved = before.map((key) => {
      const [x, y] = key.split(',').map(Number);
      return `${x - 1},${y + 1}`;
    });
    expect(liveOf(strip)).toEqual(moved.sort());
  });

  it('travels one cell right and one cell down every four generations (right gutter)', () => {
    const strip = createStrip(12, 20, empty(12, 20));
    emitGlider(strip, 'right', 2);
    const before = liveOf(strip);
    for (let g = 0; g < 4; g++) stepStrip(strip);
    const moved = before.map((key) => {
      const [x, y] = key.split(',').map(Number);
      return `${x + 1},${y + 1}`;
    });
    expect(liveOf(strip)).toEqual(moved.sort());
  });

  it('does not wrap: a glider that leaves the strip never comes back on the far side', () => {
    const strip = createStrip(8, 40, empty(8, 40));
    emitGlider(strip, 'left', 2); // born at x 4..6, flying left
    for (let g = 0; g < 120; g++) {
      stepStrip(strip);
      if (g >= 12) {
        for (const key of liveOf(strip)) expect(Number(key.split(',')[0])).toBeLessThan(4);
      }
    }
  });
});

describe('the strip: edge, keep-clear mask and the rules', () => {
  it('never spawns or keeps a cell on the edge', () => {
    const strip = createStrip(5, 5, empty(5, 5));
    for (let k = 0; k < 25; k++) spawnCell(strip, k);
    expect(liveOf(strip).length).toBe(9); // the 3x3 interior
    expect(liveOf(strip).every((key) => {
      const [x, y] = key.split(',').map(Number);
      return x >= 1 && x <= 3 && y >= 1 && y <= 3;
    })).toBe(true);
  });

  it('never lets a cell be born under the mask', () => {
    // a vertical blinker at column 4 turns horizontal next: (3,3) and (5,3) would be born, but both are under the mask
    const mask = keepClearMask(8, 8, [{ x: 3, y: 3, x2: 4, y2: 4 }, { x: 5, y: 3, x2: 6, y2: 4 }]);
    const strip = createStrip(8, 8, mask);
    for (const y of [2, 3, 4]) spawnCell(strip, y * 8 + 4);
    stepStrip(strip);
    expect(liveOf(strip)).toEqual(['4,3']);
  });

  it('refuses to spawn under the mask', () => {
    const mask = keepClearMask(4, 4, [{ x: 0, y: 0, x2: 2, y2: 2 }]);
    const strip = createStrip(4, 4, mask);
    spawnCell(strip, 1 * 4 + 1);
    expect(strip.count).toBe(0);
  });

  it('clips a box to the strip, shifted by the strip\'s first page column', () => {
    // page columns [4, 8) form the strip; a box over page columns 2..5 keeps only strip columns 0..1
    const mask = keepClearMask(4, 3, [{ x: 2, y: 0, x2: 6, y2: 2 }], 4);
    expect([...mask]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('follows the board\'s own rules, generation by generation (ages included)', () => {
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const w = 24;
    const h = 30;
    const mask = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) if (rnd() < 0.08) mask[k] = 1;
    const dense = createWorld(w, h);
    const strip = createStrip(w, h, mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (!mask[k] && rnd() < 0.35) {
          spawn(dense, k);
          spawnCell(strip, k);
        }
      }
    }
    expect(sparseLive(strip)).toEqual(denseLive(dense));
    for (let g = 0; g < 80; g++) {
      denseStep(dense, mask);
      stepStrip(strip);
      expect(sparseLive(strip)).toEqual(denseLive(dense));
    }
  });
});

describe('the rows drawn', () => {
  it('is the viewport plus a margin each side, in cell rows', () => {
    // the section starts 300px above the viewport: the viewport covers its rows 100..300 (3px cells)
    expect(rowWindow(-300, 3000, 900, 3, 0)).toEqual({ first: 100, last: 399 });
    // a 240px margin widens it by 80 cells each side
    expect(rowWindow(-300, 3000, 900, 3, 240)).toEqual({ first: 20, last: 479 });
  });

  it('clamps to the section, and is empty when the section is off screen', () => {
    expect(rowWindow(100, 3000, 900, 3, 0)).toEqual({ first: 0, last: 266 }); // starts inside the viewport
    expect(rowWindow(-5000, 3000, 900, 3, 0)).toEqual({ first: 1666, last: 999 }); // the bottom is above the viewport
    expect(rowWindow(-5000, 3000, 900, 3, 0).last).toBeLessThan(rowWindow(-5000, 3000, 900, 3, 0).first);
  });
});

describe('the rebuild rule', () => {
  it('rebuilds on a width change, or a height change bigger than a mobile toolbar', () => {
    const base = { width: 1440, height: 5000, viewport: 900 };
    expect(needsRebuild(base, { ...base, height: 5060 })).toBe(false);
    expect(needsRebuild(base, { ...base, height: 5200 })).toBe(true);
    expect(needsRebuild(base, { ...base, viewport: 840 })).toBe(false);
    expect(needsRebuild(base, { ...base, viewport: 700 })).toBe(true);
    expect(needsRebuild(base, { ...base, width: 1200 })).toBe(true);
  });
});
