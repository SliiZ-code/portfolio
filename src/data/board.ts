import type { Lang, Project, Resume } from '../lib/resume';
import { strings } from '../i18n';
import { OSCILLATORS, PATTERNS, type EmblemName } from '../scripts/board/patterns';

export const WORLD = { w: 420, h: 280 } as const;

export interface Box {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

interface OverlayNote {
  fr: string;
  en: string;
  r: number;
}

export interface BoardOverlay {
  emblem: EmblemName;
  x: number;
  y: number;
  pad: number;
  /** Other language slugs that resolve to this same project. */
  aliases?: string[];
  /** Board-only abbreviation; the resume name stays authoritative. */
  text?: string;
  label?: { fr: string; en: string };
  note?: OverlayNote;
  media?: { video?: string; image?: string };
}

/**
 * Site-only layer: where a project sits, which oscillator it is, its margin note
 * and its capture. Keyed by the slug of the RxResume project name.
 */
export const BOARD_OVERLAY: Record<string, BoardOverlay> = {
  'jeu-de-la-vie': {
    emblem: 'pulsar',
    x: 100,
    y: 62,
    pad: 3,
    aliases: ['game-of-life'],
    label: { fr: 'C++ · projet CESI', en: 'C++ · CESI project' },
    note: { fr: 'un pulsar. forcément.', en: 'a pulsar. obviously.', r: 0.04 },
    media: { video: '/media/conway.mp4' },
  },
  blink: {
    emblem: 'blinkers',
    x: 322,
    y: 70,
    pad: 2,
    label: { fr: 'Python · vidéo générée', en: 'Python · generated video' },
    note: { fr: 'Blink → des clignotants (blinkers)', en: 'Blink → blinkers', r: -0.04 },
    media: { video: '/media/blink.mp4' },
  },
  thrive: {
    emblem: 'penta',
    x: 104,
    y: 186,
    pad: 4,
    label: { fr: 'Flutter · multiplateforme', en: 'Flutter · cross-platform' },
    note: {
      fr: 'un pentadécathlon :\nil grandit, il rétrécit, il tient',
      en: 'a pentadecathlon:\nit grows, it shrinks, it holds',
      r: 0.03,
    },
    media: { image: '/media/thrive.jpg' },
  },
  'worldwide-weather-watcher': {
    emblem: 'galaxy',
    x: 318,
    y: 184,
    pad: 2,
    text: 'Weather\nWatcher',
    label: { fr: 'Arduino · capteurs · RTC', en: 'Arduino · sensors · RTC' },
    note: {
      fr: 'une galaxie de Kok :\nelle tourne comme une trotteuse',
      en: "a Kok's galaxy:\nit turns like a clock hand",
      r: -0.03,
    },
  },
};

export interface BoardNote {
  text: string;
  r: number;
}

export interface BoardProject extends Project {
  /** Text rasterised on the board, possibly wrapped or abbreviated by the overlay. */
  text: string;
  /** Full resume name, for the server-rendered list. */
  displayName: string;
  emblem: EmblemName;
  x: number;
  y: number;
  pad: number;
  label: string;
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

const MAX_TEXT_WIDTH = 14;

const wrap = (value: string, max = MAX_TEXT_WIDTH): string => {
  const lines: string[] = [];
  for (const raw of value.trim().split(/\s+/)) {
    if (!raw) continue;
    const word = raw.slice(0, max);
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.join('\n');
};

export const boardText = (project: Project): string => overlayFor(project)?.text ?? wrap(project.name);

export const boardLabel = (project: Project, lang: Lang): string => overlayFor(project)?.label?.[lang] ?? project.period;

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

interface Size {
  w: number;
  h: number;
}

const CHAR_W = 7;
const LINE_H = 11;

export const estimateBoxSize = (text: string, emblem: EmblemName, pad = 2): Size => {
  const pattern = PATTERNS[emblem];
  const lines = text.split('\n');
  const textW = Math.max(...lines.map((line) => line.length)) * CHAR_W;
  const textH = lines.length * LINE_H;
  return {
    w: Math.max(pattern[0].length + pad * 2, textW) + 8,
    h: pattern.length + pad * 2 + textH + 12,
  };
};

const overlaps = (a: Box, b: Box, margin = 6): boolean =>
  a.x < b.x2 + margin && a.x2 > b.x - margin && a.y < b.y2 + margin && a.y2 > b.y - margin;

/**
 * Finds a free spot on rings around the name. Returns the centre/top anchor.
 * Pure and deterministic so a project outside the overlay always lands somewhere sane.
 */
export function autoPlace(size: Size, occupied: Box[], index = 0, keepClear: Box[] = []): { x: number; y: number } {
  const cx = 210;
  const cy = 140;
  const golden = 2.399963;
  for (const radius of [100, 118, 136, 84, 154, 172, 60, 190]) {
    for (let step = 0; step < 24; step++) {
      const angle = index * golden + step * (Math.PI * 2 / 24) - Math.PI / 2;
      const centerX = cx + Math.cos(angle) * radius;
      const centerY = cy + Math.sin(angle) * radius;
      const raw = {
        x: centerX - size.w / 2,
        y: centerY - size.h / 2,
        x2: centerX + size.w / 2,
        y2: centerY + size.h / 2,
      };
      if (raw.x < 4 || raw.y < 4 || raw.x2 > WORLD.w - 4 || raw.y2 > WORLD.h - 4) continue;
      if (occupied.some((other) => overlaps(raw, other))) continue;
      return { x: Math.round(centerX), y: Math.round(raw.y) };
    }
  }
  for (let y = 6; y < WORLD.h - size.h; y += 12) {
    for (let x = 6; x < WORLD.w - size.w; x += 12) {
      const box = { x, y, x2: x + size.w, y2: y + size.h };
      if (!occupied.some((other) => overlaps(box, other))) return { x: Math.round(x + size.w / 2), y };
    }
  }
  return crowdedSpot(size, occupied, keepClear, index);
}

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y, b.y));

/** Board is full: take the least-overlapping spot on the outermost ring, clamped inside the world. */
function crowdedSpot(size: Size, occupied: Box[], keepClear: Box[], index: number): { x: number; y: number } {
  const golden = 2.399963;
  const radiusX = WORLD.w / 2 - size.w / 2 - 4;
  const radiusY = WORLD.h / 2 - size.h / 2 - 4;
  let best = { x: 0, y: 0, cost: Infinity };
  for (let step = 0; step < 48; step++) {
    const angle = index * golden + step * (Math.PI * 2 / 48);
    const centerX = Math.min(WORLD.w - 4 - size.w / 2, Math.max(4 + size.w / 2, WORLD.w / 2 + Math.cos(angle) * radiusX));
    const top = Math.min(WORLD.h - 4 - size.h, Math.max(4, WORLD.h / 2 + Math.sin(angle) * radiusY - size.h / 2));
    const box = { x: centerX - size.w / 2, y: top, x2: centerX + size.w / 2, y2: top + size.h };
    const cost =
      occupied.reduce((sum, other) => sum + overlapArea(box, other), 0) +
      keepClear.reduce((sum, other) => sum + overlapArea(box, other) * 1000, 0);
    if (cost < best.cost) best = { x: Math.round(centerX), y: Math.round(top), cost };
  }
  console.warn(`[board] no free spot for a ${size.w}x${size.h} project; placed on the outer ring and it may overlap`);
  return { x: best.x, y: best.y };
}

/**
 * The lab and the story are hand-placed like the name and the CV, outside the RxResume
 * data. They only peek into the home view (1440x900 shows about x 82..338, y 67..227), like
 * the projects: the story's label and note show at the top edge, between the gun and Blink
 * and clear of its glider lane; the lab's emblem and the top of its title show at the bottom
 * edge, between Thrive and the weather station, clear of the HUD.
 */
export type PageId = 'labo' | 'story';

export interface BoardPageDef {
  id: PageId;
  emblem: EmblemName;
  x: number;
  y: number;
  pad: number;
}

export const BOARD_PAGES: Record<PageId, BoardPageDef> = {
  labo: { id: 'labo', emblem: 'beacon', x: 232, y: 214, pad: 2 },
  story: { id: 'story', emblem: 'toad', x: 278, y: 30, pad: 2 },
};

const PAGE_PATHS: Record<PageId, Record<Lang, string>> = {
  labo: { fr: '/labo/', en: '/en/lab/' },
  story: { fr: '/histoire/', en: '/en/story/' },
};

export const pagePath = (id: PageId, lang: Lang): string => PAGE_PATHS[id][lang];

export interface BoardPage {
  id: PageId;
  text: string;
  emblem: EmblemName;
  x: number;
  y: number;
  pad: number;
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
      text: t.text,
      name: t.name,
      label: t.label,
      note: { text: t.note, r: PAGE_NOTE_TILT[page.id] },
      url: pagePath(page.id, lang),
    };
  });

/** One box for both languages: the widest of the two raster texts, so the layout never depends on the language. */
export const pageBox = (page: BoardPageDef): Box => {
  const boxes = (['fr', 'en'] as const).map((lang) =>
    projectBox({ ...page, text: strings(lang).board.pages[page.id].text }),
  );
  return {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.min(...boxes.map((box) => box.y)),
    x2: Math.max(...boxes.map((box) => box.x2)),
    y2: Math.max(...boxes.map((box) => box.y2)),
  };
};

/** Generous fixed boxes for the hand-placed entities, used only by auto-placement. */
export const FIXED_BOXES: Box[] = [
  { x: 104, y: 114, x2: 316, y2: 160 }, // name (rasterised client-side)
  { x: 196, y: 158, x2: 226, y2: 180 }, // cv
  { x: 144, y: 16, x2: 232, y2: 58 }, // contact + gun
];

/**
 * Gliders leave the gun mouth around (188, 24) and fly down-right until they hit the name,
 * so x - y stays near 164. Stepped boxes along that diagonal, 8 cells either side.
 */
export const GLIDER_LANE: Box[] = Array.from({ length: 10 }, (_, step) => {
  const y = 20 + step * 10;
  return { x: y + 156, y, x2: y + 10 + 172, y2: y + 10 };
});

const pageBoxes = (): Box[] => Object.values(BOARD_PAGES).map(pageBox);

/** Estimated footprint of a placed project, same anchor convention as `autoPlace` (centre x, top y). */
export const projectBox = (project: Pick<BoardProject, 'text' | 'emblem' | 'pad' | 'x' | 'y'>): Box => {
  const size = estimateBoxSize(project.text, project.emblem, project.pad);
  return {
    x: project.x - size.w / 2,
    y: project.y - 2,
    x2: project.x + size.w / 2,
    y2: project.y - 2 + size.h,
  };
};

export function getBoardProjects(resume: Resume): BoardProject[] {
  const known = resume.projects.map((project) => ({ project, overlay: overlayFor(project) }));
  const occupied = [...FIXED_BOXES, ...GLIDER_LANE, ...pageBoxes()].map((box) => ({ ...box }));
  const placed = new Map<string, BoardProject>();

  for (const { project, overlay } of known) {
    if (!overlay) continue;
    const boardProject: BoardProject = {
      ...project,
      text: boardText(project),
      displayName: project.name,
      emblem: overlay.emblem,
      x: overlay.x,
      y: overlay.y,
      pad: overlay.pad,
      label: boardLabel(project, resume.lang),
      note: boardNote(project, resume.lang),
      media: overlay.media,
    };
    placed.set(project.slug, boardProject);
    occupied.push(projectBox(boardProject));
  }

  let autoIndex = 0;
  return known.map(({ project, overlay }) => {
    if (overlay) return placed.get(project.slug)!;
    const text = boardText(project);
    const emblem = OSCILLATORS[hash(project.slug) % OSCILLATORS.length];
    const size = estimateBoxSize(text, emblem);
    const spot = autoPlace(size, occupied, autoIndex++, [...FIXED_BOXES.slice(0, 2), ...pageBoxes()]);
    const boardProject: BoardProject = {
      ...project,
      text,
      displayName: project.name,
      emblem,
      x: spot.x,
      y: spot.y,
      pad: 2,
      label: project.period,
    };
    occupied.push(projectBox(boardProject));
    return boardProject;
  });
}
