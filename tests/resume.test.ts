import { describe, expect, it } from 'vitest';
import { sanitizeResume } from '../scripts/sync-resume.mjs';
import { getResume, htmlToText, parseResume, sanitizeHtml, slugify } from '../src/lib/resume';

const fixture = {
  metadata: { notes: '<p>private note, do not ship</p>', template: 'onyx' },
  picture: { hidden: true, url: '/uploads/private.png' },
  customSections: [{ id: 'custom', title: 'Secret', hidden: false, items: [{ text: 'secret' }] }],
  basics: {
    name: 'Julien Petit-Colboc',
    headline: 'Étudiant',
    email: '',
    location: 'Rouen',
    website: { url: '', label: '' },
    customFields: [
      { id: 'field-1', hidden: true, text: 'hidden custom field', link: '' },
      { id: 'field-2', hidden: false, text: 'visible custom field', link: '' },
    ],
  },
  summary: { title: 'Profil', hidden: false, content: '<p>Bonjour</p>' },
  sections: {
    projects: {
      title: 'Projets',
      hidden: false,
      items: [
        { id: 'p1', hidden: false, name: 'Visible', period: '', website: { url: '', label: '' }, description: '<p>ok</p>' },
        { id: 'p2', hidden: true, name: 'Hidden project', period: '', website: { url: '', label: '' }, description: '' },
      ],
    },
    publications: { title: 'Publications', hidden: true, items: [{ hidden: false, title: 'Hidden section item' }] },
    certifications: {
      title: 'Certifications',
      hidden: false,
      items: [{ id: 'c1', hidden: true, title: 'Hidden certification' }],
    },
  },
};

describe('sanitizeResume', () => {
  it('never lets metadata, the picture, custom sections or hidden content reach the output', () => {
    const output = sanitizeResume(fixture) as Record<string, any>;
    const text = JSON.stringify(output);

    expect(text).not.toContain('private note');
    expect(text).not.toContain('private.png');
    expect(text).not.toContain('Hidden project');
    expect(text).not.toContain('Hidden section item');
    expect(text).not.toContain('Hidden certification');
    expect(text).not.toContain('hidden custom field');
    expect(text).not.toContain('customSections');
    expect(text).not.toContain('metadata');
    expect(output.picture).toBeUndefined();
    expect(output.sections.publications).toBeUndefined();
    expect(output.sections.projects.items).toHaveLength(1);
    expect(output.sections.projects.items[0].name).toBe('Visible');
    expect(output.sections.certifications.items).toHaveLength(0);
  });
});

describe('parseResume', () => {
  it('drops hidden items/sections even if a raw resume slips through', () => {
    const parsed = parseResume(fixture, 'fr');
    expect(parsed.projects.map((project) => project.name)).toEqual(['Visible']);
    expect(parsed.certifications).toHaveLength(0);
    expect(parsed.summary).toBe('<p>Bonjour</p>');
  });

  it('loads the committed FR/EN samples and slugifies project names', () => {
    const fr = getResume('fr');
    const en = getResume('en');
    expect(fr.projects.map((project) => project.slug)).toEqual([
      'jeu-de-la-vie',
      'blink',
      'thrive',
      'worldwide-weather-watcher',
    ]);
    expect(en.projects.map((project) => project.slug)).toEqual(fr.projects.map((project) => project.slug));
    expect(fr.name).toBe('Julien Petit-Colboc');
    expect(fr.email).toBe('');
  });
});

describe('slugify', () => {
  it('handles accents, spaces and apostrophes', () => {
    expect(slugify('Jeu de la vie')).toBe('jeu-de-la-vie');
    expect(slugify('Été — déjà vu')).toBe('ete-deja-vu');
    expect(slugify("L'atelier d'Olivier")).toBe('latelier-dolivier');
    expect(slugify('  Œuvre  ')).toBe('oeuvre');
  });
});

describe('sanitizeHtml', () => {
  it('keeps only the allow-listed tags and a safe href', () => {
    const dirty =
      '<p onclick="x()">Hi <script>alert(1)</script><strong>you</strong> ' +
      '<a href="javascript:alert(1)" class="x">bad</a>' +
      '<a href="https://example.com" onmouseover="x">good</a>' +
      '<img src=x onerror=alert(1)><br></p>';
    expect(sanitizeHtml(dirty)).toBe(
      '<p>Hi <strong>you</strong> bad<a href="https://example.com">good</a><br></p>',
    );
    expect(sanitizeHtml('<ul><li>one</li></ul>')).toBe('<ul><li>one</li></ul>');
    expect(sanitizeHtml('<p>a &amp; b</p>')).toBe('<p>a &amp; b</p>');
    expect(sanitizeHtml('<iframe src="https://evil"></iframe><em>ok</em>')).toBe('<em>ok</em>');
  });

  it('drops a rejected link but keeps its text, including nested formatting', () => {
    expect(sanitizeHtml('<p><a href="javascript:alert(1)">click <em>me</em></a> now</p>')).toBe('<p>click <em>me</em> now</p>');
    expect(sanitizeHtml('<a>no href</a>')).toBe('no href');
    expect(sanitizeHtml('x</a>y')).toBe('xy');
  });

  it('does not decode entities before parsing', () => {
    expect(sanitizeHtml('<p>&lt;div&gt; and &lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<p>&lt;div&gt; and &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(sanitizeHtml('<p>R&D & co</p>')).toBe('<p>R&amp;D &amp; co</p>');
    expect(htmlToText('<p>&lt;div&gt;</p>')).toBe('<div>');
  });

  it('turns sanitised HTML into plain text for metadata', () => {
    expect(htmlToText('<p>Hello <strong>world</strong> &amp; co</p>')).toBe('Hello world & co');
  });
});
