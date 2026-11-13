import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapPdfTranslatable, mapTranslatable, needsTranslation, pdfTranslatableStrings, sha, tagsOf, translatableStrings } from '../scripts/lib/strings.mjs';
import { sanitizeResume } from '../scripts/sync-resume.mjs';

const PHONE = '+33 7 98 76 54 32';

const raw = {
  metadata: { notes: 'private note', template: 'onyx' },
  customSections: [{ id: 'x', title: 'Secret section', hidden: false, items: [{ text: 'secret text' }] }],
  basics: {
    name: 'Julien Petit-Colboc',
    headline: 'Élève ingénieur',
    email: 'me@example.com',
    phone: PHONE,
    location: 'Rouen, France',
    website: { url: 'https://sliiz.com', label: 'Portfolio', inlineLink: false },
    customFields: [{ id: 'f', icon: 'phone', text: '07 98 76 54 32', link: '' }],
  },
  summary: { title: 'Résumé', hidden: false, content: '<p>Bonjour <a href="https://x.dev">lien</a></p>' },
  sections: {
    experience: {
      title: 'Expériences',
      hidden: false,
      items: [
        {
          id: 'e1',
          hidden: false,
          company: 'CAPFI',
          position: "Ingénieur d'études en alternance",
          location: 'Paris',
          period: 'janv. 2026 – Aujourd’hui',
          website: { url: '', label: '', inlineLink: false },
          description: '<ul><li><p>Développeur principal</p></li></ul>',
          roles: [{ id: 'r', hidden: false, position: 'Sous-rôle', period: '2026', description: '<p>Détail</p>' }],
        },
      ],
    },
    projects: {
      title: 'Projets',
      hidden: false,
      items: [
        { id: 'p1', hidden: false, name: 'Blink', period: '2024', website: { url: '', label: 'GitHub', inlineLink: false }, description: '<p>Pipeline</p>' },
        { id: 'p2', hidden: true, name: 'Hidden project', period: '', website: { url: '', label: '', inlineLink: false }, description: '<p>Caché</p>' },
      ],
    },
    skills: {
      title: 'Compétences',
      hidden: false,
      items: [{ id: 's', hidden: false, name: 'IA et LLM', proficiency: '', level: 0, keywords: ['Pipelines LLM', 'Whisper'] }],
    },
    languages: {
      title: 'Langues',
      hidden: false,
      items: [{ id: 'l', hidden: false, language: 'Français', fluency: 'Langue maternelle', level: 5 }],
    },
    publications: { title: 'Publications', hidden: true, items: [{ id: 'z', hidden: false, title: 'Private publication' }] },
  },
};

const fr = sanitizeResume(raw) as Record<string, any>;

describe('translatableStrings', () => {
  const strings = translatableStrings(fr);

  it('collects the prose: headline, summary, titles, positions, descriptions, keywords, fluency', () => {
    for (const text of [
      'Élève ingénieur',
      'Résumé',
      '<p>Bonjour <a href="https://x.dev">lien</a></p>',
      'Expériences',
      "Ingénieur d'études en alternance",
      'janv. 2026 – Aujourd’hui',
      '<ul><li><p>Développeur principal</p></li></ul>',
      'Sous-rôle',
      'Pipelines LLM',
      'Whisper',
      'Langue maternelle',
      'Français',
    ]) {
      expect(strings, text).toContain(text);
    }
  });

  it('leaves out person and company names, emails, URLs, numbers and network names', () => {
    const text = strings.join('\n');
    for (const kept of ['Julien Petit-Colboc', 'CAPFI', 'me@example.com', 'https://sliiz.com', 'https://github.com', '2024']) {
      expect(text, kept).not.toContain(kept);
    }
    expect(strings).not.toContain('2024');
  });

  it('keeps the hidden project text because hidden projects are shown on the site, but drops hidden sections and custom sections', () => {
    expect(strings).toContain('<p>Caché</p>');
    const text = strings.join('\n');
    expect(text).not.toContain('Private publication');
    expect(text).not.toContain('Publications');
    expect(text).not.toContain('secret text');
    expect(text).not.toContain('Secret section');
    expect(text).not.toContain('private note');
  });

  it('never contains the phone number, even though the raw resume holds it', () => {
    expect(strings.join('\n')).not.toContain('98 76 54 32');
    expect(JSON.stringify(fr)).not.toContain('98 76 54 32');
  });

  it('returns each string once', () => {
    const doubled = { ...fr, basics: { ...fr.basics, headline: 'Résumé' } };
    const list = translatableStrings(doubled);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('needsTranslation', () => {
  it('skips blank strings and strings without any letter', () => {
    expect(needsTranslation('   ')).toBe(false);
    expect(needsTranslation('2024')).toBe(false);
    expect(needsTranslation('– · —')).toBe(false);
    expect(needsTranslation('Paris')).toBe(true);
  });
});

describe('mapTranslatable', () => {
  it('is the identity for an identity function, and never modifies its input', () => {
    const before = structuredClone(fr);
    const same = mapTranslatable(fr, (text: string) => text);
    expect(same).toEqual(fr);
    expect(fr).toEqual(before);
  });

  it('applies the function to the translatable strings only', () => {
    const out = mapTranslatable(fr, (text: string) => `[${text}]`) as Record<string, any>;
    expect(out.basics.headline).toBe('[Élève ingénieur]');
    expect(out.basics.name).toBe('Julien Petit-Colboc');
    expect(out.summary.title).toBe('[Résumé]');
    const job = out.sections.experience.items[0];
    expect(job.company).toBe('CAPFI');
    expect(job.position).toBe("[Ingénieur d'études en alternance]");
    expect(job.location).toBe('[Paris]');
    expect(job.roles[0].position).toBe('[Sous-rôle]');
    expect(out.sections.projects.items[0].name).toBe('[Blink]');
    expect(out.sections.projects.items[0].period).toBe('2024');
    expect(out.sections.skills.items[0].keywords).toEqual(['[Pipelines LLM]', '[Whisper]']);
    expect(out.sections.languages.items[0].language).toBe('[Français]');
    expect(out.sections.languages.items[0].level).toBe(5);
  });

  it('maps the raw resume too, without touching metadata, custom sections or the phone fields', () => {
    const out = mapTranslatable(raw, (text: string) => `[${text}]`) as Record<string, any>;
    expect(out.sections.experience.items[0].roles[0].description).toBe('[<p>Détail</p>]');
    expect(out.summary.content).toBe('[<p>Bonjour <a href="https://x.dev">lien</a></p>]');
    expect(out.metadata).toEqual(raw.metadata);
    expect(out.customSections).toEqual(raw.customSections);
    expect(out.basics.phone).toBe(PHONE);
    expect(out.basics.customFields).toEqual(raw.basics.customFields);
    expect(out.basics.email).toBe('me@example.com');
  });
});

describe('sha and tagsOf', () => {
  it('hashes with sha256 hex', () => {
    expect(sha('Résumé')).toBe(createHash('sha256').update('Résumé', 'utf8').digest('hex'));
    expect(sha('a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists the tags in order, attributes included, and nothing for plain text', () => {
    expect(tagsOf('<p>a <a href="https://x.dev">b</a></p>')).toEqual(['<p>', '<a href="https://x.dev">', '</a>', '</p>']);
    expect(tagsOf('plain text')).toEqual([]);
    expect(tagsOf('')).toEqual([]);
  });
});

describe('the PDF-only prose', () => {
  const pdfRaw = {
    basics: {
      name: 'Julien',
      phone: PHONE,
      customFields: [
        { id: 'f1', icon: 'phone', text: PHONE, link: '' },
        { id: 'f2', icon: 'award', text: 'Permis de conduire', link: '' },
      ],
    },
    customSections: [
      {
        id: 'c1',
        title: 'Engagements',
        hidden: false,
        items: [
          { id: 'i1', hidden: false, title: 'Bénévolat associatif', description: '<p>Aide aux devoirs</p>' },
          { id: 'i2', hidden: true, title: 'Caché', description: '<p>Secret</p>' },
        ],
      },
      { id: 'c2', title: 'Section cachée', hidden: true, items: [{ id: 'i3', hidden: false, title: 'Invisible' }] },
    ],
    sections: {
      publications: {
        title: 'Publications',
        hidden: false,
        items: [{ id: 'p1', hidden: false, title: 'Un article', publisher: 'Revue Machin', date: '2025', description: '<p>Résumé</p>' }],
      },
      references: {
        title: 'Références',
        hidden: false,
        items: [{ id: 'r1', hidden: false, name: 'Marie Dupont', position: 'Responsable de stage', description: '<p>Recommande</p>' }],
      },
    },
  };

  it('translates the custom fields text, custom sections, publications and references, except the phone and the hidden items', () => {
    const out = mapPdfTranslatable(pdfRaw, (text: string) => `[${text}]`, PHONE) as Record<string, any>;
    expect(out.basics.customFields[0].text).toBe(PHONE);
    expect(out.basics.customFields[1].text).toBe('[Permis de conduire]');
    expect(out.customSections[0].title).toBe('[Engagements]');
    expect(out.customSections[0].items[0].title).toBe('[Bénévolat associatif]');
    expect(out.customSections[0].items[0].description).toBe('[<p>Aide aux devoirs</p>]');
    expect(out.customSections[0].items[1].title).toBe('Caché');
    expect(out.customSections[1].title).toBe('Section cachée');
    expect(out.sections.publications.items[0]).toMatchObject({ title: '[Un article]', publisher: 'Revue Machin', date: '2025' });
    expect(out.sections.publications.items[0].description).toBe('[<p>Résumé</p>]');
    expect(out.sections.references.items[0].position).toBe('[Responsable de stage]');
    expect(out.sections.references.items[0].name).toBe('Marie Dupont');
  });

  it('lists those strings for the translator, and never the phone or a hidden item', () => {
    const list = pdfTranslatableStrings(pdfRaw, PHONE);
    expect(list).toEqual(expect.arrayContaining(['Permis de conduire', 'Bénévolat associatif', 'Un article', 'Responsable de stage']));
    expect(list.join('\n')).not.toContain(PHONE);
    expect(list).not.toContain('Invisible');
    expect(list).not.toContain('Marie Dupont');
  });

  it('keeps the site strings unchanged: publications and custom sections are not in the site list', () => {
    const site = translatableStrings(sanitizeResume(pdfRaw)) as string[];
    expect(site).not.toContain('Un article');
    expect(site).not.toContain('Permis de conduire');
  });
});
