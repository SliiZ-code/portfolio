import { describe, expect, it } from 'vitest';
import { assertPdf, assertWebResume, collectPdfs, cvPdfFile, fetchCvPdf } from '../scripts/sync-resume.mjs';
import { cvPdfFile as siteCvPdfFile, cvPdfPath } from '../src/lib/cv-pdf';

const PHONE = '+33 6 12 34 56 78';
const main = { basics: { name: 'Julien', phone: PHONE } };
const web = { basics: { name: 'Julien', phone: '' }, summary: { content: '<p>Bonjour</p>' } };

const pdfBytes = (text = '%PDF-1.7\n...') => new TextEncoder().encode(text);

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake RxResume: the JSON of resume `web-id`, and its PDF. */
const fakeApi = (options: { json?: unknown; pdf?: Uint8Array<ArrayBuffer>; status?: number } = {}) => {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = options.status ?? 200;
    if (url.endsWith('/pdf')) return new Response(options.pdf ?? pdfBytes(), { status, headers: { 'content-type': 'application/pdf' } });
    return new Response(JSON.stringify({ data: options.json ?? web }), { status });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
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

describe('fetchCvPdf', () => {
  const run = (api: ReturnType<typeof fakeApi>) =>
    fetchCvPdf({ id: 'web-id', main, baseUrl: 'https://rx.example', key: 'secret', fetchImpl: api.fetchImpl });

  it('returns the PDF of a clean web resume, fetched with the key and without redirects', async () => {
    const api = fakeApi();
    const bytes = await run(api);
    expect(new TextDecoder().decode(bytes)).toMatch(/^%PDF-/);
    expect(api.calls.map((call) => call.url)).toEqual([
      'https://rx.example/api/openapi/resumes/web-id',
      'https://rx.example/api/openapi/resumes/web-id/pdf',
    ]);
    for (const { init } of api.calls) {
      expect(init.headers).toEqual({ 'x-api-key': 'secret' });
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('refuses a web resume with a phone, without downloading its PDF', async () => {
    const api = fakeApi({ json: { basics: { phone: '06 00 00 00 00' } } });
    await expect(run(api)).rejects.toThrow(/phone/);
    expect(api.calls.some((call) => call.url.endsWith('/pdf'))).toBe(false);
  });

  it('refuses a web resume that contains the main phone', async () => {
    const api = fakeApi({ json: { ...web, summary: { content: PHONE } } });
    await expect(run(api)).rejects.toThrow(/phone/);
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

  it('keeps the clean languages and reports the refused one', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('/pdf')) return new Response(pdfBytes());
      const leaky = url.includes('web-en');
      return new Response(JSON.stringify({ data: leaky ? { basics: { phone: '06 00 00 00 00' } } : web }));
    }) as unknown as typeof fetch;
    const { pdfs, errors } = await collectPdfs(jobs, { baseUrl: 'https://rx.example', key: 'k', fetchImpl });
    expect([...pdfs.keys()]).toEqual(['fr']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^en: .*phone/);
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
