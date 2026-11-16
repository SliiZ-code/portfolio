import { site } from '../data/site';
import type { Resume } from './resume';

interface PersonEntity {
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

interface WebSiteEntity {
  '@type': 'WebSite';
  '@id': string;
  url: string;
  name: string;
  inLanguage: string[];
  publisher: { '@id': string };
  author: { '@id': string };
}

interface ProfilePageEntity {
  '@type': 'ProfilePage';
  '@id': string;
  url: string;
  name: string;
  inLanguage: string;
  mainEntity: { '@id': string };
  isPartOf: { '@id': string };
}

export interface StructuredDataGraph {
  '@context': 'https://schema.org';
  '@graph': (PersonEntity | WebSiteEntity | ProfilePageEntity)[];
}

/** "Julien Petit--Colboc" -> "Julien Petit-Colboc" and "Julien Petit Colboc", the spellings people type. */
const alternateNames = (name: string): string[] =>
  [name.replace(/--/g, '-'), name.replace(/--/g, ' ')].filter((variant) => variant !== name);

const isHttpUrl = (url: string): boolean => /^https?:\/\//.test(url);

/**
 * Schema.org JSON-LD for one page: the Person, the WebSite and the page as a ProfilePage.
 * Built from the resume and the site only. Never email, phone, address or location.
 */
export function buildStructuredData(resume: Resume, pageUrl: string): StructuredDataGraph {
  const root = `${site.url}/`;
  const personId = `${root}#person`;
  const websiteId = `${root}#website`;

  const [givenName, ...familyNameParts] = resume.name.split(' ');
  const familyName = familyNameParts.join(' ');
  const alternates = alternateNames(resume.name);
  const sameAs = resume.profiles.map((profile) => profile.url).filter(isHttpUrl);

  const person: PersonEntity = {
    '@type': 'Person',
    '@id': personId,
    name: resume.name,
    ...(alternates.length > 0 ? { alternateName: alternates } : {}),
    ...(givenName ? { givenName } : {}),
    ...(familyName ? { familyName } : {}),
    ...(resume.headline ? { jobTitle: resume.headline } : {}),
    url: root,
    image: `${root}og.png`,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };

  const website: WebSiteEntity = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: root,
    name: resume.name,
    inLanguage: ['fr', 'en'],
    publisher: { '@id': personId },
    author: { '@id': personId },
  };

  const profilePage: ProfilePageEntity = {
    '@type': 'ProfilePage',
    '@id': `${pageUrl}#profilepage`,
    url: pageUrl,
    name: resume.name,
    inLanguage: resume.lang,
    mainEntity: { '@id': personId },
    isPartOf: { '@id': websiteId },
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [person, website, profilePage],
  };
}

/** Characters that are valid in JSON but can end a <script> block or break a JS parser. */
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

/** JSON for a <script type="application/ld+json">: the unsafe characters become \uXXXX escapes, which JSON.parse reads back. */
export const serializeJsonLd = (data: unknown): string =>
  JSON.stringify(data).replace(
    UNSAFE_IN_SCRIPT,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
