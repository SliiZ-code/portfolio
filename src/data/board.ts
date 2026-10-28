import type { Lang, Project, Resume } from '../lib/resume';
import { strings } from '../i18n';
import type { At } from '../scripts/board/layout';
import { OSCILLATORS, type PatternName } from '../scripts/board/patterns';

interface OverlayNote {
  fr: string;
  en: string;
  r: number;
}

export interface BoardOverlay {
  pattern: PatternName;
  pad: number;
  /** Screen fractions [centre x, pattern top y] per orientation: l landscape, p portrait. */
  at: Required<Pick<At, 'l' | 'p'>>;
  /** Other language slugs that resolve to this same project. */
  aliases?: string[];
  /** Board-only abbreviation; the resume name stays authoritative. */
  name?: string;
  /** Short tag for the list and the project page. */
  label: { fr: string; en: string };
  /** The language or tool shown under the name on the board. */
  tag: string;
  /** Margin note on the project page. */
  note?: OverlayNote;
  media?: { video?: string; image?: string };
}

/**
 * Site-only layer: where a project sits on the screen, which pattern it is, its tag, its
 * page note and its capture. Keyed by the slug of the RxResume project name.
 */
export const BOARD_OVERLAY: Record<string, BoardOverlay> = {
  'jeu-de-la-vie': {
    pattern: 'pulsar',
    pad: 3,
    at: { l: [0.14, 0.66], p: [0.26, 0.57] },
    aliases: ['game-of-life'],
    label: { fr: 'C++ · projet CESI', en: 'C++ · CESI project' },
    tag: 'C++',
    note: { fr: 'un pulsar. forcément.', en: 'a pulsar. obviously.', r: 0.04 },
    media: { video: '/media/conway.mp4' },
  },
  thrive: {
    pattern: 'penta',
    pad: 4,
    at: { l: [0.38, 0.71], p: [0.74, 0.68] },
    label: { fr: 'Flutter · multiplateforme', en: 'Flutter · cross-platform' },
    tag: 'Flutter',
    note: {
      fr: 'un pentadécathlon :\nil grandit, il rétrécit, il tient',
      en: 'a pentadecathlon:\nit grows, it shrinks, it holds',
      r: 0.03,
    },
    media: { image: '/media/thrive.jpg' },
  },
  'worldwide-weather-watcher': {
    pattern: 'galaxy',
    pad: 2,
    at: { l: [0.62, 0.68], p: [0.26, 0.79] },
    name: 'Weather Watcher',
    label: { fr: 'Arduino · capteurs · RTC', en: 'Arduino · sensors · RTC' },
    tag: 'Arduino',
    note: {
      fr: 'une galaxie de Kok :\nelle tourne comme une trotteuse',
      en: "a Kok's galaxy:\nit turns like a clock hand",
      r: -0.03,
    },
  },
  blink: {
    pattern: 'blinkers',
    pad: 2,
    at: { l: [0.84, 0.12], p: [0.74, 0.15] },
    label: { fr: 'Python · vidéo générée', en: 'Python · generated video' },
    tag: 'Python',
    note: { fr: 'Blink → des clignotants (blinkers)', en: 'Blink → blinkers', r: -0.04 },
    media: { video: '/media/blink.mp4' },
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
  pattern: PatternName;
  pad: number;
  /** Null for a project outside the overlay: the board finds it a free slot at runtime. */
  at: At | null;
  label: string;
  /** Empty for a project outside the overlay. */
  tag: string;
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

export const boardNote = (project: Project, lang: Lang): BoardNote | undefined => {
  const note = overlayFor(project)?.note;
  return note ? { text: note[lang], r: note.r } : undefined;
};

export const boardMedia = (project: Project): BoardOverlay['media'] => overlayFor(project)?.media;

/**
 * FR and EN resumes are separate documents. Prefer the project whose overlay key
 * matches, then fall back to the same index when both lists have the same size.
 */
export function findAlternateProject(project: Project, projects: Project[], other: Resume): Project | undefined {
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
        pattern: OSCILLATORS[hash(project.slug) % OSCILLATORS.length],
        pad: 2,
        at: null,
        label: project.period,
        tag: '',
      };
    }
    return {
      ...base,
      boardName: overlay.name ?? project.name,
      pattern: overlay.pattern,
      pad: overlay.pad,
      at: overlay.at,
      label: overlay.label[resume.lang],
      tag: overlay.tag,
      note: boardNote(project, resume.lang),
      media: overlay.media,
    };
  });
}

/** The lab and the story are hand-placed like the projects, but live outside the RxResume data. */
export type PageId = 'labo' | 'story';

export interface BoardPageDef {
  id: PageId;
  pattern: PatternName;
  pad: number;
  at: Required<Pick<At, 'l' | 'p'>>;
}

export const BOARD_PAGES: Record<PageId, BoardPageDef> = {
  labo: { id: 'labo', pattern: 'beacon', pad: 2, at: { l: [0.86, 0.7], p: [0.74, 0.84] } },
  story: { id: 'story', pattern: 'toad', pad: 2, at: { l: [0.58, 0.1], p: [0.26, 0.145] } },
};

/** The CV hangs off the bottom-right of the name in landscape, and has a fixed slot in portrait. */
export const CV_LAYOUT = { pattern: 'beehive', pad: 2, at: { l: 'name', p: [0.85, 0.55] } } as const satisfies {
  pattern: PatternName;
  pad: number;
  at: At;
};

/** The gun, at the top edge. */
export const CONTACT_LAYOUT = { pattern: 'gun', pad: 0, at: { l: [0.18, 0.05], p: [0.5, 0.025] } } as const satisfies {
  pattern: PatternName;
  pad: number;
  at: At;
};

const PAGE_PATHS: Record<PageId, Record<Lang, string>> = {
  labo: { fr: '/labo/', en: '/en/lab/' },
  story: { fr: '/histoire/', en: '/en/story/' },
};

export const pagePath = (id: PageId, lang: Lang): string => PAGE_PATHS[id][lang];

export interface BoardPage extends BoardPageDef {
  /** Name drawn on the board. */
  boardName: string;
  /** Short name for the server-rendered list. */
  name: string;
  label: string;
  note: BoardNote;
  url: string;
}

const PAGE_NOTE_TILT: Record<PageId, number> = { labo: 0.03, story: -0.03 };

export const getBoardPages = (lang: Lang): BoardPage[] =>
  Object.values(BOARD_PAGES).map((page) => {
    const t = strings(lang).board.pages[page.id];
    return {
      ...page,
      boardName: t.text,
      name: t.name,
      label: t.label,
      note: { text: t.note, r: PAGE_NOTE_TILT[page.id] },
      url: pagePath(page.id, lang),
    };
  });

export interface BoardEntity {
  id: string;
  kind: 'project' | 'page' | 'cv' | 'contact';
  name: string;
  /** The project's language or tool; empty for everything else. */
  tag: string;
  /** Empty for a contact with no address: drawn, but not a link. */
  url: string;
  pattern: PatternName;
  pad: number;
  at: At | null;
}

/**
 * Everything that is drawn on the board besides the name, fixed positions first: the ones
 * without a position (projects outside the overlay) are placed at runtime, in this order,
 * once everything else has claimed its room.
 */
export function getBoardEntities(resume: Resume, links: { cvHref: string; contactHref: string }): BoardEntity[] {
  const t = strings(resume.lang).board;
  const projects = getBoardProjects(resume).map<BoardEntity>((project) => ({
    id: project.slug,
    kind: 'project',
    name: project.boardName,
    tag: project.tag,
    url: projectPath(resume.lang, project.slug),
    pattern: project.pattern,
    pad: project.pad,
    at: project.at,
  }));
  const pages = getBoardPages(resume.lang).map<BoardEntity>((page) => ({
    id: page.id,
    kind: 'page',
    name: page.boardName,
    tag: '',
    url: page.url,
    pattern: page.pattern,
    pad: page.pad,
    at: page.at,
  }));
  const cv: BoardEntity = { id: 'cv', kind: 'cv', name: t.cvName, tag: '', url: links.cvHref, ...CV_LAYOUT };
  const contact: BoardEntity = {
    id: 'contact',
    kind: 'contact',
    name: t.contactName,
    tag: '',
    url: links.contactHref,
    ...CONTACT_LAYOUT,
  };
  const all = [...projects, ...pages, cv, contact];
  return [...all.filter((entity) => entity.at), ...all.filter((entity) => !entity.at)];
}
