import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initialTheme } from '../src/scripts/theme';

describe('initialTheme', () => {
  describe('automatic theme selection by hour', () => {
    it('returns night when hour is 19 or later', () => {
      expect(initialTheme(null, 19)).toBe('night');
      expect(initialTheme(null, 20)).toBe('night');
      expect(initialTheme(null, 23)).toBe('night');
    });

    it('returns night when hour is before 7', () => {
      expect(initialTheme(null, 0)).toBe('night');
      expect(initialTheme(null, 6)).toBe('night');
    });

    it('returns paper at 7:00', () => {
      expect(initialTheme(null, 7)).toBe('paper');
    });

    it('returns paper during daytime hours', () => {
      expect(initialTheme(null, 8)).toBe('paper');
      expect(initialTheme(null, 12)).toBe('paper');
      expect(initialTheme(null, 18)).toBe('paper');
    });
  });

  describe('stored preference override', () => {
    it('returns stored night value', () => {
      expect(initialTheme('night', 12)).toBe('night');
      expect(initialTheme('night', 3)).toBe('night');
    });

    it('returns stored paper value', () => {
      expect(initialTheme('paper', 20)).toBe('paper');
      expect(initialTheme('paper', 5)).toBe('paper');
    });

    it('ignores garbage stored values and uses automatic selection', () => {
      expect(initialTheme('invalid', 20)).toBe('night');
      expect(initialTheme('invalid', 12)).toBe('paper');
      expect(initialTheme('', 20)).toBe('night');
      expect(initialTheme('NIGHT', 12)).toBe('paper');
      expect(initialTheme('Paper', 3)).toBe('night');
    });
  });
});

describe('inline copy in Base.astro', () => {
  // the inline script can't import modules before first paint, so it carries its own copy
  const source = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  const block = source.match(/const initialTheme = [\s\S]*?\n\s*};/)?.[0];
  const inline = new Function(`${block}; return initialTheme;`)();

  it('decides exactly like src/scripts/theme.ts', () => {
    expect(block).toBeDefined();
    for (const stored of [null, 'night', 'paper', 'blue', ''])
      for (let hour = 0; hour < 24; hour++) expect(inline(stored, hour)).toBe(initialTheme(stored, hour));
  });
});
