import { describe, expect, it } from 'vitest';
import {
  indexLabel,
  isHiddenProject,
  joinMeta,
  langOfPath,
  leadSentences,
  linkLabel,
  markPhrases,
  splitProjects,
} from '../src/components/home/content';
import { highlightsFor } from '../src/data/highlights';
import { getResume, htmlToText } from '../src/lib/resume';
import { strings } from '../src/i18n';

describe('leadSentences', () => {
  it('keeps the first two sentences by default', () => {
    expect(leadSentences('Un. Deux! Trois? Quatre.')).toBe('Un. Deux!');
  });

  it('keeps a trailing sentence without a full stop', () => {
    expect(leadSentences('Une phrase seule', 2)).toBe('Une phrase seule');
  });

  it('returns nothing for empty text', () => {
    expect(leadSentences('')).toBe('');
    expect(leadSentences('   ')).toBe('');
  });

  it('honours a custom count', () => {
    expect(leadSentences('A. B. C.', 1)).toBe('A.');
  });
});

describe('splitProjects', () => {
  it('puts the hidden ones after the featured ones and keeps every project', () => {
    const projects = [
      { name: 'a', hidden: true },
      { name: 'b', hidden: false },
      { name: 'c' },
    ];
    const { featured, more } = splitProjects(projects);
    expect(featured.map((p) => p.name)).toEqual(['b', 'c']);
    expect(more.map((p) => p.name)).toEqual(['a']);
  });

  it('treats a project without the flag as featured', () => {
    expect(isHiddenProject({ name: 'x' })).toBe(false);
    expect(isHiddenProject({ hidden: 'yes' })).toBe(false);
    expect(isHiddenProject({ hidden: true })).toBe(true);
  });
});

describe('linkLabel', () => {
  it('names GitHub and LinkedIn', () => {
    expect(linkLabel({ url: 'https://github.com/SliiZ-code/blink', label: '' })).toBe('GitHub');
    expect(linkLabel({ url: 'https://www.linkedin.com/in/x/', label: 'Profil' })).toBe('LinkedIn');
  });

  it('uses the source label, then the host', () => {
    expect(linkLabel({ url: 'https://sliiz.com', label: 'Portfolio – sliiz.com' })).toBe('Portfolio – sliiz.com');
    expect(linkLabel({ url: 'https://example.org/page', label: ' ' })).toBe('example.org');
  });

  it('falls back to the label when the URL is not absolute', () => {
    expect(linkLabel({ url: '/local', label: 'Ici' })).toBe('Ici');
    expect(linkLabel({ url: '', label: '' })).toBe('');
  });
});

describe('joinMeta', () => {
  it('skips the empty parts', () => {
    expect(joinMeta('janv. 2026', '', undefined, 'Paris', false)).toBe('janv. 2026 · Paris');
    expect(joinMeta(false, null)).toBe('');
  });
});

describe('leadSentences keeps version numbers whole', () => {
  it('does not split "GPT-3.5"', () => {
    expect(leadSentences('Uses GPT-3.5 to write. Then more. And more.', 2)).toBe('Uses GPT-3.5 to write. Then more.');
  });
});

describe('markPhrases', () => {
  const text = 'Main developer of Cerebro, an LLM tool. Cerebro scores LLM output.';

  it('marks every exact occurrence and keeps the rest as plain runs', () => {
    expect(markPhrases(text, ['Cerebro', 'LLM'])).toEqual([
      { text: 'Main developer of ', marked: false },
      { text: 'Cerebro', marked: true },
      { text: ', an ', marked: false },
      { text: 'LLM', marked: true },
      { text: ' tool. ', marked: false },
      { text: 'Cerebro', marked: true },
      { text: ' scores ', marked: false },
      { text: 'LLM', marked: true },
      { text: ' output.', marked: false },
    ]);
  });

  it('rejoins to the original text', () => {
    const segments = markPhrases(text, ['Cerebro', 'LLM', 'tool']);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('is case-sensitive and literal, never a regular expression', () => {
    expect(markPhrases('cerebro (C++) a.*', ['Cerebro', 'C++', 'a.*'])).toEqual([
      { text: 'cerebro (', marked: false },
      { text: 'C++', marked: true },
      { text: ') ', marked: false },
      { text: 'a.*', marked: true },
    ]);
  });

  it('keeps the first of overlapping phrases and drops the other', () => {
    expect(markPhrases('réalité virtuelle', ['réalité', 'réalité virtuelle', 'virtuelle'])).toEqual([
      { text: 'réalité virtuelle', marked: true },
    ]);
  });

  it('marks an apostrophe phrase as written in the summary', () => {
    expect(markPhrases("un stage à l'étranger", ["à l'étranger"])).toEqual([
      { text: 'un stage ', marked: false },
      { text: "à l'étranger", marked: true },
    ]);
  });

  it('ignores phrases that are absent or empty, and returns nothing for empty text', () => {
    expect(markPhrases('abc', ['zzz', ''])).toEqual([{ text: 'abc', marked: false }]);
    expect(markPhrases('', ['abc'])).toEqual([]);
  });

  it('keeps markup-looking text as text', () => {
    expect(markPhrases('<b>x</b> & y', ['<b>x</b>'])).toEqual([
      { text: '<b>x</b>', marked: true },
      { text: ' & y', marked: false },
    ]);
  });
});

describe('the bio highlights match the summaries', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`finds every ${lang} phrase in the ${lang} summary`, () => {
      const bio = htmlToText(getResume(lang).summary);
      const missing = strings(lang).home.introMarks.filter((phrase) => !bio.includes(phrase));
      expect(missing).toEqual([]);
    });
  }
});

describe('indexLabel', () => {
  it('pads to two digits', () => {
    expect(indexLabel(1)).toBe('01');
    expect(indexLabel(4)).toBe('04');
    expect(indexLabel(12)).toBe('12');
  });
});

describe('langOfPath', () => {
  it('reads the language from the path', () => {
    expect(langOfPath('/en/')).toBe('en');
    expect(langOfPath('/en')).toBe('en');
    expect(langOfPath('/en/projects/blink/')).toBe('en');
    expect(langOfPath('/')).toBe('fr');
    expect(langOfPath('/enfin/')).toBe('fr');
  });
});

describe('highlightsFor', () => {
  it('returns the figures of a company in the language asked for', () => {
    expect(highlightsFor('CESI LINEACT', 'en')).toEqual([
      { value: '360°', label: 'immersive VR video' },
      { value: 'AES-256', label: 'encrypted robot access' },
    ]);
    expect(highlightsFor('CESI LINEACT', 'fr')[1]).toEqual({ value: 'AES-256', label: 'accès robot chiffré' });
  });

  it('matches the company name, ignoring surrounding spaces', () => {
    expect(highlightsFor('  CAPFI ', 'fr')).toHaveLength(3);
  });

  it('gives nothing for a company without a set, and for names that are not keys', () => {
    expect(highlightsFor('Acme', 'fr')).toEqual([]);
    expect(highlightsFor('constructor', 'en')).toEqual([]);
  });

  it('gives FR and EN the same number of figures for every company', () => {
    for (const company of ['CAPFI', 'CESI LINEACT']) {
      expect(highlightsFor(company, 'fr')).toHaveLength(highlightsFor(company, 'en').length);
    }
  });

  it('returns copies, so a caller cannot change the data', () => {
    highlightsFor('CAPFI', 'en')[0].value = 'changed';
    expect(highlightsFor('CAPFI', 'en')[0].value).toBe('300+');
  });
});
