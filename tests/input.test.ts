import { describe, expect, it } from 'vitest';
import { isTap, strokeCells } from '../src/scripts/board/input';

describe('strokeCells', () => {
  it('fills the gap between two pointer events, ends included', () => {
    expect(strokeCells([2, 2], [6, 2])).toEqual([[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]]);
    expect(strokeCells([0, 0], [3, 3])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('has no holes on a steep or shallow line', () => {
    for (const [to] of [[[10, 3]], [[3, 10]], [[-7, 4]], [[5, -9]]] as [[number, number]][]) {
      const cells = strokeCells([0, 0], to);
      for (let i = 1; i < cells.length; i++) {
        expect(Math.max(Math.abs(cells[i][0] - cells[i - 1][0]), Math.abs(cells[i][1] - cells[i - 1][1]))).toBe(1);
      }
      expect(cells[0]).toEqual([0, 0]);
      expect(cells.at(-1)).toEqual(to);
    }
  });

  it('is a single cell when the pointer did not leave it', () => {
    expect(strokeCells([4, 4], [4, 4])).toEqual([[4, 4]]);
  });
});

describe('isTap', () => {
  it('is a tap until the pointer travels more than 4 pixels', () => {
    expect(isTap(100, 100, 103, 102)).toBe(true);
    expect(isTap(100, 100, 100, 104)).toBe(true);
    expect(isTap(100, 100, 104, 104)).toBe(false);
  });
});
