import { z } from 'zod';
import fr from '../data/resume.fr.json';
import en from '../data/resume.en.json';

export type Lang = 'fr' | 'en';

/** Safe, accent-free URL segment: "Jeu de la vie" -> "jeu-de-la-vie". */
export const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const decodeEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (value: string): string => escapeText(value).replace(/"/g, '&quot;');

/** Only these URLs may end up in an href. */
export const safeUrl = (value: string): string => {
  const url = value.trim();
  if (!url || /[\u0000-\u001f]/.test(url)) return '';
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) return url;
  return '';
};

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br']);
const RAW_TEXT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math']);

const readTag = (html: string, start: number): { end: number; closing: boolean; name: string; attrs: string } | null => {
  if (html[start] !== '<') return null;
  let i = start + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  const match = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(i));
  if (!match) return null;
  const name = match[0].toLowerCase();
  i += match[0].length;
  const attrStart = i;
  let quote = '';
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return { end: i + 1, closing, name, attrs: html.slice(attrStart, i) };
    }
    i++;
  }
  return null;
};

const hrefOf = (attrs: string): string => {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  return safeUrl(decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? ''));
};

/**
 * Minimal allow-list sanitiser for RxResume rich text.
 * Keeps p, ul, ol, li, strong, em, a[href], br; drops every other tag and attribute.
 */
export const sanitizeHtml = (input: string): string => {
  if (!input) return '';
  const html = decodeEntities(input.replace(/<!--[\s\S]*?-->/g, ''));
  let out = '';
  let i = 0;
  while (i < html.length) {
    const next = html.indexOf('<', i);
    if (next === -1) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, next));
    const tag = readTag(html, next);
    if (!tag) {
      out += '&lt;';
      i = next + 1;
      continue;
    }
    i = tag.end;
    if (RAW_TEXT.has(tag.name)) {
      if (!tag.closing) {
        const close = new RegExp(`</${tag.name}\\s*>`, 'ig');
        close.lastIndex = i;
        const found = close.exec(html);
        i = found ? found.index + found[0].length : html.length;
      }
      continue;
    }
    if (!ALLOWED.has(tag.name)) continue;
    if (tag.name === 'br') {
      if (!tag.closing) out += '<br>';
      continue;
    }
    if (tag.closing) {
      out += `</${tag.name}>`;
      continue;
    }
    if (tag.name === 'a') out += `<a href="${escapeAttr(hrefOf(tag.attrs))}">`;
    else out += `<${tag.name}>`;
  }
  return out;
};

export const htmlToText = (html: string): string =>
  decodeEntities(sanitizeHtml(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const website = z
  .object({
    url: z.string().catch(''),
    label: z.string().catch(''),
    inlineLink: z.boolean().catch(false),
  })
  .catch({ url: '', label: '', inlineLink: false });

const hidden = z.boolean().catch(false);
const text = z.string().catch('');
const item = { id: text, hidden };

const profileItem = z
  .object({
    ...item,
    network: text,
    username: text,
    website,
  })
  .catch({ id: '', hidden: true, network: '', username: '', website: { url: '', label: '', inlineLink: false } });

const projectItem = z
  .object({
    ...item,
    name: text,
    period: text,
    website,
    description: text,
  })
  .catch({ id: '', hidden: true, name: '', period: '', website: { url: '', label: '', inlineLink: false }, description: '' });

const experienceItem = z
  .object({
    ...item,
    company: text,
    position: text,
    location: text,
    period: text,
    website,
    description: text,
    roles: z.array(z.object({ position: text, period: text, description: text }).catch({ position: '', period: '', description: '' })).catch([]),
  })
  .catch({ id: '', hidden: true, company: '', position: '', location: '', period: '', website: { url: '', label: '', inlineLink: false }, description: '', roles: [] });

const educationItem = z
  .object({
    ...item,
    school: text,
    degree: text,
    area: text,
    grade: text,
    location: text,
    period: text,
    website,
    description: text,
  })
  .catch({ id: '', hidden: true, school: '', degree: '', area: '', grade: '', location: '', period: '', website: { url: '', label: '', inlineLink: false }, description: '' });

const skillItem = z
  .object({
    ...item,
    name: text,
    proficiency: text,
    level: z.number().catch(0),
    keywords: z.array(z.string()).catch([]),
  })
  .catch({ id: '', hidden: true, name: '', proficiency: '', level: 0, keywords: [] });

const languageItem = z
  .object({
    ...item,
    language: text,
    fluency: text,
    level: z.number().catch(0),
  })
  .catch({ id: '', hidden: true, language: '', fluency: '', level: 0 });

const timedItem = z
  .object({
    ...item,
    title: text,
    issuer: text,
    awarder: text,
    date: text,
    website,
    description: text,
  })
  .catch({ id: '', hidden: true, title: '', issuer: '', awarder: '', date: '', website: { url: '', label: '', inlineLink: false }, description: '' });

const makeSection = <T extends z.ZodType>(items: T) =>
  z
    .object({
      title: text,
      hidden,
      items: z.array(items).catch([]),
    })
    .catch({ title: '', hidden: true, items: [] });

const sectionsSchema = z
  .object({
    profiles: makeSection(profileItem).optional().catch(undefined),
    experience: makeSection(experienceItem).optional().catch(undefined),
    education: makeSection(educationItem).optional().catch(undefined),
    projects: makeSection(projectItem).optional().catch(undefined),
    skills: makeSection(skillItem).optional().catch(undefined),
    languages: makeSection(languageItem).optional().catch(undefined),
    certifications: makeSection(timedItem).optional().catch(undefined),
    awards: makeSection(timedItem).optional().catch(undefined),
  })
  .catch({});

const resumeSchema = z.looseObject({
  basics: z
    .object({
      name: text,
      headline: text,
      email: text,
      location: text,
      website,
    })
    .catch({ name: '', headline: '', email: '', location: '', website: { url: '', label: '', inlineLink: false } }),
  summary: z
    .object({
      title: text,
      hidden,
      content: text,
    })
    .optional()
    .catch(undefined),
  sections: sectionsSchema,
});

type Raw = z.infer<typeof resumeSchema>;

export interface Website {
  url: string;
  label: string;
}

export interface Profile {
  network: string;
  username: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  period: string;
  description: string;
  website: Website;
}

export interface Experience {
  company: string;
  position: string;
  location: string;
  period: string;
  description: string;
  website: Website;
  roles: { position: string; period: string; description: string }[];
}

export interface Education {
  school: string;
  degree: string;
  area: string;
  grade: string;
  location: string;
  period: string;
  description: string;
  website: Website;
}

export interface Skill {
  name: string;
  proficiency: string;
  level: number;
  keywords: string[];
}

export interface Language {
  language: string;
  fluency: string;
  level: number;
}

export interface Certification {
  title: string;
  issuer: string;
  date: string;
  description: string;
  website: Website;
}

export interface Award {
  title: string;
  awarder: string;
  date: string;
  description: string;
  website: Website;
}

export interface Resume {
  lang: Lang;
  name: string;
  headline: string;
  email: string;
  location: string;
  website: Website;
  summaryTitle: string;
  summary: string;
  sectionTitles: {
    profiles: string;
    experience: string;
    education: string;
    projects: string;
    skills: string;
    languages: string;
    certifications: string;
    awards: string;
  };
  profiles: Profile[];
  projects: Project[];
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  languages: Language[];
  certifications: Certification[];
  awards: Award[];
}

const cleanWebsite = (value: { url: string; label: string }): Website => ({
  url: safeUrl(value.url),
  label: value.label.trim(),
});

const visible = <T extends { hidden: boolean }>(items: T[]): T[] => items.filter((entry) => !entry.hidden);

const cleanDescription = (value: string): string => sanitizeHtml(value.trim());

export const parseResume = (input: unknown, lang: Lang): Resume => {
  const data: Raw = resumeSchema.parse(input);
  const sections = data.sections ?? ({} as NonNullable<Raw['sections']>);
  const pickSection = <K extends keyof typeof sections>(key: K) => {
    const value = sections[key];
    return value && !value.hidden ? value : null;
  };
  const titles = <K extends keyof Resume['sectionTitles']>(key: K, fallback: string) =>
    pickSection(key)?.title.trim() || fallback;

  const seen = new Map<string, number>();
  const projects: Project[] = visible(pickSection('projects')?.items ?? [])
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const base = slugify(entry.name) || 'projet';
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return {
        id: entry.id,
        name: entry.name.trim(),
        slug: count === 1 ? base : `${base}-${count}`,
        period: entry.period.trim(),
        description: cleanDescription(entry.description),
        website: cleanWebsite(entry.website),
      };
    });

  return {
    lang,
    name: data.basics.name.trim(),
    headline: data.basics.headline.trim(),
    email: data.basics.email.trim(),
    location: data.basics.location.trim(),
    website: cleanWebsite(data.basics.website),
    summaryTitle: data.summary && !data.summary.hidden ? data.summary.title.trim() : '',
    summary: data.summary && !data.summary.hidden ? cleanDescription(data.summary.content) : '',
    sectionTitles: {
      profiles: titles('profiles', lang === 'fr' ? 'Réseaux' : 'Elsewhere'),
      experience: titles('experience', lang === 'fr' ? 'Expérience' : 'Experience'),
      education: titles('education', lang === 'fr' ? 'Formation' : 'Education'),
      projects: titles('projects', lang === 'fr' ? 'Projets' : 'Projects'),
      skills: titles('skills', lang === 'fr' ? 'Compétences' : 'Skills'),
      languages: titles('languages', lang === 'fr' ? 'Langues' : 'Languages'),
      certifications: titles('certifications', lang === 'fr' ? 'Certifications' : 'Certifications'),
      awards: titles('awards', lang === 'fr' ? 'Distinctions' : 'Awards'),
    },
    profiles: visible(pickSection('profiles')?.items ?? [])
      .filter((entry) => entry.network.trim() && safeUrl(entry.website.url))
      .map((entry) => ({
        network: entry.network.trim(),
        username: entry.username.trim(),
        url: safeUrl(entry.website.url),
      })),
    projects,
    experience: visible(pickSection('experience')?.items ?? [])
      .filter((entry) => entry.company.trim() || entry.position.trim())
      .map((entry) => ({
        company: entry.company.trim(),
        position: entry.position.trim(),
        location: entry.location.trim(),
        period: entry.period.trim(),
        description: cleanDescription(entry.description),
        website: cleanWebsite(entry.website),
        roles: entry.roles.map((role) => ({
          position: role.position.trim(),
          period: role.period.trim(),
          description: cleanDescription(role.description),
        })),
      })),
    education: visible(pickSection('education')?.items ?? [])
      .filter((entry) => entry.school.trim() || entry.degree.trim())
      .map((entry) => ({
        school: entry.school.trim(),
        degree: entry.degree.trim(),
        area: entry.area.trim(),
        grade: entry.grade.trim(),
        location: entry.location.trim(),
        period: entry.period.trim(),
        description: cleanDescription(entry.description),
        website: cleanWebsite(entry.website),
      })),
    skills: visible(pickSection('skills')?.items ?? [])
      .filter((entry) => entry.name.trim())
      .map((entry) => ({
        name: entry.name.trim(),
        proficiency: entry.proficiency.trim(),
        level: entry.level,
        keywords: entry.keywords.map((keyword) => keyword.trim()).filter(Boolean),
      })),
    languages: visible(pickSection('languages')?.items ?? [])
      .filter((entry) => entry.language.trim())
      .map((entry) => ({
        language: entry.language.trim(),
        fluency: entry.fluency.trim(),
        level: entry.level,
      })),
    certifications: visible(pickSection('certifications')?.items ?? [])
      .filter((entry) => entry.title.trim())
      .map((entry) => ({
        title: entry.title.trim(),
        issuer: entry.issuer.trim(),
        date: entry.date.trim(),
        description: cleanDescription(entry.description),
        website: cleanWebsite(entry.website),
      })),
    awards: visible(pickSection('awards')?.items ?? [])
      .filter((entry) => entry.title.trim())
      .map((entry) => ({
        title: entry.title.trim(),
        awarder: entry.awarder.trim(),
        date: entry.date.trim(),
        description: cleanDescription(entry.description),
        website: cleanWebsite(entry.website),
      })),
  };
};

const resumes: Record<Lang, Resume> = {
  fr: parseResume(fr, 'fr'),
  en: parseResume(en, 'en'),
};

export const getResume = (lang: Lang): Resume => resumes[lang];

export const getProject = (lang: Lang, slug: string): Project | undefined =>
  resumes[lang].projects.find((project) => project.slug === slug);
