import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Lang } from './resume';

/** Must match the file name the sync script writes (scripts/sync-resume.mjs). */
export const cvPdfFile = (lang: Lang): string => `julien-petit-colboc-${lang}.pdf`;

const CV_DIR = join(process.cwd(), 'public', 'cv');

/** Build-time check (Astro runs from the project root): is there a file in public/cv? */
const inCvDir = (file: string): boolean => existsSync(join(CV_DIR, file));

/** Public path of the CV PDF for `lang`, or an empty string while the sync has not produced it. */
export const cvPdfPath = (lang: Lang, exists: (file: string) => boolean = inCvDir): string =>
  exists(cvPdfFile(lang)) ? `/cv/${cvPdfFile(lang)}` : '';
