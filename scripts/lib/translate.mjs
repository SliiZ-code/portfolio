// French -> English for the resume's prose, with a committed cache (src/data/resume.translations.json)
// keyed by sha256(French). Only strings missing from the cache reach an AI provider. Providers are
// tried in order (claude, gemini, openrouter): the first one configured wins, and a failure falls
// through to the next. Every answer is validated before it is cached, and a provider never sees
// the phone number.
import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { holdsPhone } from './guard.mjs';
import { sameTags, sha } from './strings.mjs';

export const DEFAULT_MODELS = {
  claude: 'claude-haiku-5-5',
  gemini: 'gemini-3.5-flash',
  openrouter: 'anthropic/claude-haiku-4.5',
};

/** The Claude Code CLI run with npx when `claude` is not installed. Pinned: bump it on purpose, never `latest`. */
export const CLAUDE_CODE_PACKAGE = '@anthropic-ai/claude-code@2.1.311';

const RULES = [
  'You translate a French CV into professional English for recruiters.',
  'The input is a JSON object: each key is an id, each value a French text. Answer with ONLY a JSON object with exactly the same keys, each value being its English translation.',
  'Rules:',
  '- Faithful, concise CV English: keep every fact and qualifier of the French, add nothing, drop nothing.',
  '- Do not repeat a word or an acronym the French does not repeat, and do not add an abbreviation the French does not have.',
  '- Use the usual English CV wording for headings and job titles, e.g. "Réseaux" -> "Online profiles", "Compétences" -> "Skills", "Ingénieur d\'études en alternance" -> "Work-study engineer".',
  '- "Langages" is the skill group of programming languages (the English CV has a "Languages" section too): translate it "Programming languages". "Langues" is the spoken languages section: "Languages".',
  '- Grammar: articles and plurals must agree with the English that follows ("un stage" -> "an internship", never "a internship").',
  '- Keep these unchanged: person and company names, school names, product and technology names, network names, URLs, email addresses, numbers.',
  "- Periods and dates: translate the month names and \"aujourd'hui\" / \"aujourd’hui\" to \"present\", e.g. \"janv. 2026 – aujourd’hui\" -> \"Jan 2026 – present\".",
  '- Render French school and engineering terms naturally, e.g. "alternance" -> "work-study/apprenticeship", "Classe préparatoire intégrée" -> "Integrated preparatory programme".',
  '- A value may contain HTML. Keep every tag and attribute exactly as it is, in the same order, and translate only the text between the tags. Never add or remove a tag.',
  '- Never output anything except the JSON object.',
].join('\n');

/** What a provider is sent: the rules, then the strings as JSON. */
export const buildPrompt = (input) => `${RULES}\n\nInput:\n${JSON.stringify(input, null, 2)}`;

export const emptyCache = () => ({ version: 1, entries: {} });

/** The committed cache, or an empty one when the file is missing or unreadable. */
export const parseCache = (text) => {
  try {
    const data = JSON.parse(text ?? '');
    if (data?.version === 1 && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
      const entries = Object.fromEntries(Object.entries(data.entries).filter(([, entry]) => entry && typeof entry.en === 'string' && entry.en.trim()));
      return { version: 1, entries };
    }
  } catch {
    // a broken cache is rebuilt from the AI, never trusted
  }
  return emptyCache();
};

/** Deterministic text: entries sorted by key, so the same cache always produces the same file. */
export const serializeCache = (cache) => {
  const entries = Object.fromEntries(
    Object.keys(cache.entries)
      .sort()
      .map((key) => [key, { en: cache.entries[key].en, model: cache.entries[key].model ?? '' }]),
  );
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
};

/** Parses an answer, tolerating a Markdown code fence around the JSON. */
export const parseJsonObject = (text) => {
  const body = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    // the JSON parser message can quote the input: never repeat it
    throw new Error('the answer is not JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('the answer is not a JSON object');
  return value;
};

/**
 * Checks an answer: every key present with a non-empty string, HTML tags unchanged, no phone number.
 * The errors name the keys only, never the text.
 */
export const validateTranslations = (input, output, phone = '') => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('the answer is not a JSON object');
  const values = {};
  const bad = [];
  for (const [key, source] of Object.entries(input)) {
    const value = output[key];
    if (typeof value !== 'string' || !value.trim()) {
      bad.push(`${key}: missing`);
      continue;
    }
    if (!sameTags(source, value)) bad.push(`${key}: HTML tags changed`);
    if (phone && holdsPhone(value, phone)) bad.push(`${key}: holds the phone number`);
    values[key] = value;
  }
  if (bad.length) throw new Error(`invalid translation (${bad.join('; ')})`);
  return values;
};

const chunkBy = (strings, maxChars) => {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const text of strings) {
    if (current.length && size + text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

/** One call, validated; a bad answer gets one more try. Returns [french, english] pairs. */
const translateChunk = async (provider, chunk, phone) => {
  const input = Object.fromEntries(chunk.map((text, index) => [`s${index + 1}`, text]));
  let failure = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = validateTranslations(input, await provider.translate(input), phone);
      return chunk.map((text, index) => [text, output[`s${index + 1}`]]);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
};

/**
 * Translates the strings the cache does not hold yet. Returns the cache for exactly these strings
 * (unused entries are pruned) and whether every string now has an English text.
 */
export const translateStrings = async ({ strings, cache = emptyCache(), translators = [], phone = '', warn = () => {}, maxChars = 6000 }) => {
  const wanted = [...new Set(strings)];
  if (phone && wanted.some((text) => holdsPhone(text, phone))) throw new Error('a text to translate holds the phone number: translation refused');

  const entries = {};
  for (const text of wanted) {
    const hit = cache.entries[sha(text)];
    if (hit?.en) entries[sha(text)] = { en: hit.en, model: hit.model ?? '' };
  }
  const pending = () => wanted.filter((text) => !entries[sha(text)]);

  for (const provider of translators) {
    if (!pending().length) break;
    for (const chunk of chunkBy(pending(), maxChars)) {
      try {
        for (const [text, en] of await translateChunk(provider, chunk, phone)) entries[sha(text)] = { en, model: provider.model };
      } catch (error) {
        warn(`WARNING: ${provider.name} could not translate the resume (${error.message}), trying the next provider`);
        break;
      }
    }
  }

  return {
    cache: { version: 1, entries },
    complete: wanted.every((text) => entries[sha(text)]),
  };
};

/** The environment a `claude` child gets: the minimum to run, and the token. Never the RxResume keys. */
export const claudeEnv = (env) => ({
  PATH: env.PATH ?? '',
  HOME: env.HOME ?? '',
  ...(env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN } : {}),
});

/**
 * Claude Code, headless: `claude -p` with no tools, the prompt on stdin, JSON out. The token comes
 * from `claude setup-token`; without it the local login of the CLI is used (TRANSLATE_CLAUDE_LOCAL=1).
 */
export const claudeProvider = ({ command = 'claude', args = [], env = process.env, spawnImpl = nodeSpawn, model = env.TRANSLATE_CLAUDE_MODEL || DEFAULT_MODELS.claude, timeoutMs = 240_000 } = {}) => ({
  name: 'claude',
  model,
  translate: (input) =>
    new Promise((resolve, reject) => {
      const cliArgs = [...args, '-p', '--output-format', 'json', '--model', model, '--tools', '', '--no-session-persistence'];
      // An empty, fresh working directory: no CLAUDE.md, settings or hooks of the repository reach the child.
      const workdir = mkdtempSync(join(tmpdir(), 'resume-translate-'));
      const child = spawnImpl(command, cliArgs, { cwd: workdir, env: claudeEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rmSync(workdir, { recursive: true, force: true });
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(new Error('claude: timed out'));
        child.kill?.();
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      // stderr is never shown (it can echo the prompt) but must be drained, or a full pipe stalls the child
      child.stderr?.resume();
      // a child that exits before reading its prompt reports EPIPE here: the close event tells the story
      child.stdin.on('error', () => {});
      child.on('error', () => finish(new Error('claude: could not start')));
      child.on('close', (code) => {
        if (code !== 0) return finish(new Error(`claude: exit code ${code}`));
        let envelope;
        try {
          envelope = JSON.parse(stdout);
        } catch {
          return finish(new Error('claude: the answer is not JSON'));
        }
        if (envelope?.is_error) return finish(new Error('claude: the CLI reported an error'));
        try {
          finish(null, parseJsonObject(envelope?.result));
        } catch (error) {
          finish(new Error(`claude: ${error.message}`));
        }
      });
      child.stdin.write(buildPrompt(input));
      child.stdin.end();
    }),
});

/** Gemini REST generateContent, JSON mode. The key goes in a header, never in the URL. */
export const geminiProvider = ({ apiKey, model = DEFAULT_MODELS.gemini, fetchImpl = fetch, timeoutMs = 120_000 } = {}) => ({
  name: 'gemini',
  model,
  translate: async (input) => {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    if (!response.ok) throw new Error(`gemini: HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    const text = (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    return parseJsonObject(text);
  },
});

/** OpenRouter, OpenAI-compatible chat completions, JSON mode. */
export const openrouterProvider = ({ apiKey, model = DEFAULT_MODELS.openrouter, fetchImpl = fetch, timeoutMs = 120_000 } = {}) => ({
  name: 'openrouter',
  model,
  translate: async (input) => {
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!response.ok) throw new Error(`openrouter: HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    return parseJsonObject(body?.choices?.[0]?.message?.content);
  },
});

/** The first executable called `name` on PATH, or null. */
export const findExecutable = (name, pathValue = '') => {
  for (const dir of String(pathValue).split(delimiter).filter(Boolean)) {
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // not here, keep looking
    }
  }
  return null;
};

/** The providers the environment configures, in the order they are tried. */
export const configuredTranslators = (env, { fetchImpl = fetch, spawnImpl = nodeSpawn, findCommand = (name) => findExecutable(name, env.PATH) } = {}) => {
  const providers = [];
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.TRANSLATE_CLAUDE_LOCAL === '1') {
    const found = findCommand('claude');
    providers.push(
      claudeProvider({
        command: found ?? 'npx',
        args: found ? [] : ['-y', CLAUDE_CODE_PACKAGE],
        env,
        spawnImpl,
        model: env.TRANSLATE_CLAUDE_MODEL || DEFAULT_MODELS.claude,
      }),
    );
  }
  if (env.GEMINI_API_KEY) {
    providers.push(geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.TRANSLATE_GEMINI_MODEL || DEFAULT_MODELS.gemini, fetchImpl }));
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push(openrouterProvider({ apiKey: env.OPENROUTER_API_KEY, model: env.TRANSLATE_OPENROUTER_MODEL || DEFAULT_MODELS.openrouter, fetchImpl }));
  }
  return providers;
};
