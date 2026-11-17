import type { APIRoute } from 'astro';
import published from '../data/resume.fingerprint.json';

// The fingerprint of the master that the last complete sync applied (scripts/lib/fingerprint.mjs), or null
// when none is committed. `npm run sync:resume` writes it during the build; a build without the RxResume key
// serves the committed value. The autodeploy checker (scripts/check-resume-change.mjs) compares it with the
// master's: a difference, or null, means the site is behind the master.
export const prerender = true;

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify({ fingerprint: published.fingerprint })}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
