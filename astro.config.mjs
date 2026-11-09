import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/data/site.ts';
import { getResume } from './src/lib/resume.ts';

// the project pages were dropped: an old link (a CV sent earlier, a search result) lands on the projects of the home page
const projectRedirects = Object.fromEntries([
  ...getResume('fr').projects.map((project) => [`/projets/${project.slug}/`, '/#hc-projects']),
  ...getResume('en').projects.map((project) => [`/en/projects/${project.slug}/`, '/en/#hc-projects']),
]);

export default defineConfig({
  site: site.url,
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  // pages that no longer exist: the lab became a project, the story page and the project pages were dropped
  redirects: {
    '/labo/': '/',
    '/histoire/': '/',
    '/en/lab/': '/en/',
    '/en/story/': '/en/',
    ...projectRedirects,
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
