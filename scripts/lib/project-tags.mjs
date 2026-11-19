// One or two technologies per project, picked by AI from the French project descriptions and cached in
// src/data/project-tags.json. The model may only name a technology that the description already names,
// and every answer is checked against the text before it is cached. The step is optional: without a
// provider, or with a bad answer, the previous tags are kept and the sync carries on.
import { sha } from './strings.mjs';

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The cache file's shape: { version: 1, projects: { <project id>: { tags, model, hash } } }. */
export const emptyTagCache = () => ({ version: 1, projects: {} });

const cleanTags = (tags) => (Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()) : []);

const cleanEntry = (entry) => ({
  tags: cleanTags(entry?.tags),
  model: typeof entry?.model === 'string' ? entry.model : '',
  hash: typeof entry?.hash === 'string' ? entry.hash : '',
});

/** The committed cache, or an empty one when the file is missing or unreadable. */
export const parseTagCache = (text) => {
  try {
    const data = JSON.parse(text ?? '');
    if (data?.version === 1 && isPlain(data.projects)) {
      const projects = {};
      for (const [id, entry] of Object.entries(data.projects)) {
        if (!id || !isPlain(entry) || !Array.isArray(entry.tags)) continue;
        const clean = cleanEntry(entry);
        if (clean.hash) projects[id] = clean;
      }
      return { version: 1, projects };
    }
  } catch {
    // a broken cache is rebuilt from the AI, never trusted
  }
  return emptyTagCache();
};

/** Deterministic text: projects sorted by id, so the same cache always produces the same file. */
export const serializeTagCache = (cache) => {
  const projects = Object.fromEntries(
    Object.keys(cache?.projects ?? {})
      .sort()
      .map((id) => [id, cleanEntry(cache.projects[id])]),
  );
  return `${JSON.stringify({ version: 1, projects }, null, 2)}\n`;
};

/**
 * The text a tag must appear in: the sanitised description without its HTML tags, so markup such as
 * `<p>` or `href` can never validate a tag the prose does not name.
 */
export const descriptionText = (description) => String(description ?? '').replace(/<[^>]*>/g, ' ');

const RULES = [
  'You pick the main technologies of software projects for a portfolio.',
  'The input is a JSON object: each key is a project id, each value has the project name and its description (HTML, in French).',
  'For each project, answer with 1 or 2 main technologies that its description explicitly names.',
  'Rules:',
  '- Only a name that appears verbatim in that project description, ignoring case.',
  '- Prefer the language or framework the project is built with over a library, a tool or a platform.',
  '- Invent nothing: no technology the description does not name.',
  '- Answer with ONLY a JSON object with exactly the same keys, each value an array of 1 or 2 strings.',
].join('\n');

/** What a provider is sent: the rules, then the projects as JSON. */
export const buildTagPrompt = (projects) =>
  `${RULES}\n\nInput:\n${JSON.stringify(
    Object.fromEntries(projects.map((project) => [project.id, { name: project.name, description: project.description }])),
    null,
    2,
  )}`;

/**
 * The tags of one answer, or null when the answer for that project is unusable: not an array, a
 * value that is not a string, an empty tag, or a tag the description does not name. At most
 * `maxTags` are kept, and a repeat of the same tag (ignoring case) only counts once.
 */
const tagsFromAnswer = (answer, project, maxTags) => {
  if (!Array.isArray(answer)) return null;
  if (answer.slice(0, maxTags).some((tag) => typeof tag !== 'string')) return null;
  const text = descriptionText(project.description).toLowerCase();
  const tags = [];
  for (const raw of answer.slice(0, maxTags)) {
    const tag = raw.trim();
    if (!tag || !text.includes(tag.toLowerCase())) return null;
    if (!tags.some((seen) => seen.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags;
};

/**
 * Generates the tags of the projects whose French name or description changed. A cached entry is
 * reused when its hash matches; only the others go to `complete`, in one batch. Every answer is
 * validated against the text, with one retry for the whole batch. A project that is still invalid
 * keeps its previous entry, and an entry whose project is gone is pruned. Never throws, and logs
 * counts only: the sync must not fail because of tags.
 */
export const generateProjectTags = async ({ projects = [], cache = emptyTagCache(), complete, model = '', warn = () => {}, maxTags = 2 } = {}) => {
  const list = (Array.isArray(projects) ? projects : [])
    .filter((project) => isPlain(project) && typeof project.id === 'string' && project.id)
    .map((project) => ({ id: project.id, name: String(project.name ?? ''), description: String(project.description ?? '') }));
  const previous = isPlain(cache?.projects) ? cache.projects : {};
  const limit = Number.isInteger(maxTags) && maxTags > 0 ? maxTags : 2;

  const entries = {};
  const pending = [];
  let reused = 0;
  for (const project of list) {
    const hash = sha(`${project.name}\n${project.description}`);
    const hit = previous[project.id];
    if (hit && hit.hash === hash) {
      entries[project.id] = cleanEntry(hit);
      reused += 1;
    } else {
      pending.push({ ...project, hash });
    }
  }
  const keepPrevious = (project) => {
    if (previous[project.id]) entries[project.id] = cleanEntry(previous[project.id]);
  };
  const result = (generated) => ({ cache: { version: 1, projects: entries }, total: list.length, reused, generated });

  if (!pending.length) return result(0);
  if (typeof complete !== 'function') {
    warn('WARNING: project tags were not generated (no OpenCode key), the previous tags are kept');
    for (const project of pending) keepPrevious(project);
    return result(0);
  }

  let accepted = new Map();
  let failed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) warn(`WARNING: the project tag answer was invalid for ${pending.length - accepted.size} of ${pending.length} projects, retrying once`);
    let answer;
    try {
      answer = await complete(buildTagPrompt(pending));
    } catch {
      // provider errors can quote the prompt: keep the previous tags, and the message out of the log
      warn('WARNING: project tags could not be generated, the previous tags are kept');
      accepted = new Map();
      failed = true;
      break;
    }
    accepted = new Map();
    if (isPlain(answer)) {
      for (const project of pending) {
        const tags = tagsFromAnswer(answer[project.id], project, limit);
        if (tags) accepted.set(project.id, tags);
      }
    }
    if (accepted.size === pending.length) break;
  }

  for (const project of pending) {
    if (accepted.has(project.id)) {
      entries[project.id] = { tags: accepted.get(project.id), model: typeof model === 'string' ? model : '', hash: project.hash };
    } else {
      keepPrevious(project);
    }
  }
  if (!failed && accepted.size < pending.length) {
    warn(`WARNING: project tags are missing for ${pending.length - accepted.size} of ${pending.length} projects, their previous tags are kept`);
  }
  return result(accepted.size);
};
