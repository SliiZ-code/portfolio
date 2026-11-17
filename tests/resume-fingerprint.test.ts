import { describe, expect, it } from 'vitest';
import { fingerprintResume } from '../scripts/lib/fingerprint.mjs';
import { sanitizeResume } from '../scripts/lib/sanitize.mjs';
import fr from '../src/data/resume.fr.json';

const PHONE = '+33 7 98 76 54 32';

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

const withChange = (edit: (raw: ReturnType<typeof master>) => void) => {
  const raw = master();
  edit(raw);
  return raw;
};

describe('fingerprintResume', () => {
  it('is a 64-character sha256 hex digest', () => {
    expect(fingerprintResume(master())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same for the same content, whatever the order of the keys', () => {
    const reordered = Object.fromEntries(Object.entries(master()).reverse());
    expect(fingerprintResume(reordered)).toBe(fingerprintResume(master()));
  });

  it('does not change when only the phone number changes', () => {
    const other = withChange((raw) => {
      raw.basics.phone = '+33 6 11 22 33 44';
      raw.basics.customFields[0].text = '+33 6 11 22 33 44';
    });
    expect(fingerprintResume(other)).toBe(fingerprintResume(master()));
  });

  it('does not change for non-content metadata: the update time, the notes, the template, the picture', () => {
    const other = withChange((raw) => {
      raw.metadata.notes = 'another note';
      raw.metadata.template = 'azurill';
      raw.picture = { hidden: true, url: '/uploads/other.png' };
    });
    expect(fingerprintResume(other)).toBe(fingerprintResume(master()));
  });

  it('changes when a visible word of the site changes', () => {
    const other = withChange((raw) => {
      raw.basics.headline = 'Ingénieur logiciel';
    });
    expect(fingerprintResume(other)).not.toBe(fingerprintResume(master()));
  });

  it('changes when an item hidden from the site is hidden (it leaves the site)', () => {
    const other = withChange((raw) => {
      raw.sections.experience.items[1].hidden = true;
    });
    expect(fingerprintResume(other)).not.toBe(fingerprintResume(master()));
  });

  it('does not change when a project is hidden, because the site still shows it', () => {
    const other = withChange((raw) => {
      raw.sections.projects.items[0].hidden = true;
    });
    expect(fingerprintResume(other)).toBe(fingerprintResume(master()));
  });

  it('is what the committed site data gives: the sanitised data is a fixed point', () => {
    expect(fingerprintResume(fr)).toBe(fingerprintResume(sanitizeResume(fr)));
    expect(fingerprintResume(fr)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the published fingerprint', () => {
  it('is served at /resume-fingerprint.json as { fingerprint } from the committed site data', async () => {
    const { GET } = await import('../src/pages/resume-fingerprint.json');
    const response = await GET({} as never);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ fingerprint: fingerprintResume(fr) });
  });
});
