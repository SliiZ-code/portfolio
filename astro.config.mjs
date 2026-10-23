import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// No integrations: the board is vanilla canvas, the rest is static HTML.
export default defineConfig({
  site: 'https://sliiz.com',
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
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
