#!/usr/bin/env node
// Pull the two public resumes from RxResume and keep only what this site renders.
// Run with: npm run sync:resume
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// `.env` is optional: CI and shells can provide the same variables directly.
try {
  process.loadEnvFile();
} catch {
  // no .env file, keep the current environment
}

const OUT = {
  fr: new URL('../src/data/resume.fr.json', import.meta.url),
  en: new URL('../src/data/resume.en.json', import.meta.url),
};

const WEBSITE_KEYS = ['url', 'label', 'inlineLink'];
const website = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(WEBSITE_KEYS.map((key) => [key, typeof source[key] === 'string' ? source[key] : key === 'inlineLink' ? false : '']));
};

const str = (value) => (typeof value === 'string' ? value : '');
const num = (value) => (typeof value === 'number' ? value : 0);
const list = (value) => (Array.isArray(value) ? value : []);

const visible = (items) => list(items).filter((item) => item && !item.hidden);

const cleanItem = (item, fields) => {
  const source = item && typeof item === 'object' ? item : {};
  const output = { id: str(source.id), hidden: false };
  for (const [key, kind] of Object.entries(fields)) {
    if (kind === 'website') output[key] = website(source[key]);
    else if (kind === 'number') output[key] = num(source[key]);
    else if (kind === 'strings') output[key] = list(source[key]).filter((entry) => typeof entry === 'string');
    else output[key] = str(source[key]);
  }
  return output;
};

const ITEM_FIELDS = {
  profiles: { network: 'string', username: 'string', website: 'website' },
  experience: {
    company: 'string',
    position: 'string',
    location: 'string',
    period: 'string',
    website: 'website',
    description: 'string',
  },
  education: {
    school: 'string',
    degree: 'string',
    area: 'string',
    grade: 'string',
    location: 'string',
    period: 'string',
    website: 'website',
    description: 'string',
  },
  projects: { name: 'string', period: 'string', website: 'website', description: 'string' },
  skills: { name: 'string', proficiency: 'string', level: 'number', keywords: 'strings' },
  languages: { language: 'string', fluency: 'string', level: 'number' },
  certifications: { title: 'string', issuer: 'string', date: 'string', website: 'website', description: 'string' },
  awards: { title: 'string', awarder: 'string', date: 'string', website: 'website', description: 'string' },
};

const cleanSection = (section, key) => {
  if (!section || typeof section !== 'object' || section.hidden) return null;
  const fields = ITEM_FIELDS[key];
  return {
    title: str(section.title),
    hidden: false,
    items: visible(section.items).map((item) => {
      const clean = cleanItem(item, fields);
      if (key === 'experience') {
        clean.roles = list(item.roles).map((role) => ({
          position: str(role?.position),
          period: str(role?.period),
          description: str(role?.description),
        }));
      }
      return clean;
    }),
  };
};

/**
 * Structural sanitiser: metadata (private notes), custom sections, the picture,
 * hidden sections, hidden items and hidden custom fields must never leave this function.
 */
export const sanitizeResume = (input) => {
  const source = input && typeof input === 'object' ? input : {};
  const basics = source.basics && typeof source.basics === 'object' ? source.basics : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : null;
  const sections = source.sections && typeof source.sections === 'object' ? source.sections : {};

  const output = {
    basics: {
      name: str(basics.name),
      headline: str(basics.headline),
      email: str(basics.email),
      location: str(basics.location),
      website: website(basics.website),
    },
    sections: {},
  };

  if (summary && !summary.hidden) {
    output.summary = {
      title: str(summary.title),
      hidden: false,
      content: str(summary.content),
    };
  }

  for (const key of Object.keys(ITEM_FIELDS)) {
    const section = cleanSection(sections[key], key);
    if (section) output.sections[key] = section;
  }

  return output;
};

const getResume = async (id, baseUrl, key) => {
  const response = await fetch(`${baseUrl}/api/openapi/resumes/${encodeURIComponent(id)}`, {
    headers: { 'x-api-key': key },
  });
  if (!response.ok) throw new Error(`RxResume ${id}: HTTP ${response.status} ${response.statusText}`);
  const body = await response.json();
  return body?.data ?? body;
};

const main = async () => {
  const baseUrl = (process.env.RXRESUME_URL || 'https://rxresu.me').replace(/\/+$/, '');
  const key = process.env.RXRESUME_API_KEY;
  if (!key) throw new Error('RXRESUME_API_KEY is required');
  for (const lang of ['fr', 'en']) {
    const id = process.env[`RXRESUME_ID_${lang.toUpperCase()}`];
    if (!id) throw new Error(`RXRESUME_ID_${lang.toUpperCase()} is required`);
    const resume = await getResume(id, baseUrl, key);
    await writeFile(OUT[lang], `${JSON.stringify(sanitizeResume(resume), null, 2)}\n`);
    console.log(`${lang}: ${resume.basics?.name ?? 'resume'} -> ${OUT[lang].pathname}`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
