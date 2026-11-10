/**
 * A fake RxResume API (the routes of its OpenAPI spec the sync uses). Resumes live in memory, Trash
 * is a flag, and `/pdf` answers with a "PDF" whose text is the resume data, so a phone number left in
 * the data shows up in the PDF exactly as it would for real.
 */
export interface FakeResume {
  name: string;
  slug: string;
  data: Record<string, unknown>;
  updatedAt: string;
  trashed: boolean;
}

export interface FakeOptions {
  main: Record<string, unknown>;
  mainId?: string;
  pdfFails?: boolean;
  /** resumes already present (crash leftovers, other resumes of the account) */
  others?: { id: string; name: string; slug: string; data?: Record<string, unknown> }[];
  key?: string;
}

export interface FakeCall {
  method: string;
  path: string;
  body?: any;
}

export const fakePdf = (data: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`%PDF-1.4\n% ${JSON.stringify(data)}\n%%EOF\n`) as Uint8Array<ArrayBuffer>;

export const fakeRxResume = (options: FakeOptions) => {
  const mainId = options.mainId ?? 'main-fr';
  const key = options.key ?? 'secret';
  const store = new Map<string, FakeResume>();
  const calls: FakeCall[] = [];
  let sequence = 0;
  store.set(mainId, { name: 'Julien', slug: 'julien', data: structuredClone(options.main), updatedAt: '2026-01-01T00:00:00.000Z', trashed: false });
  for (const other of options.others ?? []) {
    store.set(other.id, { name: other.name, slug: other.slug, data: structuredClone(other.data ?? {}), updatedAt: '2026-01-01T00:00:00.000Z', trashed: false });
  }

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const path = pathname.replace('/api/openapi', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if ((init.headers as Record<string, string>)?.['x-api-key'] !== key) return json({ message: 'unauthorized' }, 401);

    if (method === 'GET' && path === '/resumes') {
      return json([...store].filter(([, r]) => !r.trashed).map(([id, r]) => ({ id, name: r.name, slug: r.slug, tags: [] })));
    }
    if (method === 'POST' && path === '/resumes') {
      const id = `temp-${++sequence}`;
      store.set(id, { name: body.name, slug: body.slug, data: { basics: { name: '', phone: '' } }, updatedAt: '2026-03-01T00:00:00.000Z', trashed: false });
      return json(id);
    }
    if (method === 'POST' && path === '/documents/purge') {
      const resume = store.get(body?.id);
      if (body?.type !== 'resume' || !resume || !resume.trashed) return json({ message: 'not in trash' }, 404);
      store.delete(body.id);
      return json({});
    }
    const match = /^\/resumes\/([^/]+)(\/pdf)?$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const resume = store.get(id);
      if (!resume || resume.trashed) return json({ message: 'not found' }, 404);
      if (match[2] && method === 'GET') {
        if (options.pdfFails) return json({ message: 'pdf broken' }, 500);
        return new Response(fakePdf(resume.data), { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      if (method === 'GET') return json({ id, name: resume.name, slug: resume.slug, data: resume.data, updatedAt: resume.updatedAt, isPublic: false });
      if (method === 'PATCH') {
        if (body.expectedUpdatedAt && body.expectedUpdatedAt !== resume.updatedAt) return json({ message: 'conflict' }, 409);
        for (const { op, path: opPath, value } of body.operations as { op: string; path: string; value?: unknown }[]) {
          const field = opPath.slice(1);
          if (op === 'remove') delete resume.data[field];
          else resume.data[field] = value;
        }
        resume.updatedAt = '2026-03-02T00:00:00.000Z';
        return json({ id, name: resume.name, slug: resume.slug, data: resume.data, updatedAt: resume.updatedAt });
      }
      if (method === 'DELETE') {
        resume.trashed = true;
        return json({});
      }
    }
    return json({ message: 'no route' }, 404);
  };

  return { fetchImpl: fetchImpl as unknown as typeof fetch, store, calls, mainId };
};
