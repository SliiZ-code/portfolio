import { describe, expect, it } from 'vitest';
import { shouldTick, type TickGate } from '../src/scripts/board';

const RATE = 120;
const T0 = 1000;

const gate = (over: Partial<TickGate> = {}): TickGate => ({
  now: T0 + 200,
  last: T0,
  interval: RATE,
  t0: T0,
  reduced: false,
  entry: 'intro',
  ...over,
});

describe('shouldTick', () => {
  it('ticks during the opening wave, once the interval has passed, without waiting for the start delay', () => {
    // 130 ms into the wave: past one interval, still well before the 500 ms direct start delay
    expect(shouldTick(gate({ now: T0 + 130 }))).toBe(true);
    // still inside the wave, many generations in
    expect(shouldTick(gate({ now: T0 + 1500, last: T0 + 1370 }))).toBe(true);
  });

  it('keeps ticking at the same rate once the wave is over, with no second start', () => {
    // the wave ended at 1800 ms; the next generation lands one interval after the last one, as usual
    expect(shouldTick(gate({ now: T0 + 1801, last: T0 + 1690 }))).toBe(false);
    expect(shouldTick(gate({ now: T0 + 1811, last: T0 + 1690 }))).toBe(true);
  });

  it('never ticks under reduced motion', () => {
    expect(shouldTick(gate({ reduced: true }))).toBe(false);
    expect(shouldTick(gate({ reduced: true, now: T0 + 5000 }))).toBe(false);
    expect(shouldTick(gate({ reduced: true, entry: 'direct', now: T0 + 5000 }))).toBe(false);
  });

  it('waits for the start delay when there is no opening wave', () => {
    expect(shouldTick(gate({ entry: 'direct', now: T0 + 499 }))).toBe(false);
    expect(shouldTick(gate({ entry: 'direct', now: T0 + 501 }))).toBe(true);
  });

  it('does not tick before the interval has elapsed', () => {
    expect(shouldTick(gate({ now: T0 + 50, last: T0 }))).toBe(false);
    expect(shouldTick(gate({ now: T0 + 5000, last: T0 + 4950 }))).toBe(false);
  });

  it('never ticks while the hero freeze stretches the interval to infinity', () => {
    expect(shouldTick(gate({ interval: Infinity, now: T0 + 5000 }))).toBe(false);
  });
});
