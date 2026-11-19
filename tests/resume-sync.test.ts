import { describe, expect, it } from 'vitest';
import { createApi } from '../scripts/lib/rxresume.mjs';
import { parseCache } from '../scripts/lib/translate.mjs';
import { parseTagCache, serializeTagCache, type TagCache } from '../scripts/lib/project-tags.mjs';
import { sha } from '../scripts/lib/strings.mjs';
import { fingerprintResume } from '../scripts/lib/fingerprint.mjs';
import { buildApi, cvPdfFile, fingerprintToPublish, resumeIdFrom, runSync } from '../scripts/sync-resume.mjs';
import { cvPdfPath } from '../src/lib/cv-pdf';
import { fakeRxResume } from './rxresume-fake';

const PHONE = '+33 7 98 76 54 32';
const digitsOf = (text: string) => text.replace(/\D/g, '');
const NEEDLE = '798765432';

const mainResume = {
  metadata: { template: 'onyx', notes: 'private note' },
  picture: { hidden: true, url: '/uploads/private.png' },
  basics: {
    name: 'Julien Petit-Colboc',
    headline: 'Élève ingénieur',
    email: 'me@example.com',
    phone: PHONE,
    location: 'Rouen, France',
    website: { url: 'https://sliiz.com', label: 'Portfolio', inlineLink: false },
    customFields: [{ id: 'f1', icon: 'phone', text: PHONE, link: '' }],
  },
  summary: { title: 'Résumé', hidden: false, content: '<p>Bonjour, <a href="https://sliiz.com">mon site</a></p>' },
  sections: {
    experience: {
      title: 'Expériences',
      hidden: false,
      items: [
        {
          id: 'e1',
          hidden: false,
          company: 'CAPFI',
          position: "Ingénieur d'études en alternance",
          location: 'Paris',
          period: 'janv. 2026 – Aujourd’hui',
          website: { url: '', label: '', inlineLink: false },
          description: '<ul><li><p>Développeur principal</p></li></ul>',
          roles: [],
        },
      ],
    },
    projects: {
      title: 'Projets',
      hidden: false,
      items: [
        { id: 'p1', hidden: false, name: 'Blink', period: '2024', website: { url: '', label: '', inlineLink: false }, description: '<p>Pipeline</p>' },
        { id: 'p2', hidden: true, name: 'Secret project', period: '', website: { url: '', label: '', inlineLink: false }, description: '<p>Caché</p>' },
      ],
    },
    skills: {
      title: 'Compétences',
      hidden: false,
      items: [{ id: 's1', hidden: false, name: 'IA et LLM', proficiency: '', level: 0, keywords: ['Whisper'] }],
    },
    publications: { title: 'Publications', hidden: true, items: [{ id: 'z', hidden: false, title: 'Private publication' }] },
  },
};

/** Prefixes each value with "[en] ", keeping the HTML, and records what it was sent. */
const fakeTranslator = () => {
  const payloads: Record<string, string>[] = [];
  return {
    payloads,
    provider: {
      name: 'fake',
      model: 'fake-model',
      translate: async (input: Record<string, string>) => {
        payloads.push(input);
        return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, `[en] ${value}`]));
      },
    },
  };
};

const noWait = async () => {};

const runWith = (
  fake: ReturnType<typeof fakeRxResume>,
  translators: unknown[],
  cache = parseCache(undefined),
  warnings: string[] = [],
  tags: { tagCache?: TagCache; tagComplete?: (prompt: string) => Promise<unknown>; tagModel?: string } = {},
) => {
  const api = createApi({ sleep: noWait, baseUrl: 'https://rx.example', key: 'secret', fetchImpl: fake.fetchImpl, protectedId: fake.mainId });
  return runSync({
    mainId: fake.mainId,
    api,
    fingerprintKey: 'secret',
    translators: translators as never,
    cache,
    stamp: 'T1',
    log: () => {},
    warn: (message: string) => warnings.push(message),
    ...tags,
  });
};

const pdfText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('runSync: the site data', () => {
  it('builds the French site data from the main resume, and the English one from the translator', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);

    expect(result.fr.basics).toMatchObject({ name: 'Julien Petit-Colboc', headline: 'Élève ingénieur' });
    expect(result.en).not.toBeNull();
    expect(result.en!.basics.headline).toBe('[en] Élève ingénieur');
    expect(result.en!.sections.experience.items[0]).toMatchObject({ company: 'CAPFI', position: "[en] Ingénieur d'études en alternance" });
    expect(result.en!.summary.content).toBe('[en] <p>Bonjour, <a href="https://sliiz.com">mon site</a></p>');
    expect(result.complete).toBe(true);
  });

  it('keeps the hidden projects on the site and drops the private sections, metadata and picture', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    expect(result.fr.sections.projects.items.map((p: { name: string }) => p.name)).toEqual(['Blink', 'Secret project']);
    const text = JSON.stringify([result.fr, result.en]);
    expect(text).not.toContain('private note');
    expect(text).not.toContain('private.png');
    expect(text).not.toContain('Private publication');
  });
});

describe('runSync: the phone number', () => {
  it('never reaches the AI provider', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider, payloads } = fakeTranslator();
    await runWith(fake, [provider]);
    expect(payloads.length).toBeGreaterThan(0);
    expect(digitsOf(JSON.stringify(payloads))).not.toContain(NEEDLE);
  });

  it('is in no output: site JSON, translations cache, the copies made for the PDFs', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    expect(digitsOf(JSON.stringify(result.fr))).not.toContain(NEEDLE);
    expect(digitsOf(JSON.stringify(result.en))).not.toContain(NEEDLE);
    expect(digitsOf(JSON.stringify(result.cache))).not.toContain(NEEDLE);
    for (const bytes of result.pdfs.values()) expect(digitsOf(pdfText(bytes))).not.toContain(NEEDLE);
    const copies = fake.calls.filter((call) => call.method === 'PATCH');
    expect(digitsOf(JSON.stringify(copies))).not.toContain(NEEDLE);
  });

  it('refuses the whole run when the French site data holds the phone, and creates no copy', async () => {
    const leaky = { ...mainResume, basics: { ...mainResume.basics, headline: `Appelez ${PHONE}` } };
    const fake = fakeRxResume({ main: leaky });
    const { provider, payloads } = fakeTranslator();
    await expect(runWith(fake, [provider])).rejects.toThrow(/phone/);
    expect(payloads).toHaveLength(0);
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('runSync: the PDFs', () => {
  it('makes one PDF per language from a copy without the phone, and never writes to the main resume', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    expect([...result.pdfs.keys()]).toEqual(['fr', 'en']);
    expect(result.errors).toEqual([]);
    const writes = fake.calls.filter((call) => call.method !== 'GET' && call.path.includes(fake.mainId));
    expect(writes).toEqual([]);
    expect(fake.store.get(fake.mainId)!.data).toEqual(mainResume);
    expect([...fake.store.keys()]).toEqual([fake.mainId]);
  });

  it('one transient 401 on the list of leftover copies does not skip the PDFs', async () => {
    const fake = fakeRxResume({ main: mainResume });
    let refused = false;
    const flaky = (async (url: string, init: RequestInit = {}) => {
      if (!refused && (init.method ?? 'GET') === 'GET' && new URL(url).pathname === '/api/openapi/resumes') {
        refused = true;
        return new Response('{}', { status: 401 });
      }
      return fake.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const api = createApi({ sleep: noWait, log: () => {}, baseUrl: 'https://rx.example', key: 'secret', fetchImpl: flaky, protectedId: fake.mainId });
    const { provider } = fakeTranslator();
    const result = await runSync({
      mainId: fake.mainId,
      api,
      fingerprintKey: 'secret',
      translators: [provider] as never,
      cache: parseCache(undefined),
      stamp: 'T1',
      log: () => {},
      warn: () => {},
    });
    expect(refused).toBe(true);
    expect([...result.pdfs.keys()]).toEqual(['fr', 'en']);
    expect(result.errors).toEqual([]);
  });

  it('the English copy carries the translated strings, and the French one the French', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    await runWith(fake, [provider]);
    const patches = fake.calls.filter((call) => call.method === 'PATCH').map((call) => JSON.stringify(call.body));
    expect(patches.some((text) => text.includes('[en] Élève ingénieur'))).toBe(true);
    expect(patches.some((text) => text.includes('Élève ingénieur') && !text.includes('[en]'))).toBe(true);
  });

  it('keeps the hidden project flag in the copy, so RxResume leaves it off the PDF', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    await runWith(fake, [provider]);
    const patch = fake.calls.find((call) => call.method === 'PATCH');
    const sections = patch?.body.operations.find((op: { path: string }) => op.path === '/sections').value;
    expect(sections.projects.items[1].hidden).toBe(true);
  });

  it('removes the leftover copies of a crashed run first, and nothing else', async () => {
    const fake = fakeRxResume({
      main: mainResume,
      others: [
        { id: 'old-copy', name: 'tmp-portfolio-pdf-fr-crash', slug: 'tmp-portfolio-pdf-fr-crash' },
        { id: 'other', name: 'Mon autre CV', slug: 'mon-autre-cv' },
      ],
    });
    const { provider } = fakeTranslator();
    await runWith(fake, [provider]);
    expect(fake.store.has('old-copy')).toBe(false);
    expect(fake.store.has('other')).toBe(true);
  });

  it('a PDF that cannot be made is reported, and its copies are still removed', async () => {
    const broken = fakeRxResume({ main: mainResume, pdfFails: true });
    const { provider } = fakeTranslator();
    const failed = await runWith(broken, [provider]);
    expect(failed.pdfs.size).toBe(0);
    expect(failed.errors.join(' ')).toMatch(/500/);
    expect([...broken.store.keys()]).toEqual([broken.mainId]);
  });
});

describe('runSync: no translation provider', () => {
  it('keeps the English as not built, warns, still produces the French, and makes no English PDF', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const warnings: string[] = [];
    const result = await runWith(fake, [], parseCache(undefined), warnings);
    expect(result.en).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.fr.basics.name).toBe('Julien Petit-Colboc');
    expect(warnings.join('\n')).toMatch(/WARNING/);
    expect(warnings.join('\n')).toMatch(/English PDF is skipped/);
    expect([...result.pdfs.keys()]).toEqual(['fr']);
    expect(result.errors).toEqual([]);
  });

  it('builds the English with no provider call when every string is already in the cache', async () => {
    const first = await runWith(fakeRxResume({ main: mainResume }), [fakeTranslator().provider]);
    const { payloads } = fakeTranslator();
    const again = await runWith(fakeRxResume({ main: mainResume }), [], first.cache);
    expect(payloads).toHaveLength(0);
    expect(again.complete).toBe(true);
    expect(again.en).toEqual(first.en);
  });

  it('prunes the cache down to the strings the French resume still uses', async () => {
    const cache = parseCache(
      JSON.stringify({ version: 1, entries: { ['f'.repeat(64)]: { en: 'Gone', model: 'old' } } }),
    );
    const { provider } = fakeTranslator();
    const result = await runWith(fakeRxResume({ main: mainResume }), [provider], cache);
    expect(result.cache.entries['f'.repeat(64)]).toBeUndefined();
    const kept = Object.values(result.cache.entries as Record<string, { en: string }>).map((entry) => entry.en);
    expect(kept).not.toContain('Gone');
  });
});

describe('runSync: the project tags', () => {
  const tagged = {
    ...mainResume,
    sections: {
      ...mainResume.sections,
      projects: {
        ...mainResume.sections.projects,
        items: [
          { ...mainResume.sections.projects.items[0], description: '<p>Un jeu en C++ avec SFML</p>' },
          { ...mainResume.sections.projects.items[1], description: '<p>Un script Python</p>' },
        ],
      },
    },
  };

  it('returns the cache of tags generated from the French project descriptions', async () => {
    const fake = fakeRxResume({ main: tagged });
    const prompts: string[] = [];
    const tagComplete = async (prompt: string) => {
      prompts.push(prompt);
      return { p1: ['C++', 'SFML'], p2: ['Python'] };
    };
    const result = await runWith(fake, [fakeTranslator().provider], parseCache(undefined), [], { tagComplete, tagModel: 'tag-model' });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('"p1"');
    expect(prompts[0]).toContain('Un jeu en C++ avec SFML');
    expect(result.tagCache.projects.p1).toEqual({
      tags: ['C++', 'SFML'],
      model: 'tag-model',
      hash: sha('Blink\n<p>Un jeu en C++ avec SFML</p>'),
    });
    expect(result.tagStats).toEqual({ total: 2, reused: 0 });
    // what the main writes is the deterministic cache file, read back the same
    expect(parseTagCache(serializeTagCache(result.tagCache)).projects.p2.tags).toEqual(['Python']);
  });

  it('is not part of the fingerprint, and a failing tag provider adds no error', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const warnings: string[] = [];
    const previous = { version: 1, projects: { p1: { tags: ['Python'], model: 'old', hash: 'stale' } } };
    const result = await runWith(fake, [fakeTranslator().provider], parseCache(undefined), warnings, {
      tagCache: previous,
      tagComplete: async () => {
        throw new Error(`the answer mentioned <p>Pipeline</p> and p1`);
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.fingerprint).toBe(fingerprintResume(mainResume, 'secret'));
    expect(result.tagStats).toEqual({ total: 2, reused: 0 });
    expect(result.tagCache.projects.p1).toEqual({ tags: ['Python'], model: 'old', hash: 'stale' });
    expect(warnings.join('\n')).toMatch(/WARNING/);
    expect(warnings.join('\n')).not.toContain('Pipeline');
    expect(warnings.join('\n')).not.toContain('p1');
  });

  it('warns and writes an empty cache when no tag provider is configured', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const warnings: string[] = [];
    const result = await runWith(fake, [fakeTranslator().provider], parseCache(undefined), warnings);
    expect(result.tagCache.projects).toEqual({});
    expect(result.tagStats).toEqual({ total: 2, reused: 0 });
    expect(result.errors).toEqual([]);
    expect(warnings.join('\n')).toMatch(/project tags/);
  });
});

describe('resume id and file names', () => {
  it('reads RXRESUME_ID, accepts RXRESUME_ID_FR as an alias, and needs one of them', () => {
    expect(resumeIdFrom({ RXRESUME_ID: 'abc' })).toBe('abc');
    expect(resumeIdFrom({ RXRESUME_ID_FR: 'def' })).toBe('def');
    expect(resumeIdFrom({ RXRESUME_ID: 'abc', RXRESUME_ID_FR: 'def' })).toBe('abc');
    expect(() => resumeIdFrom({})).toThrow(/RXRESUME_ID/);
  });

  it('uses the same PDF file names as the site', () => {
    expect(cvPdfPath('fr', (file) => file === cvPdfFile('fr'))).toBe(`/cv/${cvPdfFile('fr')}`);
    expect(cvPdfPath('en', () => false)).toBe('');
  });
});

/** Every string of a value, nested. */
const allStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
};

/**
 * The French source strings that a copy still holds: a string whose French text has a translation in the
 * cache, unless the translation is the same text. An empty list means the copy is fully English.
 */
const frenchLeftovers = (copy: unknown, entries: Record<string, { en: string }>) =>
  allStrings(copy).filter((text) => {
    const hit = entries[sha(text)];
    return Boolean(hit) && hit.en !== text;
  });

/** The data a copy holds, rebuilt from the JSON Patch that filled it. */
const copyFromPatches = (calls: { method: string; body?: any }[]) =>
  calls
    .filter((call) => call.method === 'PATCH')
    .reduce<Record<string, unknown>>((data, call) => {
      for (const op of call.body.operations as { op: string; path: string; value?: unknown }[]) {
        if (op.op === 'remove') delete data[op.path.slice(1)];
        else data[op.path.slice(1)] = op.value;
      }
      return data;
    }, {});

describe('runSync: the English PDF copy is fully English', () => {
  it('has no French string left that the cache translates, and is in en-US', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    const enCopy = copyFromPatches(fake.calls.filter((call) => call.method === 'PATCH' && JSON.stringify(call.body).includes('"en-US"')));
    expect(Object.keys(enCopy).length).toBeGreaterThan(0);
    expect((enCopy.metadata as any).page.locale).toBe('en-US');
    expect(allStrings(enCopy).some((text) => text.startsWith('[en] '))).toBe(true);
    expect(frenchLeftovers(enCopy, result.cache.entries)).toEqual([]);
  });

  it('the walker does catch a French period that the copy kept, so the test is not vacuous', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    const leaked = { sections: { experience: { items: [{ period: 'janv. 2026 – Aujourd’hui' }] } } };
    const entries = { ...result.cache.entries, [sha('janv. 2026 – Aujourd’hui')]: { en: 'Jan 2026 – present', model: 'x' } };
    expect(frenchLeftovers(leaked, entries)).toEqual(['janv. 2026 – Aujourd’hui']);
  });
});

describe('runSync: the fingerprint of the master it applied', () => {
  it('is the fingerprint of the master as read, without the phone', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const { provider } = fakeTranslator();
    const result = await runWith(fake, [provider]);
    expect(result.fingerprint).toBe(fingerprintResume(mainResume, 'secret'));
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fingerprintToPublish', () => {
  const complete = { errors: [], en: {}, fingerprint: 'a'.repeat(64) };

  it('publishes the fingerprint only when the whole master was applied', () => {
    expect(fingerprintToPublish(complete)).toBe('a'.repeat(64));
  });

  it('publishes nothing after a failed PDF, so the checker keeps retrying', () => {
    expect(fingerprintToPublish({ ...complete, errors: ['fr: copy refused'] })).toBeNull();
  });

  it('publishes nothing when the English was not rebuilt', () => {
    expect(fingerprintToPublish({ ...complete, en: null })).toBeNull();
  });
});

describe('buildApi: the build waits about a minute for RxResume', () => {
  const BASE = 'https://rx.example';
  const refusing = (fake: ReturnType<typeof fakeRxResume>, refusals: number, status: number) => {
    let left = refusals;
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      if (left > 0 && (init.method ?? 'GET') === 'GET' && new URL(url).pathname === `/api/openapi/resumes/${fake.mainId}`) {
        left -= 1;
        return new Response('{}', { status });
      }
      return fake.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    return fetchImpl;
  };

  it('retries a refused read of the master five times in all, pausing 2, 5, 15 and 30 s', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const pauses: number[] = [];
    const api = buildApi({
      baseUrl: BASE,
      key: 'secret',
      mainId: fake.mainId,
      fetchImpl: refusing(fake, 4, 401),
      sleep: async (ms: number) => {
        pauses.push(ms);
      },
      log: () => {},
    });
    const master = (await api.getResume(fake.mainId)) as { id: string };
    expect(master.id).toBe(fake.mainId);
    expect(pauses).toEqual([2_000, 5_000, 15_000, 30_000]);
  });

  it('gives up after five refusals, with the label and the status only', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const pauses: number[] = [];
    const api = buildApi({
      baseUrl: BASE,
      key: 'secret',
      mainId: fake.mainId,
      fetchImpl: refusing(fake, 99, 503),
      sleep: async (ms: number) => {
        pauses.push(ms);
      },
      log: () => {},
    });
    await expect(api.getResume(fake.mainId)).rejects.toThrow(/^RxResume: HTTP 503$/);
    expect(pauses).toHaveLength(4);
  });

  it('still refuses to write to or delete the main resume', async () => {
    const fake = fakeRxResume({ main: mainResume });
    const api = buildApi({ baseUrl: BASE, key: 'secret', mainId: fake.mainId, fetchImpl: fake.fetchImpl, sleep: async () => {}, log: () => {} });
    await expect(api.removeResume(fake.mainId)).rejects.toThrow(/main resume/);
    expect(fake.calls).toEqual([]);
  });
});
