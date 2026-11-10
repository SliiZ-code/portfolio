import type { Project, Resume } from '../lib/resume';
import { findMedia, type Media } from '../lib/media';
import { METHUSELAHS, type MethuselahName } from '../scripts/board/patterns';

export interface BoardOverlay {
  /** The methuselah drawn as the project's poster; defaults to one picked from the slug. */
  seed?: MethuselahName;
  /** Other language slugs that resolve to this same project. */
  aliases?: string[];
  /** The language or tool shown next to the name on the board. */
  tag: string;
  media?: Media;
}

/**
 * Site-only layer: a project's seed, tag and capture. Keyed by the slug of the
 * RxResume project name.
 */
export const BOARD_OVERLAY: Record<string, BoardOverlay> = {
  'jeu-de-la-vie': {
    seed: 'r-pentomino',
    aliases: ['game-of-life'],
    tag: 'C++',
    media: { video: '/media/conway.mp4' },
  },
  thrive: {
    seed: 'acorn',
    tag: 'Flutter',
    media: { image: '/media/thrive.jpg', webp: '/media/thrive.webp' },
  },
  'worldwide-weather-watcher': {
    seed: 'pi-heptomino',
    tag: 'Arduino',
  },
  blink: {
    seed: 'diehard',
    tag: 'Python',
    media: { video: '/media/blink.mp4' },
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
  /** Empty for a project outside the overlay. */
  tag: string;
  /** Tag and period, for the list and the project page. */
  meta: string;
  media?: Media;
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

/** The overlay tag and the RxResume period, whichever of the two exist. */
export const projectMeta = (project: Project): string =>
  [overlayFor(project)?.tag, project.period].filter(Boolean).join(' · ');

/**
 * An explicit overlay media wins; otherwise a file in public/media named after the project's
 * slug, its overlay key or the slug of its other-language twin is picked up by convention.
 */
export const boardMedia = (
  project: Project,
  alternate?: Project,
  exists?: (file: string) => boolean,
): BoardOverlay['media'] =>
  overlayFor(project)?.media ?? findMedia([project.slug, overlayKeyFor(project) ?? '', alternate?.slug ?? ''], exists);

export function getBoardProjects(resume: Resume): BoardProject[] {
  return resume.projects.map((project) => {
    const overlay = overlayFor(project);
    const base = { ...project, displayName: project.name };
    if (!overlay) {
      return {
        ...base,
        seed: seedFor(project),
        tag: '',
        meta: projectMeta(project),
      };
    }
    return {
      ...base,
      seed: seedFor(project),
      tag: overlay.tag,
      meta: projectMeta(project),
      media: overlay.media,
    };
  });
}
