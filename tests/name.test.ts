import { describe, expect, it } from 'vitest';
import { boardName } from '../src/lib/name';

describe('boardName', () => {
  it('puts the first name on its own line', () => {
    expect(boardName('Julien Petit-Colboc').l).toBe('Julien\nPetit-Colboc');
    expect(boardName('Julien').l).toBe('Julien');
  });

  it('breaks the narrow version once after each hyphen', () => {
    expect(boardName('Julien Petit-Colboc').p).toBe('Julien\nPetit-\nColboc');
  });

  it('breaks once per hyphen run, never leaving an empty or lone-hyphen line', () => {
    const { l, p } = boardName('Julien Petit--Colboc');
    expect(l).toBe('Julien\nPetit--Colboc');
    expect(p).toBe('Julien\nPetit--\nColboc');
    expect(p.split('\n').every((line) => line.replace(/-/g, '').length > 0)).toBe(true);
  });

  it('does not break after a trailing or leading hyphen', () => {
    expect(boardName('Julien Petit-').p).toBe('Julien\nPetit-');
    expect(boardName('Julien -Colboc').p).toBe('Julien\n-Colboc');
  });
});
