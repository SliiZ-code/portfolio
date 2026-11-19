import { describe, expect, it } from 'vitest';
import { site } from '../src/data/site';
import { getResume, parseResume, type Resume } from '../src/lib/resume';
import {
  buildStructuredData,
  serializeJsonLd,
  type StructuredDataGraph,
} from '../src/lib/structured-data';

const root = `${site.url}/`;
const fr = getResume('fr');
const en = getResume('en');

const findEntity = (graph: StructuredDataGraph, type: string): Record<string, any> => {
  const item = graph['@graph'].find((entry) => entry['@type'] === type);
  if (!item) throw new Error(`Entity of type ${type} not found in @graph`);
  return item;
};

/** A resume with a private email and location, so tests can prove neither reaches the output. */
const resumeWith = (name = 'Ada Byron--Lovelace', sections: Record<string, unknown> = {}): Resume =>
  parseResume(
    {
      basics: {
        name,
        headline: 'Engineer',
        email: 'ada@example.com',
        location: 'London',
        website: { url: '', label: '' },
      },
      sections,
    },
    'fr'
  );

describe('buildStructuredData', () => {
  it('graph holds exactly a Person, a WebSite and the ProfilePage of the page', () => {
    const data = buildStructuredData(fr, root);

    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph'].map((entry) => entry['@type'])).toEqual(['Person', 'WebSite', 'ProfilePage']);
  });

  it('Person carries the resume name, the root url and the og image', () => {
    const person = findEntity(buildStructuredData(fr, root), 'Person');

    expect(person['@id']).toBe(`${root}#person`);
    expect(person.name).toBe(fr.name);
    expect(person.url).toBe(root);
    expect(person.image).toBe(`${root}og.png`);
  });

  it('Person splits the name into given and family name', () => {
    const person = findEntity(buildStructuredData(fr, root), 'Person');

    expect(person.givenName).toBe('Julien');
    expect(person.familyName).toBe('Petit--Colboc');
  });

  it('alternateName spells a "--" name with a single hyphen and with a space', () => {
    const person = findEntity(buildStructuredData(resumeWith(), root), 'Person');

    expect(person.alternateName).toEqual(['Ada Byron-Lovelace', 'Ada Byron Lovelace']);
  });

  it('has no alternateName when the name has no "--"', () => {
    const resume = resumeWith('Ada Lovelace');
    const person = findEntity(buildStructuredData(resume, root), 'Person');

    expect(person).not.toHaveProperty('alternateName');
  });

  it('jobTitle and inLanguage follow the resume language', () => {
    const dataFr = buildStructuredData(fr, root);
    const dataEn = buildStructuredData(en, `${site.url}/en/`);

    expect(findEntity(dataFr, 'Person').jobTitle).toBe(fr.headline);
    expect(findEntity(dataEn, 'Person').jobTitle).toBe(en.headline);
    expect(findEntity(dataFr, 'ProfilePage').inLanguage).toBe('fr');
    expect(findEntity(dataEn, 'ProfilePage').inLanguage).toBe('en');
  });

  it('sameAs is the public profile links of the resume', () => {
    const resume = resumeWith('Ada Byron--Lovelace', {
      profiles: {
        title: 'Profiles',
        hidden: false,
        items: [
          { id: 'a', hidden: false, network: 'GitHub', username: 'ada', website: { url: 'https://github.com/ada' } },
          { id: 'b', hidden: false, network: 'LinkedIn', username: 'ada', website: { url: 'https://www.linkedin.com/in/ada' } },
        ],
      },
    });
    const person = findEntity(buildStructuredData(resume, root), 'Person');

    expect(person.sameAs).toEqual(['https://github.com/ada', 'https://www.linkedin.com/in/ada']);
  });

  it('sameAs keeps only http(s) links: no mailto, tel or relative link, and no hidden profile', () => {
    const resume = resumeWith('Ada Byron--Lovelace', {
      profiles: {
        title: 'Profiles',
        hidden: false,
        items: [
          { id: 'a', hidden: false, network: 'GitHub', username: 'ada', website: { url: 'https://github.com/ada' } },
          { id: 'b', hidden: true, network: 'X', username: 'ada', website: { url: 'https://x.com/ada' } },
          { id: 'c', hidden: false, network: 'Mail', username: '', website: { url: 'mailto:ada@example.com' } },
          { id: 'd', hidden: false, network: 'Phone', username: '', website: { url: 'tel:+33600000000' } },
          { id: 'e', hidden: false, network: 'Local', username: '', website: { url: '/cv/' } },
        ],
      },
    });
    const person = findEntity(buildStructuredData(resume, root), 'Person');

    expect(person.sameAs).toEqual(['https://github.com/ada']);
  });

  it('WebSite is the site, in both languages, with the Person as publisher and author', () => {
    const website = findEntity(buildStructuredData(fr, root), 'WebSite');

    expect(website['@id']).toBe(`${root}#website`);
    expect(website.url).toBe(root);
    expect(website.name).toBe(fr.name);
    expect(website.inLanguage).toEqual(['fr', 'en']);
    expect(website.publisher).toEqual({ '@id': `${root}#person` });
    expect(website.author).toEqual({ '@id': `${root}#person` });
  });

  it('ProfilePage has its own @id and name and points at the page it describes', () => {
    const pageUrl = `${root}cv/`;
    const profile = findEntity(buildStructuredData(fr, pageUrl), 'ProfilePage');

    expect(profile['@id']).toBe(`${pageUrl}#profilepage`);
    expect(profile.url).toBe(pageUrl);
    expect(profile.name).toBe(fr.name);
    expect(profile.mainEntity).toEqual({ '@id': `${root}#person` });
    expect(profile.isPartOf).toEqual({ '@id': `${root}#website` });
  });

  it('never outputs an email, phone, address or location', () => {
    const resume = resumeWith();
    const text = JSON.stringify(buildStructuredData(resume, root));

    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('London');
    expect(text).not.toContain(fr.email);
    expect(text).not.toContain(fr.location);
    expect(text).not.toMatch(/"(email|telephone|phone|address|location)"/);
  });
});

describe('serializeJsonLd', () => {
  it('escapes < > & and the line separators so the block cannot be broken out of', () => {
    const payload = {
      note: '</script><script>alert("xss")</script> a & b > c \u2028 \u2029',
      nested: { tag: '<!-- <div class="x">content</div> -->' },
    };

    const serialized = serializeJsonLd(payload);

    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(serialized).toContain('\\u003c/script');
    expect(JSON.parse(serialized)).toEqual(payload);
  });

  it('keeps the real graph parseable after escaping', () => {
    const data = buildStructuredData(fr, root);

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
