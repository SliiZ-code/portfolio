#!/usr/bin/env node
// Pull the two public resumes from RxResume and keep only what this site renders.
// When RXRESUME_PDF_ID_FR / RXRESUME_PDF_ID_EN are set, also download the public CV PDFs from
// the dedicated "web" resumes: copies of the main resumes without the phone number, overwritten
// from the main ones at each sync (never edit them by hand).
// Run with: npm run sync:resume
import { mkdir, writeFile } from 'node:fs/promises';
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

/** The file name must match src/lib/cv-pdf.ts, which links to it. */
export const cvPdfFile = (lang) => `julien-petit-colboc-${lang}.pdf`;
const pdfOut = (lang) => new URL(`../public/cv/${cvPdfFile(lang)}`, import.meta.url);

const WEBSITE_KEYS = ['url', 'label', 'inlineLink'];
const website = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(WEBSITE_KEYS.map((key) => [key, typeof source[key] === 'string' ? source[key] : key === 'inlineLink' ? false : '']));
};

const str = (value) => (typeof value === 'string' ? value : '');
const num = (value) => (typeof value === 'number' ? value : 0);
const list = (value) => (Array.isArray(value) ? value : []);

const present = (items) => list(items).filter((item) => item && typeof item === 'object');
const visible = (items) => present(items).filter((item) => !item.hidden);

// A hidden project is left off the PDF but shown on the site; everything else hidden stays private.
const publishable = (items, key) => (key === 'projects' ? present(items) : visible(items));

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
  volunteer: { organization: 'string', location: 'string', period: 'string', website: 'website', description: 'string' },
  interests: { name: 'string', keywords: 'strings' },
  certifications: { title: 'string', issuer: 'string', date: 'string', website: 'website', description: 'string' },
  awards: { title: 'string', awarder: 'string', date: 'string', website: 'website', description: 'string' },
};

const cleanSection = (section, key) => {
  if (!section || typeof section !== 'object' || section.hidden) return null;
  const fields = ITEM_FIELDS[key];
  return {
    title: str(section.title),
    hidden: false,
    items: publishable(section.items, key).map((item) => {
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
 * The one exception is the items of the projects section: hiding a project keeps it off
 * the PDF only, the site still shows it (a hidden projects section is dropped as usual).
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

/** RxResume wraps the resume in `{ data }` on some versions; accept both shapes. */
const dataOf = (body) => body?.data ?? body;
export const resumeFromResponse = (body) => sanitizeResume(dataOf(body));

const digits = (value) => value.replace(/\D/g, '');

const stringsOf = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
};

/**
 * The PDF is public: refuse the web resume if it has a phone number of its own, or if it repeats
 * the main resume's one anywhere (a summary, a custom field...), whatever the formatting.
 * The messages never contain the number.
 */
export const assertWebResume = (main, web) => {
  if (str(web?.basics?.phone).trim()) throw new Error('the web resume has a phone number');
  const phone = str(main?.basics?.phone).trim();
  if (!phone) {
    console.warn("WARNING: the main resume has no phone in basics.phone, so the web resume can't be checked against it");
    return;
  }
  // the last nine digits, so "+33 6 12..." and "06 12..." count as the same number
  const needle = digits(phone).slice(-9);
  const strings = stringsOf(web);
  // also across fields, in case the number is split over two of them
  const joined = digits(strings.join(''));
  if (strings.some((value) => value.includes(phone)) || (needle && joined.includes(needle))) {
    throw new Error("the web resume contains the main resume's phone number");
  }
};

export const assertPdf = (bytes) => {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('the response is not a PDF');
};

/** Same JSON whatever the order of the keys. */
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

/** Does `value` (a custom field...) hold `phone`, however it is written? Same test as assertWebResume. */
const holdsPhone = (value, phone) => {
  if (!phone) return false;
  const needle = digits(phone).slice(-9);
  const strings = stringsOf(value);
  return strings.some((entry) => entry.includes(phone)) || Boolean(needle && digits(strings.join('')).includes(needle));
};

/**
 * What the web resume must hold: the main resume's data, whole (basics, summary, sections, custom
 * sections, metadata, picture...), except that `basics.phone` is empty and the custom fields that
 * hold the phone are gone. Pure: the input is not modified.
 */
export const webDataFrom = (mainData) => {
  const data = structuredClone(mainData && typeof mainData === 'object' ? mainData : {});
  const basics = data.basics;
  if (basics && typeof basics === 'object') {
    const phone = str(basics.phone).trim();
    basics.phone = '';
    if (Array.isArray(basics.customFields)) basics.customFields = basics.customFields.filter((field) => !holdsPhone(field, phone));
  }
  return data;
};

/** JSON Patch operations that turn the top-level keys of `current` into those of `target`; empty when they are the same. */
export const dataOperations = (current, target) => {
  const from = current && typeof current === 'object' ? current : {};
  const operations = [];
  for (const key of Object.keys(target)) {
    // `add` on an existing member replaces it
    if (!(key in from) || stable(from[key]) !== stable(target[key])) operations.push({ op: 'add', path: `/${key}`, value: target[key] });
  }
  for (const key of Object.keys(from)) if (!(key in target)) operations.push({ op: 'remove', path: `/${key}` });
  return operations;
};

const request = (url, key, fetchImpl, { method, body } = {}) =>
  fetchImpl(url, {
    ...(method ? { method, body } : {}),
    headers: { 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
    // never forward the key to wherever a redirect points
    redirect: 'error',
    // a hung RxResume must not hang a deploy
    signal: AbortSignal.timeout(30_000),
  });

const getBody = async (id, baseUrl, key, fetchImpl = fetch) => {
  const response = await request(`${baseUrl}/api/openapi/resumes/${encodeURIComponent(id)}`, key, fetchImpl);
  if (!response.ok) throw new Error(`RxResume ${id}: HTTP ${response.status} ${response.statusText}`);
  return response.json();
};

/**
 * Makes the web resume `id` a copy of the main resume without its phone. Reads it first, writes
 * only when it differs (with its `updatedAt`, so a concurrent edit is refused rather than lost) and
 * returns the web resume as read back afterwards. Refuses to write anything that still holds the phone.
 */
export const syncWebResume = async ({ id, mainId = '', main, baseUrl, key, lang = '', fetchImpl = fetch }) => {
  const target = webDataFrom(main);
  assertWebResume(main, target);
  if (mainId && id === mainId) throw new Error(`web resume ${id} is the main resume: refusing to overwrite it`);
  const current = await getBody(id, baseUrl, key, fetchImpl);
  const operations = dataOperations(dataOf(current), target);
  if (!operations.length) return current;
  const body = { operations, ...(current?.updatedAt ? { expectedUpdatedAt: current.updatedAt } : {}) };
  const response = await request(`${baseUrl}/api/openapi/resumes/${encodeURIComponent(id)}`, key, fetchImpl, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`RxResume ${id} (update): HTTP ${response.status} ${response.statusText}`);
  console.log(`${lang ? `${lang}: ` : ''}web resume updated from the main one (${operations.length} change${operations.length > 1 ? 's' : ''})`);
  // what the PDF will be made from is what is checked, not what was sent
  return getBody(id, baseUrl, key, fetchImpl);
};

/**
 * The web resumes get overwritten: refuse any set of IDs where a web ID is also a main ID (that
 * would blank the phone on the main resume) or where both languages share one web resume.
 */
export const assertDistinctIds = (mainIds, webIds) => {
  const mains = new Set(mainIds.filter(Boolean));
  const webs = webIds.filter(Boolean);
  for (const id of webs) {
    if (mains.has(id)) throw new Error(`web resume ${id} is also a main resume: refusing to overwrite it`);
  }
  if (new Set(webs).size !== webs.length) throw new Error('RXRESUME_PDF_ID_FR and RXRESUME_PDF_ID_EN must be two different resumes');
};

/** The PDF of the web resume `id`: brought up to date with the main resume, then checked, then downloaded. */
export const fetchCvPdf = async ({ id, mainId = '', main, baseUrl, key, lang, fetchImpl = fetch }) => {
  const web = await syncWebResume({ id, mainId, main, baseUrl, key, lang, fetchImpl });
  assertWebResume(main, dataOf(web));
  const response = await request(`${baseUrl}/api/openapi/resumes/${encodeURIComponent(id)}/pdf`, key, fetchImpl);
  if (!response.ok) throw new Error(`RxResume ${id} (pdf): HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertPdf(bytes);
  return bytes;
};

/** One job per language that has a web resume: a refused language never blocks the other. */
export const collectPdfs = async (jobs, { baseUrl, key, fetchImpl }) => {
  const results = await Promise.allSettled(jobs.map((job) => fetchCvPdf({ ...job, baseUrl, key, fetchImpl })));
  const pdfs = new Map();
  const errors = [];
  results.forEach((result, index) => {
    const { lang } = jobs[index];
    if (result.status === 'fulfilled') pdfs.set(lang, result.value);
    else errors.push(`${lang}: ${result.reason?.message ?? result.reason}`);
  });
  return { pdfs, errors };
};

const main = async () => {
  const baseUrl = (process.env.RXRESUME_URL || 'https://rxresu.me').replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://')) throw new Error('RXRESUME_URL must use https://');
  const key = process.env.RXRESUME_API_KEY;
  if (!key) throw new Error('RXRESUME_API_KEY is required');
  const langs = ['fr', 'en'];
  const ids = langs.map((lang) => {
    const id = process.env[`RXRESUME_ID_${lang.toUpperCase()}`];
    if (!id) throw new Error(`RXRESUME_ID_${lang.toUpperCase()} is required`);
    return id;
  });
  // fetch everything first so a failure on one language never leaves the two files out of sync
  assertDistinctIds(ids, langs.map((lang) => process.env[`RXRESUME_PDF_ID_${lang.toUpperCase()}`]));
  const bodies = await Promise.all(ids.map((id) => getBody(id, baseUrl, key)));
  const resumes = bodies.map(resumeFromResponse);
  const jobs = langs.flatMap((lang, index) => {
    const id = process.env[`RXRESUME_PDF_ID_${lang.toUpperCase()}`];
    return id ? [{ lang, id, mainId: ids[index], main: dataOf(bodies[index]) }] : [];
  });
  const { pdfs, errors } = await collectPdfs(jobs, { baseUrl, key, fetchImpl: fetch });
  for (const [index, lang] of langs.entries()) {
    await writeFile(OUT[lang], `${JSON.stringify(resumes[index], null, 2)}\n`);
    console.log(`${lang}: ${resumes[index].basics.name || 'resume'} -> ${OUT[lang].pathname}`);
  }
  await mkdir(new URL('../public/cv/', import.meta.url), { recursive: true });
  for (const [lang, bytes] of pdfs) {
    await writeFile(pdfOut(lang), bytes);
    console.log(`${lang}: pdf -> ${pdfOut(lang).pathname}`);
  }
  // a refused PDF keeps the previous file; the failure still shows in the build log
  if (errors.length) throw new Error(`PDF skipped, previous file kept: ${errors.join('; ')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
