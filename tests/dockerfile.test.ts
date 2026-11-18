import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Dockerfile is not built in the tests (no Docker here). These checks read the sync RUN and pin the
// wiring that Coolify's "Use Docker Build Secrets" depends on: each setting comes in as a secret and falls
// back to its ARG.
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

const SETTINGS = [
  'RXRESUME_URL',
  'RXRESUME_ID',
  'RXRESUME_ID_FR',
  'TRANSLATE_OPENCODE_MODEL',
  'TRANSLATE_CLAUDE_MODEL',
  'TRANSLATE_GEMINI_MODEL',
  'TRANSLATE_OPENROUTER_MODEL',
];

const API_KEYS = ['RXRESUME_API_KEY', 'OPENCODE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];

/** The instruction that runs the sync: from its first mount to the blank line that ends it. */
const syncRun = (() => {
  const start = dockerfile.indexOf('RUN --mount=type=secret,id=RXRESUME_API_KEY');
  expect(start).toBeGreaterThan(-1);
  const end = dockerfile.indexOf('\n\n', start);
  return dockerfile.slice(start, end);
})();

describe('Dockerfile: resume sync settings', () => {
  it.each(SETTINGS)('declares %s as an ARG, the fallback for plain docker build --build-arg', (name) => {
    expect(dockerfile).toMatch(new RegExp(`^ARG ${name}$`, 'm'));
  });

  it.each(SETTINGS)('mounts %s as a secret under a SECRET_ name, so an absent or empty secret never blanks its ARG', (name) => {
    expect(syncRun).toContain(`--mount=type=secret,id=${name},env=SECRET_${name}`);
  });

  it.each(SETTINGS)('exports %s from the secret, falling back to the ARG when the secret is empty or absent', (name) => {
    expect(syncRun).toContain(`${name}="\${SECRET_${name}:-$${name}}"`);
  });

  it('mounts RXRESUME_ID and RXRESUME_URL, the two settings the sync cannot run without', () => {
    expect(syncRun).toContain('--mount=type=secret,id=RXRESUME_ID,env=SECRET_RXRESUME_ID');
    expect(syncRun).toContain('--mount=type=secret,id=RXRESUME_URL,env=SECRET_RXRESUME_URL');
  });

  it.each(API_KEYS)('keeps %s as a secret under its own name', (name) => {
    expect(syncRun).toContain(`--mount=type=secret,id=${name},env=${name}`);
  });

  it('exports the settings before the sync runs, so npm sees them', () => {
    expect(syncRun.indexOf('export RXRESUME_URL=')).toBeLessThan(syncRun.indexOf('npm run sync:resume'));
  });
});
