import { describe, expect, it } from 'vitest';
import {
  MAX_ALIGN,
  MAX_STAGGER_MS,
  STAGGER_MS,
  alignChars,
  isMorphable,
  isPlainClick,
  langOfPath,
  morphTarget,
  staggerDelay,
  switchTarget,
} from '../src/scripts/language-morph';

const chars = (text: string) => Array.from(text);

/** The steps must cover every old character once (keep or exit) and every new one once (keep or enter), in order. */
const checkCoverage = (from: string, to: string, steps: ReturnType<typeof alignChars>) => {
  expect(steps).not.toBeNull();
  const oldSeen: number[] = [];
  const newSeen: number[] = [];
  let lastFrom = -1;
  let lastTo = -1;
  for (const step of steps!) {
    if (step.kind === 'keep') {
      expect(chars(from)[step.from]).toBe(chars(to)[step.to]);
      oldSeen.push(step.from);
      newSeen.push(step.to);
      expect(step.from).toBeGreaterThan(lastFrom);
      expect(step.to).toBeGreaterThan(lastTo);
      lastFrom = step.from;
      lastTo = step.to;
    } else if (step.kind === 'exit') {
      oldSeen.push(step.from);
      expect(step.from).toBeGreaterThan(lastFrom);
      lastFrom = step.from;
    } else {
      newSeen.push(step.to);
      expect(step.to).toBeGreaterThan(lastTo);
      lastTo = step.to;
    }
  }
  expect(oldSeen.sort((a, b) => a - b)).toEqual(chars(from).map((_, i) => i));
  expect(newSeen.sort((a, b) => a - b)).toEqual(chars(to).map((_, i) => i));
};

describe('alignChars', () => {
  it('keeps every character of identical text', () => {
    const steps = alignChars(chars('Projets'), chars('Projets'));
    expect(steps).toEqual(chars('Projets').map((_, i) => ({ kind: 'keep', from: i, to: i })));
  });

  it('exits everything and enters everything when no character is shared', () => {
    const steps = alignChars(chars('abc'), chars('xyz'));
    checkCoverage('abc', 'xyz', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(0);
    expect(steps!.filter((s) => s.kind === 'exit')).toHaveLength(3);
    expect(steps!.filter((s) => s.kind === 'enter')).toHaveLength(3);
  });

  it('keeps the shared characters and turns only the changed ones into exits and enters', () => {
    const steps = alignChars(chars('abc'), chars('abd'));
    checkCoverage('abc', 'abd', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(2);
    expect(steps).toContainEqual({ kind: 'exit', from: 2 });
    expect(steps).toContainEqual({ kind: 'enter', to: 2 });
  });

  it('slides shared letters across an insertion instead of dropping them', () => {
    // "Expérience" → "Experience": the accent is removed, the rest slides into place
    const from = 'Expérience';
    const to = 'Experience';
    const steps = alignChars(chars(from), chars(to));
    checkCoverage(from, to, steps);
    const kept = steps!.filter((s) => s.kind === 'keep').length;
    expect(kept).toBe(9);
  });

  it('covers a realistic pair of sentences in order', () => {
    const from = 'Ingénieur logiciel, depuis 2019.';
    const to = 'Software engineer, since 2019.';
    checkCoverage(from, to, alignChars(chars(from), chars(to)));
  });

  it('handles empty strings on either side', () => {
    checkCoverage('', 'ab', alignChars([], chars('ab')));
    checkCoverage('ab', '', alignChars(chars('ab'), []));
  });

  it('counts code points, so an accented or emoji character is one step', () => {
    const steps = alignChars(chars('é😀'), chars('é'));
    checkCoverage('é😀', 'é', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(1);
  });

  it('gives up (null) past MAX_ALIGN characters, so a long block is swapped instantly', () => {
    const long = 'a'.repeat(MAX_ALIGN + 1);
    expect(alignChars(chars(long), chars('a'))).toBeNull();
    expect(alignChars(chars('a'), chars(long))).toBeNull();
  });
});

describe('staggerDelay', () => {
  it('starts the first character at once and steps by STAGGER_MS', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(STAGGER_MS);
    expect(staggerDelay(5)).toBe(5 * STAGGER_MS);
  });

  it('caps the stagger, so a long line still lands within the morph', () => {
    expect(staggerDelay(10_000)).toBe(MAX_STAGGER_MS);
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const d = staggerDelay(i);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('langOfPath and switchTarget', () => {
  it('reads the language of the two home pages, and of nothing else', () => {
    expect(langOfPath('/')).toBe('fr');
    expect(langOfPath('/en/')).toBe('en');
    expect(langOfPath('/en')).toBe('en');
    expect(langOfPath('/cv/')).toBeNull();
    expect(langOfPath('/en/cv/')).toBeNull();
    expect(langOfPath('/projets/x/')).toBeNull();
  });

  it('switches between / and /en/ only on the home pages', () => {
    expect(switchTarget('/')).toBe('/en/');
    expect(switchTarget('/en/')).toBe('/');
    expect(switchTarget('/cv/')).toBeNull();
    expect(switchTarget('/en/cv/')).toBeNull();
  });
});

describe('isPlainClick', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('accepts a plain primary click only', () => {
    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false); // middle click: a new tab
    expect(isPlainClick({ ...plain, button: 2 })).toBe(false);
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
  });
});

describe('morphTarget', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('returns the other home page for a plain click on its flag', () => {
    expect(morphTarget('/', 'https://example.test/en/', plain, false)).toBe('/en/');
    expect(morphTarget('/en/', 'https://example.test/', plain, false)).toBe('/');
  });

  it('declines under reduced motion, for modifier or middle clicks, and off the home pages', () => {
    expect(morphTarget('/', 'https://example.test/en/', plain, true)).toBeNull();
    expect(morphTarget('/', 'https://example.test/en/', { ...plain, metaKey: true }, false)).toBeNull();
    expect(morphTarget('/', 'https://example.test/en/', { ...plain, button: 1 }, false)).toBeNull();
    expect(morphTarget('/cv/', 'https://example.test/en/cv/', plain, false)).toBeNull();
  });

  it('declines a link that is not the other home page', () => {
    expect(morphTarget('/', 'https://example.test/en/cv/', plain, false)).toBeNull();
    expect(morphTarget('/', 'https://example.test/', plain, false)).toBeNull();
  });
});

describe('isMorphable', () => {
  it('morphs a block whose text changed and is short enough to align', () => {
    expect(isMorphable('Projets', 'Projects')).toBe(true);
  });

  it('leaves an unchanged, empty or very long block to an instant swap', () => {
    expect(isMorphable('Projets', 'Projets')).toBe(false);
    expect(isMorphable('', 'Projects')).toBe(false);
    expect(isMorphable('Projets', '')).toBe(false);
    expect(isMorphable('a'.repeat(MAX_ALIGN + 1), 'b')).toBe(false);
  });
});
