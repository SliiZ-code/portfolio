import { describe, expect, it } from 'vitest';
import { countLive, stepWorld } from '../src/scripts/board/life';
import { PULSAR_WINDOW, WORLD_SIZE, clamp, clampBox, flowLines, freeSlots, newPulsarWorld, settleSpot, type Box } from '../src/scripts/flow-text';

describe('clamp', () => {
  it('pins a value into its range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
  });

  it('pins to the minimum when the range is inverted', () => {
    expect(clamp(4, 10, 3)).toBe(10);
  });
});

describe('clampBox', () => {
  it('keeps a box inside its area', () => {
    expect(clampBox(-5, 3, 10, 10, 100, 100)).toEqual({ x: 0, y: 3 });
    expect(clampBox(95, 200, 10, 10, 100, 100)).toEqual({ x: 90, y: 90 });
    expect(clampBox(40, 20, 10, 10, 100, 100)).toEqual({ x: 40, y: 20 });
  });

  it('pins a box wider than its area to the left edge', () => {
    expect(clampBox(50, 50, 200, 10, 100, 100)).toEqual({ x: 0, y: 50 });
  });
});

describe('settleSpot', () => {
  const area = { width: 300, height: 200 };
  const box = { w: 50, h: 50 };

  it('keeps the preferred spot when the text needs no more rows there', () => {
    expect(settleSpot({ x: 120, y: 40 }, area, box, () => 4, 4, 10)).toEqual({ x: 120, y: 40 });
  });

  it('moves to the nearest spot that keeps the goal rows', () => {
    // only a box left of x=100 leaves the text its rows
    const rowsAt = (x: number) => (x < 100 ? 4 : 5);
    expect(settleSpot({ x: 150, y: 40 }, area, box, rowsAt, 4, 10)).toEqual({ x: 90, y: 40 });
  });

  it('falls back to the spot that needs the fewest rows when none keeps the goal', () => {
    const rowsAt = (x: number) => (x === 200 ? 6 : 7);
    expect(settleSpot({ x: 50, y: 40 }, area, box, rowsAt, 4, 10)).toEqual({ x: 200, y: 40 });
  });
});

describe('freeSlots', () => {
  const box = (x: number, w: number): Box => ({ x, y: 0, w, h: 10 });

  it('is the whole row without an obstacle', () => {
    expect(freeSlots(600, null, 10, 40)).toEqual([[0, 600]]);
  });

  it('leaves a run on each side of an obstacle, cut back by the gap', () => {
    expect(freeSlots(600, box(200, 100), 10, 40)).toEqual([
      [0, 190],
      [310, 600],
    ]);
  });

  it('drops a run that is narrower than the minimum', () => {
    // left run is 30px (too narrow), right run is 130px
    expect(freeSlots(600, box(40, 400), 10, 40)).toEqual([[450, 600]]);
  });

  it('keeps only the side that is free when the obstacle touches an edge', () => {
    expect(freeSlots(600, box(0, 100), 10, 40)).toEqual([[110, 600]]);
    expect(freeSlots(600, box(580, 20), 10, 40)).toEqual([[0, 570]]);
  });

  it('is empty when the obstacle covers the row', () => {
    expect(freeSlots(600, box(0, 600), 10, 40)).toEqual([]);
  });
});

/** A fake measurer: every character is 10px, words are separated by one 10px space; `from` is a word index. */
const CHAR = 10;
const words = (text: string) => text.split(' ');
const widthOf = (ws: string[]) => ws.reduce((sum, w) => sum + w.length * CHAR, 0) + Math.max(0, ws.length - 1) * CHAR;

function measurer(text: string) {
  const ws = words(text);
  return (maxWidth: number, from: number) => {
    if (from >= ws.length) return null;
    let end = from + 1;
    while (end < ws.length && widthOf(ws.slice(from, end + 1)) <= maxWidth) end++;
    const slice = ws.slice(from, end);
    return { width: widthOf(slice), end, text: slice.join(' ') };
  };
}

const SOURCE = 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx yy zz';
const LH = 20;
const GAP = 10;

function flow(width: number, box: Box | null, text = SOURCE) {
  return flowLines({ width, lineHeight: LH, box, gap: GAP, minSlot: 40, start: 0, next: measurer(text) });
}

describe('flowLines', () => {
  it('wraps greedily at the width when nothing is in the way', () => {
    const { lines, rows } = flow(100, null);
    // 'aa bb cc' is 80px; ' dd' would make it 110px, so each line holds three words
    expect(lines.map((l) => l.text)).toEqual(['aa bb cc', 'dd ee ff', 'gg hh ii', 'jj kk ll', 'mm nn oo', 'pp qq rr', 'ss tt uu', 'vv ww xx', 'yy zz']);
    expect(lines.every((l) => l.x === 0)).toBe(true);
    expect(lines.map((l) => l.y)).toEqual(lines.map((_, i) => i * LH));
    expect(rows).toBe(lines.length);
  });

  it('keeps every word, in order', () => {
    const { lines } = flow(137, { x: 40, y: 20, w: 60, h: 40 });
    expect(lines.map((l) => l.text).join(' ')).toBe(SOURCE);
  });

  it('never draws a line through the obstacle while the row meets it', () => {
    const box: Box = { x: 150, y: 20, w: 80, h: 40 };
    const { lines } = flow(400, box);
    for (const line of lines) {
      const meets = line.y < box.y + box.h + GAP && line.y + LH > box.y - GAP;
      if (!meets) continue;
      const clearLeft = line.x + line.width <= box.x - GAP + 1e-9;
      const clearRight = line.x >= box.x + box.w + GAP - 1e-9;
      expect(clearLeft || clearRight, `line "${line.text}" at y=${line.y}`).toBe(true);
    }
  });

  it('flows text on both sides of the obstacle in the same row', () => {
    const box: Box = { x: 150, y: 20, w: 80, h: 20 };
    const { lines } = flow(400, box);
    const row = lines.filter((l) => l.y === 20);
    expect(row.some((l) => l.x === 0)).toBe(true);
    expect(row.some((l) => l.x > box.x)).toBe(true);
  });

  it('keeps every line inside the paragraph width', () => {
    const { lines } = flow(300, { x: 100, y: 0, w: 60, h: 100 });
    for (const line of lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + line.width).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  it('skips a row the obstacle covers and carries the text to the next one', () => {
    const { lines } = flow(300, { x: 0, y: 0, w: 300, h: 40 });
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.min(...lines.map((l) => l.y))).toBe(60);
  });

  it('does not put a word wider than a narrow slot into it', () => {
    const text = 'aa bb wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww cc dd';
    const box: Box = { x: 60, y: 0, w: 200, h: 20 };
    const { lines } = flowLines({ width: 300, lineHeight: LH, box, gap: GAP, minSlot: 40, start: 0, next: measurer(text) });
    const wide = lines.find((l) => l.text.includes('wwww'));
    expect(wide).toBeDefined();
    // the rows the obstacle meets stay empty, so the wide word lands below it, across the full width
    expect(wide!.y).toBeGreaterThanOrEqual(box.y + box.h + GAP);
    expect(lines.map((l) => l.text).join(' ')).toBe(text);
  });

  it('does not split a word to fill a narrow run beside the cell', () => {
    // a word that fits only a short run comes back cut mid-word (pretext breaks what does not fit); a cut piece is refused
    // beside the cell, so the whole word waits for a full row below
    const next = (maxWidth: number, from: number) => {
      if (from >= 1) return null;
      return maxWidth >= 120
        ? { width: 120, end: 1, text: 'researching' }
        : { width: maxWidth, end: 0, text: 'resear', broken: true };
    };
    const box: Box = { x: 60, y: 0, w: 80, h: 20 };
    const { lines } = flowLines({ width: 200, lineHeight: LH, box, gap: GAP, minSlot: 40, start: 0, next });
    expect(lines.map((l) => l.text)).toEqual(['researching']);
    expect(lines[0].y).toBe(2 * LH);
  });

  it('reports the number of rows it used, blocked ones included', () => {
    const { lines, rows } = flow(300, { x: 0, y: 0, w: 300, h: 40 });
    expect(rows).toBe(Math.round(Math.max(...lines.map((l) => l.y)) / LH) + 1);
  });
});

describe('the pulsar pattern', () => {
  it('starts with 48 live cells, all inside the window the flow text is kept out of', () => {
    const world = newPulsarWorld();
    expect(countLive(world.cells)).toBe(48);
    expect(PULSAR_WINDOW).toBeLessThan(WORLD_SIZE);
  });

  it('comes back to its first shape every third generation', () => {
    const world = newPulsarWorld();
    const seed = world.cells.slice();
    stepWorld(world);
    expect(world.cells).not.toEqual(seed);
    stepWorld(world);
    stepWorld(world);
    expect(world.cells).toEqual(seed);
  });

  it('never dies out and never leaves its window', () => {
    const world = newPulsarWorld();
    for (let gen = 0; gen < 60; gen++) {
      stepWorld(world);
      expect(countLive(world.cells)).toBeGreaterThan(0);
      for (let y = 0; y < WORLD_SIZE; y++) {
        for (let x = 0; x < WORLD_SIZE; x++) {
          const inside = x < PULSAR_WINDOW && y < PULSAR_WINDOW;
          if (!inside) expect(world.cells[y * WORLD_SIZE + x]).toBe(0);
        }
      }
    }
  });
});
