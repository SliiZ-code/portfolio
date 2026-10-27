import { describe, expect, it } from 'vitest';
import {
  BOARD_OVERLAY,
  BOARD_PAGES,
  CONTACT_LAYOUT,
  CV_LAYOUT,
  getBoardEntities,
  getBoardPages,
  getBoardProjects,
  pagePath,
  projectPath,
} from '../src/data/board';
import { strings } from '../src/i18n';
import { getResume, type Project, type Resume } from '../src/lib/resume';
import { anchorFor, coreBox, footprint, gridFor, namePlacement, orientationFor, cellSizeFor, type Box } from '../src/scripts/board/layout';
import { OSCILLATORS, PATTERNS } from '../src/scripts/board/patterns';

const extra = (name: string, index = 0): Project => ({
  id: `extra-${index}`,
  name,
  slug: `extra-${index}`,
  period: '[placeholder] 2026',
  description: '<p>Extra</p>',
  website: { url: '', label: '' },
});

const withProjects = (resume: Resume, projects: Project[]): Resume => ({ ...resume, projects });
const overlap = (a: Box, b: Box) => a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;

describe('known project overlay', () => {
  const projects = getBoardProjects(getResume('fr'));
  const bySlug = Object.fromEntries(projects.map((project) => [project.slug, project]));

  it('places the four known projects exactly like the prototype', () => {
    expect(bySlug['jeu-de-la-vie']).toMatchObject({ pattern: 'pulsar', pad: 3, at: { l: [0.14, 0.66], p: [0.26, 0.57] } });
    expect(bySlug.thrive).toMatchObject({ pattern: 'penta', pad: 4, at: { l: [0.38, 0.71], p: [0.74, 0.68] } });
    expect(bySlug['worldwide-weather-watcher']).toMatchObject({ pattern: 'galaxy', pad: 2, at: { l: [0.62, 0.68], p: [0.26, 0.79] } });
    expect(bySlug.blink).toMatchObject({ pattern: 'blinkers', pad: 2, at: { l: [0.84, 0.12], p: [0.74, 0.15] } });
  });

  it('keeps the board names short and the resume names whole', () => {
    expect(bySlug['worldwide-weather-watcher'].boardName).toBe('Weather Watcher');
    expect(bySlug['worldwide-weather-watcher'].displayName).toBe('Worldwide Weather Watcher');
    expect(bySlug['jeu-de-la-vie'].boardName).toBe('Jeu de la vie');
  });

  it('shows only the language under each name', () => {
    expect(bySlug['jeu-de-la-vie'].tag).toBe('C++');
    expect(bySlug.thrive.tag).toBe('Flutter');
    expect(bySlug['worldwide-weather-watcher'].tag).toBe('Arduino');
    expect(bySlug.blink.tag).toBe('Python');
  });

  it('keeps the media and the page notes', () => {
    expect(bySlug['jeu-de-la-vie'].media).toEqual({ video: '/media/conway.mp4' });
    expect(bySlug.thrive.media).toEqual({ image: '/media/thrive.jpg' });
    expect(bySlug.blink.note?.text).toContain('blinkers');
  });

  it('ignores overlay entries that are not in the resume', () => {
    const only = getBoardProjects(withProjects(getResume('fr'), [getResume('fr').projects[0]]));
    expect(only).toHaveLength(1);
  });
});

describe('projects outside the overlay', () => {
  const base = getResume('fr');
  const projects = getBoardProjects(withProjects(base, [...base.projects, extra('Unlisted Project')]));
  const auto = projects.find((project) => project.slug === 'extra-0')!;

  it('keep their place in the list, with no fixed position', () => {
    expect(projects).toHaveLength(5);
    expect(auto.at).toBeNull();
    expect(auto.displayName).toBe('Unlisted Project');
    expect(auto.boardName).toBe('Unlisted Project');
  });

  it('get a deterministic oscillator and no tag', () => {
    expect(OSCILLATORS).toContain(auto.pattern);
    expect(auto.tag).toBe('');
    expect(auto.note).toBeUndefined();
    const again = getBoardProjects(withProjects(base, [...base.projects, extra('Unlisted Project')])).find((p) => p.slug === 'extra-0')!;
    expect(again.pattern).toBe(auto.pattern);
  });
});

describe('overlay aliases', () => {
  it('resolves the overlay of the French project through the English slug', () => {
    const en = getResume('en');
    const projects = getBoardProjects(withProjects(en, [{ ...en.projects[0], name: 'Game of Life', slug: 'game-of-life' }]));
    const conway = projects.find((project) => project.slug === 'game-of-life')!;
    expect(conway).toBeDefined();
    expect(conway.pattern).toBe('pulsar');
    expect(conway.tag).toBe('C++');
    expect(conway.at).toEqual(BOARD_OVERLAY['jeu-de-la-vie'].at);
  });
});

describe('lab, story, CV and contact', () => {
  it('has a lab and a story page with their own patterns and screen positions', () => {
    expect(Object.keys(BOARD_PAGES).sort()).toEqual(['labo', 'story']);
    expect(BOARD_PAGES.labo).toMatchObject({ pattern: 'beacon', pad: 2, at: { l: [0.86, 0.7], p: [0.74, 0.84] } });
    expect(BOARD_PAGES.story).toMatchObject({ pattern: 'toad', pad: 2, at: { l: [0.58, 0.1], p: [0.26, 0.145] } });
  });

  it('builds localised pages with their own urls', () => {
    const fr = getBoardPages('fr');
    const en = getBoardPages('en');
    expect(fr.map((page) => page.url).sort()).toEqual(['/histoire/', '/labo/']);
    expect(en.map((page) => page.url).sort()).toEqual(['/en/lab/', '/en/story/']);
    expect(pagePath('labo', 'fr')).toBe('/labo/');
    expect(pagePath('story', 'en')).toBe('/en/story/');
    expect(en.find((page) => page.id === 'story')?.boardName).toBe('my story');
    for (const page of [...fr, ...en]) {
      expect(page.boardName.length).toBeGreaterThan(0);
      expect(page.label.length).toBeGreaterThan(0);
      expect(page.note.text.length).toBeGreaterThan(0);
    }
  });

  it('hangs the CV off the name in landscape and gives it a fixed slot in portrait', () => {
    expect(CV_LAYOUT).toMatchObject({ pattern: 'beehive', pad: 2, at: { l: 'name', p: [0.76, 0.55] } });
  });

  it('puts the gun at the top, with no padding', () => {
    expect(CONTACT_LAYOUT).toMatchObject({ pattern: 'gun', pad: 0, at: { l: [0.18, 0.05], p: [0.5, 0.025] } });
  });
});

describe('board entities', () => {
  it('lists every entity once, in French and in English', () => {
    for (const lang of ['fr', 'en'] as const) {
      const resume = getResume(lang);
      const entities = getBoardEntities(resume, { cvHref: lang === 'fr' ? '/cv/' : '/en/cv/', contactHref: 'mailto:x@y.z' });
      const t = strings(lang).board;
      const ids = entities.map((entity) => entity.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining(['labo', 'story', 'cv', 'contact', ...resume.projects.map((project) => project.slug)]));
      for (const entity of entities) {
        expect(entity.name.length, entity.id).toBeGreaterThan(0);
        expect(PATTERNS[entity.pattern], entity.id).toBeDefined();
      }
      expect(entities.find((entity) => entity.id === 'cv')).toMatchObject({ kind: 'cv', name: t.cvName, tag: '', url: lang === 'fr' ? '/cv/' : '/en/cv/' });
      expect(entities.find((entity) => entity.id === 'contact')).toMatchObject({ kind: 'contact', url: 'mailto:x@y.z' });
      expect(entities.find((entity) => entity.id === 'blink')).toMatchObject({ kind: 'project', url: projectPath(lang, 'blink') });
    }
  });

  it('puts the fixed entities before the ones that need a free slot', () => {
    const base = getResume('fr');
    const entities = getBoardEntities(withProjects(base, [extra('Alpha'), ...base.projects]), { cvHref: '/cv/', contactHref: '' });
    const firstFree = entities.findIndex((entity) => entity.at === null);
    expect(firstFree).toBeGreaterThan(0);
    expect(entities.slice(firstFree).every((entity) => entity.at === null)).toBe(true);
  });

  it('keeps a contact without address inert', () => {
    const entities = getBoardEntities(getResume('fr'), { cvHref: '/cv/', contactHref: '' });
    expect(entities.find((entity) => entity.id === 'contact')?.url).toBe('');
  });

  it('does not collide: structures never overlap and stay on screen, in both orientations', () => {
    const entities = getBoardEntities(getResume('fr'), { cvHref: '/cv/', contactHref: 'mailto:x@y.z' }).filter((entity) => entity.at);
    // name raster of "Julien / Petit-Colboc" is about 80 × 23 cells; check a spread of screens
    const screens: [number, number][] = [[1440, 900], [1920, 1080], [1280, 720], [1024, 768], [390, 844], [768, 1024], [360, 740]];
    for (const [vw, vh] of screens) {
      const orientation = orientationFor(vw, vh);
      const name = orientation === 'p' ? { cols: 38, rows: 33 } : { cols: 80, rows: 23 };
      const cell = cellSizeFor(name, vw, vh, orientation);
      const grid = gridFor(vw, vh, cell);
      const place = namePlacement(grid, name, orientation);
      const boxes = entities.map((entity) => {
        const dims = { w: PATTERNS[entity.pattern][0].length, h: PATTERNS[entity.pattern].length };
        const fp = footprint(dims, entity.pad, anchorFor(entity.at?.[orientation], grid, place), entity.pattern === 'gun');
        return { id: entity.id, box: coreBox(fp) };
      });
      const nameBox = { x: place.x, y: place.y, x2: place.x + place.w, y2: place.y + place.h };
      for (const { id, box } of boxes) {
        expect(box.x, `${id} @ ${vw}x${vh}`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${id} @ ${vw}x${vh}`).toBeGreaterThanOrEqual(0);
        expect(box.x2, `${id} @ ${vw}x${vh}`).toBeLessThanOrEqual(grid.cols);
        expect(box.y2, `${id} @ ${vw}x${vh}`).toBeLessThanOrEqual(grid.rows);
        expect(overlap(box, nameBox), `${id} / name @ ${vw}x${vh}`).toBe(false);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(overlap(boxes[i].box, boxes[j].box), `${boxes[i].id} / ${boxes[j].id} @ ${vw}x${vh}`).toBe(false);
    }
  });
});
