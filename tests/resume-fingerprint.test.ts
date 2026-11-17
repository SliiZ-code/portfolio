import { describe, expect, it } from 'vitest';
import { fingerprintResume, withoutPhone } from '../scripts/lib/fingerprint.mjs';

const PHONE = '+33 7 98 76 54 32';
const KEY = 'rx-key-test-0001';

const master = () => ({
  metadata: { template: 'onyx', notes: 'private note', page: { locale: 'fr-FR' } },
  picture: { hidden: false, url: '/uploads/me.png' },
  basics: {
    name: 'Julien Petit-Colboc',
    headline: 'Élève ingénieur',
    email: 'me@example.com',
    phone: PHONE,
    location: 'Rouen, France',
    website: { url: 'https://sliiz.com', label: 'Portfolio', inlineLink: false },
    customFields: [{ id: 'f1', icon: 'phone', text: PHONE, link: '' }],
  },
  summary: { title: 'Résumé', hidden: false, content: '<p>Bonjour</p>' },
  sections: {
    experience: {
      title: 'Expériences',
      hidden: false,
      items: [
        {
          id: 'e1',
          hidden: false,
          company: 'CAPFI',
          position: 'Ingénieur',
          location: 'Paris',
          period: 'janv. 2026 – Aujourd’hui',
          website: { url: '', label: '', inlineLink: false },
          description: '<p>Développement</p>',
          roles: [],
        },
        {
          id: 'e2',
          hidden: false,
          company: 'Ancienne école',
          position: 'Stagiaire',
          location: '',
          period: '2020',
          website: { url: '', label: '', inlineLink: false },
          description: '',
          roles: [],
        },
      ],
    },
    projects: {
      title: 'Projets',
      hidden: false,
      items: [{ id: 'p1', hidden: false, name: 'Blink', period: '2024', website: { url: '', label: '', inlineLink: false }, description: '<p>Pipeline</p>' }],
    },
  },
});

const changed = (edit: (raw: ReturnType<typeof master>) => void) => {
  const raw = master();
  edit(raw);
  return raw;
};

const fingerprint = (raw: unknown) => fingerprintResume(raw, KEY);

describe('fingerprintResume: the function', () => {
  it('is a 64-character HMAC-SHA256 hex digest', () => {
    expect(fingerprint(master())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('needs the RxResume key, and changes with it: a plain hash could be guessed from private text', () => {
    expect(() => fingerprintResume(master(), '')).toThrow(/key/);
    expect(fingerprintResume(master(), 'another-key')).not.toBe(fingerprint(master()));
  });

  it('is the same for the same content, whatever the order of the keys', () => {
    const reordered = Object.fromEntries(Object.entries(master()).reverse());
    expect(fingerprint(reordered)).toBe(fingerprint(master()));
  });

  it('is the same for the { data } envelope and for the data itself, and ignores the update time of the envelope', () => {
    const data = master();
    expect(fingerprint({ data })).toBe(fingerprint(data));
    expect(fingerprint({ data, updatedAt: '2026-11-01T00:00:00.000Z' })).toBe(fingerprint({ data, updatedAt: '2026-11-17T09:00:00.000Z' }));
  });

  it('does not modify the master it reads', () => {
    const data = master();
    fingerprint(data);
    expect(data).toEqual(master());
  });
});

describe('fingerprintResume: what changes it', () => {
  it('does not change when only the phone number changes (basics.phone and the custom field holding it)', () => {
    const other = changed((raw) => {
      raw.basics.phone = '+33 6 11 22 33 44';
      raw.basics.customFields[0].text = '+33 6 11 22 33 44';
    });
    expect(fingerprint(other)).toBe(fingerprint(master()));
  });

  it('changes when a visible word of the site changes', () => {
    expect(fingerprint(changed((raw) => (raw.basics.headline = 'Ingénieur logiciel')))).not.toBe(fingerprint(master()));
  });

  it('changes for a change only the CV PDF shows: the template, the picture, the layout', () => {
    expect(fingerprint(changed((raw) => (raw.metadata.template = 'azurill')))).not.toBe(fingerprint(master()));
    expect(fingerprint(changed((raw) => (raw.metadata.page.locale = 'en-US')))).not.toBe(fingerprint(master()));
    expect(fingerprint(changed((raw) => (raw.picture = { hidden: true, url: '/uploads/me.png' })))).not.toBe(fingerprint(master()));
  });

  it('changes when a section only the PDF shows is added, such as publications or a custom section', () => {
    const publications = changed((raw) => {
      (raw.sections as Record<string, unknown>).publications = { title: 'Publications', hidden: false, items: [{ id: 'pub1', hidden: false, title: 'Article' }] };
    });
    expect(fingerprint(publications)).not.toBe(fingerprint(master()));
    const custom = changed((raw) => {
      (raw as Record<string, unknown>).customSections = [{ id: 'cs1', title: 'Langues', hidden: false, items: [] }];
    });
    expect(fingerprint(custom)).not.toBe(fingerprint(master()));
  });

  it('changes when an item hidden from the site is hidden, and when a project is hidden: both leave the PDF', () => {
    expect(fingerprint(changed((raw) => (raw.sections.experience.items[1].hidden = true)))).not.toBe(fingerprint(master()));
    expect(fingerprint(changed((raw) => (raw.sections.projects.items[0].hidden = true)))).not.toBe(fingerprint(master()));
  });

  it('changes with the notes of the master: the autodeploy follows every edit that the PDF could show', () => {
    expect(fingerprint(changed((raw) => (raw.metadata.notes = 'another note')))).not.toBe(fingerprint(master()));
  });
});

describe('withoutPhone', () => {
  it('blanks basics.phone and removes the custom fields that hold the phone number, and keeps the others', () => {
    const data = withoutPhone(master());
    expect(data.basics.phone).toBe('');
    expect(data.basics.customFields).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('98 76 54');
  });
});

describe('the published fingerprint', () => {
  it('is served at /resume-fingerprint.json as { fingerprint }, the value the sync committed (null until one is synced)', async () => {
    const { GET } = await import('../src/pages/resume-fingerprint.json');
    const response = await GET({} as never);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['fingerprint']);
    expect(body.fingerprint === null || /^[0-9a-f]{64}$/.test(body.fingerprint)).toBe(true);
  });
});
