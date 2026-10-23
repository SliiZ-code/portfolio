import { describe, expect, it, vi } from 'vitest';
import { autoPlace, BOARD_OVERLAY, estimateBoxSize, getBoardProjects, WORLD } from '../src/data/board';
import { getResume, type Project, type Resume } from '../src/lib/resume';
import { OSCILLATORS } from '../src/scripts/board/patterns';

interface Box {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

const overlap = (a: Box, b: Box): boolean => a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;

describe('known project overlay', () => {
  it('places the four known projects exactly like the prototype', () => {
    const projects = getBoardProjects(getResume('fr'));
    const bySlug = Object.fromEntries(projects.map((project) => [project.slug, project]));

    expect(bySlug['jeu-de-la-vie']).toMatchObject({ x: 100, y: 62, emblem: 'pulsar', pad: 3 });
    expect(bySlug.blink).toMatchObject({ x: 322, y: 70, emblem: 'blinkers', pad: 2 });
    expect(bySlug.thrive).toMatchObject({ x: 104, y: 186, emblem: 'penta', pad: 4 });
    expect(bySlug['worldwide-weather-watcher']).toMatchObject({ x: 318, y: 184, emblem: 'galaxy', pad: 2 });
    expect(bySlug['jeu-de-la-vie'].note?.text).toBe('un pulsar. forcément.');
    expect(bySlug['worldwide-weather-watcher'].text).toBe('Weather\nWatcher');
    expect(bySlug['worldwide-weather-watcher'].displayName).toBe('Worldwide Weather Watcher');
  });

  it('ignores overlay entries that are not in the resume', () => {
    const projects = getBoardProjects(getResume('fr'));
    const slugs = new Set(projects.map((project) => project.slug));
    for (const key of Object.keys(BOARD_OVERLAY)) {
      if (!slugs.has(key)) expect(projects.some((project) => project.slug === key)).toBe(false);
    }
  });
});

describe('auto placement', () => {
  it('finds a free ring spot that does not overlap occupied boxes', () => {
    const size = { w: 40, h: 20 };
    const occupied = [{ x: 100, y: 100, x2: 320, y2: 180 }];
    const spot = autoPlace(size, occupied);
    const box = { x: spot.x - size.w / 2, y: spot.y, x2: spot.x + size.w / 2, y2: spot.y + size.h };
    expect(overlap(box, occupied[0])).toBe(false);
  });

  it('gives an unknown RxResume project a deterministic oscillator and no note', () => {
    const base = getResume('fr');
    const extra: Project = {
      id: 'extra',
      name: 'Unlisted Project',
      slug: 'unlisted-project',
      period: '',
      description: '<p>Extra</p>',
      website: { url: '', label: '' },
    };
    const resume: Resume = { ...base, projects: [...base.projects, extra] };
    const projects = getBoardProjects(resume);
    const auto = projects.find((project) => project.slug === 'unlisted-project')!;

    expect(projects).toHaveLength(5);
    expect(OSCILLATORS).toContain(auto.emblem);
    expect(auto.note).toBeUndefined();
    expect(auto.displayName).toBe('Unlisted Project');
  });

  it('never overlaps the other structures, even with several unknown projects', () => {
    const base = getResume('fr');
    const extras: Project[] = ['Alpha Thing', 'Beta Thing', 'Gamma Thing'].map((name, index) => ({
      id: `extra-${index}`,
      name,
      slug: `extra-${index}`,
      period: '',
      description: '',
      website: { url: '', label: '' },
    }));
    const projects = getBoardProjects({ ...base, projects: [...base.projects, ...extras] });
    const boxes = projects.map((project) => {
      const size = estimateBoxSize(project.text, project.emblem, project.pad);
      return {
        x: project.x - size.w / 2,
        y: project.y - 2,
        x2: project.x + size.w / 2,
        y2: project.y - 2 + size.h,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlap(boxes[i], boxes[j]), `${projects[i].slug} / ${projects[j].slug}`).toBe(false);
      }
    }
  });

  it('never overlaps the name or CV boxes with many long-named projects', () => {
    const base = getResume('fr');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const extras: Project[] = Array.from({ length: 10 }, (_, index) => ({
      id: `long-${index}`,
      name: `Extraordinarily Long Project Name Number ${index} With Many Words`,
      slug: `long-${index}`,
      period: '',
      description: '',
      website: { url: '', label: '' },
    }));
    const projects = getBoardProjects({ ...base, projects: [...base.projects, ...extras] });
    const fixed = [
      { x: 104, y: 114, x2: 316, y2: 160 },
      { x: 196, y: 158, x2: 226, y2: 180 },
    ];
    for (const project of projects.filter((entry) => entry.slug.startsWith('long-'))) {
      const size = estimateBoxSize(project.text, project.emblem, project.pad);
      const box = { x: project.x - size.w / 2, y: project.y - 2, x2: project.x + size.w / 2, y2: project.y - 2 + size.h };
      for (const other of fixed) expect(overlap(box, other), project.slug).toBe(false);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x2).toBeLessThanOrEqual(WORLD.w);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y2).toBeLessThanOrEqual(WORLD.h);
    }
    warn.mockRestore();
  });

  it('autoPlace never returns the board centre on overflow and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const size = { w: 60, h: 40 };
    const spot = autoPlace(size, [{ x: 0, y: 0, x2: WORLD.w, y2: WORLD.h }], 3);
    expect(spot).not.toEqual({ x: 210, y: 140 });
    expect(spot.x - size.w / 2).toBeGreaterThanOrEqual(0);
    expect(spot.x + size.w / 2).toBeLessThanOrEqual(WORLD.w);
    expect(spot.y).toBeGreaterThanOrEqual(0);
    expect(spot.y + size.h).toBeLessThanOrEqual(WORLD.h);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('truncates only the raster text; displayName keeps the full name', () => {
    const base = getResume('fr');
    const name = 'Supercalifragilisticexpialidocious Implementation';
    const extra: Project = { id: 'x', name, slug: 'x', period: '', description: '', website: { url: '', label: '' } };
    const auto = getBoardProjects({ ...base, projects: [...base.projects, extra] }).find((project) => project.slug === 'x')!;
    expect(auto.text.split('\n').every((line) => line.length <= 14)).toBe(true);
    expect(auto.displayName).toBe(name);
  });
});
