import { describe, expect, it } from 'vitest';
import {
  BOARD_OVERLAY,
  getBoardProjects,
  overlayFor,
  projectMeta,
  seedFor,
} from '../src/data/board';
import { slugify, type Project, type Resume } from '../src/lib/resume';
import { sampleResume } from './fixtures';
import { cellSizeFor, gridFor, namePlacement, orientationFor, type Box } from '../src/scripts/board/layout';
import { METHUSELAHS } from '../src/scripts/board/patterns';

const extra = (name: string, index = 0): Project => ({
  id: `extra-${index}`,
  name,
  slug: `extra-${index}`,
  period: '[placeholder] 2026',
  description: '<p>Extra</p>',
  website: { url: '', label: '' },
});

const withProjects = (resume: Resume, projects: Project[]): Resume => ({ ...resume, projects });

describe('known project overlay', () => {
  const projects = getBoardProjects(sampleResume('fr'));
  const bySlug = Object.fromEntries(projects.map((project) => [project.slug, project]));

  it('gives each known project its methuselah', () => {
    expect(bySlug['jeu-de-la-vie'].seed).toBe('r-pentomino');
    expect(bySlug.thrive.seed).toBe('acorn');
    expect(bySlug['worldwide-weather-watcher'].seed).toBe('pi-heptomino');
    expect(bySlug.blink.seed).toBe('diehard');
  });

  it('no longer places projects on the board: no pattern, no padding, no position', () => {
    for (const project of projects) {
      expect(project).not.toHaveProperty('pattern');
      expect(project).not.toHaveProperty('pad');
      expect(project).not.toHaveProperty('at');
    }
    for (const overlay of Object.values(BOARD_OVERLAY)) {
      expect(overlay).not.toHaveProperty('pattern');
      expect(overlay).not.toHaveProperty('pad');
      expect(overlay).not.toHaveProperty('at');
    }
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
    expect(bySlug.blink.note?.text).toContain('diehard');
  });

  it('describes the seed in the page notes, in both languages', () => {
    const notes = (lang: 'fr' | 'en') => Object.fromEntries(Object.entries(BOARD_OVERLAY).map(([key, overlay]) => [key, overlay.note?.[lang]]));
    expect(notes('fr')).toEqual({
      'jeu-de-la-vie': 'le R-pentomino : cinq cellules,\n1103 générations de chaos',
      thrive: 'un gland : sept cellules\nqui poussent 5206 générations',
      'worldwide-weather-watcher': "un pi-heptomino :\nil s'agite, puis il se pose",
      blink: 'un diehard : il disparaît\naprès 130 générations',
      'larduino-en-pixels': "un B-heptomino :\nil fait naître des planeurs",
    });
    expect(notes('en')).toEqual({
      'jeu-de-la-vie': 'the R-pentomino: five cells,\n1103 generations of chaos',
      thrive: 'an acorn: seven cells\nthat grow for 5206 generations',
      'worldwide-weather-watcher': 'a pi-heptomino:\nit stirs, then it settles',
      blink: 'a diehard: gone\nafter 130 generations',
      'larduino-en-pixels': 'a B-heptomino:\nit gives birth to gliders',
    });
  });

  it('ignores overlay entries that are not in the resume', () => {
    const only = getBoardProjects(withProjects(sampleResume('fr'), [sampleResume('fr').projects[0]]));
    expect(only).toHaveLength(1);
  });
});

describe('project meta line', () => {
  const base = sampleResume('fr');
  const dated = (period: string) => withProjects(base, base.projects.map((project) => ({ ...project, period })));

  it('joins the overlay tag and the period from RxResume', () => {
    const projects = getBoardProjects(dated('2024'));
    expect(projects.find((project) => project.slug === 'jeu-de-la-vie')?.meta).toBe('C++ · 2024');
    expect(projects.find((project) => project.slug === 'blink')?.meta).toBe('Python · 2024');
    expect(projectMeta(dated('2024').projects[0])).toBe('C++ · 2024');
  });

  it('skips the parts that are empty', () => {
    expect(getBoardProjects(dated('')).find((project) => project.slug === 'thrive')?.meta).toBe('Flutter');
    const unlisted = withProjects(base, [{ ...extra('Unlisted'), period: '2023' }, extra('Bare', 1)]);
    expect(getBoardProjects(unlisted).map((project) => project.meta)).toEqual(['2023', '[placeholder] 2026']);
    expect(projectMeta({ ...extra('Bare'), period: '' })).toBe('');
  });

  it('has no hand-written label left in the overlay', () => {
    for (const overlay of Object.values(BOARD_OVERLAY)) expect(overlay).not.toHaveProperty('label');
  });
});

describe('projects outside the overlay', () => {
  const base = sampleResume('fr');
  const projects = getBoardProjects(withProjects(base, [...base.projects, extra('Unlisted Project')]));
  const auto = projects.find((project) => project.slug === 'extra-0')!;

  it('keep their place in the list', () => {
    expect(projects).toHaveLength(5);
    expect(auto.displayName).toBe('Unlisted Project');
    expect(auto.boardName).toBe('Unlisted Project');
  });

  it('get a deterministic methuselah and no tag', () => {
    expect(METHUSELAHS).toContain(auto.seed);
    expect(auto.tag).toBe('');
    expect(auto.note).toBeUndefined();
    const again = getBoardProjects(withProjects(base, [...base.projects, extra('Unlisted Project')])).find((p) => p.slug === 'extra-0')!;
    expect(again.seed).toBe(auto.seed);
  });

  it('pick the methuselah from the slug, spreading projects over all of them', () => {
    const seeds = new Set<string>();
    for (let n = 0; n < 40; n++) seeds.add(seedFor({ ...extra('Project', n), slug: `project-${n}` }));
    expect(seeds.size).toBe(METHUSELAHS.length);
  });

  it('let the overlay name a seed that beats the slug', () => {
    const arduino = { ...extra('L’Arduino'), slug: 'larduino-en-pixels' };
    expect(seedFor(arduino)).toBe('b-heptomino');
  });
});

describe('overlay aliases', () => {
  it('resolves the overlay of the French project through the English slug', () => {
    const en = sampleResume('en');
    const projects = getBoardProjects(withProjects(en, [{ ...en.projects[0], name: 'Game of Life', slug: 'game-of-life' }]));
    const conway = projects.find((project) => project.slug === 'game-of-life')!;
    expect(conway).toBeDefined();
    expect(conway.seed).toBe('r-pentomino');
    expect(conway.tag).toBe('C++');
  });
});

describe('the Arduino experiment', () => {
  const arduino = (lang: 'fr' | 'en'): Project => {
    const name = lang === 'fr' ? "L'Arduino en pixels" : 'The Arduino in pixels';
    return { ...extra(name), slug: slugify(name) };
  };

  it('resolves its overlay through the French and the English slug', () => {
    for (const lang of ['fr', 'en'] as const) {
      expect(overlayFor(arduino(lang))).toMatchObject({
        seed: 'b-heptomino',
        tag: 'three.js',
        experiment: { kind: 'pixel-model', src: '/media/arduino.glb' },
      });
    }
    expect(slugify("L'Arduino en pixels")).toBe('larduino-en-pixels');
    expect(slugify('The Arduino in pixels')).toBe('the-arduino-in-pixels');
  });

  it('shows up on the board once RxResume has the project, and not before', () => {
    const base = sampleResume('fr');
    expect(getBoardProjects(base).map((project) => project.slug)).not.toContain('larduino-en-pixels');
    const project = getBoardProjects(withProjects(base, [...base.projects, arduino('fr')])).find((entry) => entry.slug === 'larduino-en-pixels')!;
    expect(project).toMatchObject({ seed: 'b-heptomino', tag: 'three.js' });
    expect(project.note?.text.length).toBeGreaterThan(0);
  });

  it('is the only overlay entry with an experiment', () => {
    const withExperiment = Object.keys(BOARD_OVERLAY).filter((key) => BOARD_OVERLAY[key].experiment);
    expect(withExperiment).toEqual(['larduino-en-pixels']);
  });
});

describe('name placement across screens', () => {
  it('keeps the name around half the width and inside the grid, in both orientations', () => {
    // the fine name raster: "Julien / Petit-Colboc" is 150 × 41 cells, "Julien / Petit- / Colboc" 82 × 63
    const screens: [number, number][] = [[1440, 900], [1920, 1080], [1280, 720], [1024, 768], [390, 844], [768, 1024], [360, 740], [360, 640]];
    for (const [vw, vh] of screens) {
      const orientation = orientationFor(vw, vh);
      const name = orientation === 'p' ? { cols: 82, rows: 63 } : { cols: 150, rows: 41 };
      const cell = cellSizeFor(name, vw, vh, orientation);
      const ratio = (name.cols * cell) / vw;
      expect(ratio, `name width @ ${vw}x${vh}`).toBeGreaterThanOrEqual(orientation === 'p' ? 0.4 : 0.34);
      expect(ratio, `name width @ ${vw}x${vh}`).toBeLessThanOrEqual(orientation === 'p' ? 0.72 : 0.45);
      const grid = gridFor(vw, vh, cell);
      const place = namePlacement(grid, name, orientation);
      const box: Box = { x: place.x, y: place.y, x2: place.x + place.w, y2: place.y + place.h };
      expect(box.x, `name @ ${vw}x${vh}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `name @ ${vw}x${vh}`).toBeGreaterThanOrEqual(0);
      expect(box.x2, `name @ ${vw}x${vh}`).toBeLessThanOrEqual(grid.cols);
      expect(box.y2, `name @ ${vw}x${vh}`).toBeLessThanOrEqual(grid.rows);
    }
  });
});
