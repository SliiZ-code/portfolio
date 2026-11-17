import { describe, expect, it } from 'vitest';
import { createApi } from '../scripts/lib/rxresume.mjs';

const baseUrl = 'https://rx.example';
const KEY = 'key-SECRET-1234';
const RESUME_ID = 'resume-id-7';
const BODY_TEXT = 'BODY-SECRET-TEXT';

/**
 * A fetch that answers from a script, one step per call: a status number (the body is BODY_TEXT), an
 * object with a status and a Retry-After header, an Error to throw, or `{ body }` for a 2xx answer.
 */
type Step = number | Error | { status: number; retryAfter: string } | { body: string };

const scripted = (steps: Step[]) => {
  const queue = [...steps];
  const calls: { method: string; path: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? 'GET', path: new URL(url).pathname });
    const step = queue.shift();
    if (step === undefined) throw new Error('the script ran out of answers');
    if (step instanceof Error) throw step;
    if (typeof step === 'number') return new Response(BODY_TEXT, { status: step });
    if ('retryAfter' in step) return new Response(BODY_TEXT, { status: step.status, headers: { 'retry-after': step.retryAfter } });
    return new Response(step.body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const recorder = () => {
  const delays: number[] = [];
  const logs: string[] = [];
  return {
    delays,
    logs,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    log: (line: string) => {
      logs.push(line);
    },
  };
};

const networkError = () => new TypeError('fetch failed');
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('RxResume client: retries of idempotent requests (GET)', () => {
  it('retries a list that answers 401 once, then succeeds', async () => {
    const { fetchImpl, calls } = scripted([401, { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.listResumes()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
    expect(r.delays).toEqual([2000]);
  });

  it('gives up after three attempts on 503, with the label and the status only', async () => {
    const { fetchImpl, calls } = scripted([503, 503, 503]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.listResumes()).rejects.toThrow(/^RxResume list: HTTP 503$/);
    expect(calls).toHaveLength(3);
    expect(r.delays).toEqual([2000, 5000]);
  });

  it('retries a GET after a network error', async () => {
    const { fetchImpl, calls } = scripted([networkError(), { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.listResumes()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('retries a GET after a timeout', async () => {
    const { fetchImpl, calls } = scripted([timeoutError(), { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.listResumes()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 404: it will not change on a second try', async () => {
    const { fetchImpl, calls } = scripted([404]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.listResumes()).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
    expect(r.delays).toEqual([]);
  });

  it('honours Retry-After (seconds) in place of the backoff', async () => {
    const { fetchImpl } = scripted([{ status: 503, retryAfter: '7' }, { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await api.listResumes();
    expect(r.delays).toEqual([7000]);
  });

  it('caps Retry-After at 30 seconds', async () => {
    const { fetchImpl } = scripted([{ status: 429, retryAfter: '120' }, { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await api.listResumes();
    expect(r.delays).toEqual([30_000]);
  });

  it('logs one line per retry with the label, the status and the attempt, and never the key, an id or a body', async () => {
    const { fetchImpl } = scripted([503, { body: '%PDF-1.4' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await api.downloadPdf(RESUME_ID);
    expect(r.logs).toEqual(['RxResume (pdf): HTTP 503, attempt 1 of 3 failed, retrying in 2000 ms']);
    const everything = r.logs.join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(RESUME_ID);
    expect(everything).not.toContain(BODY_TEXT);
  });
});

describe('RxResume client: non-idempotent requests', () => {
  it('does not retry a create on a 500, since the copy may already exist', async () => {
    const { fetchImpl, calls } = scripted([500, { body: '"new-id"' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.createResume({ name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' })).rejects.toThrow(/RxResume create: HTTP 500/);
    expect(calls).toHaveLength(1);
    expect(r.delays).toEqual([]);
  });

  it('does not retry a create after a network error, since the copy may already exist', async () => {
    const { fetchImpl, calls } = scripted([networkError(), { body: '"new-id"' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.createResume({ name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' })).rejects.toThrow(/RxResume create: network error/);
    expect(calls).toHaveLength(1);
  });

  it('retries a create that answers 429, which means it was not processed, then succeeds', async () => {
    const { fetchImpl, calls } = scripted([429, { body: '"new-id"' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.createResume({ name: 'tmp-portfolio-pdf-fr-1', slug: 'tmp-portfolio-pdf-fr-1' })).resolves.toBe('new-id');
    expect(calls).toHaveLength(2);
  });

  it('does not retry a PATCH on a 503', async () => {
    const { fetchImpl, calls } = scripted([503]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log, protectedId: 'main-fr' });
    await expect(api.patchResume(RESUME_ID, [{ op: 'add', path: '/summary', value: {} }])).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(1);
  });

  it('retries a PATCH that answers 401, which means it was not processed, then succeeds', async () => {
    const { fetchImpl, calls } = scripted([401, { body: `{"id":"${RESUME_ID}"}` }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log, protectedId: 'main-fr' });
    await expect(api.patchResume(RESUME_ID, [{ op: 'add', path: '/summary', value: {} }])).resolves.toEqual({ id: RESUME_ID });
    expect(calls).toHaveLength(2);
  });

  it('does not retry the trash (DELETE) on a 503, so nothing is purged after it', async () => {
    const { fetchImpl, calls } = scripted([503]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.removeResume(RESUME_ID)).rejects.toThrow(/^RxResume \(trash\): HTTP 503$/);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /api/openapi/resumes/${RESUME_ID}`]);
  });

  it('retries the purge that answers 429, without repeating the trash', async () => {
    const { fetchImpl, calls } = scripted([{ body: '{}' }, 429, { body: '{}' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.removeResume(RESUME_ID)).resolves.toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /api/openapi/resumes/${RESUME_ID}`,
      'POST /api/openapi/documents/purge',
      'POST /api/openapi/documents/purge',
    ]);
  });

  it('does not retry the purge on a 503: the copy is in Trash and the error says so', async () => {
    const { fetchImpl, calls } = scripted([{ body: '{}' }, 503]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log });
    await expect(api.removeResume(RESUME_ID)).rejects.toThrow(/^RxResume \(purge\): HTTP 503$/);
    expect(calls).toHaveLength(2);
  });
});

describe('RxResume client: the build schedule (five attempts, about a minute)', () => {
  // the sync passes this; the checker keeps the default (three attempts, about 7 s)
  const BUILD_PAUSES = [2_000, 5_000, 15_000, 30_000];

  it('makes five attempts, pausing 2, 5, 15 and 30 s, then gives up with the label and the status only', async () => {
    const { fetchImpl, calls } = scripted([503, 503, 503, 503, 503]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log, retryPausesMs: BUILD_PAUSES });
    await expect(api.listResumes()).rejects.toThrow(/^RxResume list: HTTP 503$/);
    expect(calls).toHaveLength(5);
    expect(r.delays).toEqual(BUILD_PAUSES);
    expect(r.logs.at(-1)).toBe('RxResume list: HTTP 503, attempt 4 of 5 failed, retrying in 30000 ms');
  });

  it('succeeds on the fifth attempt after four 401 refusals of a valid key', async () => {
    const { fetchImpl, calls } = scripted([401, 401, 401, 401, { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log, retryPausesMs: BUILD_PAUSES });
    await expect(api.listResumes()).resolves.toEqual([]);
    expect(calls).toHaveLength(5);
    expect(r.delays).toEqual(BUILD_PAUSES);
  });

  it('still caps Retry-After at 30 s', async () => {
    const { fetchImpl } = scripted([{ status: 503, retryAfter: '90' }, { body: '[]' }]);
    const r = recorder();
    const api = createApi({ baseUrl, key: KEY, fetchImpl, sleep: r.sleep, log: r.log, retryPausesMs: BUILD_PAUSES });
    await api.listResumes();
    expect(r.delays).toEqual([30_000]);
  });
});
