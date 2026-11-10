import { mkdir } from 'node:fs/promises';

const playwrightPath = '/tmp/shot/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

const SHOTS_DIR = '/home/sliiz/.t3/scratch/shots';
const BASE_URL = 'http://127.0.0.1:18084';
await mkdir(SHOTS_DIR, { recursive: true });

const TIMESTAMPS = [0, 100, 200, 300, 450, 650];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
});

// Helper to inject animation controller on page
async function setupAnimationCapture() {
  await page.evaluate(() => {
    window.__capturedAnimations = [];
    window.__pauseCapturing = true;
    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const anim = origAnimate.apply(this, args);
      if (window.__pauseCapturing) {
        anim.pause();
      }
      window.__capturedAnimations.push(anim);
      return anim;
    };
  });
}

async function waitForAnimations() {
  await page.waitForFunction(() => window.__capturedAnimations && window.__capturedAnimations.length > 0, {
    timeout: 5000,
  });
  // Wait a tick for all synchronous animate calls to finish registering
  await page.waitForTimeout(50);
}

async function setAnimationsTime(t) {
  await page.evaluate((time) => {
    for (const anim of window.__capturedAnimations) {
      anim.currentTime = time;
    }
  }, t);
}

async function releaseAnimations() {
  await page.evaluate(() => {
    window.__pauseCapturing = false;
    for (const anim of window.__capturedAnimations) {
      anim.play();
    }
  });
  // Wait for animations to finish and finally block to execute
  await page.waitForTimeout(700);
}

async function createStrip(frames, outPath, title) {
  const stripContext = await browser.newContext({ viewport: { width: 1800, height: 600 } });
  const stripPage = await stripContext.newPage();
  const columns = frames
    .map(
      (f) => `
    <div class="frame-col">
      <div class="time-label">${f.time} ms</div>
      <img src="data:image/png;base64,${f.buffer.toString('base64')}" />
    </div>
  `,
    )
    .join('');

  await stripPage.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 24px;
            background: #18181b;
            color: #f4f4f5;
            font-family: system-ui, -apple-system, sans-serif;
            display: inline-block;
          }
          h2 {
            margin: 0 0 16px 0;
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.02em;
          }
          .strip {
            display: flex;
            gap: 12px;
            align-items: flex-start;
          }
          .frame-col {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #27272a;
            padding: 8px;
            border-radius: 6px;
          }
          .time-label {
            font-size: 12px;
            font-weight: bold;
            color: #a1a1aa;
            text-align: center;
          }
          img {
            display: block;
            max-width: 300px;
            height: auto;
            border: 1px solid #3f3f46;
            border-radius: 4px;
            background: #fdfbf7;
          }
        </style>
      </head>
      <body>
        <h2>${title}</h2>
        <div class="strip">${columns}</div>
      </body>
    </html>
  `);

  await stripPage.waitForTimeout(200);
  const element = await stripPage.$('body');
  await element.screenshot({ path: outPath });
  await stripContext.close();
  console.log(`Saved strip to ${outPath}`);
}

async function getElementStyles() {
  return page.evaluate(() => {
    const fixedLayers = document.querySelectorAll('div[aria-hidden="true"][style*="position: fixed"]');
    const summaryStyle = document.querySelector('#content .hc-summary')?.getAttribute('style');
    const noteStyle = document.querySelector('#name-note')?.getAttribute('style');
    return {
      fixedLayersCount: fixedLayers.length,
      summaryStyle: summaryStyle ?? null,
      noteStyle: noteStyle ?? null,
    };
  });
}

let freshFrStyles = null;

async function verifyDomClean(expectedStyles) {
  const cleanState = await getElementStyles();
  console.log('DOM Cleanliness Check:', JSON.stringify(cleanState));
  if (cleanState.fixedLayersCount > 0) {
    throw new Error(`Leftover fixed overlay layer found! Count: ${cleanState.fixedLayersCount}`);
  }
  if (cleanState.summaryStyle !== expectedStyles.summaryStyle) {
    throw new Error(
      `Mismatch on .hc-summary style: expected "${expectedStyles.summaryStyle}", got "${cleanState.summaryStyle}"`,
    );
  }
  if (cleanState.noteStyle !== expectedStyles.noteStyle) {
    throw new Error(
      `Mismatch on #name-note style: expected "${expectedStyles.noteStyle}", got "${cleanState.noteStyle}"`,
    );
  }
}

console.log('=== Step 1: Load FR home page & measure baseline fresh styles ===');
await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
freshFrStyles = await getElementStyles();
console.log('Fresh FR initial styles:', JSON.stringify(freshFrStyles));

const freshEnPage = await context.newPage();
await freshEnPage.goto(`${BASE_URL}/en/`, { waitUntil: 'networkidle' });
await freshEnPage.waitForTimeout(1000);
const freshEnStyles = await freshEnPage.evaluate(() => {
  return {
    fixedLayersCount: 0,
    summaryStyle: document.querySelector('#content .hc-summary')?.getAttribute('style') ?? null,
    noteStyle: document.querySelector('#name-note')?.getAttribute('style') ?? null,
  };
});
await freshEnPage.close();
console.log('Fresh EN initial styles:', JSON.stringify(freshEnStyles));

console.log('=== Step 2: Crossfade test on .hc-summary (FR -> EN) ===');
await page.evaluate(() => {
  const el = document.querySelector('#content .hc-summary');
  el?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);

await setupAnimationCapture();
await page.click('.hud .flags a[hreflang="en"]');
await waitForAnimations();

const summaryEnFrames = [];
const summaryBox = await page.locator('#content .hc-summary').boundingBox();
for (const t of TIMESTAMPS) {
  await setAnimationsTime(t);
  const buf = await page.screenshot({ clip: summaryBox });
  summaryEnFrames.push({ time: t, buffer: buf });
}
await releaseAnimations();
await verifyDomClean(freshEnStyles);
await createStrip(
  summaryEnFrames,
  `${SHOTS_DIR}/morph-fade-summary-en.png`,
  '.hc-summary crossfade: FR → EN (0, 100, 200, 300, 450, 650 ms)',
);

console.log('=== Step 3: Crossfade test on .hc-summary (EN -> FR) ===');
await page.evaluate(() => {
  const el = document.querySelector('#content .hc-summary');
  el?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);

await setupAnimationCapture();
await page.click('.hud .flags a[hreflang="fr"]');
await waitForAnimations();

const summaryFrFrames = [];
const summaryFrBox = await page.locator('#content .hc-summary').boundingBox();
for (const t of TIMESTAMPS) {
  await setAnimationsTime(t);
  const buf = await page.screenshot({ clip: summaryFrBox });
  summaryFrFrames.push({ time: t, buffer: buf });
}
await releaseAnimations();
await verifyDomClean(freshFrStyles);
await createStrip(
  summaryFrFrames,
  `${SHOTS_DIR}/morph-fade-summary-fr.png`,
  '.hc-summary crossfade: EN → FR (0, 100, 200, 300, 450, 650 ms)',
);

console.log('=== Step 4: Letter-morph test on #name-note (FR -> EN) ===');
// Scroll back to top so #name-note is in view
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(300);

await setupAnimationCapture();
await page.click('.hud .flags a[hreflang="en"]');
await waitForAnimations();

const noteEnFrames = [];
const noteBox = await page.locator('#name-note').boundingBox();
for (const t of TIMESTAMPS) {
  await setAnimationsTime(t);
  const buf = await page.screenshot({ clip: noteBox });
  noteEnFrames.push({ time: t, buffer: buf });
}
await releaseAnimations();
await verifyDomClean(freshEnStyles);
await createStrip(
  noteEnFrames,
  `${SHOTS_DIR}/morph-fade-name-note-en.png`,
  '#name-note letter-morph: FR → EN (0, 100, 200, 300, 450, 650 ms)',
);

console.log('=== Step 5: Letter-morph test on #name-note (EN -> FR) ===');
await setupAnimationCapture();
await page.click('.hud .flags a[hreflang="fr"]');
await waitForAnimations();

const noteFrFrames = [];
const noteFrBox = await page.locator('#name-note').boundingBox();
for (const t of TIMESTAMPS) {
  await setAnimationsTime(t);
  const buf = await page.screenshot({ clip: noteFrBox });
  noteFrFrames.push({ time: t, buffer: buf });
}
await releaseAnimations();
await verifyDomClean(freshFrStyles);
await createStrip(
  noteFrFrames,
  `${SHOTS_DIR}/morph-fade-name-note-fr.png`,
  '#name-note letter-morph: EN → FR (0, 100, 200, 300, 450, 650 ms)',
);

await browser.close();

console.log('=== All Verification Completed Successfully! ===');
console.log(`Console errors count: ${consoleErrors.length}`);
if (consoleErrors.length > 0) {
  console.error('Errors encountered:', consoleErrors);
  process.exit(1);
}
