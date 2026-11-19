// The sanitiser: turns the RxResume resume into exactly what the site renders (src/data/resume.fr.json).
// Pure, no I/O, no secrets. The sync and the site's data both come from it. The master's fingerprint
// (scripts/lib/fingerprint.mjs) covers the whole phone-free data instead, since the CV PDF shows more.
// Anything not in the output (metadata, picture, phone, hidden sections and items) never leaves it.

const WEBSITE_KEYS = ['url', 'label', 'inlineLink'];
const website = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(WEBSITE_KEYS.map((key) => [key, typeof source[key] === 'string' ? source[key] : key === 'inlineLink' ? false : '']));
};

export const str = (value) => (typeof value === 'string' ? value : '');
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
 * The header's custom fields that carry a public link, as profiles. RxResume keeps the GitHub and
 * LinkedIn links there, not in the Profiles section; a field without an http(s) link (the phone,
 * the email) or a hidden field never leaves this function.
 */
const linkedProfiles = (basics) =>
  present(basics.customFields)
    .filter((field) => !field.hidden)
    .flatMap((field) => {
      const network = str(field.text).trim();
      const url = str(field.link).trim();
      if (!network || !/^https?:\/\//i.test(url)) return [];
      return [
        {
          id: str(field.id),
          hidden: false,
          network,
          username: '',
          website: { url, label: network, inlineLink: false },
        },
      ];
    });

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

  // The header links (GitHub, LinkedIn) are custom fields, not Profiles items: publish the ones
  // that carry an http(s) link, after the Profiles section's own items, and never when that section
  // is hidden. A field without a link (the phone) is dropped like every other custom field.
  const links = linkedProfiles(basics);
  if (links.length && sections.profiles?.hidden !== true) {
    const existing = output.sections.profiles;
    const seen = new Set();
    const items = [...links, ...(existing?.items ?? [])].filter((item) => {
      const url = str(item.website?.url).trim().toLowerCase();
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    output.sections.profiles = { title: existing?.title ?? '', hidden: false, items };
  }

  return output;
};

/** RxResume wraps the resume in `{ data }` on some versions; accept both shapes. */
export const dataOf = (body) => body?.data ?? body;
export const resumeFromResponse = (body) => sanitizeResume(dataOf(body));

/** Same JSON whatever the order of the keys. */
export const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
