// The phone number must never reach the site JSON, the translations cache, the AI provider, a copy in
// RxResume or a PDF. These checks compare against the main resume's `basics.phone`, whatever its
// formatting. Their messages never contain the number.
import { inflateSync, constants } from 'node:zlib';

const digits = (value) => value.replace(/\D/g, '');
const str = (value) => (typeof value === 'string' ? value : '');

const stringsOf = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
};

/** The last nine digits: "+33 …" and "0…" written with the same digits are the same number. */
export const phoneNeedle = (phone) => {
  const found = digits(str(phone));
  return found ? found.slice(-9) : '';
};

/** Does `value` hold `phone`, in any string, or split over several of them? */
export const holdsPhone = (value, phone) => {
  const text = str(phone).trim();
  const needle = phoneNeedle(text);
  if (!needle) return false;
  const strings = stringsOf(value);
  return strings.some((entry) => entry.includes(text)) || digits(strings.join('')).includes(needle);
};

export const assertNoPhone = (value, phone, label) => {
  if (holdsPhone(value, phone)) throw new Error(`${label} holds the phone number`);
};

export const assertPdf = (bytes) => {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('the response is not a PDF');
};

/**
 * Does a PDF show the phone number? Checks the file as it is and every compressed stream once
 * inflated, digits only. A PDF whose text is encoded as glyph ids cannot be read this way: the
 * copy's data is checked before it is sent, and the PDF is refused if its bytes show the number.
 */
export const pdfHoldsPhone = (bytes, phone) => {
  const needle = phoneNeedle(phone);
  if (!needle) return false;
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('latin1');
  const parts = [buffer];
  const streams = /(?<!end)stream\r?\n/g;
  let match;
  while ((match = streams.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (buffer[stop - 1] === 10 || buffer[stop - 1] === 13)) stop--;
    try {
      parts.push(inflateSync(buffer.subarray(start, stop), { finishFlush: constants.Z_SYNC_FLUSH }));
    } catch {
      // not a Flate stream, or damaged: the raw bytes were already checked
    }
    streams.lastIndex = end;
  }
  return parts.some((part) => digits(part.toString('latin1')).includes(needle));
};
