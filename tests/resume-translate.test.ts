import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha } from '../scripts/lib/strings.mjs';
import {
  CLAUDE_CODE_PACKAGE,
  buildPrompt,
  claudeProvider,
  configuredTranslators,
  geminiProvider,
  openrouterProvider,
  parseCache,
  serializeCache,
  translateStrings,
  validateTranslations,
} from '../scripts/lib/translate.mjs';

const PHONE = '+33 7 98 76 54 32';

/** A translator that prefixes every value, keeping the HTML as it is, and records what it was sent. */
const fakeTranslator = (name = 'fake', model = 'fake-model') => {
  const payloads: Record<string, string>[] = [];
  return {
    payloads,
    provider: {
      name,
      model,
      translate: async (input: Record<string, string>) => {
        payloads.push(input);
        return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, `[en] ${value}`]));
      },
    },
  };
};

const noop = () => {};

describe('parseCache and serializeCache', () => {
  it('starts empty when there is no file or the file is broken', () => {
    expect(parseCache(undefined)).toEqual({ version: 1, entries: {} });
    expect(parseCache('not json')).toEqual({ version: 1, entries: {} });
    expect(parseCache('{"version":2,"entries":{}}')).toEqual({ version: 1, entries: {} });
  });

  it('writes the same text whatever the order of the entries, sorted by hash', () => {
    const a = { version: 1, entries: { b: { en: 'B', model: 'm' }, a: { en: 'A', model: 'm' } } };
    const b = { version: 1, entries: { a: { en: 'A', model: 'm' }, b: { en: 'B', model: 'm' } } };
    expect(serializeCache(a)).toBe(serializeCache(b));
    expect(serializeCache(a).indexOf('"a"')).toBeLessThan(serializeCache(a).indexOf('"b"'));
    expect(serializeCache(a).endsWith('\n')).toBe(true);
    expect(parseCache(serializeCache(a))).toEqual(a);
  });
});

describe('validateTranslations', () => {
  const input = { s1: 'Bonjour <a href="https://x.dev">lien</a>', s2: 'Résumé' };

  it('accepts a complete answer with the same HTML tags', () => {
    expect(validateTranslations(input, { s1: 'Hello <a href="https://x.dev">link</a>', s2: 'Summary' })).toEqual({
      s1: 'Hello <a href="https://x.dev">link</a>',
      s2: 'Summary',
    });
  });

  it('refuses a missing key, an empty value and a value that is not a string', () => {
    expect(() => validateTranslations(input, { s1: 'Hello <a href="https://x.dev">link</a>' })).toThrow(/s2/);
    expect(() => validateTranslations(input, { s1: 'Hello <a href="https://x.dev">link</a>', s2: '  ' })).toThrow(/s2/);
    expect(() => validateTranslations(input, { s1: 'Hello <a href="https://x.dev">link</a>', s2: 3 })).toThrow(/s2/);
  });

  it('refuses a changed tag sequence, including a changed link', () => {
    expect(() => validateTranslations(input, { s1: 'Hello <a href="https://evil.dev">link</a>', s2: 'Summary' })).toThrow(/s1/);
    expect(() => validateTranslations(input, { s1: 'Hello link', s2: 'Summary' })).toThrow(/s1/);
  });

  it('refuses an answer that is not an object', () => {
    expect(() => validateTranslations(input, ['x'])).toThrow(/JSON object/);
    expect(() => validateTranslations(input, null)).toThrow(/JSON object/);
  });

  it('refuses a value that holds the phone number, without repeating it in the error', () => {
    try {
      validateTranslations({ s1: 'Tel' }, { s1: `Phone ${PHONE}` }, PHONE);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/phone/);
      expect((error as Error).message).not.toContain('98 76');
    }
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt({ s1: 'Classe préparatoire intégrée', s2: 'janv. 2026 – aujourd’hui' });

  it('asks for a JSON object with the same keys and the recruiter rules', () => {
    expect(prompt).toContain('"s1": "Classe préparatoire intégrée"');
    expect(prompt).toContain('Integrated preparatory programme');
    expect(prompt).toContain('work-study');
    expect(prompt).toContain('same keys');
    expect(prompt).toMatch(/keep every tag/i);
    expect(prompt).toMatch(/add nothing, drop nothing/i);
  });

  it('guards the wording slips seen in review: repeated words, invented acronyms, section titles, articles', () => {
    expect(prompt).toMatch(/do not repeat a word/i);
    expect(prompt).toContain('"Réseaux" -> "Online profiles"');
    expect(prompt).toContain('"un stage" -> "an internship"');
  });
});

describe('translateStrings', () => {
  it('sends only the strings missing from the cache, and keeps the cache entries that are still used', async () => {
    const cache = parseCache(
      serializeCache({
        version: 1,
        entries: {
          [sha('Résumé')]: { en: 'Summary', model: 'old' },
          [sha('Périmé')]: { en: 'Stale', model: 'old' },
        },
      }),
    );
    const { provider, payloads } = fakeTranslator();
    const result = await translateStrings({ strings: ['Résumé', 'Whisper'], cache, translators: [provider], warn: noop });

    expect(result.complete).toBe(true);
    expect(payloads).toHaveLength(1);
    expect(Object.values(payloads[0])).toEqual(['Whisper']);
    expect(result.cache.entries[sha('Résumé')]).toEqual({ en: 'Summary', model: 'old' });
    expect(result.cache.entries[sha('Whisper')]).toEqual({ en: '[en] Whisper', model: 'fake-model' });
    expect(result.cache.entries[sha('Périmé')]).toBeUndefined();
  });

  it('calls no provider when every string is cached, and is complete', async () => {
    const cache = { version: 1, entries: { [sha('Résumé')]: { en: 'Summary', model: 'm' } } };
    const { provider, payloads } = fakeTranslator();
    const result = await translateStrings({ strings: ['Résumé'], cache, translators: [provider], warn: noop });
    expect(payloads).toHaveLength(0);
    expect(result.complete).toBe(true);
  });

  it('is incomplete with no provider configured, keeps the cache of the used strings, and warns', async () => {
    const warnings: string[] = [];
    const result = await translateStrings({ strings: ['Whisper'], cache: { version: 1, entries: {} }, translators: [], warn: (m: string) => warnings.push(m) });
    expect(result.complete).toBe(false);
    expect(result.cache.entries).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('falls through to the next provider when the first one throws, and records which model answered', async () => {
    const failing = { name: 'first', model: 'm1', translate: async () => Promise.reject(new Error('quota')) };
    const { provider } = fakeTranslator('second', 'm2');
    const warnings: string[] = [];
    const result = await translateStrings({ strings: ['Whisper'], cache: { version: 1, entries: {} }, translators: [failing, provider], warn: (m: string) => warnings.push(m) });
    expect(result.complete).toBe(true);
    expect(result.cache.entries[sha('Whisper')].model).toBe('m2');
    expect(warnings.join('\n')).toMatch(/first/);
  });

  it('retries once a bad answer (changed tags) and then fails over to the next provider', async () => {
    let calls = 0;
    const flaky = {
      name: 'flaky',
      model: 'f',
      translate: async (_input: Record<string, string>) => {
        calls++;
        return { s1: 'broken' };
      },
    };
    const { provider } = fakeTranslator('good', 'g');
    const result = await translateStrings({ strings: ['<p>Bonjour</p>'], cache: { version: 1, entries: {} }, translators: [flaky, provider], warn: noop });
    expect(calls).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.cache.entries[sha('<p>Bonjour</p>')].model).toBe('g');
  });

  it('accepts a second answer that is good after a bad first one', async () => {
    let calls = 0;
    const once = {
      name: 'once',
      model: 'o',
      translate: async (_input: Record<string, string>) => {
        calls++;
        return calls === 1 ? { s1: '<p>Hello</em>' } : { s1: '<p>Hello</p>' };
      },
    };
    const result = await translateStrings({ strings: ['<p>Bonjour</p>'], cache: { version: 1, entries: {} }, translators: [once], warn: noop });
    expect(calls).toBe(2);
    expect(result.cache.entries[sha('<p>Bonjour</p>')].en).toBe('<p>Hello</p>');
  });

  it('never sends the phone number to a provider, and calls none when a string holds it', async () => {
    const { provider, payloads } = fakeTranslator();
    await expect(
      translateStrings({ strings: ['Bonjour', `Appelez ${PHONE}`], cache: { version: 1, entries: {} }, translators: [provider], phone: PHONE, warn: noop }),
    ).rejects.toThrow(/phone/);
    expect(payloads).toHaveLength(0);
  });

  it('splits long batches into several calls', async () => {
    const { provider, payloads } = fakeTranslator();
    const strings = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].map((s) => `Texte ${s}`);
    await translateStrings({ strings, cache: { version: 1, entries: {} }, translators: [provider], maxChars: 80, warn: noop });
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.flatMap((p) => Object.values(p))).toHaveLength(3);
  });
});

/** A fake child process: receives the prompt on stdin, answers with `stdout` and exits with `code`. */
const fakeSpawn = (answer: { stdout?: string; code?: number; hang?: boolean }) => {
  const calls: { cmd: string; args: string[]; env: Record<string, string>; cwd?: string; stdin: string[] }[] = [];
  const spawnImpl = (cmd: string, args: string[], options: { env: Record<string, string>; cwd?: string }) => {
    const child = new EventEmitter() as EventEmitter & { stdin: any; stdout: EventEmitter; stderr: any; kill: () => void };
    const record = { cmd, args, env: options.env, cwd: options.cwd, stdin: [] as string[] };
    calls.push(record);
    child.stdout = new EventEmitter();
    child.stderr = Object.assign(new EventEmitter(), { resume: () => undefined });
    child.stdin = Object.assign(new EventEmitter(), {
      write: (text: string) => record.stdin.push(text),
      end: () => {
        if (answer.hang) return;
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(answer.stdout ?? ''));
          child.emit('close', answer.code ?? 0);
        });
      },
    });
    child.kill = () => child.emit('close', null);
    return child;
  };
  return { calls, spawnImpl: spawnImpl as never };
};

describe('claudeProvider', () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/home/build',
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-token',
    RXRESUME_API_KEY: 'rx-secret',
    GEMINI_API_KEY: 'gem-secret',
    OPENROUTER_API_KEY: 'or-secret',
  };

  it('runs claude -p headless with no tools, the prompt on stdin, and only PATH, HOME and the token in its environment', async () => {
    const { calls, spawnImpl } = fakeSpawn({ stdout: JSON.stringify({ result: JSON.stringify({ s1: 'Hello' }), is_error: false }) });
    const provider = claudeProvider({ command: '/usr/bin/claude', args: [], env, spawnImpl });
    const out = await provider.translate({ s1: 'Bonjour' });

    expect(out).toEqual({ s1: 'Hello' });
    const [call] = calls;
    expect(call.cmd).toBe('/usr/bin/claude');
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'claude-haiku-5-5', '--tools', '']));
    expect(call.stdin.join('')).toContain('"s1": "Bonjour"');
    expect(Object.keys(call.env).sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH']);
    expect(JSON.stringify(call.env)).not.toMatch(/rx-secret|gem-secret|or-secret/);
  });

  it('uses TRANSLATE_CLAUDE_MODEL when set, and reads a fenced JSON answer', async () => {
    const { calls, spawnImpl } = fakeSpawn({ stdout: JSON.stringify({ result: '```json\n{"s1":"Hi"}\n```' }) });
    const provider = claudeProvider({ command: 'npx', args: ['-y', '@anthropic-ai/claude-code'], env: { ...env, TRANSLATE_CLAUDE_MODEL: 'claude-sonnet-5-5' }, spawnImpl });
    expect(await provider.translate({ s1: 'Bonjour' })).toEqual({ s1: 'Hi' });
    expect(calls[0].args.slice(0, 2)).toEqual(['-y', '@anthropic-ai/claude-code']);
    expect(calls[0].args).toContain('claude-sonnet-5-5');
  });

  it('fails without echoing the answer when the CLI reports an error or exits non-zero', async () => {
    const reported = fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: 'secret answer text' }) });
    await expect(claudeProvider({ command: 'claude', env, spawnImpl: reported.spawnImpl }).translate({ s1: 'x' })).rejects.toThrow(/error/);
    const crashed = fakeSpawn({ stdout: 'secret answer text', code: 1 });
    const error = await claudeProvider({ command: 'claude', env, spawnImpl: crashed.spawnImpl }).translate({ s1: 'x' }).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/exit code 1/);
    expect((error as Error).message).not.toContain('secret answer');
  });

  it('gives up after its timeout', async () => {
    const { spawnImpl } = fakeSpawn({ hang: true });
    await expect(claudeProvider({ command: 'claude', env, spawnImpl, timeoutMs: 20 }).translate({ s1: 'x' })).rejects.toThrow(/timed out|exit/);
  });

  it('runs in an empty directory of its own, removed afterwards, never in the repository', async () => {
    const { calls, spawnImpl } = fakeSpawn({ stdout: JSON.stringify({ result: '{"s1":"Hi"}' }) });
    await claudeProvider({ command: 'claude', env, spawnImpl }).translate({ s1: 'Bonjour' });
    const cwd = calls[0].cwd!;
    expect(cwd).toBeTruthy();
    expect(cwd).not.toBe(process.cwd());
    expect(existsSync(cwd)).toBe(false);
  });

  it('reports the exit when the child closes its stdin early, instead of crashing on EPIPE', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter() as EventEmitter & { stdin: any; stdout: EventEmitter; stderr: any; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = Object.assign(new EventEmitter(), { resume: () => undefined });
      child.stdin = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => {
          child.stdin.emit('error', new Error('EPIPE'));
          setImmediate(() => child.emit('close', 1));
        },
      });
      return child;
    };
    const error = await claudeProvider({ command: 'claude', env, spawnImpl: spawnImpl as never }).translate({ s1: 'x' }).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/exit code 1/);
  });
});

describe('geminiProvider', () => {
  it('calls generateContent with the key in a header, never in the URL, and asks for JSON', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"s1":"Hello"}' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = geminiProvider({ apiKey: 'gem-secret', model: 'gemini-3.5-flash', fetchImpl });
    expect(await provider.translate({ s1: 'Bonjour' })).toEqual({ s1: 'Hello' });

    expect(seen[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect(seen[0].url).not.toContain('gem-secret');
    expect((seen[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('gem-secret');
    expect(seen[0].init.redirect).toBe('error');
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(seen[0].init.body)).generationConfig.responseMimeType).toBe('application/json');
  });

  it('reports only the HTTP status, never the body that may echo the key', async () => {
    const fetchImpl = (async () => new Response('bad key gem-secret', { status: 403 })) as unknown as typeof fetch;
    const error = await geminiProvider({ apiKey: 'gem-secret', model: 'm', fetchImpl }).translate({ s1: 'x' }).catch((e: Error) => e);
    expect((error as Error).message).toBe('gemini: HTTP 403');
  });
});

describe('openrouterProvider', () => {
  it('calls the OpenAI-compatible chat endpoint with a bearer key and the model in the body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"s1":"Hello"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = openrouterProvider({ apiKey: 'or-secret', model: 'anthropic/claude-haiku-4.5', fetchImpl });
    expect(await provider.translate({ s1: 'Bonjour' })).toEqual({ s1: 'Hello' });
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer or-secret');
    expect(JSON.parse(String(seen[0].init.body)).model).toBe('anthropic/claude-haiku-4.5');
  });

  it('reports only the HTTP status on failure', async () => {
    const fetchImpl = (async () => new Response('or-secret echoed', { status: 500 })) as unknown as typeof fetch;
    const error = await openrouterProvider({ apiKey: 'or-secret', model: 'm', fetchImpl }).translate({ s1: 'x' }).catch((e: Error) => e);
    expect((error as Error).message).toBe('openrouter: HTTP 500');
  });
});

describe('configuredTranslators', () => {
  const findCommand = (name: string) => (name === 'claude' ? '/home/u/.local/bin/claude' : null);

  it('has none when no key is set', () => {
    expect(configuredTranslators({ PATH: '/usr/bin' }, { findCommand })).toEqual([]);
  });

  it('keeps the order claude, gemini, openrouter, each only when configured', () => {
    const all = configuredTranslators(
      { PATH: '/usr/bin', HOME: '/h', CLAUDE_CODE_OAUTH_TOKEN: 't', GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'o' },
      { findCommand },
    );
    expect(all.map((p) => p.name)).toEqual(['claude', 'gemini', 'openrouter']);
    expect(configuredTranslators({ OPENROUTER_API_KEY: 'o' }, { findCommand }).map((p) => p.name)).toEqual(['openrouter']);
  });

  it('uses the local Claude Code login only when TRANSLATE_CLAUDE_LOCAL=1, and npx when claude is not on PATH', () => {
    expect(configuredTranslators({ PATH: '/x', TRANSLATE_CLAUDE_LOCAL: '1' }, { findCommand }).map((p) => p.name)).toEqual(['claude']);
    expect(configuredTranslators({ PATH: '/x', TRANSLATE_CLAUDE_LOCAL: '1' }, { findCommand: () => null }).map((p) => p.name)).toEqual(['claude']);
  });

  it('runs npx with the pinned Claude Code version, and only when a token is given (no download without one)', async () => {
    expect(CLAUDE_CODE_PACKAGE).toMatch(/^@anthropic-ai\/claude-code@\d+\.\d+\.\d+$/);
    const none = fakeSpawn({ stdout: '{}' });
    expect(configuredTranslators({ PATH: '/x', HOME: '/h' }, { findCommand: () => null, spawnImpl: none.spawnImpl }).map((p) => p.name)).toEqual([]);
    expect(none.calls).toHaveLength(0);

    const withToken = fakeSpawn({ stdout: JSON.stringify({ result: '{"s1":"Hi"}' }) });
    const [claude] = configuredTranslators({ PATH: '/x', HOME: '/h', CLAUDE_CODE_OAUTH_TOKEN: 't' }, { findCommand: () => null, spawnImpl: withToken.spawnImpl });
    await claude.translate({ s1: 'Bonjour' });
    expect(withToken.calls[0]).toMatchObject({ cmd: 'npx' });
    expect(withToken.calls[0].args.slice(0, 2)).toEqual(['-y', CLAUDE_CODE_PACKAGE]);
  });

  it('applies the model overrides', () => {
    const [gemini] = configuredTranslators({ GEMINI_API_KEY: 'g', TRANSLATE_GEMINI_MODEL: 'gemini-x' }, { findCommand });
    expect(gemini.model).toBe('gemini-x');
    const [openrouter] = configuredTranslators({ OPENROUTER_API_KEY: 'o' }, { findCommand });
    expect(openrouter.model).toBe('anthropic/claude-haiku-4.5');
  });
});
