import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/scripts/board/life';
import { BEEHIVE, GLIDER_HEADINGS, METHUSELAHS, METHUSELAH_PATTERNS, PATTERNS } from '../src/scripts/board/patterns';

const count = (cells: number[][]) => cells.flat().reduce((sum, value) => sum + value, 0);

describe('gliders by heading', () => {
  it('are 3×3 with five live cells', () => {
    for (const { cells } of GLIDER_HEADINGS) {
      expect(cells).toHaveLength(3);
      expect(cells.every((row) => row.length === 3)).toBe(true);
      expect(count(cells)).toBe(5);
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

describe('structure patterns', () => {
  it('keeps the CV beehive and the contact gun', () => {
    expect(BEEHIVE).toHaveLength(3);
    expect(PATTERNS.beehive).toBe(BEEHIVE);
    expect(Object.keys(PATTERNS).sort()).toEqual(['beehive', 'gun']);
  });
});

describe('methuselahs', () => {
  it('are the five standard layouts', () => {
    const rows = (name: keyof typeof METHUSELAH_PATTERNS) => METHUSELAH_PATTERNS[name].map((row) => row.join('').replace(/1/g, 'O').replace(/0/g, '.'));
    expect(rows('r-pentomino')).toEqual(['.OO', 'OO.', '.O.']);
    expect(rows('acorn')).toEqual(['.O.....', '...O...', 'OO..OOO']);
    expect(rows('diehard')).toEqual(['......O.', 'OO......', '.O...OOO']);
    expect(rows('b-heptomino')).toEqual(['O.OO', 'OOO.', '.O..']);
    expect(rows('pi-heptomino')).toEqual(['OOO', 'O.O', 'O.O']);
  });

  it('lists each one once, in a fixed order', () => {
    expect(METHUSELAHS).toEqual(['r-pentomino', 'acorn', 'diehard', 'b-heptomino', 'pi-heptomino']);
    expect(Object.keys(METHUSELAH_PATTERNS).sort()).toEqual([...METHUSELAHS].sort());
  });

  it('have the right number of cells', () => {
    const cells = Object.fromEntries(METHUSELAHS.map((name) => [name, count(METHUSELAH_PATTERNS[name])]));
    expect(cells).toEqual({ 'r-pentomino': 5, acorn: 7, diehard: 7, 'b-heptomino': 7, 'pi-heptomino': 7 });
  });

  it('really are the patterns they claim to be (checked by running Life)', () => {
    // the diehard vanishes completely at generation 130, and not a generation sooner
    const run = (name: keyof typeof METHUSELAH_PATTERNS, steps: number) => {
      const world = createWorld(120, 120);
      METHUSELAH_PATTERNS[name].forEach((row, j) => row.forEach((value, i) => value && (world.cells[(55 + j) * 120 + 55 + i] = 1)));
      let population = 0;
      for (let step = 0; step < steps; step++) population = stepWorld(world);
      return population;
    };
    expect(run('diehard', 129)).toBeGreaterThan(0);
    expect(run('diehard', 130)).toBe(0);
    // the R-pentomino is still growing long after a hundred generations, the pi-heptomino has settled by 200
    expect(run('r-pentomino', 100)).toBeGreaterThan(50);
    const settled = run('pi-heptomino', 200);
    expect(run('pi-heptomino', 210)).toBe(settled);
  });
});
