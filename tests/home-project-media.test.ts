import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeCss = readFileSync(new URL('../src/styles/home.css', import.meta.url), 'utf8');
const projectMediaAstro = readFileSync(new URL('../src/components/home/ProjectMedia.astro', import.meta.url), 'utf8');

describe('Home project previews (mobile and desktop consistency)', () => {
  it('hides project preview media by default in home.css so mobile matches desktop', () => {
    // .hc-media must have display: none by default
    expect(homeCss).toMatch(/\.hc-media\s*\{[^}]*display:\s*none;/);
  });

  it('does not constrain .hc-project to a thumbnail grid at 560px breakpoint', () => {
    // 560px breakpoint should not have 176px thumbnail column for .hc-project
    const mq560 = homeCss.slice(homeCss.indexOf('@media (min-width: 560px)'));
    const mq560Block = mq560.slice(0, mq560.indexOf('@media (min-width: 900px)'));
    expect(mq560Block).not.toContain('176px');
  });

  it('guards lazy video loading against hidden figures in ProjectMedia.astro', () => {
    expect(projectMediaAstro).toContain('if (figure.offsetParent === null) return;');
  });
});
