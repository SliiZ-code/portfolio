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

interface World {
  data: Record<string, any>;
  updatedAt: string;
  /** the fingerprint the site publishes: a 64-hex string, null (404), or 'unreachable' (network error) */
  live: string | null | 'unreachable';
  /** Coolify's answer for GET /deployments/applications/:uuid?take=1 */
  deployments: { status: string; updated_at: string }[] | 'error';
  rxStatus?: number;
}

const scenario = (overrides: Partial<World> = {}) => {
  const data = overrides.data ?? resumeData();
  const world: World = {
    data,
    updatedAt: new Date(NOW - 60 * MIN).toISOString(),
    live: fingerprintResume({ data }),
    deployments: [],
    ...overrides,
  };
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push({ method, url, auth: headers.get('authorization') ?? headers.get('x-api-key') });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

    if (url.startsWith(`${RX}/api/openapi/resumes/${MAIN}`)) {
      if (headers.get('x-api-key') !== RX_KEY) return json({ message: 'unauthorized' }, 401);
      if (world.rxStatus) return json({ message: `resume ${world.data.basics.headline}` }, world.rxStatus);
      return json({ id: MAIN, name: 'Julien', slug: 'julien', data: world.data, updatedAt: world.updatedAt, isPublic: false });
    }
    if (url.startsWith(`${SITE}/resume-fingerprint.json`)) {
      if (world.live === 'unreachable') throw new TypeError('fetch failed');
      if (world.live === null) return json({ message: 'not found' }, 404);
      return json({ fingerprint: world.live });
    }
    if (url.startsWith(`${CF}/api/v1/deployments/applications/${APP}`)) {
      if (!headers.get('authorization')?.startsWith('Bearer ') || headers.get('authorization') !== `Bearer ${CF_TOKEN}`) return json({ message: 'unauthenticated' }, 401);
      if (world.deployments === 'error') return json({ message: 'server error' }, 500);
      return json({ count: world.deployments.length, deployments: world.deployments.map((d, i) => ({ id: i, status: d.status, updated_at: d.updated_at, created_at: d.updated_at })) });
    }
    if (url.startsWith(`${CF}/api/v1/deploy?`)) {
      if (method !== 'POST') return json({ message: 'method not allowed' }, 405);
      if (headers.get('authorization') !== `Bearer ${CF_TOKEN}`) return json({ message: 'unauthenticated' }, 401);
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
  });
  return { promise, lines };
};

const deployCalls = (fake: ReturnType<typeof scenario>) => fake.calls.filter((call) => call.url.includes('/api/v1/deploy?'));

describe('checkResume: when to deploy', () => {
  it('does nothing when the live site already matches the master', async () => {
    const fake = scenario();
    const { promise } = run(fake);
    const result = await promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('waits when the master changed less than the quiet period ago', async () => {
    const data = resumeData({ basics: { ...resumeData().basics, headline: 'Ingénieur logiciel' } });
    const fake = scenario({ data, updatedAt: new Date(NOW - 10 * MIN).toISOString(), live: fingerprintResume({ data: resumeData() }) });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('deploys with force, once, when the master changed and the quiet period has passed', async () => {
    const data = resumeData({ basics: { ...resumeData().basics, headline: 'Ingénieur logiciel' } });
    const fake = scenario({ data, live: fingerprintResume({ data: resumeData() }) });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: true });
    const calls = deployCalls(fake);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${CF}/api/v1/deploy?uuid=${APP}&force=true`);
    expect(calls[0].auth).toBe(`Bearer ${CF_TOKEN}`);
  });

  it('treats a phone-only change as no change at all', async () => {
    const withOtherPhone = resumeData({ basics: { ...resumeData().basics, phone: '+33 6 11 22 33 44' } });
    const fake = scenario({ data: withOtherPhone, live: fingerprintResume({ data: resumeData() }) });
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

  it('also treats a missing live fingerprint (404) as changed', async () => {
    const fake = scenario({ live: null });
    expect((await run(fake).promise).deployed).toBe(true);
  });

  it.each(['queued', 'in_progress'])('skips while a deployment is %s', async (status) => {
    const fake = scenario({ live: 'unreachable', deployments: [{ status, updated_at: new Date(NOW - 1 * MIN).toISOString() }] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('skips and exits non-zero when the latest deployment failed in the last 6 hours', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [{ status: 'failed', updated_at: new Date(NOW - 2 * 60 * MIN).toISOString() }] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 1, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('deploys again once the failed deployment is older than 6 hours', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [{ status: 'failed', updated_at: new Date(NOW - 7 * 60 * MIN).toISOString() }] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: true });
  });

  it('waits when the latest deployment started less than the cooldown ago, so a mismatch cannot redeploy every run', async () => {
    const fake = scenario({ live: 'unreachable', deployments: [{ status: 'finished', updated_at: new Date(NOW - 10 * MIN).toISOString() }] });
    const result = await run(fake).promise;
    expect(result).toMatchObject({ exitCode: 0, deployed: false });
    expect(deployCalls(fake)).toHaveLength(0);
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

  it('stops without deploying when Coolify cannot be read', async () => {
    const fake = scenario({ live: 'unreachable', deployments: 'error' });
    const result = await run(fake).promise;
    expect(result.exitCode).toBe(1);
    expect(deployCalls(fake)).toHaveLength(0);
  });

  it('fails without deploying, and without echoing the body, when RxResume errors', async () => {
    const fake = scenario({ live: 'unreachable', rxStatus: 500 });
    const { promise, lines } = run(fake);
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(deployCalls(fake)).toHaveLength(0);
    expect(lines.join('\n')).not.toContain('Élève ingénieur');
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
