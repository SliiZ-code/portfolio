// The RxResume calls the sync makes, all under `${RXRESUME_URL}/api/openapi` (OpenAPI spec 6.x):
//   GET    /resumes                      list (metadata only), used to find leftover copies
//   GET    /resumes/{id}                 read a resume with its data
//   POST   /resumes                      create a copy, body {name, slug, tags, withSampleData}, answers the id
//   PATCH  /resumes/{id}                 JSON Patch on the top-level keys of the data, guarded by expectedUpdatedAt
//   GET    /resumes/{id}/pdf             the PDF
//   DELETE /resumes/{id}                 moves the resume to Trash (30 days)
//   POST   /documents/purge              {type: "resume", id}: deletes a resume that is in Trash, for good
// Every request sends the key in `x-api-key`, never follows a redirect and times out.
//
// Retries (docs/resume-sync.md, "Retries"): the pauses before each retry come from `retryPausesMs` (the build
// waits longer than the checker), or from the Retry-After header (capped at 30 s). A 401 or 429 means the request
// was refused before it was processed, so it is retried for every method. A GET is also retried on 408, 5xx, a
// network error or a timeout. Nothing else is retried, so a create, a patch or a delete that may already have run
// is never run twice.

const API = '/api/openapi';
/** The checker's schedule: three attempts, about 7 s in all. It runs every 15 minutes and tries again then. */
export const CHECKER_PAUSES_MS = [2_000, 5_000];
/** The build's schedule: five attempts, about 52 s in all, enough for a refusal that lasts about a minute. */
export const BUILD_PAUSES_MS = [2_000, 5_000, 15_000, 30_000];
const RETRY_AFTER_CAP_MS = 30_000;

/** A real pause; the checker and the sync inject their own so the tests do not wait. */
export const pauseFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The pause a Retry-After header asks for, in ms and capped; null when there is no usable header. */
const retryAfterMs = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  let ms;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    const date = Date.parse(text);
    if (Number.isNaN(date)) return null;
    ms = date - Date.now();
  }
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
};

/** Whether a response with this status may be retried for this method. */
const retriable = (status, method) => {
  if (status === 401 || status === 429) return true;
  return method === 'GET' && (status === 408 || status >= 500);
};

/** Why a fetch threw, in words: the error's message can quote the URL, so it is not used. */
const failureName = (error) => (error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network error');

/**
 * `protectedId` is the main resume. This client never writes to it and never deletes it, whatever the
 * caller asks: the check sits here, below every caller, and is what keeps the main resume safe.
 * `retryPausesMs` is the schedule of retries (attempts are one more than its length; default: the checker's).
 * `sleep` and `log` are injectable so tests run without waiting.
 */
export const createApi = ({
  baseUrl,
  key,
  fetchImpl = fetch,
  protectedId = '',
  timeoutMs: defaultTimeoutMs = 30_000,
  retryPausesMs = CHECKER_PAUSES_MS,
  sleep = pauseFor,
  log = console.log,
}) => {
  const origin = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!origin.startsWith('https://')) throw new Error('RXRESUME_URL must use https://');

  // One try. Resolves to `{ ok: true, value }` or to a failure that may be retried; throws when it must not be.
  const tryOnce = async (label, url, init, timeoutMs, read) => {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // an injected fetch can say whether its error is worth a retry (the checker's guard does); `false` is final
      if (error?.transient === false) throw error;
      // an error with a `transient` flag is the checker's ServiceError: its `detail` is safe to log, its message repeats the label
      const reason = typeof error?.transient === 'boolean' ? error.detail : failureName(error);
      return { ok: false, error, reason };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, reason: `HTTP ${response.status}`, retryAfter: response.headers.get('retry-after') };
    }
    try {
      return { ok: true, value: await read(response) };
    } catch (error) {
      // a parser error can quote the text it failed on, which is resume data: the message stays generic
      if (error instanceof SyntaxError) throw new Error(`${label}: the answer is not JSON`);
      return { ok: false, error, reason: failureName(error) };
    }
  };

  const send = async (label, path, { method = 'GET', body, timeoutMs = defaultTimeoutMs, read = async () => undefined } = {}) => {
    const url = `${origin}${API}${path}`;
    const init = {
      method,
      headers: { 'x-api-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      redirect: 'error',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const attemptsAllowed = retryPausesMs.length + 1;
    for (let attempts = 1; ; attempts += 1) {
      const outcome = await tryOnce(label, url, init, timeoutMs, read);
      if (outcome.ok) return outcome.value;
      // a failure with no status is a network error or a timeout: only a GET is safe to repeat
      const again = outcome.status === undefined ? method === 'GET' : retriable(outcome.status, method);
      if (!again || attempts >= attemptsAllowed) {
        // the checker's own errors keep their transient flag: that classification is its contract
        if (outcome.error && typeof outcome.error.transient === 'boolean') throw outcome.error;
        throw new Error(`${label}: ${outcome.reason}`);
      }
      const pause = retryAfterMs(outcome.retryAfter) ?? retryPausesMs[attempts - 1];
      log(`${label}: ${outcome.reason}, attempt ${attempts} of ${attemptsAllowed} failed, retrying in ${pause} ms`);
      await sleep(pause);
    }
  };

  const at = (id) => `/resumes/${encodeURIComponent(id)}`;
  const refuseMain = (id, action) => {
    if (protectedId && id === protectedId) throw new Error(`refusing to ${action} the main resume`);
  };
  // a parser error is reported in `send` as "not JSON", so the body is only parsed here
  const readJson = (response) => response.json();
  const readBytes = async (response) => new Uint8Array(await response.arrayBuffer());

  return {
    // the labels carry no id: the checker logs these messages, and its logs are public
    getResume: (id) => send('RxResume', at(id), { read: readJson }),

    listResumes: () => send('RxResume list', '/resumes', { read: readJson }),

    createResume: async ({ name, slug }) => {
      const body = await send('RxResume create', '/resumes', { method: 'POST', body: { name, slug, tags: [], withSampleData: false }, read: readJson });
      const id = typeof body === 'string' ? body : body?.id;
      if (typeof id !== 'string' || !id) throw new Error('RxResume create: no id in the answer');
      return id;
    },

    patchResume: async (id, operations, expectedUpdatedAt) => {
      refuseMain(id, 'write to');
      return send('RxResume (update)', at(id), {
        method: 'PATCH',
        body: { operations, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
        read: readJson,
      });
    },

    downloadPdf: (id) => send('RxResume (pdf)', `${at(id)}/pdf`, { timeoutMs: 60_000, read: readBytes }),

    /** Trash, then purge: a temporary copy must not stay in the account for 30 days. */
    removeResume: async (id) => {
      if (typeof id !== 'string' || !id) throw new Error('refusing to remove a resume without an id');
      refuseMain(id, 'delete');
      await send('RxResume (trash)', at(id), { method: 'DELETE' });
      await send('RxResume (purge)', '/documents/purge', { method: 'POST', body: { type: 'resume', id } });
    },
  };
};
