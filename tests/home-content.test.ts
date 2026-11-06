import { describe, expect, it } from 'vitest';
import { isHiddenProject, joinMeta, leadSentences, linkLabel, splitProjects } from '../src/components/home/content';

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
