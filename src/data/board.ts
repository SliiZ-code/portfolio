import type { Lang, Project, Resume } from '../lib/resume';
import { findMedia } from '../lib/media';
import { METHUSELAHS, type MethuselahName } from '../scripts/board/patterns';

interface OverlayNote {
  fr: string;
  en: string;
  r: number;
}

/** A live demo shown on the project page instead of the pixelated capture. */
export interface BoardExperiment {
  /** `pixel-model`: a 3D model rendered with three.js, then pixelated like a capture. */
  kind: 'pixel-model';
  /** Source of the experiment's asset. */
  src: string;
}

export interface BoardOverlay {
  /** The methuselah the project fires onto the board; defaults to one picked from the slug. */
  seed?: MethuselahName;
  /** Other language slugs that resolve to this same project. */
  aliases?: string[];
  /** Board-only abbreviation; the resume name stays authoritative. */
  name?: string;
  /** The language or tool shown next to the name on the board. */
  tag: string;
  /** Margin note on the project page. */
  note?: OverlayNote;
  media?: { video?: string; image?: string };
  /** Replaces the capture on the project page. */
  experiment?: BoardExperiment;
}

/**
 * Site-only layer: a project's seed, tag, page note and capture. Keyed by the slug of the
 * RxResume project name.
 */
export const BOARD_OVERLAY: Record<string, BoardOverlay> = {
  'jeu-de-la-vie': {
    seed: 'r-pentomino',
    aliases: ['game-of-life'],
    tag: 'C++',
    note: {
      fr: 'le R-pentomino : cinq cellules,\n1103 générations de chaos',
      en: 'the R-pentomino: five cells,\n1103 generations of chaos',
      r: 0.04,
    },
    media: { video: '/media/conway.mp4' },
  },
  thrive: {
    seed: 'acorn',
    tag: 'Flutter',
    note: {
      fr: 'un gland : sept cellules\nqui poussent 5206 générations',
      en: 'an acorn: seven cells\nthat grow for 5206 generations',
      r: 0.03,
    },
    media: { image: '/media/thrive.jpg' },
  },
  'worldwide-weather-watcher': {
    seed: 'pi-heptomino',
    name: 'Weather Watcher',
    tag: 'Arduino',
    note: {
      fr: "un pi-heptomino :\nil s'agite, puis il se pose",
      en: 'a pi-heptomino:\nit stirs, then it settles',
      r: -0.03,
    },
  },
  blink: {
    seed: 'diehard',
    tag: 'Python',
    note: {
      fr: 'un diehard : il disparaît\naprès 130 générations',
      en: 'a diehard: gone\nafter 130 generations',
      r: -0.04,
    },
    media: { video: '/media/blink.mp4' },
  },
  // the slugs of "L'Arduino en pixels" and "The Arduino in pixels"
  'larduino-en-pixels': {
    seed: 'b-heptomino',
    aliases: ['the-arduino-in-pixels'],
    tag: 'three.js',
    note: {
      fr: "un B-heptomino :\nil fait naître des planeurs",
      en: 'a B-heptomino:\nit gives birth to gliders',
      r: 0.03,
    },
    experiment: { kind: 'pixel-model', src: '/media/arduino.glb' },
  },
};

export interface BoardNote {
  text: string;
  r: number;
}

export interface BoardProject extends Project {
  /** Name drawn on the board, possibly shortened by the overlay. */
  boardName: string;
  /** Full resume name, for the server-rendered list. */
  displayName: string;
  /** The methuselah this project fires onto the board. */
  seed: MethuselahName;
  /** Empty for a project outside the overlay. */
  tag: string;
  /** Tag and period, for the list and the project page. */
  meta: string;
  note?: BoardNote;
  media?: { video?: string; image?: string };
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

export const boardNote = (project: Project, lang: Lang): BoardNote | undefined => {
  const note = overlayFor(project)?.note;
  return note ? { text: note[lang], r: note.r } : undefined;
};

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

/**
 * FR and EN resumes are separate documents, but a duplicated entry keeps its id: match on
 * that first, then on the overlay key, then fall back to the same index when both lists
 * have the same size.
 */
export function findAlternateProject(project: Project, projects: Project[], other: Resume): Project | undefined {
  if (project.id) {
    const same = other.projects.find((candidate) => candidate.id === project.id);
    if (same) return same;
  }
  const key = overlayKeyFor(project);
  if (key) {
    const matched = other.projects.find((candidate) => overlayKeyFor(candidate) === key);
    if (matched) return matched;
  }
  const index = projects.findIndex((candidate) => candidate.slug === project.slug);
  if (index !== -1 && projects.length === other.projects.length) return other.projects[index];
  return undefined;
}

export const projectPath = (lang: Lang, slug: string): string => (lang === 'fr' ? `/projets/${slug}/` : `/en/projects/${slug}/`);

export function getBoardProjects(resume: Resume): BoardProject[] {
  return resume.projects.map((project) => {
    const overlay = overlayFor(project);
    const base = { ...project, displayName: project.name };
    if (!overlay) {
      return {
        ...base,
        boardName: project.name,
        seed: seedFor(project),
        tag: '',
        meta: projectMeta(project),
      };
    }
    return {
      ...base,
      boardName: overlay.name ?? project.name,
      seed: seedFor(project),
      tag: overlay.tag,
      meta: projectMeta(project),
      note: boardNote(project, resume.lang),
      media: overlay.media,
    };
  });
}
