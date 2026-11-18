#!/usr/bin/env node
// The resume autodeploy timer: its own Coolify application (Dockerfile.autodeploy), from this repository.
// It runs scripts/check-resume-change.mjs at start, then every CHECK_INTERVAL_MINUTES (default 15), one check
// at a time, so two checks never overlap. Every decision, retry and log line belongs to the checker; this
// loop only says when it starts, how often it runs and what each check exited with.
//   node scripts/autodeploy-loop.mjs
// Locally, with the settings of docs/resume-sync.md:
//   node --env-file=.env scripts/autodeploy-loop.mjs
// SIGTERM and SIGINT stop it: the default sleep ends at once and the process exits 0.
// Logs carry no environment value: the interval (a number of minutes) is the only setting ever printed.
import { pathToFileURL } from 'node:url';
import { checkResume } from './check-resume-change.mjs';

const MINUTE = 60_000;
const DEFAULT_INTERVAL_MINUTES = 15;

/**
 * The pause between two checks, in ms, from CHECK_INTERVAL_MINUTES. An absent or empty value means the
 * default (15); anything that is not a positive number of minutes is a configuration error.
 */
export const intervalMsFrom = (env = {}) => {
  const text = String(env.CHECK_INTERVAL_MINUTES ?? '').trim();
  const minutes = text === '' ? DEFAULT_INTERVAL_MINUTES : Number(text);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('CHECK_INTERVAL_MINUTES must be a number of minutes greater than 0');
  return minutes * MINUTE;
};

/** The default sleep: resolves at the end of the pause, or as soon as the signal aborts, timer cleared. */
const sleepFor = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * One check immediately, then the interval, until the signal aborts. `check` defaults to the real checker
 * and gets the same `env` and `log`. A check that exits 1 or throws is logged and the loop goes on: a
 * bad run must not stop the timer. `sleep` is injectable so the tests never wait; it receives the signal
 * so it can end early. Returns `{ runs }`, the number of checks it ran.
 */
export const runAutodeploy = async ({ env = {}, check = checkResume, sleep = sleepFor, log = console.log, signal } = {}) => {
  const intervalMs = intervalMsFrom(env);
  log('autodeploy: resume check loop starting');
  log(`autodeploy: interval ${intervalMs / MINUTE} min`);
  let runs = 0;
  while (!signal?.aborted) {
    runs += 1;
    let exitCode = 1;
    try {
      const result = await check({ env, log });
      exitCode = Number(result?.exitCode) === 0 ? 0 : 1;
    } catch (error) {
      // The checker catches its own failures; this is only for an injected or unexpected one. Its message
      // can quote a setting, so the class name is logged instead.
      log(`autodeploy: check ${runs} threw ${error?.name ?? 'an error'}`);
    }
    log(`autodeploy: check ${runs} exit ${exitCode}`);
    if (signal?.aborted) break;
    await sleep(intervalMs, signal);
  }
  return { runs };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort());
  try {
    await runAutodeploy({ env: process.env, signal: controller.signal });
    process.exitCode = 0;
  } catch (error) {
    // A configuration error (for example CHECK_INTERVAL_MINUTES): the message names the setting only.
    console.error(`autodeploy: ${error.message}`);
    process.exitCode = 1;
  }
}
