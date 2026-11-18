import { describe, expect, it } from 'vitest';
import { intervalMsFrom, runAutodeploy } from '../scripts/autodeploy-loop.mjs';

// Everything here is fake: the check, the sleep and the log are injected, so the loop never waits and never
// calls RxResume, the site or Coolify. Secrets below are obvious placeholders.
const RX_KEY = 'rx-key-SECRET-7f3a';
const CF_TOKEN = 'cf-token-SECRET-91bd';
const MIN = 60_000;

describe('intervalMsFrom', () => {
  it('defaults to 15 minutes when CHECK_INTERVAL_MINUTES is absent or empty', () => {
    expect(intervalMsFrom({})).toBe(15 * MIN);
    expect(intervalMsFrom({ CHECK_INTERVAL_MINUTES: '' })).toBe(15 * MIN);
  });

  it('reads CHECK_INTERVAL_MINUTES as a number of minutes', () => {
    expect(intervalMsFrom({ CHECK_INTERVAL_MINUTES: '5' })).toBe(5 * MIN);
    expect(intervalMsFrom({ CHECK_INTERVAL_MINUTES: '0.5' })).toBe(30_000);
  });

  it.each(['0', '-5', 'NaN', 'abc'])('throws on %j, which is not a positive number of minutes', (value) => {
    expect(() => intervalMsFrom({ CHECK_INTERVAL_MINUTES: value })).toThrow(/CHECK_INTERVAL_MINUTES/);
  });
});

describe('runAutodeploy', () => {
  /** A loop whose check keeps a count, whose sleep aborts the loop after `stopAfterSleeps`, and whose log is kept. */
  const loop = (options: { stopAfterSleeps?: number; check?: () => Promise<{ exitCode: number }> | { exitCode: number }; env?: Record<string, string | undefined> } = {}) => {
    const controller = new AbortController();
    const lines: string[] = [];
    const sleeps: number[] = [];
    const events: string[] = [];
    let checks = 0;
    let active = 0;
    let overlap = false;
    const stopAfterSleeps = options.stopAfterSleeps ?? 1;
    const check = options.check ?? (() => ({ exitCode: 0 }));
    const run = runAutodeploy({
      env: options.env ?? {},
      check: async () => {
        checks += 1;
        events.push('check');
        active += 1;
        if (active > 1) overlap = true;
        try {
          return await check();
        } finally {
          active -= 1;
        }
      },
      sleep: async (ms: number) => {
        events.push('sleep');
        sleeps.push(ms);
        if (sleeps.length >= stopAfterSleeps) controller.abort();
      },
      log: (line: string) => lines.push(line),
      signal: controller.signal,
    });
    return { run, controller, lines, sleeps, events, count: () => checks, overlapped: () => overlap };
  };

  it('checks immediately, sleeps the interval between checks, and never overlaps', async () => {
    const fake = loop({ stopAfterSleeps: 2, env: { CHECK_INTERVAL_MINUTES: '2' } });
    const { runs } = await fake.run;
    expect(runs).toBe(2);
    expect(fake.count()).toBe(2);
    expect(fake.events).toEqual(['check', 'sleep', 'check', 'sleep']);
    expect(fake.sleeps).toEqual([2 * MIN, 2 * MIN]);
    expect(fake.overlapped()).toBe(false);
  });

  it('stops on abort, before the next check and after the sleep ends early', async () => {
    const fake = loop({ stopAfterSleeps: 1 });
    const { runs } = await fake.run;
    expect(runs).toBe(1);
    expect(fake.count()).toBe(1);
  });

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const lines: string[] = [];
    const result = await runAutodeploy({ env: {}, check: async () => ({ exitCode: 0 }), log: (line: string) => lines.push(line), signal: controller.signal });
    expect(result.runs).toBe(0);
    expect(lines.join('\n')).toContain('interval 15 min');
  });

  it('keeps going, after the interval, when a check exits 1', async () => {
    const fake = loop({ stopAfterSleeps: 2, check: () => ({ exitCode: 1 }) });
    const { runs } = await fake.run;
    expect(runs).toBe(2);
    expect(fake.count()).toBe(2);
    expect(fake.lines.filter((line) => line.includes('exit 1'))).toHaveLength(2);
  });

  it('keeps going when a check throws, and logs its class name only', async () => {
    let calls = 0;
    const fake = loop({
      stopAfterSleeps: 2,
      check: () => {
        calls += 1;
        if (calls === 1) throw new TypeError(`connect https://rx.example?key=${RX_KEY}`);
        return { exitCode: 0 };
      },
    });
    const { runs } = await fake.run;
    expect(runs).toBe(2);
    expect(fake.count()).toBe(2);
    const text = fake.lines.join('\n');
    expect(text).toContain('check 1 threw TypeError');
    expect(text).toContain('check 1 exit 1');
    expect(text).toContain('check 2 exit 0');
    expect(text).not.toContain(RX_KEY);
  });

  it('logs its own start line, the interval and each exit code, never an environment value', async () => {
    const fake = loop({ stopAfterSleeps: 1, env: { CHECK_INTERVAL_MINUTES: '2', RXRESUME_API_KEY: RX_KEY, COOLIFY_DEPLOY_TOKEN: CF_TOKEN } });
    await fake.run;
    const text = fake.lines.join('\n');
    expect(text).toContain('autodeploy: resume check loop starting');
    expect(text).toContain('interval 2 min');
    expect(text).toContain('check 1 exit 0');
    for (const secret of [RX_KEY, CF_TOKEN, String(2 * MIN)]) expect(text).not.toContain(secret);
  });
});
