#!/usr/bin/env node
// Pulls the one French resume from RxResume and turns it into the site's data and the public CV PDFs:
//   1. RXRESUME_ID (or RXRESUME_ID_FR) is read, sanitised to what the site renders -> src/data/resume.fr.json
//   2. its prose is translated to English with AI (cached by sha256 in src/data/resume.translations.json)
//      -> src/data/resume.en.json. Without a provider, or when a string is missing, the committed
//      English is kept and a WARNING is printed.
//   3. for each language, a temporary copy is made in RxResume (name `tmp-portfolio-pdf-*`), its PDF is
//      downloaded to public/cv/, and the copy is moved to Trash and purged, even when the PDF fails.
//      Leftover copies from a crashed run are removed first. The main resume is only ever read.
//   4. when all of that worked, the master's fingerprint (scripts/lib/fingerprint.mjs) is written to
//      src/data/resume.fingerprint.json: the autodeploy checker reads it from the site. A partial run keeps
//      the committed one, so the checker keeps retrying.
// The phone number is checked everywhere it could leak: the site data, the cache, the AI payload,
// the copies and the PDFs. Providers: CLAUDE_CODE_OAUTH_TOKEN, then GEMINI_API_KEY, then OPENROUTER_API_KEY.
// Run with: npm run sync:resume
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertNoPhone, assertPdf, pdfHoldsPhone } from './lib/guard.mjs';
import { fingerprintResume, withoutPhone } from './lib/fingerprint.mjs';
import { createApi } from './lib/rxresume.mjs';
import { configuredTranslators, emptyCache, parseCache, serializeCache, translateStrings } from './lib/translate.mjs';
import { mapPdfTranslatable, mapTranslatable, pdfTranslatableStrings, sha, translatableStrings } from './lib/strings.mjs';
import { dataOf, resumeFromResponse, sanitizeResume, stable, str } from './lib/sanitize.mjs';

export { resumeFromResponse, sanitizeResume };

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
const FINGERPRINT = new URL('../src/data/resume.fingerprint.json', import.meta.url);

/** The file name must match src/lib/cv-pdf.ts, which links to it. */
export const cvPdfFile = (lang) => `julien-petit-colboc-${lang}.pdf`;
const pdfOut = (lang) => new URL(`../public/cv/${cvPdfFile(lang)}`, import.meta.url);

/** Every temporary copy this script makes starts with this; only these are ever deleted. */
export const TEMP_PREFIX = 'tmp-portfolio-pdf-';


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
 * What each language's PDF copy changes on top of the main resume: the language only, the look stays the
 * main resume's. RxResume formats the dates, and their "present" label, from `metadata.page.locale`: with the
 * French locale the English PDF printed "janv. 2026 – Aujourd’hui" and "sept. 2028". en-US is the locale of the
 * hand-made English resume, which fitted on one page.
 */
export const PDF_METADATA = { fr: {}, en: { page: { locale: 'en-US' }, typography: { body: { lineHeight: 1.35 } } } };

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const merged = (base, overrides) =>
  Object.entries(overrides).reduce(
    (out, [key, value]) => ({ ...out, [key]: isPlain(value) && isPlain(out[key]) ? merged(out[key], value) : structuredClone(value) }),
    { ...base },
  );

/**
 * What a temporary copy holds: the resume's data, whole (sections, custom sections, metadata, picture...),
 * without the phone (scripts/lib/fingerprint.mjs withoutPhone). Hidden items keep their flag, so RxResume
 * leaves them off the PDF. `overrides` is merged into `metadata` (see PDF_METADATA). Pure: the input is not modified.
 */
export const pdfDataFrom = (mainData, overrides = {}) => {
  const data = withoutPhone(mainData);
  if (Object.keys(overrides).length) data.metadata = merged(isPlain(data.metadata) ? data.metadata : {}, overrides);
  return data;
};

/**
 * The fingerprint to publish after a run: only when the whole master was applied (site data, English and both
 * PDFs). Otherwise null, and the committed fingerprint is kept, so the checker sees a mismatch and retries.
 */
export const fingerprintToPublish = (result) => (result.errors.length === 0 && result.en ? result.fingerprint : null);

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
  const target = pdfDataFrom(source, PDF_METADATA[lang] ?? {});
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
export const runSync = async ({
  mainId,
  api,
  fingerprintKey,
  translators = [],
  cache = emptyCache(),
  stamp = Date.now().toString(36),
  log = console.log,
  warn = console.warn,
}) => {
  const data = dataOf(await api.getResume(mainId));
  const fingerprint = fingerprintResume(data, fingerprintKey);
  const phone = str(data?.basics?.phone).trim();
  if (!phone) warn("WARNING: the main resume has no phone in basics.phone, so the phone checks are skipped");

  const fr = sanitizeResume(data);
  assertNoPhone(fr, phone, 'the French site data');

  // the translators only see the sanitised French strings: the phone can not be in them (checked above and again before the call)
  // the site's strings, and the PDF-only prose (publications, custom sections...) that only the English copy shows
  const strings = [...translatableStrings(fr), ...pdfTranslatableStrings(data, phone)];
  const translation = await translateStrings({ strings, cache, translators, phone, warn });
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
    if (en) jobs.push(['en', mapPdfTranslatable(data, english, phone)]);
    for (const [lang, source] of jobs) {
      try {
        pdfs.set(lang, await makePdf({ api, mainId, lang, source, phone, stamp, log }));
      } catch (error) {
        errors.push(`${lang}: ${error.message}`);
      }
    }
  }
  return { fr, en, cache: translation.cache, complete: translation.complete, pdfs, errors, fingerprint };
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
  const result = await runSync({ mainId, api, fingerprintKey: key, translators, cache, stamp: Date.now().toString(36) });

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
  const published = fingerprintToPublish(result);
  if (published) await writeFile(FINGERPRINT, json({ fingerprint: published }));
  // a refused PDF keeps the previous file; the failure still shows in the build log
  if (result.errors.length) throw new Error(`PDF skipped, previous file kept: ${result.errors.join('; ')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
