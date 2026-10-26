import { describe, expect, it } from 'vitest';
import { parseHex, quantize, type Palette } from '../src/scripts/pixel/quantize';

const paper: Palette = { paper: parseHex('#e8e5dc'), ink: parseHex('#1b1a17'), accent: parseHex('#2433ff') };
const night: Palette = { paper: parseHex('#131210'), ink: parseHex('#e8e5dc'), accent: parseHex('#ff8a3d') };

const px = (...rgb: number[]) => new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], rgb[3] ?? 255]);
const run = (data: Uint8ClampedArray, palette: Palette, isNight: boolean) => {
  quantize(data, palette, isNight);
  return [...data.slice(0, 4)];
};

describe('parseHex', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(parseHex('#e8e5dc')).toEqual([232, 229, 220]);
    expect(parseHex('#fa0')).toEqual([255, 170, 0]);
    expect(parseHex(' #131210 ')).toEqual([19, 18, 16]);
  });
});

describe('quantize on the paper theme', () => {
  it('maps light to paper and dark to ink', () => {
    expect(run(px(255, 255, 255), paper, false)).toEqual([...paper.paper, 255]);
    expect(run(px(0, 0, 0), paper, false)).toEqual([...paper.ink, 255]);
  });

  it('uses the accent for vivid colours, however bright', () => {
    expect(run(px(220, 30, 30), paper, false)).toEqual([...paper.accent, 255]);
    expect(run(px(30, 200, 40), paper, false)).toEqual([...paper.accent, 255]);
  });

  it('keeps dark vivid pixels out of the accent (they are just shadow)', () => {
    expect(run(px(60, 0, 0), paper, false)).not.toEqual([...paper.accent, 255]);
  });

  it('makes the output opaque', () => {
    expect(run(px(120, 120, 120, 0), paper, false)[3]).toBe(255);
  });
});

describe('quantize on the night theme', () => {
  it('maps light to ink and dark to paper, so the picture is not a negative', () => {
    expect(run(px(255, 255, 255), night, true)).toEqual([...night.ink, 255]);
    expect(run(px(0, 0, 0), night, true)).toEqual([...night.paper, 255]);
  });
});

describe('five ink levels', () => {
  const gradient = () => {
    const data = new Uint8ClampedArray(256 * 4);
    for (let v = 0; v < 256; v++) data.set([v, v, v, 255], v * 4);
    return data;
  };
  const distinct = (data: Uint8ClampedArray) => new Set(Array.from({ length: data.length / 4 }, (_, i) => data.slice(i * 4, i * 4 + 3).join(',')));

  it('collapses a 256-step grey ramp to exactly five colours', () => {
    const data = gradient();
    quantize(data, paper, false);
    expect(distinct(data).size).toBe(5);
    const night5 = gradient();
    quantize(night5, night, true);
    expect(distinct(night5).size).toBe(5);
  });

  it('steps evenly from paper to ink', () => {
    const data = gradient();
    quantize(data, paper, false);
    const mid = [...data.slice(128 * 4, 128 * 4 + 3)];
    expect(mid).toEqual(paper.paper.map((v, k) => Math.round(v + (paper.ink[k] - v) * 0.5)));
  });
});
