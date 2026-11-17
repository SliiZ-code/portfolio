import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Caddyfile is not run in the tests (no Caddy here). These checks read its text and resolve each path the way
// Caddy does: handle blocks are tried in order and the first one whose matcher fits serves the request.

const caddyfile = readFileSync(new URL('../Caddyfile', import.meta.url), 'utf8');

const DAY = 'public, max-age=86400';
const YEAR = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

interface Directive {
  name: string;
  args: string;
  body: string[];
}

const netBraces = (text: string) => (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);

/** The directives of one block, one level deep: each is a line, with the lines of its own block as its body. */
const parseDirectives = (lines: string[]): Directive[] => {
  const directives: Directive[] = [];
  let open: Directive | undefined;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (depth === 0) {
      if (line === '' || line.startsWith('#')) continue;
      const [name, ...rest] = line.replace(/\s*\{$/, '').split(/\s+/);
      const directive: Directive = { name, args: rest.join(' '), body: [] };
      directives.push(directive);
      depth += netBraces(line);
      open = depth > 0 ? directive : undefined;
    } else {
      depth += netBraces(line);
      if (depth > 0) open?.body.push(line);
    }
  }
  return directives;
};

/** The directives inside the site block `:80 { … }`. */
const site = (() => {
  const lines = caddyfile.split('\n');
  const start = lines.indexOf(':80 {');
  const end = lines.indexOf('}', start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return parseDirectives(lines.slice(start + 1, end));
})();

const handles = site.filter((directive) => directive.name === 'handle');
const matchers = new Map(
  site
    .filter((directive) => directive.name.startsWith('@'))
    .map((directive) => {
      const [kind, ...patterns] = directive.args.split(/\s+/);
      expect(kind).toBe('path');
      return [directive.name, patterns] as const;
    }),
);

/** A Caddy path pattern: `*` inside a segment matches part of it, a trailing `/*` matches everything below. */
const pathRegExp = (pattern: string): RegExp => {
  const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  if (pattern.endsWith('/*')) {
    return new RegExp(`^${escape(pattern.slice(0, -2))}/.*$`);
  }
  return new RegExp(`^${pattern.split('*').map(escape).join('[^/]*')}$`);
};

const handleMatches = (handle: Directive, urlPath: string): boolean => {
  if (handle.args === '') return true;
  const patterns = handle.args.startsWith('@') ? matchers.get(handle.args) ?? [] : [handle.args];
  return patterns.some((pattern) => pathRegExp(pattern).test(urlPath));
};

const cacheControlOf = (handle: Directive): string[] =>
  handle.body.flatMap((line) => {
    const match = /^header\s+Cache-Control\s+"([^"]*)"$/.exec(line);
    return match ? [match[1]] : [];
  });

/** The Cache-Control a browser gets for this path: the first handle block that matches sets it. */
const effectiveCacheControl = (urlPath: string): string | undefined => {
  const handle = handles.find((candidate) => handleMatches(candidate, urlPath));
  return handle && cacheControlOf(handle)[0];
};

const listed = (dir: string, pattern: RegExp) =>
  readdirSync(new URL(`../public/${dir}`, import.meta.url))
    .filter((file) => pattern.test(file))
    .map((file) => `/${dir}/${file}`);

describe('Caddyfile: one Cache-Control per response', () => {
  it('sets Cache-Control only inside the handle blocks, never in a top-level header that the blocks would race', () => {
    expect(site.filter((directive) => directive.name === 'header')).toEqual([]);
  });

  it.each(handles.map((handle) => [handle.args || '(catch-all)', handle] as const))(
    'the handle block for %s sets exactly one Cache-Control and serves its file',
    (_, handle) => {
      expect(cacheControlOf(handle)).toHaveLength(1);
      expect(handle.body).toContain('file_server');
    },
  );

  it('ends with the catch-all, so every path that no rule names falls to the revalidating default', () => {
    expect(handles[handles.length - 1]?.args).toBe('');
    expect(handles.filter((handle) => handle.args === '')).toHaveLength(1);
  });

  it('keeps the immutable year for /_astro/* alone', () => {
    const immutable = handles.filter((handle) => cacheControlOf(handle).some((value) => value.includes('immutable')));
    expect(immutable.map((handle) => handle.args)).toEqual(['/_astro/*']);
    expect(cacheControlOf(immutable[0])).toEqual([YEAR]);
  });

  it('keeps error handling: error responses are no-cache and rewrite to the 404 page', () => {
    const errors = site.find((directive) => directive.name === 'handle_errors');
    expect(errors).toBeDefined();
    expect(errors?.body).toContain('header Cache-Control "no-cache"');
    expect(errors?.body).toContain('rewrite * /404.html');
  });
});

describe('Caddyfile: cache rules per path', () => {
  it.each([
    '/_astro/BoardPage.CyStzFAP.css',
    '/_astro/index.zxuS5Me9.js',
  ])('%s: content-hashed Astro bundle, cached for a year', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(YEAR);
  });

  it.each([
    ...listed('media', /\./),
    ...listed('fonts', /\.woff2$/),
  ])('%s: fixed-name media or font, cached for a day', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(DAY);
  });

  it.each([
    '/og.png',
    '/apple-touch-icon.png',
    '/favicon.svg',
  ])('%s: hand-made brand image, cached for a day', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(DAY);
  });

  it.each(listed('cv', /\.pdf$/))('%s: CV PDF, revalidated on every visit', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(REVALIDATE);
  });

  it.each([
    '/robots.txt',
    '/sitemap-index.xml',
    '/sitemap-0.xml',
    '/resume-fingerprint.json',
  ])('%s: regenerated on every deploy, revalidated on every visit', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(REVALIDATE);
  });

  it.each([
    '/',
    '/en/',
    '/cv/',
    '/en/cv/',
    '/404.html',
    '/some/page/index.html',
    '/unknown-future-file.js',
  ])('%s: HTML and anything else, revalidated on every visit', (urlPath) => {
    expect(effectiveCacheControl(urlPath)).toBe(REVALIDATE);
  });

  it('does not let /_astro/ match a page whose name only starts the same way', () => {
    expect(effectiveCacheControl('/_astrology/')).toBe(REVALIDATE);
  });

  it('does not match a sitemap name that only looks like one', () => {
    expect(effectiveCacheControl('/sitemap.html')).toBe(REVALIDATE);
  });
});
