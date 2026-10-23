import type { Lang } from '../lib/resume';
import fr from './fr';
import en from './en';

export const strings = (lang: Lang) => (lang === 'fr' ? fr : en);

export const otherLang = (lang: Lang): Lang => (lang === 'fr' ? 'en' : 'fr');
