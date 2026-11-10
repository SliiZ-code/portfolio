import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createApi } from '../scripts/lib/rxresume.mjs';
import { assertPdf, assertNoPhone, holdsPhone, pdfHoldsPhone } from '../scripts/lib/guard.mjs';
import { cleanupLeftovers, dataOperations, makePdf, pdfDataFrom } from '../scripts/sync-resume.mjs';
import { fakePdf, fakeRxResume } from './rxresume-fake';

const PHONE = '+33 7 98 76 54 32';
const pdfBytes = (text = '%PDF-1.7\n...') => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

const main = {
  basics: {
    name: 'Julien',
    phone: PHONE,
    customFields: [
      { id: 'a', icon: 'phone', text: PHONE, link: '' },
      { id: 'b', icon: 'github', text: 'sliiz', link: 'https://github.com/sliiz' },
    ],
  },
  summary: { title: 'Profil', hidden: false, content: '<p>Bonjour</p>' },
  sections: {
    projects: {
      title: 'Projets',
      hidden: false,
      items: [
        { id: 'p1', hidden: false, name: 'Visible', period: '', website: { url: '', label: '' }, description: '<p>ok</p>' },
        { id: 'p2', hidden: true, name: 'Hidden project', period: '', website: { url: '', label: '' }, description: '' },
      ],
    },
  },
  metadata: { template: 'onyx', notes: 'private note' },
};

describe('pdfDataFrom', () => {
  it('blanks the phone and drops the custom fields that hold it, and keeps everything else', () => {
    const data = pdfDataFrom(main) as Record<string, any>;
    expect(data.basics.phone).toBe('');
    expect(data.basics.customFields.map((field: { id: string }) => field.id)).toEqual(['b']);
    expect(data.metadata).toEqual(main.metadata);
    expect(data.sections).toEqual(main.sections);
    expect(JSON.stringify(data)).not.toContain('98 76 54 32');
  });

  it('keeps the hidden project flags as they are, so RxResume leaves the project off the PDF', () => {
    const data = pdfDataFrom(main) as Record<string, any>;
    expect(data.sections.projects.items[1].hidden).toBe(true);
  });

  it('does not modify its input and copes with no basics', () => {
    const before = structuredClone(main);
    pdfDataFrom(main);
    expect(main).toEqual(before);
    expect(pdfDataFrom({ summary: { content: 'x' } })).toEqual({ summary: { content: 'x' } });
  });
});

describe('dataOperations', () => {
  it('is empty when the data is the same, whatever the order of the keys', () => {
    expect(dataOperations({ a: { x: 1, y: 2 }, b: [1] }, { b: [1], a: { y: 2, x: 1 } })).toEqual([]);
  });

  it('replaces what differs, adds what is missing and removes what is extra', () => {
    expect(dataOperations({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 })).toEqual([
      { op: 'add', path: '/b', value: 5 },
      { op: 'add', path: '/d', value: 4 },
      { op: 'remove', path: '/c' },
    ]);
  });
});

describe('assertPdf', () => {
  it('accepts bytes that start with %PDF-, and refuses anything else', () => {
    expect(() => assertPdf(pdfBytes())).not.toThrow();
    expect(() => assertPdf(pdfBytes('<html>login</html>'))).toThrow(/PDF/);
    expect(() => assertPdf(new Uint8Array())).toThrow(/PDF/);
  });
});

describe('phone guards', () => {
  it('recognises the phone however it is written, and never names it in an error', () => {
    for (const leak of [PHONE, 'Call +33798765432 now', '07.98.76.54.32', '<p>tel 0798765432</p>']) {
      expect(holdsPhone({ summary: leak }, PHONE), leak).toBe(true);
      expect(() => assertNoPhone({ summary: leak }, PHONE, 'the site data')).toThrow(/phone/);
    }
    try {
      assertNoPhone({ summary: PHONE }, PHONE, 'the site data');
    } catch (error) {
      expect((error as Error).message).not.toContain('98 76');
    }
  });

  it('recognises a phone split over two fields', () => {
    expect(holdsPhone({ fields: [{ text: '07 98' }, { text: '76 54 32' }] }, '07 98 76 54 32')).toBe(true);
  });

  it('is silent when there is no phone to look for', () => {
    expect(holdsPhone({ summary: 'anything' }, '')).toBe(false);
  });

  it('finds the phone in the text of a PDF, plain or compressed, and not in a clean one', () => {
    const plain = pdfBytes(`%PDF-1.4\n(Tel ${PHONE}) Tj\n%%EOF`);
    const compressed = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'),
      deflateSync(Buffer.from(`BT (07 98 76 54 32) Tj ET`)),
      Buffer.from('\nendstream\nendobj\n%%EOF'),
    ]);
    expect(pdfHoldsPhone(plain, PHONE)).toBe(true);
    expect(pdfHoldsPhone(new Uint8Array(compressed), PHONE)).toBe(true);
    expect(pdfHoldsPhone(pdfBytes('%PDF-1.4\n(Bonjour) Tj\n%%EOF'), PHONE)).toBe(false);
  });
});

describe('createApi', () => {
  const baseUrl = 'https://rx.example';

  it('calls the OpenAPI routes with the key, never follows a redirect and times out', async () => {
    const fake = fakeRxResume({ main, key: 'secret' });
    const api = createApi({ baseUrl, key: 'secret', fetchImpl: fake.fetchImpl });
    const resume = (await api.getResume(fake.mainId)) as { data: Record<string, unknown> };
    expect(resume.data.summary).toBeDefined();
    expect(fake.calls[0]).toMatchObject({ method: 'GET', path: '/resumes/main-fr' });
  });

  it('creates a resume from a name and a slug, and returns its id', async () => {
    const fake = fakeRxResume({ main });
    const api = createApi({ baseUrl, key: 'secret', fetchImpl: fake.fetchImpl });
    const id = await api.createResume({ name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' });
    expect(id).toBe('temp-1');
    expect(fake.calls[0]).toMatchObject({ method: 'POST', path: '/resumes', body: { name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' } });
  });

  it('removes a resume by moving it to Trash, then purging it: the resume type and id only', async () => {
    const fake = fakeRxResume({ main });
    const api = createApi({ baseUrl, key: 'secret', fetchImpl: fake.fetchImpl });
    const id = await api.createResume({ name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' });
    await api.removeResume(id);
    expect(fake.calls.slice(1).map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /resumes/${id}`, 'POST /documents/purge']);
    expect(fake.calls[2].body).toEqual({ type: 'resume', id });
    expect(fake.store.has(id)).toBe(false);
  });

  it('reports only the status when a call fails', async () => {
    const fake = fakeRxResume({ main, pdfFails: true });
    const api = createApi({ baseUrl, key: 'wrong', fetchImpl: fake.fetchImpl });
    await expect(api.getResume(fake.mainId)).rejects.toThrow(/401/);
    const ok = createApi({ baseUrl, key: 'secret', fetchImpl: fake.fetchImpl });
    await expect(ok.downloadPdf(fake.mainId)).rejects.toThrow(/500/);
  });

  it('refuses a non-https base URL', () => {
    expect(() => createApi({ baseUrl: 'http://rx.example', key: 'k' })).toThrow(/https/);
  });
});

describe('makePdf', () => {
  const run = (fake: ReturnType<typeof fakeRxResume>, source: Record<string, unknown> = main, lang = 'fr') => {
    const api = createApi({ baseUrl: 'https://rx.example', key: 'secret', fetchImpl: fake.fetchImpl });
    return makePdf({ api, mainId: fake.mainId, lang, source, phone: PHONE, stamp: '20260310', log: () => {} });
  };

  it('creates a temporary copy, fills it, makes the PDF, then removes the copy', async () => {
    const fake = fakeRxResume({ main });
    const bytes = await run(fake);
    expect(new TextDecoder().decode(bytes)).toMatch(/^%PDF-/);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /resumes',
      'GET /resumes/temp-1',
      'PATCH /resumes/temp-1',
      'GET /resumes/temp-1',
      'GET /resumes/temp-1/pdf',
      'DELETE /resumes/temp-1',
      'POST /documents/purge',
    ]);
    expect(fake.calls[0].body).toMatchObject({ name: 'tmp-portfolio-pdf-fr-20260310', slug: 'tmp-portfolio-pdf-fr-20260310' });
    expect(fake.store.has('temp-1')).toBe(false);
  });

  it('never writes to the main resume, and never sends the phone to the temporary copy', async () => {
    const fake = fakeRxResume({ main });
    await run(fake);
    expect(fake.calls.filter((c) => c.path.includes(fake.mainId) && c.method !== 'GET')).toEqual([]);
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(JSON.stringify(patch?.body)).not.toContain('98 76 54 32');
    expect(JSON.stringify(patch?.body)).toContain('"/basics"');
  });

  it('still removes the temporary copy when the PDF fails, and reports the PDF error', async () => {
    const fake = fakeRxResume({ main, pdfFails: true });
    await expect(run(fake)).rejects.toThrow(/500/);
    expect(fake.store.has('temp-1')).toBe(false);
    expect(fake.calls.at(-1)?.path).toBe('/documents/purge');
  });

  it('removes the copy when the copy reads back with a phone number, and refuses it', async () => {
    const fake = fakeRxResume({ main });
    const realPatch = fake.fetchImpl;
    const leaky = (async (url: string, init: RequestInit = {}) => {
      const response = await realPatch(url, init);
      if (init.method === 'PATCH') {
        // RxResume brings the phone back into the copy after the write: the readback must catch it
        const stored = fake.store.get('temp-1');
        if (stored) stored.data = { ...stored.data, summary: { content: `Tel ${PHONE}` } };
      }
      return response;
    }) as unknown as typeof fetch;
    const api = createApi({ baseUrl: 'https://rx.example', key: 'secret', fetchImpl: leaky });
    await expect(makePdf({ api, mainId: fake.mainId, lang: 'fr', source: main, phone: PHONE, stamp: '1', log: () => {} })).rejects.toThrow(/phone/);
    expect(fake.store.has('temp-1')).toBe(false);
  });

  it('refuses before creating anything when the data to put in the copy still holds the phone', async () => {
    const fake = fakeRxResume({ main });
    const leaking = { ...main, summary: { content: `Appelez ${PHONE}` } };
    await expect(run(fake, leaking)).rejects.toThrow(/phone/);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a copy whose id is the main resume id, and never deletes the main resume', async () => {
    const fake = fakeRxResume({ main, mainId: 'main-fr' });
    const api = {
      createResume: async () => 'main-fr',
      getResume: async () => ({ data: {}, updatedAt: 'x' }),
      patchResume: async () => ({}),
      downloadPdf: async () => pdfBytes(),
      removeResume: async (id: string) => {
        throw new Error(`removed ${id}`);
      },
    };
    await expect(makePdf({ api: api as never, mainId: 'main-fr', lang: 'fr', source: {}, phone: PHONE, stamp: '1', log: () => {} })).rejects.toThrow(/main resume/);
    expect(fake.store.has('main-fr')).toBe(true);
  });

  it('a PDF that holds the phone is refused', async () => {
    const api = {
      createResume: async () => 'temp-9',
      getResume: async () => ({ data: {}, updatedAt: 'x' }),
      patchResume: async () => ({}),
      downloadPdf: async () => pdfBytes(`%PDF-1.4\n(${PHONE}) Tj`),
      removeResume: async () => {},
    };
    await expect(makePdf({ api: api as never, mainId: 'main-fr', lang: 'fr', source: {}, phone: PHONE, stamp: '1', log: () => {} })).rejects.toThrow(/phone/);
  });
});

describe('cleanupLeftovers', () => {
  it('removes only the leftover copies whose name or slug starts with the prefix', async () => {
    const fake = fakeRxResume({
      main,
      others: [
        { id: 'leftover-1', name: 'tmp-portfolio-pdf-fr-old', slug: 'tmp-portfolio-pdf-fr-old' },
        { id: 'leftover-2', name: 'Mon CV', slug: 'tmp-portfolio-pdf-en-old' },
        { id: 'keep-1', name: 'Mon autre CV', slug: 'mon-autre-cv' },
        { id: 'keep-2', name: 'Pas tmp-portfolio-pdf-', slug: 'x' },
      ],
    });
    const api = createApi({ baseUrl: 'https://rx.example', key: 'secret', fetchImpl: fake.fetchImpl });
    expect(await cleanupLeftovers({ api, mainId: fake.mainId })).toBe(2);
    expect([...fake.store.keys()].sort()).toEqual([fake.mainId, 'keep-1', 'keep-2'].sort());
    expect(fake.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/resumes/leftover-1', '/resumes/leftover-2']);
  });

  it('refuses, before deleting anything, when the main resume matches the prefix', async () => {
    const fake = fakeRxResume({
      main,
      mainId: 'main-fr',
      others: [{ id: 'leftover-1', name: 'tmp-portfolio-pdf-fr-old', slug: 'tmp-portfolio-pdf-fr-old' }],
    });
    fake.store.get('main-fr')!.name = 'tmp-portfolio-pdf-main';
    const api = createApi({ baseUrl: 'https://rx.example', key: 'secret', fetchImpl: fake.fetchImpl });
    await expect(cleanupLeftovers({ api, mainId: 'main-fr' })).rejects.toThrow(/main resume/);
    expect(fake.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    expect(fake.store.has('leftover-1')).toBe(true);
  });
});

describe('fake PDF sanity', () => {
  it('carries the data text, so the fake shows a leak the way RxResume would', () => {
    expect(new TextDecoder().decode(fakePdf({ phone: PHONE }))).toContain(PHONE);
  });
});
