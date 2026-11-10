import { describe, expect, it } from 'vitest';
import { createApi } from '../scripts/lib/rxresume.mjs';
import { parseCache } from '../scripts/lib/translate.mjs';
import { cvPdfFile, resumeIdFrom, runSync } from '../scripts/sync-resume.mjs';
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

const runWith = (fake: ReturnType<typeof fakeRxResume>, translators: unknown[], cache = parseCache(undefined), warnings: string[] = []) => {
  const api = createApi({ baseUrl: 'https://rx.example', key: 'secret', fetchImpl: fake.fetchImpl });
  return runSync({
    mainId: fake.mainId,
    api,
    translators: translators as never,
    cache,
    stamp: 'T1',
    log: () => {},
    warn: (message: string) => warnings.push(message),
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
