// The RxResume calls the sync makes, all under `${RXRESUME_URL}/api/openapi` (OpenAPI spec 6.x):
//   GET    /resumes                      list (metadata only), used to find leftover copies
//   GET    /resumes/{id}                 read a resume with its data
//   POST   /resumes                      create a copy, body {name, slug, tags, withSampleData}, answers the id
//   PATCH  /resumes/{id}                 JSON Patch on the top-level keys of the data, guarded by expectedUpdatedAt
//   GET    /resumes/{id}/pdf             the PDF
//   DELETE /resumes/{id}                 moves the resume to Trash (30 days)
//   POST   /documents/purge              {type: "resume", id}: deletes a resume that is in Trash, for good
// Every request sends the key in `x-api-key`, never follows a redirect and times out.

const API = '/api/openapi';

/**
 * `protectedId` is the main resume. This client never writes to it and never deletes it, whatever the
 * caller asks: the check sits here, below every caller, and is what keeps the main resume safe.
 */
export const createApi = ({ baseUrl, key, fetchImpl = fetch, protectedId = '' }) => {
  const origin = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!origin.startsWith('https://')) throw new Error('RXRESUME_URL must use https://');
  const send = async (label, path, { method = 'GET', body, timeoutMs = 30_000 } = {}) => {
    const init = {
      method,
      headers: { 'x-api-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetchImpl(`${origin}${API}${path}`, init);
    // only the status: an error body may echo what was sent
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    return response;
  };
  // a parser error can quote the text it failed on, which is resume data: the message stays generic
  const sendJson = async (label, path, options) => {
    const response = await send(label, path, options);
    try {
      return await response.json();
    } catch {
      throw new Error(`${label}: the answer is not JSON`);
    }
  };
  const at = (id) => `/resumes/${encodeURIComponent(id)}`;
  const refuseMain = (id, action) => {
    if (protectedId && id === protectedId) throw new Error(`refusing to ${action} the main resume`);
  };

  return {
    getResume: (id) => sendJson(`RxResume ${id}`, at(id)),

    listResumes: () => sendJson('RxResume list', '/resumes'),

    createResume: async ({ name, slug }) => {
      const body = await sendJson('RxResume create', '/resumes', { method: 'POST', body: { name, slug, tags: [], withSampleData: false } });
      const id = typeof body === 'string' ? body : body?.id;
      if (typeof id !== 'string' || !id) throw new Error('RxResume create: no id in the answer');
      return id;
    },

    patchResume: async (id, operations, expectedUpdatedAt) => {
      refuseMain(id, 'write to');
      return sendJson(`RxResume ${id} (update)`, at(id), {
        method: 'PATCH',
        body: { operations, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
      });
    },

    downloadPdf: async (id) => {
      const response = await send(`RxResume ${id} (pdf)`, `${at(id)}/pdf`, { timeoutMs: 60_000 });
      return new Uint8Array(await response.arrayBuffer());
    },

    /** Trash, then purge: a temporary copy must not stay in the account for 30 days. */
    removeResume: async (id) => {
      if (typeof id !== 'string' || !id) throw new Error('refusing to remove a resume without an id');
      refuseMain(id, 'delete');
      await send(`RxResume ${id} (trash)`, at(id), { method: 'DELETE' });
      await send(`RxResume ${id} (purge)`, '/documents/purge', { method: 'POST', body: { type: 'resume', id } });
    },
  };
};
