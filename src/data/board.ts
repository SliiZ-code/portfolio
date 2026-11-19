import type { Project, Resume } from '../lib/resume';
import { METHUSELAHS, type MethuselahName } from '../scripts/board/patterns';
import tagCache from './project-tags.json';

/** One generated entry of src/data/project-tags.json. */
export interface ProjectTagEntry {
  tags: string[];
  model: string;
  hash: string;
}

/** The tag cache the resume sync writes, keyed by the RxResume project id. */
export interface ProjectTagCache {
  version: number;
  projects: Record<string, ProjectTagEntry>;
}

export const TAG_CACHE = tagCache as ProjectTagCache;

export interface BoardOverlay {
  /** The methuselah drawn as the project's poster; defaults to one picked from the slug. */
  seed?: MethuselahName;
  /** Other language slugs that resolve to this same project. */
  aliases?: string[];
  /** The manual fallback tag, shown only when the tag cache has none for the project. */
  tag: string;
}

/**
 * Site-only layer: a project's seed and tag. Keyed by the slug of the RxResume
 * project name.
 */
export const BOARD_OVERLAY: Record<string, BoardOverlay> = {
  'jeu-de-la-vie': {
    seed: 'r-pentomino',
    aliases: ['game-of-life'],
    tag: 'C++',
  },
  thrive: {
    seed: 'acorn',
    tag: 'Flutter',
  },
  'worldwide-weather-watcher': {
    seed: 'pi-heptomino',
    tag: 'Arduino',
  },
  blink: {
    seed: 'diehard',
    tag: 'Python',
  },
  // the slugs of "L'Arduino en pixels" and "The Arduino in pixels"
  'larduino-en-pixels': {
    seed: 'b-heptomino',
    aliases: ['the-arduino-in-pixels'],
    tag: 'three.js',
  },
};

export interface BoardProject extends Project {
  /** Full resume name, for the server-rendered list. */
  displayName: string;
  /** The methuselah this project fires onto the board. */
  seed: MethuselahName;
  /** The generated tags, else the overlay's one, joined by " · "; empty when both are missing. */
  tag: string;
  /** Tag and period, for the list and the project page. */
  meta: string;
}

const OVERLAY_KEYS = new Map<string, string>();
for (const [key, overlay] of Object.entries(BOARD_OVERLAY)) {
  OVERLAY_KEYS.set(key, key);
  for (const alias of overlay.aliases ?? []) OVERLAY_KEYS.set(alias, key);
}

/** The overlay key a project resolves to, whether it uses the key itself or an alias. */
export const overlayKeyFor = (projectOrSlug: Project | string): string | undefined =>
  OVERLAY_KEYS.get(typeof projectOrSlug === 'string' ? projectOrSlug : projectOrSlug.slug);

export const overlayFor = (projectOrSlug: Project | string): BoardOverlay | undefined => {
  const key = overlayKeyFor(projectOrSlug);
  return key ? BOARD_OVERLAY[key] : undefined;
};

const hash = (value: string): number => {
  let h = 7;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
};

/** The overlay's seed, or a methuselah picked from the slug so the same project always fires the same one. */
export const seedFor = (project: Project): MethuselahName =>
  overlayFor(project)?.seed ?? METHUSELAHS[hash(project.slug) % METHUSELAHS.length];

/**
 * The tags of a project: the ones the sync generated from its RxResume description, and the overlay's
 * hand-written one only as a fallback (or when the cache has none). Pure: pass any cache in tests.
 */
export const tagsFor = (project: Project, cache: ProjectTagCache = TAG_CACHE): string[] => {
  const generated = cache.projects?.[project.id]?.tags;
  const tags = (Array.isArray(generated) ? generated : []).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim());
  if (tags.length) return tags;
  const manual = overlayFor(project)?.tag;
  return manual ? [manual] : [];
};

/** The tags and the RxResume period, whichever of them exist. */
export const projectMeta = (project: Project, cache: ProjectTagCache = TAG_CACHE): string =>
  [...tagsFor(project, cache), project.period].filter(Boolean).join(' · ');

export function getBoardProjects(resume: Resume, cache: ProjectTagCache = TAG_CACHE): BoardProject[] {
  return resume.projects.map((project) => ({
    ...project,
    displayName: project.name,
    seed: seedFor(project),
    tag: tagsFor(project, cache).join(' · '),
    meta: projectMeta(project, cache),
  }));
}
