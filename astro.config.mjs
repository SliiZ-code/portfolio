import { defineConfig } from 'astro/config';

// No integrations: the board is vanilla canvas, the rest is static HTML.
export default defineConfig({
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
});
