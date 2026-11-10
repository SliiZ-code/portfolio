import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/scripts/board/life';
import {
  BEEHIVE,
  BLINKER_PHASES,
  BLOCK,
  BOAT,
  DIVIDER_CELL,
  LOAF,
  MAX_GAP_CELLS,
  MAX_PATTERNS,
  MIN_GAP_CELLS,
  ROW_HEIGHT_CELLS,
  STILL_LIFES,
  TUB,
  blinkerPhase,
  createRnd,
  layoutRow,
} from '../src/scripts/still-life';

const countLive = (cells: number[][]): number =>
  cells.reduce((sum, row) => sum + row.reduce((rSum, c) => rSum + (c ? 1 : 0), 0), 0);

const CELL = DIVIDER_CELL;
const DESKTOP = 680;
const PHONE = 351;
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe('pattern definitions and still life properties', () => {
  it('has correct live cell counts for all still lifes', () => {
    expect(countLive(BLOCK)).toBe(4);
    expect(countLive(BEEHIVE)).toBe(6);
    expect(countLive(LOAF)).toBe(7);
    expect(countLive(BOAT)).toBe(5);
    expect(countLive(TUB)).toBe(4);
  });

  it('still lifes are unchanged after stepping one or more Life generations', () => {
    for (const [name, pattern] of Object.entries(STILL_LIFES)) {
      const worldW = 12;
      const worldH = 12;
      const world = createWorld(worldW, worldH);
      const startX = 4;
      const startY = 4;

      pattern.forEach((row, r) =>
        row.forEach((val, c) => {
          if (val) world.cells[(startY + r) * worldW + (startX + c)] = 1;
        }),
      );

      const initialLive = countLive(pattern);
      expect(world.cells.reduce((a, b) => a + b, 0)).toBe(initialLive);

      // Step 1 generation
      stepWorld(world);

      pattern.forEach((row, r) =>
        row.forEach((val, c) => {
          expect(world.cells[(startY + r) * worldW + (startX + c)], `${name} at [${r},${c}]`).toBe(val);
        }),
      );

      // Step 5 more generations
      for (let g = 0; g < 5; g++) {
        stepWorld(world);
      }

      pattern.forEach((row, r) =>
        row.forEach((val, c) => {
          expect(world.cells[(startY + r) * worldW + (startX + c)], `${name} after 6 gens at [${r},${c}]`).toBe(val);
        }),
      );
    }
  });

  it('blinkers are period-2 oscillators', () => {
    const worldW = 10;
    const worldH = 10;
    const world = createWorld(worldW, worldH);
    const startX = 3;
    const startY = 3;

    // Plant phase 0
    BLINKER_PHASES[0].forEach((row, r) =>
      row.forEach((val, c) => {
        if (val) world.cells[(startY + r) * worldW + (startX + c)] = 1;
      }),
    );

    // Generation 1 -> should match phase 1
    stepWorld(world);
    BLINKER_PHASES[1].forEach((row, r) =>
      row.forEach((val, c) => {
        expect(world.cells[(startY + r) * worldW + (startX + c)], `blinker gen 1 at [${r},${c}]`).toBe(val);
      }),
    );

    // Generation 2 -> should return to phase 0
    stepWorld(world);
    BLINKER_PHASES[0].forEach((row, r) =>
      row.forEach((val, c) => {
        expect(world.cells[(startY + r) * worldW + (startX + c)], `blinker gen 2 at [${r},${c}]`).toBe(val);
      }),
    );
  });
});

describe('blinkerPhase', () => {
  it('toggles every 600ms by default', () => {
    expect(blinkerPhase(0)).toBe(0);
    expect(blinkerPhase(300)).toBe(0);
    expect(blinkerPhase(599)).toBe(0);
    expect(blinkerPhase(600)).toBe(1);
    expect(blinkerPhase(900)).toBe(1);
    expect(blinkerPhase(1199)).toBe(1);
    expect(blinkerPhase(1200)).toBe(0);
  });

  it('supports custom period or step count', () => {
    expect(blinkerPhase(0, 1)).toBe(0);
    expect(blinkerPhase(1, 1)).toBe(1);
    expect(blinkerPhase(2, 1)).toBe(0);
    expect(blinkerPhase(3, 1)).toBe(1);
  });
});

describe('layoutRow', () => {
  it('returns empty array when width is too narrow', () => {
    const rnd = createRnd(42);
    expect(layoutRow(10, 6, rnd)).toEqual([]);
    expect(layoutRow(0, 6, rnd)).toEqual([]);
    expect(layoutRow(-10, 6, rnd)).toEqual([]);
  });

  it('places patterns without overflowing the width', () => {
    const cell = 6;
    for (const width of [100, 390, 680, 960, 1200]) {
      const rnd = createRnd(12345);
      const placed = layoutRow(width, cell, rnd);
      const maxCols = Math.floor(width / cell);

      for (const p of placed) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(maxCols);
        expect((p.x + p.width) * cell).toBeLessThanOrEqual(width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y + p.height).toBeLessThanOrEqual(ROW_HEIGHT_CELLS);
      }
    }
  });

  it('leaves wide, irregular gaps between consecutive patterns', () => {
    const gaps = new Set<number>();
    for (const seed of SEEDS) {
      const placed = layoutRow(DESKTOP, CELL, createRnd(seed));
      for (let i = 0; i < placed.length - 1; i++) {
        const gap = placed[i + 1]!.x - (placed[i]!.x + placed[i]!.width);
        expect(gap).toBeGreaterThanOrEqual(MIN_GAP_CELLS);
        expect(gap).toBeLessThanOrEqual(MAX_GAP_CELLS);
        gaps.add(gap);
      }
    }
    expect(gaps.size).toBeGreaterThan(5);
  });

  it('keeps the row sparse: a handful of patterns on a wide screen, fewer on a phone', () => {
    const desktop = SEEDS.map((seed) => layoutRow(DESKTOP, CELL, createRnd(seed)).length);
    const phone = SEEDS.map((seed) => layoutRow(PHONE, CELL, createRnd(seed)).length);
    // 680 px is 113 cells (7 patterns at most); 351 px is 58 cells (4 at most)
    expect(Math.min(...desktop)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...desktop)).toBeLessThanOrEqual(MAX_PATTERNS);
    expect(Math.max(...phone)).toBeLessThanOrEqual(4);
    expect(mean(phone)).toBeLessThan(mean(desktop));
  });

  it('starts at the left edge of the text', () => {
    for (const seed of SEEDS) {
      expect(layoutRow(DESKTOP, CELL, createRnd(seed))[0]!.x).toBeLessThanOrEqual(2);
    }
  });

  it('is deterministic when given the same seeded rnd', () => {
    const placed1 = layoutRow(680, 6, createRnd(777));
    const placed2 = layoutRow(680, 6, createRnd(777));
    expect(placed1).toEqual(placed2);

    const placed3 = layoutRow(680, 6, createRnd(888));
    expect(placed1).not.toEqual(placed3);
  });

  it('mixes still lifes with blinkers, with a still life in every row', () => {
    const names = new Set<string>();
    for (const seed of SEEDS) {
      const placed = layoutRow(DESKTOP, CELL, createRnd(seed));
      expect(placed.some((p) => !p.isBlinker)).toBe(true);
      placed.forEach((p) => names.add(p.name));
    }
    expect(names.has('blinker')).toBe(true);
  });
});
