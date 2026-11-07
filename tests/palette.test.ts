import { describe, expect, it } from 'vitest';
import { foldForSearch } from '../src/scripts/palette';

describe('foldForSearch', () => {
  it('drops accents and case, and squeezes spaces', () => {
    expect(foldForSearch('  Expériences\n Professionnelles ')).toBe('experiences professionnelles');
    expect(foldForSearch("Copier l'E-MAIL")).toBe("copier l'e-mail");
    expect(foldForSearch('À propos')).toBe('a propos');
  });
});
