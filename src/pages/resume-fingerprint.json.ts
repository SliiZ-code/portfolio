import type { APIRoute } from 'astro';
import { fingerprintResume } from '../../scripts/lib/fingerprint.mjs';
import fr from '../data/resume.fr.json';

// The fingerprint of the resume this build was made from (scripts/lib/fingerprint.mjs). The autodeploy
// checker (scripts/check-resume-change.mjs) compares it with the master's: a difference means the site is
// behind the master. Built from the committed site data, so a build without a RxResume key publishes the
// fingerprint of what it actually shows.
export const prerender = true;

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify({ fingerprint: fingerprintResume(fr) })}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
