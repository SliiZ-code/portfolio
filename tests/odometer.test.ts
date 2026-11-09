import { describe, expect, it } from 'vitest';
import { diffDigits } from '../src/scripts/board/odometer';

describe('odometer diffDigits helper', () => {
  describe('padding', () => {
    it('handles increment on padded 4-digit numbers', () => {
      const result = diffDigits('0000', '0001');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([3]);
      expect(result.digits[3]).toEqual({
        index: 3,
        from: '0',
        to: '1',
        changed: true,
      });
      expect(result.digits[0].changed).toBe(false);
      expect(result.digits[1].changed).toBe(false);
      expect(result.digits[2].changed).toBe(false);
    });

    it('handles carry across multiple padded digits', () => {
      const result = diffDigits('0009', '0010');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([2, 3]);
      expect(result.digits[2]).toEqual({ index: 2, from: '0', to: '1', changed: true });
      expect(result.digits[3]).toEqual({ index: 3, from: '9', to: '0', changed: true });
    });

    it('handles decrement with borrow across padded digits', () => {
      const result = diffDigits('0010', '0009');
      expect(result.direction).toBe('down');
      expect(result.changed).toEqual([2, 3]);
      expect(result.digits[2]).toEqual({ index: 2, from: '1', to: '0', changed: true });
      expect(result.digits[3]).toEqual({ index: 3, from: '0', to: '9', changed: true });
    });
  });

  describe('growing digit count', () => {
    it('handles transition from 1 to 2 digits', () => {
      const result = diffDigits('9', '10');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([0, 1]);
      expect(result.digits).toEqual([
        { index: 0, from: '', to: '1', changed: true },
        { index: 1, from: '9', to: '0', changed: true },
      ]);
    });

    it('handles transition from 2 to 3 digits (e.g. 99 to 100)', () => {
      const result = diffDigits('99', '100');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([0, 1, 2]);
      expect(result.digits).toEqual([
        { index: 0, from: '', to: '1', changed: true },
        { index: 1, from: '9', to: '0', changed: true },
        { index: 2, from: '9', to: '0', changed: true },
      ]);
    });

    it('handles adding higher order digit with unchanged lower digits', () => {
      const result = diffDigits('45', '145');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([0]);
      expect(result.digits[0]).toEqual({ index: 0, from: '', to: '1', changed: true });
      expect(result.digits[1]).toEqual({ index: 1, from: '4', to: '4', changed: false });
      expect(result.digits[2]).toEqual({ index: 2, from: '5', to: '5', changed: false });
    });

    it('handles shrinking digit count (e.g. 100 to 95)', () => {
      const result = diffDigits('100', '95');
      expect(result.direction).toBe('down');
      expect(result.changed).toEqual([0, 1]);
      expect(result.digits).toEqual([
        { index: 0, from: '0', to: '9', changed: true },
        { index: 1, from: '0', to: '5', changed: true },
      ]);
    });
  });

  describe('direction up/down', () => {
    it('detects single digit increase as up', () => {
      const result = diffDigits('120', '125');
      expect(result.direction).toBe('up');
      expect(result.changed).toEqual([2]);
      expect(result.digits[2]).toEqual({ index: 2, from: '0', to: '5', changed: true });
    });

    it('detects single digit decrease as down', () => {
      const result = diffDigits('125', '120');
      expect(result.direction).toBe('down');
      expect(result.changed).toEqual([2]);
      expect(result.digits[2]).toEqual({ index: 2, from: '5', to: '0', changed: true });
    });

    it('detects multi-digit decrease as down', () => {
      const result = diffDigits('500', '499');
      expect(result.direction).toBe('down');
      expect(result.changed).toEqual([0, 1, 2]);
    });
  });

  describe('no change', () => {
    it('returns empty changed array and direction none when identical', () => {
      const result = diffDigits('0000', '0000');
      expect(result.direction).toBe('none');
      expect(result.changed).toEqual([]);
      expect(result.digits.every((d) => !d.changed)).toBe(true);
    });

    it('returns empty changed array for multi-digit identical values', () => {
      const result = diffDigits('142', '142');
      expect(result.direction).toBe('none');
      expect(result.changed).toEqual([]);
    });
  });
});
