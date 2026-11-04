import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/data/site.ts';

export default defineConfig({
  site: site.url,
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  // pages that no longer exist: the lab became a project, the story page was dropped
  redirects: {
    '/labo/': '/',
    '/histoire/': '/',
    '/en/lab/': '/en/',
    '/en/story/': '/en/',
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'fr',
        locales: {
          fr: 'fr',
          en: 'en',
        },
      },
    }),
  ],
});
