import { describe, expect, it } from 'vitest';
import { assertDistinctIds, assertPdf, assertWebResume, collectPdfs, cvPdfFile, dataOperations, fetchCvPdf, webDataFrom } from '../scripts/sync-resume.mjs';
import { cvPdfFile as siteCvPdfFile, cvPdfPath } from '../src/lib/cv-pdf';

const PHONE = '+33 6 12 34 56 78';
const main = { basics: { name: 'Julien', phone: PHONE }, summary: { content: '<p>Bonjour</p>' } };
const web = { basics: { name: 'Julien', phone: '' }, summary: { content: '<p>Bonjour</p>' } };

const pdfBytes = (text = '%PDF-1.7\n...') => new TextEncoder().encode(text);

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * A fake RxResume holding the web resume `web-id`: GET gives its JSON, PATCH applies top-level JSON
 * Patch operations to its data (and refuses a stale `expectedUpdatedAt`), `/pdf` gives the PDF.
 */
const fakeApi = (options: { json?: Record<string, unknown>; pdf?: Uint8Array<ArrayBuffer>; status?: number; patchStatus?: number } = {}) => {
  const calls: Call[] = [];
  let data: Record<string, unknown> = structuredClone(options.json ?? web);
  let updatedAt = '2026-01-01T00:00:00.000Z';
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = options.status ?? 200;
    if (url.endsWith('/pdf')) return new Response(options.pdf ?? pdfBytes(), { status, headers: { 'content-type': 'application/pdf' } });
    if (init.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      if (options.patchStatus) return new Response('{}', { status: options.patchStatus });
      if (body.expectedUpdatedAt && body.expectedUpdatedAt !== updatedAt) return new Response('{}', { status: 409 });
      for (const { op, path, value } of body.operations) {
        const key = path.slice(1);
        if (op === 'remove') delete data[key];
        else data[key] = value;
      }
      updatedAt = '2026-02-02T00:00:00.000Z';
      return new Response(JSON.stringify({ data, updatedAt }), { status });
    }
    return new Response(JSON.stringify({ data, updatedAt }), { status });
  };
  return { calls, patches: () => calls.filter((call) => call.init.method === 'PATCH'), fetchImpl: fetchImpl as unknown as typeof fetch };
};

describe('assertWebResume', () => {
  it('accepts a web resume with no phone anywhere', () => {
    expect(() => assertWebResume(main, web)).not.toThrow();
  });

  it('refuses a web resume that has a phone number', () => {
    expect(() => assertWebResume(main, { ...web, basics: { ...web.basics, phone: '06 00 00 00 00' } })).toThrow(/phone/);
    expect(() => assertWebResume({ basics: {} }, { basics: { phone: '06 00 00 00 00' } })).toThrow(/phone/);
  });

  it('refuses a web resume that repeats the phone of the main one, however it is written', () => {
    for (const leak of [PHONE, 'Call +33612345678 now', '06.12.34.56.78', '<p>tel 0612345678</p>']) {
      const leaky = { ...web, summary: { content: leak } };
      expect(() => assertWebResume(main, leaky), leak).toThrow(/phone/);
    }
  });

  it('refuses a phone split over two fields', () => {
    const split = { ...web, basics: { ...web.basics, customFields: [{ text: '06 12' }, { text: '34 56 78' }] } };
    expect(() => assertWebResume(main, split)).toThrow(/phone/);
  });

  it('does not put the number in the error', () => {
    try {
      assertWebResume(main, { ...web, summary: { content: PHONE } });
    } catch (error) {
      expect((error as Error).message).not.toContain('12 34');
    }
  });

  it('only checks the phone field when the main resume has none', () => {
    expect(() => assertWebResume({ basics: {} }, web)).not.toThrow();
  });
});

describe('assertPdf', () => {
  it('accepts bytes that start with %PDF-', () => {
    expect(() => assertPdf(pdfBytes())).not.toThrow();
  });

  it('refuses anything else', () => {
    expect(() => assertPdf(pdfBytes('<html>login</html>'))).toThrow(/PDF/);
    expect(() => assertPdf(new Uint8Array())).toThrow(/PDF/);
  });
});

describe('webDataFrom', () => {
  const full = {
    picture: { hidden: false, url: '/uploads/me.jpg' },
    basics: {
      name: 'Julien',
      email: 'j@example.com',
      phone: PHONE,
      customFields: [
        { id: 'a', icon: 'phone', text: PHONE, link: '' },
        { id: 'b', icon: 'phone', text: '', link: 'tel:+33612345678' },
        { id: 'c', icon: 'github', text: 'sliiz', link: 'https://github.com/sliiz' },
        { id: 'd', icon: 'phone', text: '06.12.34.56.78', link: '' },
      ],
    },
    summary: { title: 'Profil', content: '<p>Bonjour</p>' },
    sections: { skills: { title: 'Compétences', items: [{ id: 's', name: 'C++' }] } },
    customSections: [{ id: 'x', title: 'Extra', items: [] }],
    metadata: { template: 'pikachu', notes: 'private', page: { format: 'a4' } },
  };

  it('blanks the phone and drops the custom fields that hold it, however it is written', () => {
    const data = webDataFrom(full);
    expect(data.basics.phone).toBe('');
    expect(data.basics.customFields.map((field: { id: string }) => field.id)).toEqual(['c']);
    expect(() => assertWebResume(full, data)).not.toThrow();
  });

  it('changes nothing else: every other key and field is kept as it was', () => {
    const data = webDataFrom(full);
    const { phone: _phone, customFields: _fields, ...basics } = full.basics;
    const { phone: _blank, customFields: _kept, ...webBasics } = data.basics;
    expect(webBasics).toEqual(basics);
    expect(data.customSections).toEqual(full.customSections);
    for (const key of ['picture', 'summary', 'sections', 'metadata'] as const) expect(data[key], key).toEqual(full[key]);
    expect(data.basics.customFields[0]).toEqual(full.basics.customFields[2]);
  });

  it('does not modify its input', () => {
    const before = structuredClone(full);
    webDataFrom(full);
    expect(full).toEqual(before);
  });

  it('keeps the custom fields as they are when the main resume has no phone', () => {
    const data = webDataFrom({ basics: { phone: '', customFields: [{ text: 'a' }] } });
    expect(data.basics).toEqual({ phone: '', customFields: [{ text: 'a' }] });
  });

  it('copes with data that has no basics', () => {
    expect(webDataFrom({ summary: { content: 'x' } })).toEqual({ summary: { content: 'x' } });
    expect(webDataFrom(undefined)).toEqual({});
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

describe('fetchCvPdf', () => {
  const run = (api: ReturnType<typeof fakeApi>, mainData: Record<string, unknown> = main) =>
    fetchCvPdf({ id: 'web-id', main: mainData, baseUrl: 'https://rx.example', key: 'secret', fetchImpl: api.fetchImpl });

  it('returns the PDF of an up to date web resume, fetched with the key and without redirects, and writes nothing', async () => {
    const api = fakeApi();
    const bytes = await run(api);
    expect(new TextDecoder().decode(bytes)).toMatch(/^%PDF-/);
    expect(api.calls.map((call) => call.url)).toEqual([
      'https://rx.example/api/openapi/resumes/web-id',
      'https://rx.example/api/openapi/resumes/web-id/pdf',
    ]);
    expect(api.patches()).toHaveLength(0);
    for (const { init } of api.calls) {
      expect(init.headers).toEqual({ 'x-api-key': 'secret' });
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('copies the main resume into a stale web resume, then checks what it reads back', async () => {
    const api = fakeApi({ json: { basics: { name: 'Old', phone: '' }, summary: { content: '<p>Ancien</p>' } } });
    const newer = { ...main, summary: { content: '<p>Nouveau</p>' }, sections: { skills: { items: [] } } };
    await run(api, newer);
    const [patch] = api.patches();
    expect(api.calls.map((call) => `${call.init.method ?? 'GET'} ${call.url.split('/resumes/')[1]}`)).toEqual([
      'GET web-id',
      'PATCH web-id',
      'GET web-id',
      'GET web-id/pdf',
    ]);
    const sent = JSON.parse(String(patch.init.body));
    expect(sent.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(sent.operations.map((operation: { path: string }) => operation.path).sort()).toEqual(['/basics', '/sections', '/summary']);
    expect(JSON.stringify(sent)).not.toContain('12 34');
    expect(patch.init.headers).toMatchObject({ 'x-api-key': 'secret', 'content-type': 'application/json' });
    expect(patch.init.redirect).toBe('error');
  });

  it('never writes the phone into the web resume, even when it sits in the summary', async () => {
    const api = fakeApi();
    await expect(run(api, { ...main, summary: { content: `Call ${PHONE}` } })).rejects.toThrow(/phone/);
    expect(api.patches()).toHaveLength(0);
    expect(api.calls.some((call) => call.url.endsWith('/pdf'))).toBe(false);
  });

  it('removes a phone the web resume had of its own, then downloads', async () => {
    const api = fakeApi({ json: { ...web, basics: { ...web.basics, phone: '06 00 00 00 00' } } });
    await run(api);
    expect(api.patches()).toHaveLength(1);
  });

  it('stops when the write fails, without downloading the PDF', async () => {
    const api = fakeApi({ json: { basics: { phone: '06 00 00 00 00' } }, patchStatus: 500 });
    await expect(run(api)).rejects.toThrow(/500/);
    expect(api.calls.some((call) => call.url.endsWith('/pdf'))).toBe(false);
  });

  it('refuses a concurrent edit instead of overwriting it', async () => {
    const api = fakeApi({ json: { basics: { phone: '' } }, patchStatus: 409 });
    await expect(run(api)).rejects.toThrow(/409/);
  });

  it('refuses a response that is not a PDF', async () => {
    await expect(run(fakeApi({ pdf: pdfBytes('<html>sign in</html>') }))).rejects.toThrow(/PDF/);
  });

  it('refuses an HTTP error', async () => {
    await expect(run(fakeApi({ status: 404 }))).rejects.toThrow(/404/);
  });
});

describe('collectPdfs', () => {
  const jobs = [
    { lang: 'fr', id: 'web-fr', main },
    { lang: 'en', id: 'web-en', main },
  ];

  it('keeps the languages that worked and reports the one that failed', async () => {
    const api = fakeApi();
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.includes('web-en') && !url.endsWith('/pdf')) return new Response('{}', { status: 423 });
      return api.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { pdfs, errors } = await collectPdfs(jobs, { baseUrl: 'https://rx.example', key: 'k', fetchImpl });
    expect([...pdfs.keys()]).toEqual(['fr']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^en: .*423/);
  });

  it('has nothing to do without a job', async () => {
    const { pdfs, errors } = await collectPdfs([], { baseUrl: 'https://rx.example', key: 'k', fetchImpl: fakeApi().fetchImpl });
    expect(pdfs.size).toBe(0);
    expect(errors).toEqual([]);
  });
});

describe('cvPdfPath', () => {
  const having = (...files: string[]) => (file: string) => files.includes(file);

  it('links the PDF of a language only when its file exists', () => {
    expect(cvPdfPath('fr', having(cvPdfFile('fr')))).toBe(`/cv/${cvPdfFile('fr')}`);
    expect(cvPdfPath('en', having(cvPdfFile('fr')))).toBe('');
    expect(cvPdfPath('fr', having())).toBe('');
  });

  it('uses the same file name as the sync script', () => {
    for (const lang of ['fr', 'en'] as const) expect(siteCvPdfFile(lang)).toBe(cvPdfFile(lang));
  });
});

describe('the web resume is never a main resume', () => {
  it('refuses a web ID that is a main ID, in either language', () => {
    expect(() => assertDistinctIds(['main-fr', 'main-en'], ['main-fr', 'web-en'])).toThrow(/main resume/);
    expect(() => assertDistinctIds(['main-fr', 'main-en'], ['web-fr', 'main-fr'])).toThrow(/main resume/);
  });

  it('refuses one web resume shared by both languages', () => {
    expect(() => assertDistinctIds(['main-fr', 'main-en'], ['web', 'web'])).toThrow(/two different/);
  });

  it('accepts distinct web resumes, or none', () => {
    expect(() => assertDistinctIds(['main-fr', 'main-en'], ['web-fr', 'web-en'])).not.toThrow();
    expect(() => assertDistinctIds(['main-fr', 'main-en'], [undefined, ''])).not.toThrow();
  });

  it('never calls the API when asked to overwrite the main resume', async () => {
    const api = fakeApi();
    await expect(
      fetchCvPdf({ id: 'main-fr', mainId: 'main-fr', main, baseUrl: 'https://rx.example', key: 'secret', fetchImpl: api.fetchImpl }),
    ).rejects.toThrow(/main resume/);
    expect(api.calls).toHaveLength(0);
  });
});
