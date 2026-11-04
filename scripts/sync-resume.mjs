#!/usr/bin/env node
// Pull the two public resumes from RxResume and keep only what this site renders.
// When RXRESUME_PDF_ID_FR / RXRESUME_PDF_ID_EN are set, also download the public CV PDFs from
// the dedicated "web" resumes (the same resumes without the phone number).
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
  if (!phone) return;
  // the last nine digits, so "+33 6 12..." and "06 12..." count as the same number
  const needle = digits(phone).slice(-9);
  if (stringsOf(web).some((value) => value.includes(phone) || (needle && digits(value).includes(needle)))) {
    throw new Error("the web resume contains the main resume's phone number");
  }
};

export const assertPdf = (bytes) => {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('the response is not a PDF');
};

const request = (url, key, fetchImpl) =>
  fetchImpl(url, {
    headers: { 'x-api-key': key },
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

/** The PDF of the web resume `id`, only once its JSON has passed `assertWebResume`. */
export const fetchCvPdf = async ({ id, main, baseUrl, key, fetchImpl = fetch }) => {
  assertWebResume(main, dataOf(await getBody(id, baseUrl, key, fetchImpl)));
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
  const bodies = await Promise.all(ids.map((id) => getBody(id, baseUrl, key)));
  const resumes = bodies.map(resumeFromResponse);
  const jobs = langs.flatMap((lang, index) => {
    const id = process.env[`RXRESUME_PDF_ID_${lang.toUpperCase()}`];
    return id ? [{ lang, id, main: dataOf(bodies[index]) }] : [];
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
