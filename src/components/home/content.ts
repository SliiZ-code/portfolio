import type { Website } from '../../lib/resume';

/**
 * A project the PDF hides (`hidden`) still belongs on the site; it just comes after the featured ones.
 * `parseResume` does not carry the flag through yet, so until it does every project counts as featured.
 */
export const isHiddenProject = (project: object): boolean => (project as { hidden?: unknown }).hidden === true;

export const splitProjects = <T extends object>(projects: T[]): { featured: T[]; more: T[] } => ({
  featured: projects.filter((project) => !isHiddenProject(project)),
  more: projects.filter(isHiddenProject),
});

/** The first `count` sentences of plain text, for a one-line teaser. */
export const leadSentences = (text: string, count = 2): string => {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [];
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
