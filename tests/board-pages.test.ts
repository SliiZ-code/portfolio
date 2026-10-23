import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_PAGES,
  FIXED_BOXES,
  GLIDER_LANE,
  getBoardPages,
  getBoardProjects,
  pageBox,
  pagePath,
  projectBox,
  WORLD,
  type Box,
} from '../src/data/board';
import { getResume, type Project } from '../src/lib/resume';

const overlap = (a: Box, b: Box): boolean => a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;

const extra = (name: string, index: number): Project => ({
  id: `extra-${index}`,
  name,
  slug: `extra-${index}`,
  period: '',
  description: '',
  website: { url: '', label: '' },
});

describe('lab and story structures', () => {
  const pages = Object.values(BOARD_PAGES);
  const projects = getBoardProjects(getResume('fr'));

  it('has a lab and a story structure with their own oscillators', () => {
    expect(pages.map((page) => page.id).sort()).toEqual(['labo', 'story']);
    const emblems = [...pages.map((page) => page.emblem), ...projects.map((project) => project.emblem)];
    expect(new Set(emblems).size).toBe(emblems.length);
  });

  it('keeps every page box inside the world', () => {
    for (const page of pages) {
      const box = pageBox(page);
      expect(box.x, page.id).toBeGreaterThanOrEqual(0);
      expect(box.y, page.id).toBeGreaterThanOrEqual(0);
      expect(box.x2, page.id).toBeLessThanOrEqual(WORLD.w);
      expect(box.y2, page.id).toBeLessThanOrEqual(WORLD.h);
    }
  });

  it('does not overlap the name, cv, contact gun, its glider lane or the projects', () => {
    for (const page of pages) {
      const box = pageBox(page);
      for (const fixed of [...FIXED_BOXES, ...GLIDER_LANE]) expect(overlap(box, fixed), page.id).toBe(false);
      for (const project of projects) expect(overlap(box, projectBox(project)), `${page.id} / ${project.slug}`).toBe(false);
    }
  });

  it('does not overlap each other', () => {
    const [a, b] = pages;
    expect(overlap(pageBox(a), pageBox(b))).toBe(false);
  });

  it('covers the whole glider lane from the gun mouth down to the name', () => {
    const lane = GLIDER_LANE;
    expect(Math.min(...lane.map((box) => box.y))).toBeLessThanOrEqual(24);
    expect(Math.max(...lane.map((box) => box.y2))).toBeGreaterThanOrEqual(114);
    // a glider leaving the gun at (190, 28) is at (190 + n, 28 + n)
    for (let n = 0; n < 80; n += 4) {
      const point = { x: 190 + n, y: 28 + n, x2: 191 + n, y2: 29 + n };
      expect(lane.some((box) => overlap(box, point)), `step ${n}`).toBe(true);
    }
  });

  it('builds localised entries with their own page urls', () => {
    const fr = getBoardPages('fr');
    const en = getBoardPages('en');
    expect(fr.map((page) => page.url).sort()).toEqual(['/histoire/', '/labo/']);
    expect(en.map((page) => page.url).sort()).toEqual(['/en/lab/', '/en/story/']);
    expect(pagePath('labo', 'fr')).toBe('/labo/');
    expect(pagePath('story', 'en')).toBe('/en/story/');
    for (const page of [...fr, ...en]) {
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.label.length).toBeGreaterThan(0);
      expect(page.note.text.length).toBeGreaterThan(0);
    }
  });

  it('stays out of the way of auto-placed RxResume projects', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = getResume('fr');
    const many = [...base.projects, ...['Alpha Thing', 'Beta Thing', 'Gamma Thing'].map(extra)];
    const placed = getBoardProjects({ ...base, projects: many }).filter((project) => project.slug.startsWith('extra-'));
    expect(placed).toHaveLength(3);
    for (const project of placed) {
      const box = projectBox(project);
      for (const page of pages) expect(overlap(box, pageBox(page)), `${project.slug} / ${page.id}`).toBe(false);
      for (const fixed of [...FIXED_BOXES, ...GLIDER_LANE]) expect(overlap(box, fixed), project.slug).toBe(false);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps auto-placed projects off the pages even on a crowded board', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = getResume('fr');
    const many = Array.from({ length: 10 }, (_, index) => extra(`Extraordinarily Long Project Name Number ${index} With Many Words`, index));
    const placed = getBoardProjects({ ...base, projects: [...base.projects, ...many] }).filter((project) => project.slug.startsWith('extra-'));
    for (const project of placed) {
      for (const page of pages) expect(overlap(projectBox(project), pageBox(page)), `${project.slug} / ${page.id}`).toBe(false);
    }
    warn.mockRestore();
  });
});
