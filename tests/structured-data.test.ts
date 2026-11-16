import { describe, expect, it } from 'vitest';
import { getResume } from '../src/lib/resume';
import {
  buildStructuredData,
  serializeJsonLd,
  type StructuredDataGraph,
} from '../src/lib/structured-data';

const findEntity = <T = any>(graph: StructuredDataGraph, type: string): T => {
  const item = graph['@graph'].find((entry) => entry['@type'] === type);
  if (!item) throw new Error(`Entity of type ${type} not found in @graph`);
  return item as T;
};

describe('structured data (JSON-LD)', () => {
  const resumeFr = getResume('fr');
  const resumeEn = getResume('en');
  const baseUrl = 'https://sliiz.com';

  it('builds a JSON-LD object with an @graph containing Person, WebSite, and ProfilePage', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);
    expect(data['@context']).toBe('https://schema.org');
    expect(Array.isArray(data['@graph'])).toBe(true);

    const types = data['@graph'].map((entry) => entry['@type']);
    expect(types).toContain('Person');
    expect(types).toContain('WebSite');
    expect(types).toContain('ProfilePage');
  });

  it('Person has the exact name, alternateName variants, and given/family names', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);
    const person = findEntity(data, 'Person');

    expect(person['@id']).toBe('https://sliiz.com/#person');
    expect(person.name).toBe('Julien Petit--Colboc');
    expect(person.alternateName).toEqual(['Julien Petit-Colboc', 'Julien Petit Colboc']);
    expect(person.givenName).toBe('Julien');
    expect(person.familyName).toBe('Petit--Colboc');
    expect(person.url).toBe('https://sliiz.com/');
  });

  it('Person jobTitle reflects the resume headline per language', () => {
    const frData = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);
    const enData = buildStructuredData(resumeEn, 'en', `${baseUrl}/en/`);

    const personFr = findEntity(frData, 'Person');
    const personEn = findEntity(enData, 'Person');

    expect(personFr.jobTitle).toBe(resumeFr.headline);
    expect(personEn.jobTitle).toBe(resumeEn.headline);
  });

  it('sameAs contains the GitHub and LinkedIn URLs from the resume', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);
    const person = findEntity(data, 'Person');

    expect(person.sameAs).toContain('https://github.com/SliiZ-code');
    expect(person.sameAs).toContain('https://www.linkedin.com/in/julien-petit-colboc/');
  });

  it('image defaults to og.png when no photo is present in public/', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`, {
      exists: () => false,
    });
    const person = findEntity(data, 'Person');
    expect(person.image).toBe('https://sliiz.com/og.png');
  });

  it('image uses existing photo in public/ when present', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`, {
      exists: (file: string) => file === 'portrait.jpg',
    });
    const person = findEntity(data, 'Person');
    expect(person.image).toBe('https://sliiz.com/portrait.jpg');
  });

  it('WebSite has the required properties and references the Person as publisher/author', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);
    const website = findEntity(data, 'WebSite');

    expect(website['@id']).toBe('https://sliiz.com/#website');
    expect(website.url).toBe('https://sliiz.com/');
    expect(website.name).toBe('Julien Petit--Colboc');
    expect(website.inLanguage).toEqual(['fr', 'en']);
    expect(website.publisher).toEqual({ '@id': 'https://sliiz.com/#person' });
    expect(website.author).toEqual({ '@id': 'https://sliiz.com/#person' });
  });

  it('ProfilePage url and inLanguage match the arguments', () => {
    const dataFr = buildStructuredData(resumeFr, 'fr', `${baseUrl}/cv/`);
    const profileFr = findEntity(dataFr, 'ProfilePage');

    expect(profileFr.url).toBe('https://sliiz.com/cv/');
    expect(profileFr.inLanguage).toBe('fr');
    expect(profileFr.mainEntity).toEqual({ '@id': 'https://sliiz.com/#person' });
    expect(profileFr.isPartOf).toEqual({ '@id': 'https://sliiz.com/#website' });

    const dataEn = buildStructuredData(resumeEn, 'en', `${baseUrl}/en/`);
    const profileEn = findEntity(dataEn, 'ProfilePage');

    expect(profileEn.url).toBe('https://sliiz.com/en/');
    expect(profileEn.inLanguage).toBe('en');
  });

  it('contains no email, telephone, or address keys anywhere in the output', () => {
    const data = buildStructuredData(resumeFr, 'fr', `${baseUrl}/`);

    const collectKeys = (obj: unknown, keys: string[] = []): string[] => {
      if (!obj || typeof obj !== 'object') return keys;
      if (Array.isArray(obj)) {
        for (const item of obj) collectKeys(item, keys);
        return keys;
      }
      for (const [key, value] of Object.entries(obj)) {
        keys.push(key);
        collectKeys(value, keys);
      }
      return keys;
    };

    const forbidden = ['email', 'telephone', 'phone', 'address'];
    const allKeys = collectKeys(data).map((k) => k.toLowerCase());

    for (const term of forbidden) {
      expect(allKeys).not.toContain(term);
    }

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(resumeFr.email);
  });

  it('serializer escapes < so JSON cannot break out of script tags', () => {
    const payload = {
      note: '</script><script>alert("xss")</script>',
      nested: {
        tag: '<div class="test">content</div>',
      },
    };

    const serialized = serializeJsonLd(payload);
    expect(serialized).not.toContain('<');
    expect(serialized).toContain('\\u003c/script');
    expect(serialized).toContain('\\u003cscript');

    // JSON.parse correctly unescapes it
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(payload);
  });
});
