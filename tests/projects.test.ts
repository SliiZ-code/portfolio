import { describe, expect, it } from 'vitest';
import { placeProjects, stampSpot, waveFront, waveTravel, type PxRect } from '../src/scripts/board/projects';
import type { Box } from '../src/scripts/board/layout';

const overlapPx = (a: PxRect, b: PxRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const rectOf = (p: { left: number; top: number; width: number; height: number }): PxRect => ({
  left: p.left,
  top: p.top,
  right: p.left + p.width,
  bottom: p.top + p.height,
});

describe('placeProjects', () => {
  // 1440×900: cell 4, the name is 600×164 at (420, 260), its note one line below, the CV hangs off its right
  const landscape = {
    vw: 1440,
    vh: 900,
    orientation: 'l' as const,
    natural: { w: 300, h: 330 },
    obstacles: [
      { left: 420, top: 260, right: 1020, bottom: 424 },
      { left: 420, top: 434, right: 1000, bottom: 462 },
      { left: 980, top: 470, right: 1030, bottom: 540 },
    ],
    topLimit: 52,
    bottomLimit: 860,
  };

  it('hugs the right gutter, vertically centred, clear of everything in landscape', () => {
    const spot = placeProjects(landscape);
    expect(spot.left + spot.width).toBe(1440 - 16);
    expect(spot.top).toBe(Math.round((900 - 330) / 2));
    expect(spot.height).toBe(330);
    expect(spot.overflow).toBe(false);
    for (const obstacle of landscape.obstacles) expect(overlapPx(rectOf(spot), obstacle)).toBe(false);
  });

  it('keeps a gap from the widest obstacle when the column is wide', () => {
    const spot = placeProjects({ ...landscape, natural: { w: 420, h: 330 } });
    expect(spot.left).toBeGreaterThanOrEqual(1030 + 20);
    expect(spot.left + spot.width).toBeLessThanOrEqual(1424);
  });

  it('flags a column that is too narrow and one that is too tall, and never leaves its band', () => {
    const narrow = placeProjects({ ...landscape, natural: { w: 600, h: 330 } });
    expect(narrow.narrow).toBe(true);
    expect(narrow.left).toBeGreaterThanOrEqual(1050);
    const tall = placeProjects({ ...landscape, vh: 500, bottomLimit: 460, natural: { w: 300, h: 600 } });
    expect(tall.overflow).toBe(true);
    expect(tall.top).toBeGreaterThanOrEqual(52);
    expect(tall.top + tall.height).toBeLessThanOrEqual(460);
  });

  it('goes under the name, its note and the CV on a phone, full width within the gutters', () => {
    const phone = placeProjects({
      vw: 390,
      vh: 844,
      orientation: 'p',
      natural: { w: 300, h: 240 },
      obstacles: [
        { left: 72, top: 195, right: 318, bottom: 384 },
        { left: 72, top: 394, right: 318, bottom: 470 },
        { left: 300, top: 468, right: 350, bottom: 530 },
      ],
      topLimit: 12,
      bottomLimit: 796,
    });
    expect(phone.left).toBe(16);
    expect(phone.width).toBe(390 - 32);
    expect(phone.top).toBeGreaterThanOrEqual(530 + 14);
    expect(phone.top + phone.height).toBeLessThanOrEqual(796);
    expect(phone.overflow).toBe(false);
  });

  it('scrolls on a short phone rather than run into the bottom corner', () => {
    const phone = placeProjects({
      vw: 360,
      vh: 640,
      orientation: 'p',
      natural: { w: 300, h: 240 },
      obstacles: [{ left: 300, top: 358, right: 340, bottom: 420 }],
      topLimit: 12,
      bottomLimit: 594,
    });
    expect(phone.overflow).toBe(true);
    expect(phone.top + phone.height).toBeLessThanOrEqual(594);
  });
});

describe('stampSpot', () => {
  const grid = { cols: 360, rows: 225 };
  const list: Box = { x: 264, y: 70, x2: 358, y2: 150 };
  const seed = { w: 7, h: 3 };
  const clash = (a: Box, x: number, y: number, margin = 3) => x - margin < a.x2 && x + seed.w + margin > a.x && y - margin < a.y2 && y + seed.h + margin > a.y;

  it('lands just outside the list, on the side with the open board, level with the row', () => {
    const spot = stampSpot(seed, 110, list, [], grid)!;
    expect(spot.x + seed.w).toBeLessThanOrEqual(list.x - 2);
    expect(spot.x + seed.w).toBeGreaterThan(list.x - 5);
    expect(Math.abs(spot.y + seed.h / 2 - 110)).toBeLessThanOrEqual(1);
  });

  it('uses the right side when the list is on the left', () => {
    const spot = stampSpot(seed, 100, { x: 4, y: 70, x2: 90, y2: 150 }, [], grid)!;
    expect(spot.x).toBeGreaterThanOrEqual(92);
  });

  it('slides to the nearest free rows when the row’s own level is taken', () => {
    const name: Box = { x: 105, y: 60, x2: 262, y2: 120 };
    const spot = stampSpot(seed, 90, list, [name], grid)!;
    expect(clash(name, spot.x, spot.y)).toBe(false);
    expect(spot.x + seed.w).toBeLessThanOrEqual(list.x - 2);
  });

  it('never overlaps what is off limits, and stays on screen', () => {
    const blocked: Box[] = [{ x: 100, y: 40, x2: 262, y2: 125 }, { x: 200, y: 125, x2: 262, y2: 160 }];
    for (let row = 70; row <= 150; row += 5) {
      const spot = stampSpot(seed, row, list, blocked, grid)!;
      expect(spot, `row ${row}`).not.toBeNull();
      for (const box of blocked) expect(clash(box, spot.x, spot.y), `row ${row}`).toBe(false);
      expect(spot.x).toBeGreaterThanOrEqual(1);
      expect(spot.y + seed.h).toBeLessThanOrEqual(grid.rows - 1);
    }
  });

  it('gives up instead of overlapping when there is no room at all', () => {
    expect(stampSpot(seed, 100, list, [{ x: 0, y: 0, x2: 360, y2: 225 }], grid)).toBeNull();
  });
});

describe('the opening wave', () => {
  it('travels past the farthest corner and the trailing bands', () => {
    const travel = waveTravel({ x: 180, y: 85 }, { cols: 360, rows: 225 }, 4, 3);
    expect(travel).toBeCloseTo(Math.hypot(180, 140) + 12, 5);
  });

  it('starts at the centre, ends at the travel, never goes backwards and decelerates', () => {
    expect(waveFront(0, 200)).toBe(0);
    expect(waveFront(1, 200)).toBeCloseTo(200, 5);
    expect(waveFront(2, 200)).toBeCloseTo(200, 5);
    expect(waveFront(-1, 200)).toBe(0);
    let previous = -1;
    let previousStep = Infinity;
    for (let n = 0; n <= 20; n++) {
      const front = waveFront(n / 20, 200);
      expect(front).toBeGreaterThanOrEqual(previous);
      if (n > 0) {
        expect(front - previous).toBeLessThanOrEqual(previousStep + 1e-9);
        previousStep = front - previous;
      }
      previous = front;
    }
  });
});
