import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/scripts/board/life';
import { BEEHIVE, BLINKERS, GLIDER_HEADINGS, PATTERNS } from '../src/scripts/board/patterns';

describe('gliders by heading', () => {
  it('are 3×3 with five live cells', () => {
    for (const { cells } of GLIDER_HEADINGS) {
      expect(cells).toHaveLength(3);
      expect(cells.every((row) => row.length === 3)).toBe(true);
      expect(cells.flat().reduce((sum, value) => sum + value, 0)).toBe(5);
    }
  });

  it('really travel along their declared heading (checked by running Life)', () => {
    for (const { heading, cells } of GLIDER_HEADINGS) {
      const world = createWorld(20, 20);
      cells.forEach((row, j) => row.forEach((value, i) => value && (world.cells[(8 + j) * 20 + 8 + i] = 1)));
      for (let generation = 0; generation < 8; generation++) stepWorld(world);
      cells.forEach((row, j) =>
        row.forEach((value, i) => {
          const x = 8 + i + heading[0] * 2;
          const y = 8 + j + heading[1] * 2;
          expect(world.cells[y * 20 + x], `${heading} ${i},${j}`).toBe(value);
        }),
      );
    }
  });
});

describe('v2 patterns', () => {
  it('has three blinkers and a beehive', () => {
    expect(BLINKERS).toEqual([[1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1]]);
    expect(BEEHIVE).toHaveLength(3);
    expect(PATTERNS.beehive).toBe(BEEHIVE);
  });
});
