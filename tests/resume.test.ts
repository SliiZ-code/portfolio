import { describe, expect, it } from 'vitest';
import { resumeFromResponse, sanitizeResume } from '../scripts/sync-resume.mjs';
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
    expect(text).not.toContain('Hidden section item');
    expect(text).not.toContain('Hidden certification');
    expect(text).not.toContain('hidden custom field');
    expect(text).not.toContain('customSections');
    expect(text).not.toContain('metadata');
    expect(output.picture).toBeUndefined();
    expect(output.sections.publications).toBeUndefined();
    expect(output.sections.certifications.items).toHaveLength(0);
  });

  it('keeps hidden projects: hidden means off the PDF, not off the site', () => {
    const output = sanitizeResume(fixture) as Record<string, any>;
    expect(output.sections.projects.items.map((entry: any) => entry.name)).toEqual(['Visible', 'Hidden project']);
    expect(output.sections.projects.items.every((entry: any) => entry.hidden === false)).toBe(true);
  });

  it('still drops hidden items of every other section', () => {
    const output = sanitizeResume({
      sections: {
        experience: { title: 'XP', hidden: false, items: [{ id: 'e1', hidden: true, company: 'Secret Corp' }] },
        volunteer: { title: 'Vol', hidden: false, items: [{ id: 'v1', hidden: true, organization: 'Secret Club' }] },
      },
    }) as Record<string, any>;
    expect(JSON.stringify(output)).not.toContain('Secret');
    expect(output.sections.experience.items).toHaveLength(0);
  });

  it('drops the projects section itself when it is hidden', () => {
    const output = sanitizeResume({
      sections: { projects: { title: 'Projets', hidden: true, items: [{ id: 'p', hidden: false, name: 'Nope' }] } },
    }) as Record<string, any>;
    expect(output.sections.projects).toBeUndefined();
  });
});

describe('resumeFromResponse', () => {
  it('unwraps a { data } envelope and sanitises it', () => {
    const output = resumeFromResponse({ data: fixture }) as Record<string, any>;
    expect(output.basics.name).toBe('Julien Petit-Colboc');
    expect(JSON.stringify(output)).not.toContain('private note');
  });

  it('accepts a bare resume body', () => {
    const output = resumeFromResponse(fixture) as Record<string, any>;
    expect(output.sections.projects.items).toHaveLength(2);
  });

  it('survives an empty or non-object body', () => {
    expect(resumeFromResponse(null)).toMatchObject({ basics: { name: '' }, sections: {} });
  });
});

describe('parseResume', () => {
  it('drops hidden items/sections even if a raw resume slips through', () => {
    const parsed = parseResume(fixture, 'fr');
    expect(parsed.certifications).toHaveLength(0);
    expect(parsed.summary).toBe('<p>Bonjour</p>');
  });

  it('keeps hidden projects but not hidden items elsewhere', () => {
    const parsed = parseResume(fixture, 'fr');
    expect(parsed.projects.map((project) => project.name)).toEqual(['Visible', 'Hidden project']);
    const experience = parseResume(
      { sections: { experience: { title: '', hidden: false, items: [{ id: 'e', hidden: true, company: 'Secret Corp' }] } } },
      'fr',
    );
    expect(experience.experience).toHaveLength(0);
  });

  it('drops the projects when their section is hidden', () => {
    const parsed = parseResume(
      { sections: { projects: { title: 'Projets', hidden: true, items: [{ id: 'p', hidden: false, name: 'Nope' }] } } },
      'fr',
    );
    expect(parsed.projects).toEqual([]);
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

describe('volunteer and interests', () => {
  const raw = {
    sections: {
      volunteer: {
        title: 'Activités',
        hidden: false,
        items: [
          {
            id: 'v1',
            hidden: false,
            organization: ' BDE CESI Rouen ',
            location: 'Rouen',
            period: 'oct. 2025 – Aujourd’hui',
            website: { url: 'https://example.com', label: 'site' },
            description: '<p>Communication <script>x</script></p>',
          },
          { id: 'v2', hidden: false, organization: '  ' },
        ],
      },
      interests: {
        title: '',
        hidden: false,
        items: [{ id: 'i1', hidden: false, name: ' Course à pied ', keywords: ['trail', ' ', 'semi'] }, { id: 'i2', hidden: false, name: '' }],
      },
    },
  };

  it('parses volunteer entries and drops empty ones', () => {
    const parsed = parseResume(raw, 'fr');
    expect(parsed.volunteer).toEqual([
      {
        organization: 'BDE CESI Rouen',
        location: 'Rouen',
        period: 'oct. 2025 – Aujourd’hui',
        description: '<p>Communication </p>',
        website: { url: 'https://example.com', label: 'site' },
      },
    ]);
    expect(parsed.sectionTitles.volunteer).toBe('Activités');
  });

  it('parses interests and drops empty ones', () => {
    const parsed = parseResume(raw, 'fr');
    expect(parsed.interests).toEqual([{ name: 'Course à pied', keywords: ['trail', 'semi'] }]);
  });

  it('falls back to a title in the resume language', () => {
    expect(parseResume({}, 'fr').sectionTitles).toMatchObject({ volunteer: 'Engagements', interests: "Centres d'intérêt" });
    expect(parseResume({}, 'en').sectionTitles).toMatchObject({ volunteer: 'Volunteering', interests: 'Interests' });
  });

  it('survives the sync with the same fields', () => {
    const output = sanitizeResume(raw) as Record<string, any>;
    expect(output.sections.volunteer.items[0]).toMatchObject({ organization: ' BDE CESI Rouen ', location: 'Rouen' });
    expect(output.sections.interests.items[0]).toMatchObject({ name: ' Course à pied ', keywords: ['trail', ' ', 'semi'] });
  });

  it('keeps hidden volunteer entries off the site', () => {
    const parsed = parseResume(
      { sections: { volunteer: { title: '', hidden: false, items: [{ id: 'v', hidden: true, organization: 'Secret' }] } } },
      'en',
    );
    expect(parsed.volunteer).toEqual([]);
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
