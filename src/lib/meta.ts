import { htmlToText, type Resume } from './resume';

/** The parts of a resume the home page's title needs. */
export type TitleSource = Pick<Resume, 'name' | 'headline'>;

/** The parts of a resume the home page's description needs. */
export type DescriptionSource = Pick<Resume, 'summary' | 'headline'>;

/**
 * The home page title: the resume's name and headline, so the tab matches the CV. The site strings
 * are only a fallback for a resume that does not have both.
 */
export const resumeTitle = (resume: TitleSource, fallback: string): string => {
  const name = resume.name.trim();
  const headline = resume.headline.trim();
  return name && headline ? `${name} — ${headline}` : fallback;
};

/** The first sentence of a text: up to the first period, exclamation or question mark. */
const firstSentence = (text: string): string => {
  const match = /^.+?[.!?…](?=\s|$)/u.exec(text);
  return (match ? match[0] : text).trim();
};

/** Cuts a text at the last space inside `max` and ends it with an ellipsis. */
const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/**
 * The home page description: the first sentence of the resume summary, shortened to `max`
 * characters. An empty summary falls back to the headline, then to the site string.
 */
export const resumeDescription = (resume: DescriptionSource, fallback: string, max = 160): string => {
  const sentence = firstSentence(htmlToText(resume.summary ?? ''));
  return truncate(sentence || resume.headline.trim() || fallback, max);
};
