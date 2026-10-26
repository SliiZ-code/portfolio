import { describe, expect, it } from 'vitest';
import { findFreeSlot } from '../src/scripts/board/slots';

const grid = { cols: 100, rows: 60 };
const overlap = (a: { x: number; y: number; x2: number; y2: number }, b: typeof a) =>
  a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;

describe('findFreeSlot', () => {
  it('returns the free rectangle nearest the middle of the screen', () => {
    const slot = findFreeSlot({ w: 20, h: 10 }, [], grid);
    expect(slot).toEqual({ x: 40, y: 25 });
  });

  it('avoids every occupied box, with a margin', () => {
    const occupied = [{ x: 30, y: 15, x2: 70, y2: 45 }];
    const slot = findFreeSlot({ w: 20, h: 10 }, occupied, grid, { margin: 2 })!;
    expect(slot).not.toBeNull();
    const box = { x: slot.x - 2, y: slot.y - 2, x2: slot.x + 22, y2: slot.y + 12 };
    expect(overlap(box, occupied[0])).toBe(false);
  });

  it('stays inside the screen with an edge gap', () => {
    const occupied = [{ x: 0, y: 0, x2: 100, y2: 40 }];
    const slot = findFreeSlot({ w: 20, h: 8 }, occupied, grid, { edge: 3 })!;
    expect(slot.x).toBeGreaterThanOrEqual(3);
    expect(slot.y).toBeGreaterThanOrEqual(3);
    expect(slot.x + 20).toBeLessThanOrEqual(97);
    expect(slot.y + 8).toBeLessThanOrEqual(57);
  });

  it('finds a slot squeezed into the only free band', () => {
    const occupied = [{ x: 0, y: 0, x2: 100, y2: 40 }, { x: 0, y: 50, x2: 100, y2: 60 }];
    const slot = findFreeSlot({ w: 10, h: 6 }, occupied, grid, { margin: 0, edge: 0 })!;
    expect(slot.y).toBeGreaterThanOrEqual(40);
    expect(slot.y + 6).toBeLessThanOrEqual(50);
  });

  it('returns null when nothing fits, instead of overlapping', () => {
    expect(findFreeSlot({ w: 20, h: 10 }, [{ x: 0, y: 0, x2: 100, y2: 60 }], grid)).toBeNull();
    expect(findFreeSlot({ w: 200, h: 10 }, [], grid)).toBeNull();
  });

  it('is deterministic', () => {
    const occupied = [{ x: 20, y: 10, x2: 60, y2: 30 }];
    expect(findFreeSlot({ w: 15, h: 9 }, occupied, grid)).toEqual(findFreeSlot({ w: 15, h: 9 }, occupied, grid));
  });

  it('prefers the given point over the centre', () => {
    const slot = findFreeSlot({ w: 10, h: 6 }, [], grid, { prefer: { x: 90, y: 5 }, edge: 2 })!;
    expect(slot.x + 10).toBeGreaterThan(80);
    expect(slot.y).toBeLessThan(10);
  });
});
