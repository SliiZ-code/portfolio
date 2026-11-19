import { describe, expect, it } from 'vitest';
import { strings } from '../src/i18n';
import { parseResume } from '../src/lib/resume';
import { resumeDescription, resumeTitle } from '../src/lib/meta';

const FALLBACK_TITLE = 'Site title';

/** A resume whose home meta can be tested: name, headline and summary only. */
const resume = ({ name = 'Julien Petit--Colboc', headline = 'Élève ingénieur en IA, VR et robotique', summary = '<p>Bonjour</p>' } = {}) =>
  parseResume(
    {
      basics: { name, headline, email: 'me@example.com', location: 'Rouen', website: { url: '', label: '' } },
      summary: { title: 'Profil', hidden: false, content: summary },
    },
    'fr',
  );

describe('the home title comes from the resume headline', () => {
  it('joins the name and the headline', () => {
    expect(resumeTitle(resume({ name: 'Julien', headline: 'Élève ingénieur' }), FALLBACK_TITLE)).toBe('Julien — Élève ingénieur');
  });

  it('falls back to the site title when the resume lacks a name or a headline', () => {
    expect(resumeTitle(resume({ headline: '' }), FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resumeTitle(resume({ name: '' }), FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resumeTitle(resume({ name: '', headline: '' }), FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
  });
});

describe('the home description comes from the resume summary', () => {
  const FALLBACK = strings('fr').board.description;

  it('takes the first sentence, without the HTML', () => {
    const phrase = resumeDescription(resume({ summary: '<p>Bonjour. <strong>Deuxième</strong> phrase.</p>' }), FALLBACK);
    expect(phrase).toBe('Bonjour.');
  });

  it('cuts a long sentence at the last space and ends it with an ellipsis', () => {
    const text = `${'mot '.repeat(60).trim()}.`;
    const description = resumeDescription(resume({ summary: `<p>${text}</p>` }), FALLBACK);

    expect(description.endsWith('…')).toBe(true);
    const cut = description.slice(0, -1);
    expect(text.startsWith(cut)).toBe(true);
    expect(text[cut.length]).toBe(' ');
    expect(description.length).toBeLessThanOrEqual(161);
  });

  it('honours the max it is given', () => {
    const description = resumeDescription(resume({ summary: '<p>Un résumé assez long pour être coupé proprement.</p>' }), FALLBACK, 20);
    expect(description.endsWith('…')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(21);
    expect(description).toBe('Un résumé assez…');
  });

  it('falls back to the headline, then to the site description', () => {
    expect(resumeDescription(resume({ summary: '', headline: 'Élève ingénieur' }), FALLBACK)).toBe('Élève ingénieur');
    expect(resumeDescription(resume({ summary: '', headline: '' }), FALLBACK)).toBe(FALLBACK);
  });
});

describe('the i18n board strings stay as fallbacks', () => {
  it('provides a short description between 120 and 160 chars in French and English', () => {
    const frDesc = strings('fr').board.description;
    const enDesc = strings('en').board.description;

    expect(typeof frDesc).toBe('string');
    expect(typeof enDesc).toBe('string');

    expect(frDesc.length).toBeGreaterThanOrEqual(120);
    expect(frDesc.length).toBeLessThanOrEqual(160);

    expect(enDesc.length).toBeGreaterThanOrEqual(120);
    expect(enDesc.length).toBeLessThanOrEqual(160);
  });
});
