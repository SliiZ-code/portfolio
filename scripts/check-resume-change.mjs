#!/usr/bin/env node
// Redeploys the site when the master resume changed, about QUIET_MINUTES after the last edit.
// RxResume has no webhooks and autosaves while typing, so the checker waits for a quiet period before it
// deploys. It runs every 15 minutes in .github/workflows/resume-autodeploy.yml; locally:
//   node --env-file=.env scripts/check-resume-change.mjs --dry-run
//
// Per run, read-only except for the one deploy call:
//   1. the master is read from RxResume (scripts/lib/rxresume.mjs, GET only) and fingerprinted
//      (scripts/lib/fingerprint.mjs): the whole phone-free master, keyed with the RxResume key
//   2. the site's fingerprint is read from SITE_URL/resume-fingerprint.json (missing or unreachable = changed)
//   3. the newest of the latest Coolify deployments is read, and the decision is made (decideDeploy):
//      - a failed deployment that ended less than one cron interval ago: exit 1, once (GitHub emails the owner);
//        for the next six hours, no redeploy and exit 0 (no email for every run)
//      - the live site matches the master: nothing to do
//      - the master changed less than QUIET_MINUTES ago, or a deployment is queued or running: wait
//      - a deployment started less than DEPLOY_COOLDOWN_MINUTES ago: wait
//      - a deployment that started after the last edit and still left the site behind: its build could not
//        sync (RxResume or the translation failed), so wait and retry at most every six hours, not every run
//   4. deploy: POST {COOLIFY_URL}/api/v1/deploy?uuid=...&force=true (force = build without the Docker cache, so
//      the sync layer runs again; see docs/resume-sync.md)
// Logs carry decisions and 12-character fingerprint prefixes only: never resume text, keys, tokens, the phone
// number or URLs (the repository is public and Actions logs are public).
import { pathToFileURL } from 'node:url';
import { createApi } from './lib/rxresume.mjs';
import { fingerprintResume } from './lib/fingerprint.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The schedule runs every 15 minutes: the first run after a failure is the only one within this window, so a
// failure is reported by one run (a later run within the window would report it again).
const ALERT_WINDOW_MS = 15 * MINUTE;
const FAILURE_PAUSE_MS = 6 * HOUR;
const RETRY_PAUSE_MS = 6 * HOUR;
const DEPLOYMENTS_SEEN = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const HEX64 = /^[0-9a-f]{64}$/;

/** Coolify statuses are not documented in full: queued and in_progress/in-progress count as busy. */
const stateOf = (status) => {
  const normal = String(status ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (normal === 'queued' || normal === 'inprogress') return 'busy';
  if (normal === 'failed') return 'failed';
  return 'done';
};

/**
 * The decision, as data. `latest` is the newest Coolify deployment, `{ status, startedAt, endedAt }` with the
 * times in ms (NaN when unreadable), or null. Returns `{ deploy, exitCode, reason }`; `exitCode` 1 means
 * "stop, and tell the owner": GitHub then emails once for that run.
 */
export const decideDeploy = ({ masterFingerprint, live, updatedAt, now, quietMinutes, latest, cooldownMinutes }) => {
  if (latest && stateOf(latest.status) === 'failed') {
    const endedAt = Number.isFinite(latest.endedAt) ? latest.endedAt : latest.startedAt;
    if (!Number.isFinite(endedAt)) return { deploy: false, exitCode: 1, reason: 'the latest Coolify deployment has no readable time: stopping' };
    const agoMs = now - endedAt;
    if (agoMs < ALERT_WINDOW_MS) {
      return { deploy: false, exitCode: 1, reason: `the latest deployment failed ${Math.floor(agoMs / MINUTE)} min ago: reported once, no redeploy for 6 hours` };
    }
    if (agoMs < FAILURE_PAUSE_MS) {
      return { deploy: false, exitCode: 0, reason: `the latest deployment failed ${Math.floor(agoMs / MINUTE)} min ago: no redeploy for 6 hours` };
    }
  }

  if (live === masterFingerprint) return { deploy: false, exitCode: 0, reason: 'the live site matches the master: nothing to do' };

  const edited = Date.parse(updatedAt);
  if (!Number.isFinite(edited)) return { deploy: false, exitCode: 0, reason: 'the master update time is unreadable: waiting' };
  const ageMinutes = Math.max(0, Math.floor((now - edited) / MINUTE));
  if (ageMinutes < quietMinutes) {
    return { deploy: false, exitCode: 0, reason: `the master changed ${ageMinutes} min ago, the quiet period is ${quietMinutes} min: waiting` };
  }

  if (latest) {
    if (stateOf(latest.status) === 'busy') return { deploy: false, exitCode: 0, reason: 'a Coolify deployment is queued or in progress: waiting' };
    if (!Number.isFinite(latest.startedAt)) return { deploy: false, exitCode: 1, reason: 'the latest Coolify deployment has no readable time: stopping' };
    const sinceStartMs = now - latest.startedAt;
    if (sinceStartMs < cooldownMinutes * MINUTE) {
      return { deploy: false, exitCode: 0, reason: `the latest deployment started ${Math.floor(sinceStartMs / MINUTE)} min ago, cooldown ${cooldownMinutes} min: waiting` };
    }
    // Started after the last edit, so its build read the current master: if the site still differs, that build
    // could not sync. Retrying every cooldown would rebuild forever, so retry at most every six hours.
    if (latest.startedAt >= edited && sinceStartMs < RETRY_PAUSE_MS) {
      return { deploy: false, exitCode: 0, reason: 'a deployment started after the last edit and left the site behind (its sync failed?): retry in 6 hours' };
    }
  }

  return { deploy: true, exitCode: 0, reason: 'the master changed and the quiet period has passed: deploy' };
};

const nonEmpty = (value, fallback) => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const minutesFrom = (value, name) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a number of minutes`);
  return number;
};

const httpsOrigin = (value, name) => {
  const origin = value.replace(/\/+$/, '');
  if (!origin.startsWith('https://')) throw new Error(`${name} must use https://`);
  return origin;
};

const readConfig = (env, dryRun) => {
  const key = nonEmpty(env.RXRESUME_API_KEY, '');
  if (!key) throw new Error('RXRESUME_API_KEY is required');
  const mainId = nonEmpty(env.RXRESUME_ID, '') || nonEmpty(env.RXRESUME_ID_FR, '');
  if (!mainId) throw new Error('RXRESUME_ID is required (RXRESUME_ID_FR is accepted as an alias)');
  const coolifyNames = ['COOLIFY_URL', 'COOLIFY_DEPLOY_TOKEN', 'COOLIFY_APP_UUID'];
  const coolify = coolifyNames.map((name) => nonEmpty(env[name], ''));
  const hasCoolify = coolify.every(Boolean);
  if (!hasCoolify && !dryRun) throw new Error(`${coolifyNames.join(', ')} are required (a dry run does not need them)`);
  return {
    rxUrl: httpsOrigin(nonEmpty(env.RXRESUME_URL, 'https://rxresu.me'), 'RXRESUME_URL'),
    key,
    mainId,
    siteUrl: httpsOrigin(nonEmpty(env.SITE_URL, 'https://sliiz.com'), 'SITE_URL'),
    quietMinutes: minutesFrom(nonEmpty(env.QUIET_MINUTES, '30'), 'QUIET_MINUTES'),
    cooldownMinutes: minutesFrom(nonEmpty(env.DEPLOY_COOLDOWN_MINUTES, '30'), 'DEPLOY_COOLDOWN_MINUTES'),
    coolify: hasCoolify ? { url: httpsOrigin(coolify[0], 'COOLIFY_URL'), token: coolify[1], app: coolify[2] } : null,
  };
};

/** The site's fingerprint, or null when it is missing or unreachable. Only the status is ever logged. */
const liveFingerprint = async ({ siteUrl, fetchImpl, now, log }) => {
  try {
    const response = await fetchImpl(`${siteUrl}/resume-fingerprint.json?t=${now}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      log(`site: no fingerprint published (HTTP ${response.status})`);
      return null;
    }
    const body = await response.json();
    return typeof body?.fingerprint === 'string' && HEX64.test(body.fingerprint) ? body.fingerprint : null;
  } catch {
    log('site: fingerprint unreachable');
    return null;
  }
};

/** Coolify answers UTC times, sometimes without a zone: those are read as UTC, never as the machine's local time. */
const parseTime = (value) => {
  const text = String(value ?? '').trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  return Date.parse(iso);
};

/**
 * The newest Coolify deployment as `{ status, startedAt, endedAt }`, or null when there is none. The order of
 * the answer is not documented, so the newest by start time is picked out of the last few.
 */
const latestDeployment = async ({ coolify, fetchImpl }) => {
  const response = await fetchImpl(`${coolify.url}/api/v1/deployments/applications/${encodeURIComponent(coolify.app)}?take=${DEPLOYMENTS_SEEN}`, {
    headers: { authorization: `Bearer ${coolify.token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Coolify deployments: HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.deployments)) throw new Error('Coolify deployments: unexpected answer');
  const deployments = body.deployments
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      status: item.status,
      startedAt: parseTime(item.created_at ?? item.updated_at),
      endedAt: parseTime(item.updated_at ?? item.created_at),
    }));
  if (!deployments.length) return null;
  const rank = (item) => (Number.isFinite(item.startedAt) ? item.startedAt : -Infinity);
  return deployments.reduce((newest, item) => (rank(item) > rank(newest) ? item : newest));
};

const triggerDeploy = async ({ coolify, fetchImpl }) => {
  const query = new URLSearchParams({ uuid: coolify.app, force: 'true' });
  const response = await fetchImpl(`${coolify.url}/api/v1/deploy?${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${coolify.token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Coolify deploy: HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  const id = body?.deployments?.[0]?.deployment_uuid;
  return typeof id === 'string' ? id.slice(0, 8) : null;
};

/**
 * One check. Returns `{ exitCode, deployed, decision }` and logs decisions only. Every failure is caught
 * here and reported as exit code 1 with a short message: a message never carries a secret or resume text.
 */
export const checkResume = async ({ env = {}, fetchImpl = fetch, now = Date.now(), dryRun = false, log = console.log } = {}) => {
  try {
    const config = readConfig(env, dryRun);
    const api = createApi({ baseUrl: config.rxUrl, key: config.key, fetchImpl, protectedId: config.mainId });
    const master = await api.getResume(config.mainId);
    const masterFingerprint = fingerprintResume(master, config.key);
    const live = await liveFingerprint({ siteUrl: config.siteUrl, fetchImpl, now, log });
    log(`master ${masterFingerprint.slice(0, 12)}, live ${live ? live.slice(0, 12) : 'unavailable'}`);

    let latest = null;
    if (config.coolify) {
      latest = await latestDeployment({ coolify: config.coolify, fetchImpl });
    } else {
      log('coolify: no settings in this dry run, deployments not checked');
    }

    const decision = decideDeploy({
      masterFingerprint,
      live,
      updatedAt: master.updatedAt,
      now,
      quietMinutes: config.quietMinutes,
      latest,
      cooldownMinutes: config.cooldownMinutes,
    });
    log(`decision: ${decision.reason}`);

    if (!decision.deploy) return { exitCode: decision.exitCode, deployed: false, decision };
    if (dryRun) {
      log('dry run: would deploy (no deploy call made)');
      return { exitCode: 0, deployed: false, decision };
    }
    const deployment = await triggerDeploy({ coolify: config.coolify, fetchImpl });
    log(`deployment queued${deployment ? ` (${deployment}…)` : ''}, built without cache`);
    return { exitCode: 0, deployed: true, decision };
  } catch (error) {
    log(`error: ${error.message}`);
    return { exitCode: 1, deployed: false, decision: null };
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode } = await checkResume({ env: process.env, dryRun: process.argv.includes('--dry-run') });
  process.exitCode = exitCode;
}
