import { describe, expect, it } from 'vitest';
import { HERO_FREEZE, HERO_SLOW, heroProgress, tickInterval } from '../src/scripts/board';

describe('heroProgress', () => {
  it('is 0 at the top and 1 once the hero is one viewport away', () => {
    expect(heroProgress(0, 900)).toBe(0);
    expect(heroProgress(900, 900)).toBe(1);
  });

  it('is linear in between', () => {
    expect(heroProgress(270, 900)).toBeCloseTo(0.3);
    expect(heroProgress(630, 900)).toBeCloseTo(0.7);
  });

  it('clamps past the hero, and above the top', () => {
    expect(heroProgress(2000, 900)).toBe(1);
    expect(heroProgress(-40, 900)).toBe(0);
  });

  it('is 0 for a viewport that has no height yet, or a scroll that is not a number', () => {
    expect(heroProgress(100, 0)).toBe(0);
    expect(heroProgress(100, NaN)).toBe(0);
    expect(heroProgress(NaN, 900)).toBe(0);
  });
});

describe('tickInterval', () => {
  const base = 120;

  it('ticks at the base rate at the top', () => {
    expect(tickInterval(0, base)).toBe(base);
  });

  it('stretches linearly to HERO_SLOW times the base rate at HERO_FREEZE', () => {
    expect(HERO_SLOW).toBe(4);
    expect(tickInterval(HERO_FREEZE / 2, base)).toBeCloseTo(base * 2.5);
    expect(tickInterval(HERO_FREEZE - 1e-9, base)).toBeCloseTo(base * HERO_SLOW);
  });

  it('freezes the board from HERO_FREEZE on', () => {
    expect(tickInterval(HERO_FREEZE, base)).toBe(Infinity);
    expect(tickInterval(1, base)).toBe(Infinity);
  });

  it('never gets faster as the hero scrolls away', () => {
    let previous = 0;
    for (let p = 0; p < HERO_FREEZE; p += 0.01) {
      const interval = tickInterval(p, base);
      expect(interval).toBeGreaterThanOrEqual(previous);
      previous = interval;
    }
  });

  it('treats a bad progress as the top', () => {
    expect(tickInterval(NaN, base)).toBe(base);
    expect(tickInterval(-1, base)).toBe(base);
  });
});
