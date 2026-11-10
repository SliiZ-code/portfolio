#!/usr/bin/env node
// Pulls the one French resume from RxResume and turns it into the site's data and the public CV PDFs:
//   1. RXRESUME_ID (or RXRESUME_ID_FR) is read, sanitised to what the site renders -> src/data/resume.fr.json
//   2. its prose is translated to English with AI (cached by sha256 in src/data/resume.translations.json)
//      -> src/data/resume.en.json. Without a provider, or when a string is missing, the committed
//      English is kept and a WARNING is printed.
//   3. for each language, a temporary copy is made in RxResume (name `tmp-portfolio-pdf-*`), its PDF is
//      downloaded to public/cv/, and the copy is moved to Trash and purged, even when the PDF fails.
//      Leftover copies from a crashed run are removed first. The main resume is only ever read.
// The phone number is checked everywhere it could leak: the site data, the cache, the AI payload,
// the copies and the PDFs. Providers: CLAUDE_CODE_OAUTH_TOKEN, then GEMINI_API_KEY, then OPENROUTER_API_KEY.
// Run with: npm run sync:resume
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertNoPhone, assertPdf, holdsPhone, pdfHoldsPhone } from './lib/guard.mjs';
import { createApi } from './lib/rxresume.mjs';
import { configuredTranslators, emptyCache, parseCache, serializeCache, translateStrings } from './lib/translate.mjs';
import { mapTranslatable, sha, translatableStrings } from './lib/strings.mjs';

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
const CACHE = new URL('../src/data/resume.translations.json', import.meta.url);

/** The file name must match src/lib/cv-pdf.ts, which links to it. */
export const cvPdfFile = (lang) => `julien-petit-colboc-${lang}.pdf`;
const pdfOut = (lang) => new URL(`../public/cv/${cvPdfFile(lang)}`, import.meta.url);

/** Every temporary copy this script makes starts with this; only these are ever deleted. */
export const TEMP_PREFIX = 'tmp-portfolio-pdf-';

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

/** Same JSON whatever the order of the keys. */
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

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

/**
 * What a temporary copy holds: the resume's data, whole (sections, custom sections, metadata, picture...),
 * except that `basics.phone` is empty and the custom fields that hold the phone are gone. Hidden
 * items keep their flag, so RxResume leaves them off the PDF. Pure: the input is not modified.
 */
export const pdfDataFrom = (mainData) => {
  const data = structuredClone(mainData && typeof mainData === 'object' ? mainData : {});
  const basics = data.basics;
  if (basics && typeof basics === 'object') {
    const phone = str(basics.phone).trim();
    basics.phone = '';
    if (Array.isArray(basics.customFields)) basics.customFields = basics.customFields.filter((field) => !holdsPhone(field, phone));
  }
  return data;
};

/** The main resume's id: RXRESUME_ID, with RXRESUME_ID_FR accepted as an alias. */
export const resumeIdFrom = (env) => {
  const id = (env.RXRESUME_ID || env.RXRESUME_ID_FR || '').trim();
  if (!id) throw new Error('RXRESUME_ID is required (RXRESUME_ID_FR is accepted as an alias)');
  return id;
};

/** Deletes the copies a crashed run left behind: only names or slugs starting with the prefix, never the main resume. */
export const cleanupLeftovers = async ({ api, mainId, log = console.log }) => {
  const found = (await api.listResumes()).filter((resume) => [resume?.name, resume?.slug].some((value) => typeof value === 'string' && value.startsWith(TEMP_PREFIX)));
  if (found.some((resume) => resume.id === mainId)) throw new Error('refusing to delete the main resume');
  for (const resume of found) {
    await api.removeResume(resume.id);
    log(`removed a leftover copy from a previous run (${resume.id})`);
  }
  return found.length;
};

/**
 * The PDF of one language. A temporary copy is created, filled with `source` minus the phone, read back
 * and checked, then its PDF is downloaded and checked. The copy is removed in every case, and a removal
 * failure is an error of its own. Refuses to touch the main resume.
 */
export const makePdf = async ({ api, mainId, lang, source, phone, stamp, log = console.log }) => {
  const target = pdfDataFrom(source);
  assertNoPhone(target, phone, 'the data for the PDF copy');
  const name = `${TEMP_PREFIX}${lang}-${stamp}`;
  const id = await api.createResume({ name, slug: name });
  if (id === mainId) throw new Error('refusing to use the main resume as a copy');
  log(`${lang}: copy ${id} created for the PDF`);

  let bytes;
  let failure = null;
  try {
    const current = await api.getResume(id);
    // a copy is private from its creation: a public one would put the CV, phone aside, on the web
    if (current.isPublic === true) throw new Error(`the copy ${id} is public, refusing to fill it`);
    const operations = dataOperations(current.data ?? {}, target);
    if (operations.length) await api.patchResume(id, operations, current.updatedAt);
    const readback = await api.getResume(id);
    assertNoPhone(readback.data ?? {}, phone, 'the copy in RxResume');
    bytes = await api.downloadPdf(id);
    assertPdf(bytes);
    if (pdfHoldsPhone(bytes, phone)) throw new Error('the PDF holds the phone number');
  } catch (error) {
    failure = error;
  }
  const removal = await api.removeResume(id).then(
    () => null,
    (error) => error,
  );
  const leftover = removal ? `the copy ${id} could not be removed (${removal.message}): delete it in RxResume` : '';
  if (failure) throw new Error(leftover ? `${failure.message}; ${leftover}` : failure.message);
  if (leftover) throw new Error(leftover);
  return bytes;
};

/**
 * The whole sync, with every outside call injected. Returns what to write; writes nothing itself.
 * Throws (and writes nothing) when a phone number would reach the site data.
 */
export const runSync = async ({ mainId, api, translators = [], cache = emptyCache(), stamp = Date.now().toString(36), log = console.log, warn = console.warn }) => {
  const data = dataOf(await api.getResume(mainId));
  const phone = str(data?.basics?.phone).trim();
  if (!phone) warn("WARNING: the main resume has no phone in basics.phone, so the phone checks are skipped");

  const fr = sanitizeResume(data);
  assertNoPhone(fr, phone, 'the French site data');

  // the translators only see the sanitised French strings: the phone can not be in them (checked above and again before the call)
  const translation = await translateStrings({ strings: translatableStrings(fr), cache, translators, phone, warn });
  const english = (text) => translation.cache.entries[sha(text)]?.en ?? text;
  const en = translation.complete ? mapTranslatable(fr, english) : null;
  if (en) assertNoPhone(en, phone, 'the English site data');
  assertNoPhone(Object.values(translation.cache.entries).map((entry) => entry.en), phone, 'the translations cache');
  if (!en) warn('WARNING: the English resume was not rebuilt (translation incomplete): the committed src/data/resume.en.json is kept, and the English PDF is skipped');

  const pdfs = new Map();
  const errors = [];
  let ready = true;
  try {
    await cleanupLeftovers({ api, mainId, log });
  } catch (error) {
    ready = false;
    errors.push(`leftover copies: ${error.message}`);
  }
  if (ready) {
    const jobs = [['fr', data]];
    if (en) jobs.push(['en', mapTranslatable(data, english)]);
    for (const [lang, source] of jobs) {
      try {
        pdfs.set(lang, await makePdf({ api, mainId, lang, source, phone, stamp, log }));
      } catch (error) {
        errors.push(`${lang}: ${error.message}`);
      }
    }
  }
  return { fr, en, cache: translation.cache, complete: translation.complete, pdfs, errors };
};

const readOptional = (url) => readFile(url, 'utf8').catch(() => '');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const main = async () => {
  const env = process.env;
  const baseUrl = (env.RXRESUME_URL || 'https://rxresu.me').replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://')) throw new Error('RXRESUME_URL must use https://');
  const key = env.RXRESUME_API_KEY;
  if (!key) throw new Error('RXRESUME_API_KEY is required');
  const mainId = resumeIdFrom(env);

  const api = createApi({ baseUrl, key, fetchImpl: fetch, protectedId: mainId });
  const translators = configuredTranslators(env, { fetchImpl: fetch, spawnImpl: spawn });
  const cache = parseCache(await readOptional(CACHE));
  const result = await runSync({ mainId, api, translators, cache, stamp: Date.now().toString(36) });

  await writeFile(OUT.fr, json(result.fr));
  console.log(`fr: ${result.fr.basics.name || 'resume'} -> ${OUT.fr.pathname}`);
  if (result.en) {
    await writeFile(OUT.en, json(result.en));
    console.log(`en: ${result.en.basics.name || 'resume'} -> ${OUT.en.pathname}`);
  }
  await writeFile(CACHE, serializeCache(result.cache));
  await mkdir(new URL('../public/cv/', import.meta.url), { recursive: true });
  for (const [lang, bytes] of result.pdfs) {
    await writeFile(pdfOut(lang), bytes);
    console.log(`${lang}: pdf -> ${pdfOut(lang).pathname}`);
  }
  // a refused PDF keeps the previous file; the failure still shows in the build log
  if (result.errors.length) throw new Error(`PDF skipped, previous file kept: ${result.errors.join('; ')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
