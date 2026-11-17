// The fingerprint of the master resume as the site sees it: sha256 of the sanitised, phone-free data
// (scripts/lib/sanitize.mjs), key order ignored. Metadata, the picture, the phone and the update time
// are not in it, so they never change it. The site publishes it at /resume-fingerprint.json (built from
// the committed src/data/resume.fr.json, which is a fixed point of the sanitiser), and the autodeploy
// checker compares it with the one computed from RxResume. Pure: no I/O.
import { createHash } from 'node:crypto';
import { resumeFromResponse, stable } from './sanitize.mjs';

/** The fingerprint of a raw RxResume resume (`{ data }` or the data itself). */
export const fingerprintResume = (raw) => createHash('sha256').update(stable(resumeFromResponse(raw))).digest('hex');
