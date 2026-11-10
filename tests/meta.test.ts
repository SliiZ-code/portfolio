import { describe, expect, it } from 'vitest';
import fr from '../src/i18n/fr';
import en from '../src/i18n/en';
import { strings } from '../src/i18n';

describe('item 2: dedicated short board meta description', () => {
  it('provides a dedicated short description between 120 and 160 chars in French and English', () => {
    const frDesc = strings('fr').board.description;
    const enDesc = strings('en').board.description;

    expect(typeof frDesc).toBe('string');
    expect(typeof enDesc).toBe('string');

    expect(frDesc.length).toBeGreaterThanOrEqual(120);
    expect(frDesc.length).toBeLessThanOrEqual(160);

    expect(enDesc.length).toBeGreaterThanOrEqual(120);
    expect(enDesc.length).toBeLessThanOrEqual(160);
  });
});

describe('item 3: board title', () => {
  it('formats the board tab title with engineer role per language', () => {
    expect(fr.board.title('Julien Petit--Colboc')).toBe('Julien Petit--Colboc — Ingénieur IA, VR & robotique');
    expect(en.board.title('Julien Petit--Colboc')).toBe('Julien Petit--Colboc — AI, VR & robotics engineer');
  });
});
