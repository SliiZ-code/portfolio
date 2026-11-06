// Key figures for the experience case studies, per company and language. Each figure is a fact from the
// RxResume text (see src/data/resume.*.json); the company name is the match key, as in the resume.
import type { Lang } from '../lib/resume';

export interface Highlight {
  /** The figure as drawn in pixel type: "300+", "360°", "AES-256". */
  value: string;
  /** A short label under the figure, lower case. */
  label: string;
}

type ByLang = Record<Lang, Highlight[]>;

const HIGHLIGHTS: Record<string, ByLang> = {
  CAPFI: {
    fr: [
      { value: '300+', label: "appels d'offres traités" },
      { value: '3', label: 'sous-scores expliqués' },
      { value: '~10', label: 'commerciaux servis chaque jour' },
    ],
    en: [
      { value: '300+', label: 'RFPs processed' },
      { value: '3', label: 'explained sub-scores' },
      { value: '~10', label: 'sales staff served daily' },
    ],
  },
  'CESI LINEACT': {
    fr: [
      { value: '360°', label: 'vidéo immersive en VR' },
      { value: 'AES-256', label: 'accès robot chiffré' },
    ],
    en: [
      { value: '360°', label: 'immersive VR video' },
      { value: 'AES-256', label: 'encrypted robot access' },
    ],
  },
};

/** The company's figures in the given language; none for a company without a set. */
export const highlightsFor = (company: string, lang: Lang): Highlight[] => {
  const key = company.trim();
  const set = Object.prototype.hasOwnProperty.call(HIGHLIGHTS, key) ? HIGHLIGHTS[key] : undefined;
  return set ? set[lang].map((highlight) => ({ ...highlight })) : [];
};
