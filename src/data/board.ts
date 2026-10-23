import type { Lang, Project, Resume } from '../lib/resume';
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
  displayName: string;
  emblem: EmblemName;
  x: number;
  y: number;
  pad: number;
  label: string;
  note?: BoardNote;
  media?: { video?: string; image?: string };
}

const hash = (value: string): number => {
  let h = 7;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
};

const wrap = (value: string, max = 14): string => {
  const lines: string[] = [];
  for (const word of value.trim().split(/\s+/)) {
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.join('\n');
};

export const boardText = (project: Project): string =>
  BOARD_OVERLAY[project.slug]?.text ?? wrap(project.name);

export const boardDisplayName = (project: Project): string => boardText(project).replace(/\n/g, ' ');

export const boardLabel = (project: Project, lang: Lang): string => {
  const overlay = BOARD_OVERLAY[project.slug];
  return overlay?.label?.[lang] ?? project.period;
};

export const boardNote = (project: Project, lang: Lang): BoardNote | undefined => {
  const note = BOARD_OVERLAY[project.slug]?.note;
  return note ? { text: note[lang], r: note.r } : undefined;
};

export const boardMedia = (project: Project): BoardOverlay['media'] => BOARD_OVERLAY[project.slug]?.media;

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
export function autoPlace(size: Size, occupied: Box[], index = 0): { x: number; y: number } {
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
  return { x: cx, y: cy };
}

/** Generous fixed boxes for the hand-placed entities, used only by auto-placement. */
const FIXED_BOXES: Box[] = [
  { x: 104, y: 114, x2: 316, y2: 160 }, // name (rasterised client-side)
  { x: 196, y: 158, x2: 226, y2: 180 }, // cv
  { x: 144, y: 16, x2: 232, y2: 58 }, // contact + gun
];

const boxFor = (project: BoardProject): Box => {
  const overlay = BOARD_OVERLAY[project.slug];
  const text = project.text;
  const size = estimateBoxSize(text, project.emblem, overlay?.pad ?? 2);
  return {
    x: project.x - size.w / 2,
    y: project.y - 2,
    x2: project.x + size.w / 2,
    y2: project.y - 2 + size.h,
  };
};

export function getBoardProjects(resume: Resume): BoardProject[] {
  const known = resume.projects.map((project) => ({ project, overlay: BOARD_OVERLAY[project.slug] }));
  const occupied = FIXED_BOXES.map((box) => ({ ...box }));
  const placed = new Map<string, BoardProject>();

  for (const { project, overlay } of known) {
    if (!overlay) continue;
    const boardProject: BoardProject = {
      ...project,
      text: overlay.text ?? project.name,
      displayName: (overlay.text ?? project.name).replace(/\n/g, ' '),
      emblem: overlay.emblem,
      x: overlay.x,
      y: overlay.y,
      pad: overlay.pad,
      label: boardLabel(project, resume.lang),
      note: boardNote(project, resume.lang),
      media: overlay.media,
    };
    placed.set(project.slug, boardProject);
    occupied.push(boxFor(boardProject));
  }

  let autoIndex = 0;
  return known.map(({ project, overlay }) => {
    if (overlay) return placed.get(project.slug)!;
    const text = wrap(project.name);
    const emblem = OSCILLATORS[hash(project.slug) % OSCILLATORS.length];
    const size = estimateBoxSize(text, emblem);
    const spot = autoPlace(size, occupied, autoIndex++);
    const boardProject: BoardProject = {
      ...project,
      text,
      displayName: text.replace(/\n/g, ' '),
      emblem,
      x: spot.x,
      y: spot.y,
      pad: 2,
      label: project.period,
    };
    occupied.push(boxFor(boardProject));
    return boardProject;
  });
}
