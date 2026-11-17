import { describe, expect, it } from 'vitest';
import { checkResume } from '../scripts/check-resume-change.mjs';
import { fingerprintResume } from '../scripts/lib/fingerprint.mjs';

// Everything here is fake: RxResume, the site and Coolify are answered by one injected fetch.
// The deploy endpoint is never reached for real. Secrets below are obvious placeholders.
const RX = 'https://rx.example';
const SITE = 'https://site.example';
const CF = 'https://coolify.example';
const RX_KEY = 'rx-key-SECRET-7f3a';
const CF_TOKEN = 'cf-token-SECRET-91bd';
const APP = 'app-uuid-1';
const MAIN = 'master-resume-id';
const PHONE = '+33 7 98 76 54 32';
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const MIN = 60_000;

const resumeData = (overrides: Record<string, unknown> = {}) => ({
  metadata: { template: 'onyx', notes: 'private note' },
  basics: { name: 'Julien Petit-Colboc', headline: 'Élève ingénieur', email: 'me@example.com', phone: PHONE, location: 'Rouen' },
  sections: {
    experience: {
      title: 'Expériences',
      hidden: false,
      items: [{ id: 'e1', hidden: false, company: 'CAPFI', position: 'Ingénieur', location: '', period: '2026', website: { url: '', label: '', inlineLink: false }, description: '', roles: [] }],
    },
  },
  ...overrides,
});

interface Deployment {
  status: string;
  startedAt: number;
  endedAt: number;
}

/** A deployment that started and ended this many minutes ago. */
const dep = (status: string, startedMinAgo: number, endedMinAgo = startedMinAgo): Deployment => ({
  status,
  startedAt: NOW - startedMinAgo * MIN,
  endedAt: NOW - endedMinAgo * MIN,
});

/** How a service fails instead of answering: an HTTP status with an optional body, or an error fetch throws. */
type Failure = { status: number; body?: unknown } | { thrown: unknown };

interface World {
  data: Record<string, any>;
  updatedAt: string;
  /** the fingerprint the site publishes: a 64-hex string, null (404), or 'unreachable' (network error) */
  live: string | null | 'unreachable';
  /** Coolify's answer for GET /deployments/applications/:uuid?take=5, in the order given */
  deployments: Deployment[];
  /** RxResume's answer to the master read, when it is not the resume */
  rx?: Failure;
  /** RxResume answers the master read with 200 and this text (not JSON) */
  rxRaw?: string;
  /** Coolify's answer to the deployments check */
  coolify?: Failure;
  /** Coolify's answer to the deploy call */
  deploy?: Failure;
}

const scenario = (overrides: Partial<World> = {}) => {
  const data = overrides.data ?? resumeData();
  const world: World = {
    data,
    updatedAt: new Date(NOW - 60 * MIN).toISOString(),
    live: fingerprintResume({ data }, RX_KEY),
    deployments: [],
    ...overrides,
  };
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const ago = (ms: number) => new Date(ms).toISOString();
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push({ method, url, auth: headers.get('authorization') ?? headers.get('x-api-key') });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const fail = (failure: Failure) => {
      if ('thrown' in failure) throw failure.thrown;
      return json(failure.body ?? { message: 'failed' }, failure.status);
    };

    if (url.startsWith(`${RX}/api/openapi/resumes/${MAIN}`)) {
      if (headers.get('x-api-key') !== RX_KEY) return json({ message: 'unauthorized' }, 401);
      if (world.rx) return fail(world.rx);
      if (world.rxRaw !== undefined) return new Response(world.rxRaw, { status: 200 });
      return json({ id: MAIN, name: 'Julien', slug: 'julien', data: world.data, updatedAt: world.updatedAt, isPublic: false });
    }
    if (url.startsWith(`${SITE}/resume-fingerprint.json`)) {
      if (world.live === 'unreachable') throw new TypeError('fetch failed');
      if (world.live === null) return json({ message: 'not found' }, 404);
      return json({ fingerprint: world.live });
    }
    if (url.startsWith(`${CF}/api/v1/deployments/applications/${APP}`)) {
      if (!headers.get('authorization')?.startsWith('Bearer ') || headers.get('authorization') !== `Bearer ${CF_TOKEN}`) return json({ message: 'unauthenticated' }, 401);
      if (world.coolify) return fail(world.coolify);
      return json({
        count: world.deployments.length,
        deployments: world.deployments.map((d, i) => ({ id: i, status: d.status, created_at: ago(d.startedAt), updated_at: ago(d.endedAt) })),
      });
    }
    if (url.startsWith(`${CF}/api/v1/deploy?`)) {
      if (method !== 'POST') return json({ message: 'method not allowed' }, 405);
      if (headers.get('authorization') !== `Bearer ${CF_TOKEN}`) return json({ message: 'unauthenticated' }, 401);
      if (world.deploy) return fail(world.deploy);
      return json({ deployments: [{ message: 'queued', resource_uuid: APP, deployment_uuid: 'dep-0123456789abcdef' }] });
    }
    return json({ message: 'no route' }, 404);
  };
  return { world, calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};

const env = (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  RXRESUME_URL: RX,
  RXRESUME_ID: MAIN,
  RXRESUME_API_KEY: RX_KEY,
  SITE_URL: SITE,
  COOLIFY_URL: CF,
  COOLIFY_DEPLOY_TOKEN: CF_TOKEN,
  COOLIFY_APP_UUID: APP,
  QUIET_MINUTES: '30',
  ...overrides,
});

const run = (fake: ReturnType<typeof scenario>, options: { env?: Record<string, string | undefined>; dryRun?: boolean } = {}) => {
  const lines: string[] = [];
  const promise = checkResume({
    env: options.env ?? env(),
    fetchImpl: fake.fetchImpl,
    now: NOW,
    dryRun: options.dryRun ?? false,
    log: (line: string) => lines.push(line),
    sleep: async () => {},
  });
  return { promise, lines };
};

/** The master was edited an hour ago and the live site is behind: without a failure, the run deploys. */
const behind = (overrides: Partial<World> = {}) =>
  scenario({
    data: resumeData({ basics: { ...resumeData().basics, headline: 'Ingénieur logiciel' } }),
    live: fingerprintResume({ data: resumeData() }, RX_KEY),
    ...overrides,
  });

const networkError = (code = 'ECONNREFUSED') =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} rx.example:443`), { code }) });

const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

const deployCalls = (fake: ReturnType<typeof scenario>) => fake.calls.filter((call) => call.url.includes('/api/v1/deploy?'));

describe('checkResume: when to deploy', () => {
  it('does nothing when the live site already matches the master', async () => {
    const fake = scenario();
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('waits when the master changed less than the quiet period ago', async () => {
    const data = resumeData({ basics: { ...resumeData().basics, headline: 'Ingénieur logiciel' } });
    const fake = scenario({ data, updatedAt: new Date(NOW - 10 * MIN).toISOString(), live: fingerprintResume({ data: resumeData() }, RX_KEY) });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('deploys with force, once, when the master changed and the quiet period has passed', async () => {
    const data = resumeData({ basics: { ...resumeData().basics, headline: 'Ingénieur logiciel' } });
    const fake = scenario({ data, live: fingerprintResume({ data: resumeData() }, RX_KEY) });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: true });
    const calls = deployCalls(fake);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${CF}/api/v1/deploy?uuid=${APP}&force=true`);
    expect(calls[0].auth).toBe(`Bearer ${CF_TOKEN}`);
  });

  it('deploys a change only the CV PDF shows, such as the template', async () => {
    const data = resumeData({ metadata: { template: 'azurill', notes: 'private note' } });
    const fake = scenario({ data, live: fingerprintResume({ data: resumeData() }, RX_KEY) });
    expect((await run(fake).promise).deployed).toBe(true);
  });

  it('treats a phone-only change as no change at all', async () => {
    const withOtherPhone = resumeData({ basics: { ...resumeData().basics, phone: '+33 6 11 22 33 44' } });
    const fake = scenario({ data: withOtherPhone, live: fingerprintResume({ data: resumeData() }, RX_KEY) });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('treats an unreachable live fingerprint as changed, so it deploys only when the quiet period holds', async () => {
    const quiet = scenario({ live: 'unreachable' });
    expect((await run(quiet).promise).deployed).toBe(true);
    expect(deployCalls(quiet)).toHaveLength(1);

    const recent = scenario({ live: 'unreachable', updatedAt: new Date(NOW - 5 * MIN).toISOString() });
    const result = await run(recent).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(recent)).toHaveLength(0);
  });

  it('also treats a missing live fingerprint (404, or null) as changed', async () => {
    const fake = scenario({ live: null });
    expect((await run(fake).promise).deployed).toBe(true);
  });

  it.each(['queued', 'in_progress'])('skips while a deployment is %s', async (status) => {
    const fake = scenario({ live: 'unreachable', deployments: [dep(status, 1)] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('waits when the latest deployment started less than the cooldown ago', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [dep('finished', 10)] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });
});

describe('checkResume: a failed deployment is reported once', () => {
  it('exits 1 and does not redeploy when the failure ended less than 15 minutes ago', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [dep('failed', 20, 10)] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('is reported even while the master is still in its quiet period', async () => {
    const fake = scenario({ live: 'unreachable', updatedAt: new Date(NOW - 3 * MIN).toISOString(), deployments: [dep('failed', 20, 5)] });
    expect((await run(fake).promise).exitCode).toBe(1);
  });

  it('stays quiet on the next runs: exit 0, no redeploy, for six hours after the failure', async () => {
    for (const endedMinAgo of [20, 35, 120, 5 * 60]) {
      const fake = scenario({ live: 'unreachable', deployments: [dep('failed', endedMinAgo + 5, endedMinAgo)] });
      const result = await run(fake).promise;
      expect(result).toMatchObject({ exitCode: 0, deployed: false });
      expect(deployCalls(fake)).toHaveLength(0);
    }
  });

  it('deploys again once the failed deployment is older than 6 hours', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [dep('failed', 7 * 60 + 5, 7 * 60)] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: true });
  });

  it('reads the newest deployment, not the first one listed', async () => {
    const fake = scenario({
      live: 'unreachable',
      updatedAt: new Date(NOW - 2 * 60 * MIN).toISOString(),
      deployments: [dep('finished', 5 * 60), dep('failed', 20, 10)],
    });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 1, deployed: false });
    expect(fake.calls.some((call) => call.url === `${CF}/api/v1/deployments/applications/${APP}?take=5`)).toBe(true);
  });
});

describe('checkResume: a sync that keeps failing does not rebuild every cooldown', () => {
  it('waits after a deployment that started after the last edit left the site behind', async () => {
    const fake = scenario({
      live: 'unreachable',
      updatedAt: new Date(NOW - 3 * 60 * MIN).toISOString(),
      deployments: [dep('finished', 2 * 60)],
    });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('retries once six hours have passed since that deployment', async () => {
    const fake = scenario({
      live: 'unreachable',
      updatedAt: new Date(NOW - 10 * 60 * MIN).toISOString(),
      deployments: [dep('finished', 7 * 60)],
    });
    expect((await run(fake).promise).deployed).toBe(true);
  });

  it('does not hold back a deployment that started before the last edit', async () => {
    const fake = scenario({
      live: 'unreachable',
      updatedAt: new Date(NOW - 2 * 60 * MIN).toISOString(),
      deployments: [dep('finished', 3 * 60)],
    });
    expect((await run(fake).promise).deployed).toBe(true);
  });

  it('does not mistake an edit made while a build was running for a failed sync', async () => {
    const fake = scenario({
      live: 'unreachable',
      updatedAt: new Date(NOW - 58 * MIN).toISOString(),
      deployments: [dep('finished', 60, 55)],
    });
    expect((await run(fake).promise).deployed).toBe(true);
  });
});

describe('checkResume: dry run and configuration', () => {
  it('prints the decision and never calls the deploy endpoint', async () => {
    const fake = scenario({ live: 'unreachable' });
    const { promise, lines } = run(fake, { dryRun: true });
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/dry run/i);
    expect(lines.join('\n')).toMatch(/would deploy/i);
  });

  it('runs without the Coolify settings in dry run, and makes no Coolify call', async () => {
    const fake = scenario({ live: 'unreachable' });
    const coolifyless = env({ COOLIFY_URL: undefined, COOLIFY_DEPLOY_TOKEN: undefined, COOLIFY_APP_UUID: undefined });
    const result = await run(fake, { env: coolifyless, dryRun: true }).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(fake.calls.some((call) => call.url.startsWith(CF))).toBe(false);
  });

  it('stops before any call when a required secret is missing, and names only the variable', async () => {
    const fake = scenario({ live: 'unreachable' });
    const { promise, lines } = run(fake, { env: env({ RXRESUME_API_KEY: undefined }) });
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(fake.calls).toHaveLength(0);
    expect(lines.join('\n')).toContain('RXRESUME_API_KEY');
  });

});

describe('checkResume: the logs', () => {
  it('never contain the API keys, the phone number, resume text or a full fingerprint', async () => {
    const fake = scenario({ live: 'unreachable' });
    const { promise, lines } = run(fake);
    await promise;
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [RX_KEY, CF_TOKEN, PHONE, '798765432', 'Élève ingénieur', 'Julien Petit-Colboc', 'CAPFI', 'dep-0123456789abcdef']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/[0-9a-f]{40,}/);
  });

  it('does not log the URLs it calls', async () => {
    const fake = scenario({ live: 'unreachable' });
    const { promise, lines } = run(fake);
    await promise;
    const text = lines.join('\n');
    for (const url of [RX, SITE, CF]) expect(text).not.toContain(url);
  });
});

describe('checkResume: a transient failure skips the run quietly', () => {
  it.each([429, 500, 503])('RxResume %i: exits 0, no deploy, one line naming the service and the status', async (status) => {
    const fake = behind({ rx: { status, body: { message: 'Élève ingénieur' } } });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.at(-1)).toBe(`RxResume: HTTP ${status} (transient), no deploy this run`);
  });

  it('retries the master read before skipping the run, one line per retry', async () => {
    const fake = behind({ rx: { status: 503 } });
    const { promise, lines } = run(fake);
    await promise;
    expect(lines.filter((line) => line.includes('attempt'))).toEqual([
      'RxResume: HTTP 503, attempt 1 of 3 failed, retrying in 2000 ms',
      'RxResume: HTTP 503, attempt 2 of 3 failed, retrying in 5000 ms',
    ]);
  });

  it('RxResume network error: exits 0, no deploy, and the error code only', async () => {
    const fake = behind({ rx: { thrown: networkError() } });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.at(-1)).toBe('RxResume: network error ECONNREFUSED (transient), no deploy this run');
  });

  it('RxResume timeout: exits 0, no deploy', async () => {
    const fake = behind({ rx: { thrown: timeoutError() } });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.at(-1)).toBe('RxResume: timeout (transient), no deploy this run');
  });

  it('Coolify 502 on the deployments check: exits 0, no deploy', async () => {
    const fake = behind({ coolify: { status: 502 } });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.at(-1)).toBe('Coolify: HTTP 502 (transient), no deploy this run');
  });

  it.each([{ status: 502 }, { thrown: networkError() }] as Failure[])('a failed deploy call (%o) exits 0 and is not reported as deployed', async (deploy) => {
    const fake = behind({ deploy });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^Coolify: .* \(transient\), no deploy this run$/);
  });
});

describe('checkResume: a configuration or auth failure stops the run loudly', () => {
  it.each([401, 403])('RxResume %i: exits 1 and does not deploy', async (status) => {
    const fake = behind({ rx: { status } });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('a refused redirect (RxResume URL is wrong, not down): exits 1 and does not deploy', async () => {
    const redirect = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    const fake = behind({ rx: { thrown: redirect } });
    const { promise, lines } = run(fake);
    expect(await promise).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines).toEqual(['RxResume: redirect refused, check the URL, stopping']);
  });

  it('RxResume 404 on the master: exits 1 and does not deploy', async () => {
    const fake = behind({ rx: { status: 404 } });
    expect(await run(fake).promise).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('an unparseable master: exits 1, does not deploy, and does not echo the text', async () => {
    const fake = behind({ rxRaw: '<html>Élève ingénieur</html>' });
    const { promise, lines } = run(fake);
    expect(await promise).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.join('\n')).not.toContain('Élève ingénieur');
  });

  it.each([401, 403])('Coolify %i on the deployments check: exits 1 and does not deploy', async (status) => {
    const fake = behind({ coolify: { status } });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });
});

describe('checkResume: the logs of a failure', () => {
  it.each([
    ['RxResume 503', { rx: { status: 503, body: { message: 'Élève ingénieur' } } }],
    ['RxResume network error', { rx: { thrown: networkError() } }],
    ['RxResume 401', { rx: { status: 401, body: { message: 'Élève ingénieur' } } }],
    ['Coolify 502', { coolify: { status: 502, body: { message: 'Élève ingénieur' } } }],
    ['Coolify 403', { coolify: { status: 403, body: { message: 'Élève ingénieur' } } }],
  ] as [string, Partial<World>][])('%s: never contains the keys, the resume text, the phone or a host', async (_, failure) => {
    const fake = behind(failure);
    const { promise, lines } = run(fake);
    await promise;
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [RX_KEY, CF_TOKEN, PHONE, '798765432', 'Élève ingénieur', 'Julien Petit-Colboc', 'rx.example', 'site.example', 'coolify.example']) {
      expect(text).not.toContain(secret);
    }
  });
});
