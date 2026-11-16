import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { site } from '../data/site';
import type { Lang, Resume } from './resume';

export interface StructuredDataOptions {
  /** Optional custom exists function for checking files in public/ (defaults to build-time filesystem check). */
  exists?: (file: string) => boolean;
  /** Optional base URL override (defaults to site.url). */
  baseUrl?: string;
}

export interface PersonEntity {
  '@type': 'Person';
  '@id': string;
  name: string;
  alternateName?: string[];
  givenName?: string;
  familyName?: string;
  jobTitle?: string;
  url: string;
  image: string;
  sameAs?: string[];
}

export interface WebSiteEntity {
  '@type': 'WebSite';
  '@id': string;
  url: string;
  name: string;
  inLanguage: string[];
  publisher: { '@id': string };
  author: { '@id': string };
}

export interface ProfilePageEntity {
  '@type': 'ProfilePage';
  url: string;
  inLanguage: Lang;
  mainEntity: { '@id': string };
  isPartOf: { '@id': string };
}

export type StructuredDataEntity = PersonEntity | WebSiteEntity | ProfilePageEntity;

export interface StructuredDataGraph {
  '@context': 'https://schema.org';
  '@graph': StructuredDataEntity[];
}

const PUBLIC_DIR = join(process.cwd(), 'public');
const inPublicDir = (file: string): boolean => existsSync(join(PUBLIC_DIR, file));

/** Candidates for personal photos in public/. */
const PHOTO_CANDIDATES = [
  'photo.jpg',
  'photo.jpeg',
  'photo.png',
  'photo.webp',
  'portrait.jpg',
  'portrait.jpeg',
  'portrait.png',
  'portrait.webp',
  'avatar.jpg',
  'avatar.jpeg',
  'avatar.png',
  'avatar.webp',
  'profile.jpg',
  'profile.jpeg',
  'profile.png',
  'profile.webp',
  'julien.jpg',
  'julien.jpeg',
  'julien.png',
  'julien.webp',
];

/** Derives alternate name spellings (e.g. replacing "--" with "-" and " "). */
export const deriveAlternateNames = (name: string): string[] => {
  if (!name.includes('--')) return [];
  const withSingleHyphen = name.replace(/--/g, '-');
  const withSpace = name.replace(/--/g, ' ');
  const variants = [withSingleHyphen, withSpace].filter((variant) => variant !== name);
  return Array.from(new Set(variants));
};

/** Resolves the absolute URL of the photo or fallback og.png. */
export const resolvePersonImage = (
  baseUrl: string,
  exists: (file: string) => boolean = inPublicDir
): string => {
  const photo = PHOTO_CANDIDATES.find((candidate) => exists(candidate));
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return photo ? `${cleanBase}/${photo}` : `${cleanBase}/og.png`;
};

export type BuildStructuredDataInput =
  | [resume: Resume, lang: Lang, pageUrl: string, options?: StructuredDataOptions]
  | [params: { resume: Resume; lang: Lang; pageUrl: string; options?: StructuredDataOptions }];

/**
 * Builds Schema.org JSON-LD structured data with an @graph holding Person, WebSite, and ProfilePage.
 * Never includes private data such as email, phone, or postal address.
 */
export function buildStructuredData(
  resumeOrParams: Resume | { resume: Resume; lang: Lang; pageUrl: string; options?: StructuredDataOptions },
  maybeLang?: Lang,
  maybePageUrl?: string,
  maybeOptions?: StructuredDataOptions
): StructuredDataGraph {
  let resume: Resume;
  let lang: Lang;
  let pageUrl: string;
  let options: StructuredDataOptions | undefined;

  if (typeof maybeLang === 'string' && typeof maybePageUrl === 'string') {
    resume = resumeOrParams as Resume;
    lang = maybeLang;
    pageUrl = maybePageUrl;
    options = maybeOptions;
  } else {
    const params = resumeOrParams as {
      resume: Resume;
      lang: Lang;
      pageUrl: string;
      options?: StructuredDataOptions;
    };
    resume = params.resume;
    lang = params.lang;
    pageUrl = params.pageUrl;
    options = params.options;
  }

  const rawBase = options?.baseUrl || site.url || 'https://sliiz.com';
  const baseUrl = rawBase.replace(/\/+$/, '');
  const rootUrl = `${baseUrl}/`;
  const exists = options?.exists ?? inPublicDir;

  const [givenName, ...familyParts] = (resume.name || '').split(' ');
  const familyName = familyParts.length > 0 ? familyParts.join(' ') : undefined;
  const alternateNames = deriveAlternateNames(resume.name || '');

  const personId = `${baseUrl}/#person`;
  const websiteId = `${baseUrl}/#website`;

  const profiles = (resume.profiles || [])
    .map((profile) => profile.url)
    .filter((url) => typeof url === 'string' && url.length > 0);

  const person: PersonEntity = {
    '@type': 'Person',
    '@id': personId,
    name: resume.name,
    ...(alternateNames.length > 0 ? { alternateName: alternateNames } : {}),
    ...(givenName ? { givenName } : {}),
    ...(familyName ? { familyName } : {}),
    ...(resume.headline ? { jobTitle: resume.headline } : {}),
    url: rootUrl,
    image: resolvePersonImage(baseUrl, exists),
    ...(profiles.length > 0 ? { sameAs: profiles } : {}),
  };

  const website: WebSiteEntity = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: rootUrl,
    name: resume.name,
    inLanguage: ['fr', 'en'],
    publisher: { '@id': personId },
    author: { '@id': personId },
  };

  const profilePage: ProfilePageEntity = {
    '@type': 'ProfilePage',
    url: pageUrl,
    inLanguage: lang,
    mainEntity: { '@id': personId },
    isPartOf: { '@id': websiteId },
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [person, website, profilePage],
  };
}

/**
 * Serializes data to JSON and escapes `<` characters to prevent breaking out of `<script>` tags.
 */
export const serializeJsonLd = (data: unknown): string => {
  return JSON.stringify(data).replace(/</g, '\\u003c');
};
