// The fingerprint of the master resume: HMAC-SHA256 over the master's data as the sync reads it, with the
// phone number left out (`basics.phone` and the custom fields that hold it). It covers everything the site
// and the CV PDFs are made from, metadata and layout included, so a change visible only in the PDF changes it.
// The data holds no timestamps (RxResume keeps `updatedAt` outside it, and ids are generated once, when an
// item is created), so nothing volatile is hashed.
// The key is the RxResume API key, which the build and the checker both have: the published value cannot be
// guessed from low-entropy private text (notes, hidden items) the way a plain hash could.
// The sync writes this value to src/data/resume.fingerprint.json, the site serves it, and the autodeploy
// checker (scripts/check-resume-change.mjs) computes it from the live master. Pure: no I/O.
import { createHmac } from 'node:crypto';
import { holdsPhone } from './guard.mjs';
import { dataOf, stable } from './sanitize.mjs';

/** The master's data with the phone number removed: the same data the CV PDF copies are made from. Pure. */
export const withoutPhone = (mainData) => {
  const data = structuredClone(mainData && typeof mainData === 'object' ? mainData : {});
  const basics = data.basics;
  if (basics && typeof basics === 'object') {
    const phone = typeof basics.phone === 'string' ? basics.phone.trim() : '';
    basics.phone = '';
    if (Array.isArray(basics.customFields)) basics.customFields = basics.customFields.filter((field) => !holdsPhone(field, phone));
  }
  return data;
};

/** The fingerprint of a raw RxResume resume (`{ data }` or the data itself), with the RxResume API key. */
export const fingerprintResume = (raw, key) => {
  if (typeof key !== 'string' || !key) throw new Error('the fingerprint needs the RxResume API key');
  return createHmac('sha256', key).update(stable(withoutPhone(dataOf(raw)))).digest('hex');
};
