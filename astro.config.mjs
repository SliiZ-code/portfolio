import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/data/site.ts';

export default defineConfig({
  site: site.url,
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  integrations: [
    sitemap({
      // the story pages hold placeholder copy until the real text is written
      filter: (page) => !/\/(histoire|en\/story)\/$/.test(new URL(page).pathname),
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
