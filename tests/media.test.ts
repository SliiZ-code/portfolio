import { describe, expect, it } from 'vitest';
import { boardMedia } from '../src/data/board';
import { findMedia } from '../src/lib/media';
import type { Project } from '../src/lib/resume';

const project = (name: string, slug: string): Project => ({
  id: slug,
  name,
  slug,
  period: '',
  description: '',
  website: { url: '', label: '' },
});

const having = (...files: string[]) => (file: string) => files.includes(file);

describe('findMedia', () => {
  it('finds a video by slug', () => {
    expect(findMedia(['my-app'], having('my-app.mp4'))).toEqual({ video: '/media/my-app.mp4' });
  });

  it('accepts webm and every image extension', () => {
    expect(findMedia(['a'], having('a.webm'))).toEqual({ video: '/media/a.webm' });
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      expect(findMedia(['a'], having(`a.${ext}`))).toEqual({ image: `/media/a.${ext}` });
    }
  });

  it('adds the WebP twin of an image when there is one', () => {
    expect(findMedia(['a'], having('a.jpg', 'a.webp'))).toEqual({ image: '/media/a.jpg', webp: '/media/a.webp' });
    expect(findMedia(['a'], having('a.jpg'))).toEqual({ image: '/media/a.jpg' });
    expect(findMedia(['a'], having('a.webp'))).toEqual({ image: '/media/a.webp' });
  });

  it('lets a video win over an image of the same name', () => {
    expect(findMedia(['a'], having('a.jpg', 'a.mp4'))).toEqual({ video: '/media/a.mp4' });
  });

  it('tries the slugs in order', () => {
    expect(findMedia(['own', 'key', 'alt'], having('alt.png', 'key.jpg'))).toEqual({ image: '/media/key.jpg' });
    expect(findMedia(['own', 'key', 'alt'], having('alt.png', 'own.webp'))).toEqual({ image: '/media/own.webp' });
  });

  it('returns nothing when no file exists', () => {
    expect(findMedia(['a', 'b'], having())).toBeUndefined();
  });
});

describe('boardMedia', () => {
  it('lets an explicit overlay media win over files', () => {
    const exists = having('thrive.mp4');
    expect(boardMedia(project('Thrive', 'thrive'), undefined, exists)).toEqual({ image: '/media/thrive.jpg', webp: '/media/thrive.webp' });
  });

  it('uses the own slug, then the overlay key, then the alternate project slug', () => {
    const en = project('Weather', 'weather-watcher');
    expect(boardMedia(en, undefined, having('weather-watcher.jpg'))).toEqual({ image: '/media/weather-watcher.jpg' });
    expect(boardMedia(project('Game of Life', 'game-of-life'), undefined, having())).toEqual({ video: '/media/conway.mp4' });
    const frAlt = project('Mon app', 'mon-app');
    expect(boardMedia(project('My app', 'my-app'), frAlt, having('mon-app.png'))).toEqual({ image: '/media/mon-app.png' });
    expect(boardMedia(project('My app', 'my-app'), frAlt, having('mon-app.png', 'my-app.webm'))).toEqual({ video: '/media/my-app.webm' });
  });

  it('finds the alternate project file even when this slug has none', () => {
    const p = project('Worldwide Weather Watcher', 'www-alias');
    expect(boardMedia(p, project('Worldwide Weather Watcher', 'worldwide-weather-watcher'), having('worldwide-weather-watcher.mp4'))).toEqual({
      video: '/media/worldwide-weather-watcher.mp4',
    });
  });

  it('is undefined for a project with no media at all', () => {
    expect(boardMedia(project('Nothing', 'nothing'), undefined, having())).toBeUndefined();
  });
});
