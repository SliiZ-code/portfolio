// The human text of a resume: what gets translated, and how a translation is put back.
// The same walker serves the sanitised French data (the site) and the raw RxResume data (the PDF
// copies), so both keep exactly the same fields in English. Names, companies, schools, emails,
// URLs, networks, numbers and ids are never listed here, so they are never translated.
import { createHash } from 'node:crypto';
import { holdsPhone } from './guard.mjs';

/** The cache key of a French string: sha256 of its UTF-8 text. */
export const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A string with at least one letter; blanks and numbers such as "2024" stay as they are. */
export const needsTranslation = (text) => typeof text === 'string' && /\p{L}/u.test(text);

/** The tags of an HTML string, in order, attributes included: <p>, <a href="...">, </a>... */
export const tagsOf = (html) => (typeof html === 'string' ? html.match(/<[^>]+>/g) ?? [] : []);

/** Same tags in the same order: the only check a translation of a rich-text field must pass. */
export const sameTags = (source, translated) => JSON.stringify(tagsOf(source)) === JSON.stringify(tagsOf(translated));

/** Fields of each section's items that hold prose (plain text or HTML). */
const ITEM_TEXT = {
  profiles: [],
  experience: ['position', 'location', 'period', 'description'],
  education: ['degree', 'area', 'grade', 'location', 'period', 'description'],
  projects: ['name', 'period', 'description'],
  skills: ['name', 'proficiency'],
  languages: ['language', 'fluency'],
  volunteer: ['organization', 'location', 'period', 'description'],
  interests: ['name'],
  certifications: ['title', 'date', 'description'],
  awards: ['title', 'date', 'description'],
};
const ROLE_TEXT = ['position', 'period', 'description'];

/**
 * Applies `fn` to every translatable string of `data` (sanitised or raw) and returns a copy.
 * `fn` is only called for strings that need translating; anything else is left as it is.
 */
export const mapTranslatable = (data, fn) => {
  const out = structuredClone(data && typeof data === 'object' ? data : {});
  const translate = (value) => (needsTranslation(value) ? fn(value) : value);
  const text = (object, key) => {
    if (object && typeof object === 'object' && typeof object[key] === 'string') object[key] = translate(object[key]);
  };
  const keywords = (item) => {
    if (item && Array.isArray(item.keywords)) item.keywords = item.keywords.map(translate);
  };

  const { basics, summary, sections } = out;
  if (basics && typeof basics === 'object') {
    text(basics, 'headline');
    text(basics, 'location');
    text(basics.website, 'label');
  }
  if (summary && typeof summary === 'object') {
    text(summary, 'title');
    text(summary, 'content');
  }
  if (sections && typeof sections === 'object') {
    for (const [key, section] of Object.entries(sections)) {
      if (!(key in ITEM_TEXT) || !section || typeof section !== 'object') continue;
      text(section, 'title');
      for (const item of Array.isArray(section.items) ? section.items : []) {
        if (!item || typeof item !== 'object') continue;
        for (const field of ITEM_TEXT[key]) text(item, field);
        text(item.website, 'label');
        keywords(item);
        if (key === 'experience' && Array.isArray(item.roles)) {
          for (const role of item.roles) for (const field of ROLE_TEXT) text(role, field);
        }
      }
    }
  }
  return out;
};

/** Every translatable string of `data`, each once, in order of appearance. */
export const translatableStrings = (data) => {
  const seen = new Set();
  const found = [];
  mapTranslatable(data, (value) => {
    if (!seen.has(value)) {
      seen.add(value);
      found.push(value);
    }
    return value;
  });
  return found;
};

/**
 * The prose the PDF shows but the site does not: publications and references (their items), custom
 * sections and the custom fields of the header. Only the PDF copies carry them, so only they are translated
 * from here. Hidden sections and items are off the PDF and are skipped. The phone field is never prose.
 */
const PDF_ONLY_ITEM_TEXT = {
  publications: ['title', 'date', 'description'],
  references: ['position', 'description'],
};
const CUSTOM_ITEM_TEXT = ['title', 'position', 'location', 'period', 'date', 'organization', 'summary', 'description'];

/**
 * The raw resume's PDF text, translated: everything `mapTranslatable` does, plus the PDF-only prose above.
 * `phone` keeps any custom field that holds the phone number out of the translation. Returns a copy.
 */
export const mapPdfTranslatable = (data, fn, phone = '') => {
  const out = mapTranslatable(data, fn);
  const translate = (value) => (needsTranslation(value) ? fn(value) : value);
  const text = (object, key) => {
    if (object && typeof object === 'object' && typeof object[key] === 'string') object[key] = translate(object[key]);
  };
  const items = (list) => (Array.isArray(list) ? list : []).filter((item) => item && typeof item === 'object' && !item.hidden);

  if (Array.isArray(out.basics?.customFields)) {
    for (const field of out.basics.customFields) if (field && typeof field === 'object' && !holdsPhone(field, phone)) text(field, 'text');
  }
  for (const [key, fields] of Object.entries(PDF_ONLY_ITEM_TEXT)) {
    const section = out.sections?.[key];
    if (!section || typeof section !== 'object' || section.hidden) continue;
    text(section, 'title');
    for (const item of items(section.items)) for (const field of fields) text(item, field);
  }
  for (const section of items(out.customSections)) {
    if (section.hidden) continue;
    text(section, 'title');
    for (const item of items(section.items)) for (const field of CUSTOM_ITEM_TEXT) text(item, field);
  }
  return out;
};

/** Every string `mapPdfTranslatable` would translate, each once. */
export const pdfTranslatableStrings = (data, phone = '') => {
  const seen = new Set();
  const found = [];
  mapPdfTranslatable(
    data,
    (value) => {
      if (!seen.has(value)) {
        seen.add(value);
        found.push(value);
      }
      return value;
    },
    phone,
  );
  return found;
};
