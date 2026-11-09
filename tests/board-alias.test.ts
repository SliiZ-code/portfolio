import { describe, expect, it } from 'vitest';
import { boardMedia, boardNote, overlayFor, overlayKeyFor } from '../src/data/board';
import type { Project } from '../src/lib/resume';

const project = (name: string, slug: string): Project => ({
  id: slug,
  name,
  slug,
  period: '',
  description: '',
  website: { url: '', label: '' },
});


describe('overlay aliases', () => {
  it('resolves the overlay through an alias slug', () => {
    const en = project('Game of Life', 'game-of-life');
    expect(overlayKeyFor(en)).toBe('jeu-de-la-vie');
    expect(overlayFor(en)?.seed).toBe('r-pentomino');
    expect(boardNote(en, 'en')?.text).toBe('the R-pentomino: five cells,\n1103 generations of chaos');
    expect(boardMedia(en)).toEqual({ video: '/media/conway.mp4' });
  });

  it('has no overlay for an unknown slug', () => {
    expect(overlayFor('nothing-here')).toBeUndefined();
  });
});

