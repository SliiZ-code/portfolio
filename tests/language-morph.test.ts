import { describe, expect, it } from 'vitest';
import {
  ENTER_AFTER_MS,
  EXIT_MS,
  FADE_IN_AFTER_MS,
  FADE_IN_MS,
  FADE_OUT_MS,
  MAX_ALIGN,
  MAX_STAGGER_MS,
  MOVE_MS,
  SHORT_TEXT_THRESHOLD,
  STAGGER_MS,
  alignChars,
  fadeTiming,
  glyphTiming,
  isMorphable,
  isPlainClick,
  langOfPath,
  morphStyle,
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
    const steps = alignChars(chars('éa😀'), chars('éa'));
    checkCoverage('éa😀', 'éa', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(2);
  });

  it('does not slide a lone shared character across the text: it leaves and arrives instead', () => {
    // "1" is shared by both texts but on its own: a coincidence, not a word that moved
    const steps = alignChars(chars('a1b'), chars('c1d'));
    checkCoverage('a1b', 'c1d', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(0);
    expect(steps!.filter((s) => s.kind === 'exit')).toHaveLength(3);
    expect(steps!.filter((s) => s.kind === 'enter')).toHaveLength(3);
  });

  it('keeps a run of two or more shared characters', () => {
    const steps = alignChars(chars('ab cd'), chars('ab cX'));
    checkCoverage('ab cd', 'ab cX', steps);
    expect(steps!.filter((s) => s.kind === 'keep')).toHaveLength(4);
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
  const here = 'https://example.test/';

  it('returns the other home page for a plain click on its flag', () => {
    expect(morphTarget(here, 'https://example.test/en/', plain, false)).toBe('/en/');
    expect(morphTarget('https://example.test/en/', 'https://example.test/', plain, false)).toBe('/');
  });

  it('declines under reduced motion, for modifier or middle clicks, and off the home pages', () => {
    expect(morphTarget(here, 'https://example.test/en/', plain, true)).toBeNull();
    expect(morphTarget(here, 'https://example.test/en/', { ...plain, metaKey: true }, false)).toBeNull();
    expect(morphTarget(here, 'https://example.test/en/', { ...plain, button: 1 }, false)).toBeNull();
    expect(morphTarget('https://example.test/cv/', 'https://example.test/en/cv/', plain, false)).toBeNull();
  });

  it('declines a link that is not the other home page', () => {
    expect(morphTarget(here, 'https://example.test/en/cv/', plain, false)).toBeNull();
    expect(morphTarget(here, 'https://example.test/', plain, false)).toBeNull();
  });

  it('never fetches another origin, even when its path is a home page', () => {
    // the fetched HTML is injected into this page: only same-origin pages may be read
    expect(morphTarget(here, 'https://evil.test/en/', plain, false)).toBeNull();
    expect(morphTarget(here, 'http://example.test/en/', plain, false)).toBeNull();
    expect(morphTarget(here, 'https://sub.example.test/en/', plain, false)).toBeNull();
  });

  it('resolves a relative flag link against the page it is on', () => {
    expect(morphTarget(here, '/en/', plain, false)).toBe('/en/');
  });
});

describe('glyphTiming', () => {
  it('slides a kept character for MOVE_MS after its stagger', () => {
    expect(glyphTiming('keep', 3)).toEqual({ delay: 3 * STAGGER_MS, duration: MOVE_MS });
  });

  it('fades a removed character out quickly, before the new ones arrive', () => {
    expect(glyphTiming('exit', 0)).toEqual({ delay: 0, duration: EXIT_MS });
    expect(EXIT_MS).toBeLessThan(MOVE_MS);
  });

  it('rolls a new character in only after ENTER_AFTER_MS, so the old and new text do not pile up', () => {
    expect(glyphTiming('enter', 0)).toEqual({ delay: ENTER_AFTER_MS, duration: MOVE_MS });
    expect(glyphTiming('enter', 2).delay).toBe(ENTER_AFTER_MS + 2 * STAGGER_MS);
  });

  it('lands every step within the 500–700 ms the morph is meant to take, however long the text', () => {
    const kinds = ['keep', 'exit', 'enter'] as const;
    let latest = 0;
    for (const kind of kinds) {
      for (let index = 0; index < 1000; index++) {
        const { delay, duration } = glyphTiming(kind, index);
        latest = Math.max(latest, delay + duration);
      }
    }
    expect(latest).toBeGreaterThanOrEqual(500);
    expect(latest).toBeLessThanOrEqual(700);
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

describe('morphStyle', () => {
  it('chooses letters for short, single-line text pairs like nav items and labels', () => {
    expect(morphStyle('Projets', 'Projects')).toBe('letters');
    expect(morphStyle('À propos', 'About')).toBe('letters');
    expect(morphStyle('2026 — aujourd’hui', '2026 — present')).toBe('letters');
  });

  it('keeps letter morph for the hero name note (≤ 60 chars)', () => {
    const frNote = 'Élève ingénieur en informatique – IA, VR et robotique';
    const enNote = 'Computer Science Engineering Student – AI, VR & Robotics';
    expect(Array.from(frNote).length).toBeLessThanOrEqual(SHORT_TEXT_THRESHOLD);
    expect(Array.from(enNote).length).toBeLessThanOrEqual(SHORT_TEXT_THRESHOLD);
    expect(morphStyle(frNote, enNote)).toBe('letters');
  });

  it('chooses letters at exactly SHORT_TEXT_THRESHOLD characters on both sides', () => {
    const textA = 'a'.repeat(SHORT_TEXT_THRESHOLD);
    const textB = 'b'.repeat(SHORT_TEXT_THRESHOLD);
    expect(morphStyle(textA, textB)).toBe('letters');
  });

  it('chooses fade when either side exceeds the short-text threshold', () => {
    const normal = 'Projets';
    const long = 'a'.repeat(SHORT_TEXT_THRESHOLD + 1);
    expect(morphStyle(normal, long)).toBe('fade');
    expect(morphStyle(long, normal)).toBe('fade');
  });

  it('chooses fade for long paragraphs such as the bio summary', () => {
    const bioFr =
      "Élève ingénieur en 4e année d'informatique (alternance) à CESI, apprenti chez CAPFI depuis janvier 2026. Développeur principal de Cerebro...";
    const bioEn =
      'Computer science engineering student in 4th year at CESI, apprentice at CAPFI since January 2026. Lead developer of Cerebro...';
    expect(morphStyle(bioFr, bioEn)).toBe('fade');
  });

  it('chooses fade when text contains newlines even if short', () => {
    expect(morphStyle('Ligne 1\nLigne 2', 'Line 1\nLine 2')).toBe('fade');
    expect(morphStyle('Court', 'Short\nbreak')).toBe('fade');
  });

  it('trims outer whitespace before checking length and newlines', () => {
    expect(morphStyle('\n  Projets  \n', '  Projects  ')).toBe('letters');
  });
});

describe('fadeTiming', () => {
  it('fades out the old text over ~180 ms starting immediately', () => {
    const timing = fadeTiming();
    expect(timing.out.delay).toBe(0);
    expect(timing.out.duration).toBe(FADE_OUT_MS);
    expect(timing.out.duration).toBe(180);
  });

  it('fades in the new text over ~280 ms starting at ~120 ms', () => {
    const timing = fadeTiming();
    expect(timing.in.delay).toBe(FADE_IN_AFTER_MS);
    expect(timing.in.delay).toBe(120);
    expect(timing.in.duration).toBe(FADE_IN_MS);
    expect(timing.in.duration).toBe(280);
  });

  it('limits the overlap between visible old and new texts to at most 100 ms', () => {
    const { out, in: entering } = fadeTiming();
    const outEnd = out.delay + out.duration;
    const inStart = entering.delay;
    const overlap = Math.max(0, outEnd - inStart);
    expect(overlap).toBeLessThanOrEqual(100);
    expect(overlap).toBe(60);
  });

  it('completes the crossfade well within the ~660 ms morph budget', () => {
    const { in: entering } = fadeTiming();
    const totalDuration = entering.delay + entering.duration;
    expect(totalDuration).toBeLessThanOrEqual(660);
    expect(totalDuration).toBe(400);
  });
});
