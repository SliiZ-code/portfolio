import type { Website } from '../../lib/resume';

/**
 * A project the PDF hides (`hidden`) still belongs on the site; it just comes after the featured ones.
 */
export const isHiddenProject = (project: object): boolean => (project as { hidden?: unknown }).hidden === true;

export const splitProjects = <T extends object>(projects: T[]): { featured: T[]; more: T[] } => ({
  featured: projects.filter((project) => !isHiddenProject(project)),
  more: projects.filter(isHiddenProject),
});

/** The first `count` sentences of plain text, for a one-line teaser. */
export const leadSentences = (text: string, count = 2): string => {
  // a sentence ends on punctuation followed by a space or the end, so "GPT-3.5" or "Node.js" stay whole
  const sentences = text.match(/[\s\S]+?(?:[.!?…]+(?=\s|$)|$)/g) ?? [];
  return sentences
    .slice(0, count)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join(' ');
};

/** A short label for an external link: GitHub and LinkedIn by name, otherwise the source's label or host. */
export const linkLabel = ({ url, label }: Website): string => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'github.com') return 'GitHub';
    if (host === 'linkedin.com') return 'LinkedIn';
    return label.trim() || host;
  } catch {
    return label.trim();
  }
};

/** Joins non-empty parts with a middle dot: "janv. 2026 – Aujourd’hui · Paris". */
export const joinMeta = (...parts: (string | false | undefined | null)[]): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

export interface TextSegment {
  text: string;
  marked: boolean;
}

/**
 * Splits plain text into runs, marking every exact occurrence of the phrases. Matching is case-sensitive and
 * literal; where two phrases overlap, the one that starts first (then the longer) wins. Nothing is ever parsed as
 * HTML, so the caller renders each run as text and the output cannot inject markup.
 */
export const markPhrases = (text: string, phrases: readonly string[]): TextSegment[] => {
  const found: { start: number; end: number }[] = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + phrase.length)) {
      found.push({ start: at, end: at + phrase.length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const { start, end } of found) {
    if (start < cursor) continue; // overlaps a phrase already marked
    if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
};

/** A two-digit index for a numbered list: 4 becomes "04". */
export const indexLabel = (n: number): string => String(n).padStart(2, '0');

/** The language a page is served in, from its path: "/en/…" is English, everything else French. */
export const langOfPath = (pathname: string): 'fr' | 'en' => (pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'fr');
