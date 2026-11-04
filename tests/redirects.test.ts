import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';

describe('redirects for the removed pages', () => {
  it('sends the old lab and story URLs back to the board of their language', () => {
    expect(config.redirects).toEqual({
      '/labo/': '/',
      '/histoire/': '/',
      '/en/lab/': '/en/',
      '/en/story/': '/en/',
    });
  });
});
