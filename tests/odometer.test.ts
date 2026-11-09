import { describe, expect, it } from 'vitest';
import { diffDigits, rollPlan, type DiffResult } from '../src/scripts/board/odometer';

/** The positions of the digits that change, in order. */
const changedAt = (result: DiffResult): number[] => result.digits.flatMap((d, i) => (d.changed ? [i] : []));

describe('diffDigits', () => {
  it('changes only the digit that moved on a plain increment', () => {
    const result = diffDigits('0000', '0001');
    expect(result.direction).toBe('up');
    expect(changedAt(result)).toEqual([3]);
    expect(result.digits[3]).toEqual({ from: '0', to: '1', changed: true });
  });

  it('carries across padded digits on an increment', () => {
    const result = diffDigits('0009', '0010');
    expect(result.direction).toBe('up');
    expect(changedAt(result)).toEqual([2, 3]);
    expect(result.digits[2]).toEqual({ from: '0', to: '1', changed: true });
    expect(result.digits[3]).toEqual({ from: '9', to: '0', changed: true });
  });

  it('borrows across padded digits on a decrement', () => {
    const result = diffDigits('0010', '0009');
    expect(result.direction).toBe('down');
    expect(changedAt(result)).toEqual([2, 3]);
    expect(result.digits[2]).toEqual({ from: '1', to: '0', changed: true });
    expect(result.digits[3]).toEqual({ from: '0', to: '9', changed: true });
  });

  it('adds columns on the left when the number grows, keeping the unchanged digits still', () => {
    expect(diffDigits('9', '10').digits).toEqual([
      { from: '', to: '1', changed: true },
      { from: '9', to: '0', changed: true },
    ]);
    const result = diffDigits('45', '145');
    expect(result.direction).toBe('up');
    expect(changedAt(result)).toEqual([0]);
    expect(result.digits[1]).toEqual({ from: '4', to: '4', changed: false });
  });

  it('drops the leftmost columns when the number shrinks', () => {
    const result = diffDigits('100', '95');
    expect(result.direction).toBe('down');
    expect(result.digits).toEqual([
      { from: '0', to: '9', changed: true },
      { from: '0', to: '5', changed: true },
    ]);
  });

  it('reports no direction and no change for the same value', () => {
    const result = diffDigits('0142', '0142');
    expect(result.direction).toBe('none');
    expect(changedAt(result)).toEqual([]);
  });
});

describe('rollPlan', () => {
  it('rolls up on an increase: the old digit leaves at the top, the new one rises from below', () => {
    expect(rollPlan('4', '5', 'up')).toEqual({ top: '4', bottom: '5', start: 0, end: -50 });
  });

  it('rolls down on a decrease: the new digit drops in from above', () => {
    expect(rollPlan('5', '4', 'down')).toEqual({ top: '4', bottom: '5', start: -50, end: 0 });
  });

  it.each([
    ['up', '4', '5'],
    ['down', '5', '4'],
  ] as const)('%s starts on the old digit and rests on the new one', (direction, from, to) => {
    const plan = rollPlan(from, to, direction);
    const shown = (offset: number) => (offset === 0 ? plan.top : plan.bottom);
    expect(shown(plan.start)).toBe(from);
    expect(shown(plan.end)).toBe(to);
  });
});
