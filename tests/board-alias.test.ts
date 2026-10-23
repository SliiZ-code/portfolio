import { describe, expect, it } from 'vitest';
import { boardMedia, boardNote, findAlternateProject, overlayFor, overlayKeyFor } from '../src/data/board';
import { getResume, type Project, type Resume } from '../src/lib/resume';

const project = (name: string, slug: string): Project => ({
  id: slug,
  name,
  slug,
  period: '',
  description: '',
  website: { url: '', label: '' },
});

const withProjects = (lang: Resume['lang'], projects: Project[]): Resume => ({ ...getResume(lang), lang, projects });

describe('overlay aliases', () => {
  it('resolves the overlay through an alias slug', () => {
    const en = project('Game of Life', 'game-of-life');
    expect(overlayKeyFor(en)).toBe('jeu-de-la-vie');
    expect(overlayFor(en)?.emblem).toBe('pulsar');
    expect(boardNote(en, 'en')?.text).toBe('a pulsar. obviously.');
    expect(boardMedia(en)).toEqual({ video: '/media/conway.mp4' });
  });

  it('has no overlay for an unknown slug', () => {
    expect(overlayFor('nothing-here')).toBeUndefined();
  });
});

describe('findAlternateProject', () => {
  const frProjects = [project('Jeu de la vie', 'jeu-de-la-vie'), project('Blink', 'blink')];
  const fr = withProjects('fr', frProjects);

  it('finds the other-language project by overlay key', () => {
    const en = withProjects('en', [project('Blink', 'blink'), project('Game of Life', 'game-of-life')]);
    expect(findAlternateProject(frProjects[0], fr.projects, en)?.slug).toBe('game-of-life');
  });

  it('falls back to the same index when the lists have the same size', () => {
    const en = withProjects('en', [project('One', 'one'), project('Two', 'two')]);
    const mine = [project('Un', 'un'), project('Deux', 'deux')];
    expect(findAlternateProject(mine[1], mine, en)?.slug).toBe('two');
  });

  it('returns undefined when nothing matches', () => {
    const en = withProjects('en', [project('One', 'one')]);
    const mine = [project('Un', 'un'), project('Deux', 'deux')];
    expect(findAlternateProject(mine[1], mine, en)).toBeUndefined();
  });
});
