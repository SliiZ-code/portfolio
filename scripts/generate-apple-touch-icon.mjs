import { chromium } from '/tmp/shot/node_modules/playwright/index.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '../public/apple-touch-icon.png');

const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; width: 140px; height: 140px; background: #e8e5dc; }
    svg { width: 140px; height: 140px; }
    .cell { fill: #1b1a17; }
  </style>
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect class="cell" x="23" y="3" width="18" height="18" />
    <rect class="cell" x="43" y="23" width="18" height="18" />
    <rect class="cell" x="3" y="43" width="18" height="18" />
    <rect class="cell" x="23" y="43" width="18" height="18" />
    <rect class="cell" x="43" y="43" width="18" height="18" />
  </svg>
</body>
</html>
`;

async function generate() {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 180, height: 180 });
    await page.setContent(html);
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Generated ${outputPath}`);
  } finally {
    if (browser) await browser.close();
  }
}

generate().catch(console.error);
