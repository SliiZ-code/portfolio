import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';
import { getResume } from '../src/lib/resume';

describe('redirects for the removed pages', () => {
  it('sends the old lab and story URLs back to the board of their language', () => {
    expect(config.redirects).toMatchObject({
      '/labo/': '/',
      '/histoire/': '/',
      '/en/lab/': '/en/',
      '/en/story/': '/en/',
    });
  });

  it('sends every old project page to the projects of the home page', () => {
    const redirects = config.redirects as Record<string, string>;
    for (const project of getResume('fr').projects) expect(redirects[`/projets/${project.slug}/`]).toBe('/#hc-projects');
    for (const project of getResume('en').projects) {
      expect(redirects[`/en/projects/${project.slug}/`]).toBe('/en/#hc-projects');
    }
  });
});
