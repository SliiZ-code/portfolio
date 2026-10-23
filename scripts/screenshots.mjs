#!/usr/bin/env node
/**
 * Capture the Astro site (and the prototype, for comparison) with Playwright.
 *
 * Playwright is not a project dependency: point PLAYWRIGHT_MODULE at an
 * installed copy when running this script, for example:
 *
 *   PLAYWRIGHT_MODULE=/tmp/shot/node_modules/playwright/index.mjs \
 *     node scripts/screenshots.mjs
 *
 * Env:
 *   BASE_URL       default http://localhost:4321
 *   PROTOTYPE_URL  default file://<repo>/design/board.html
 *   OUT_DIR        default /tmp/shot
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const base = (process.env.BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const prototype = process.env.PROTOTYPE_URL || pathToFileURL(resolve(root, 'design/board.html')).href;
const out = process.env.OUT_DIR || '/tmp/shot';
const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';

const { chromium } = await import(modulePath);
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const problems = [];
const shots = [];

const watch = (page, label) => {
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label}: ${message.text()}`);
  });
};

const visit = async (path, { label, viewport, theme, before, settle = 2600, fullPage = false }) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  if (theme) {
    await page.evaluate((value) => {
      localStorage.setItem('jpc-theme', value);
      document.documentElement.dataset.theme = value;
      document.dispatchEvent(new CustomEvent('themechange'));
    }, theme);
  }
  await page.waitForTimeout(settle);
  if (before) await before(page);
  const file = `${out}/astro-${label}.png`;
  await page.screenshot({ path: file, fullPage });
  shots.push(file);
  const meta = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    theme: document.documentElement.dataset.theme,
    gen: document.getElementById('gen')?.textContent ?? null,
  }));
  console.log(label, JSON.stringify(meta));
  await context.close();
};

await visit('/', { label: 'home-fr', viewport: { width: 1440, height: 900 }, settle: 3600 });

await visit('/', {
  label: 'home-fr-pan',
  viewport: { width: 1440, height: 900 },
  settle: 3400,
  before: async (page) => {
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(1080, 690, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  },
});

await visit('/', {
  label: 'home-fr-list',
  viewport: { width: 1440, height: 900 },
  settle: 3200,
  before: async (page) => {
    await page.click('#list-btn');
    await page.waitForTimeout(600);
  },
});

await visit('/en/', { label: 'home-en', viewport: { width: 1440, height: 900 }, settle: 3600 });

await visit('/', {
  label: 'home-night',
  viewport: { width: 1440, height: 900 },
  settle: 3200,
  before: async (page) => {
    await page.click('[data-theme-toggle]');
    await page.waitForTimeout(800);
  },
});

await visit('/projets/jeu-de-la-vie/', {
  label: 'project-fr',
  viewport: { width: 1440, height: 900 },
  settle: 2800,
});

await visit('/projets/blink/', { label: 'project-blink-desktop', viewport: { width: 1440, height: 900 }, settle: 2800 });
await visit('/projets/blink/', { label: 'project-blink-mobile', viewport: { width: 390, height: 844 }, settle: 2800 });

const asciiReady = async (page) => {
  await page.waitForSelector('.ascii-box[data-state="ready"]', { timeout: 15000 });
  await page.waitForTimeout(600);
};

await visit('/labo/', { label: 'lab-fr', viewport: { width: 1440, height: 900 }, settle: 1500, before: asciiReady });
await visit('/labo/', { label: 'lab-night', viewport: { width: 1440, height: 900 }, theme: 'night', settle: 1500, before: asciiReady });
await visit('/en/lab/', { label: 'lab-en', viewport: { width: 1440, height: 900 }, settle: 1500, before: asciiReady });
await visit('/labo/', { label: 'lab-mobile', viewport: { width: 390, height: 844 }, settle: 1500, before: asciiReady });
await visit('/histoire/', { label: 'story-fr', viewport: { width: 1440, height: 900 }, settle: 800 });
await visit('/en/story/', { label: 'story-en', viewport: { width: 390, height: 844 }, settle: 800 });

// the whole board: zoomed all the way out, to check the placement of every structure
await visit('/', {
  label: 'board-full',
  viewport: { width: 1440, height: 900 },
  settle: 2600,
  before: async (page) => {
    await page.mouse.move(720, 450);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1500);
  },
});

await visit('/cv/', { label: 'cv-fr', viewport: { width: 1440, height: 900 }, settle: 800, fullPage: true });

await visit('/', {
  label: 'home-mobile',
  viewport: { width: 390, height: 844 },
  settle: 3600,
});

// Prototype, same viewport and settle time as the first Astro shot.
const prototypeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const prototypePage = await prototypeContext.newPage();
watch(prototypePage, 'prototype');
await prototypePage.goto(prototype, { waitUntil: 'load' });
await prototypePage.waitForTimeout(3600);
await prototypePage.screenshot({ path: `${out}/astro-prototype.png` });
shots.push(`${out}/astro-prototype.png`);
await prototypeContext.close();

// Compose the two home shots side by side without extra image dependencies.
const asDataUrl = async (file) => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
const [astroShot, prototypeShot] = await Promise.all([
  asDataUrl(`${out}/astro-home-fr.png`),
  asDataUrl(`${out}/astro-prototype.png`),
]);
const compositeContext = await browser.newContext({ viewport: { width: 2880, height: 900 } });
const composite = await compositeContext.newPage();
await composite.setContent(`
  <style>
    html, body { margin: 0; background: #efece2; }
    .row { display: grid; grid-template-columns: 1440px 1440px; }
    img { display: block; width: 1440px; height: 900px; }
  </style>
  <div class="row">
    <img src="${astroShot}" alt="Astro" />
    <img src="${prototypeShot}" alt="Prototype" />
  </div>
`);
await composite.waitForTimeout(300);
await composite.screenshot({ path: `${out}/astro-side-by-side.png` });
shots.push(`${out}/astro-side-by-side.png`);
await compositeContext.close();

await browser.close();

console.log('\nshots:');
for (const shot of shots) console.log(` ${shot}`);
console.log(`\nconsole/page errors: ${problems.length}`);
for (const problem of problems) console.log(` ${problem}`);
process.exitCode = problems.length ? 1 : 0;
