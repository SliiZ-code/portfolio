import { chromium } from '/tmp/shot/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '../public/og.png');
const projectRoot = path.join(__dirname, '..');

const PORT = 4411;
// OG_URL: use a preview that is already running instead of starting one
const EXTERNAL_URL = process.env.OG_URL?.replace(/\/$/, '');
let previewProcess;

async function checkPortInUse() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/`);
    return response.ok || response.status === 404; // Port is in use
  } catch {
    return false; // Port is free
  }
}

async function startPreview() {
  // Check if port is already in use
  const inUse = await checkPortInUse();
  if (inUse) {
    throw new Error(`Port ${PORT} is already in use`);
  }

  return new Promise((resolve, reject) => {
    const astroPath = path.join(projectRoot, 'node_modules/astro/bin/astro.mjs');
    previewProcess = spawn('node', [astroPath, 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
      cwd: projectRoot,
    });

    let resolvedOnce = false;
    let output = '';

    const timeout = setTimeout(() => {
      if (previewProcess && !resolvedOnce) {
        previewProcess.kill('SIGTERM');
        reject(new Error('Preview server startup timeout'));
      }
    }, 30000);

    previewProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes(String(PORT)) && !resolvedOnce) {
        resolvedOnce = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(), 500);
      }
    });

    previewProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    previewProcess.on('error', (err) => {
      if (!resolvedOnce) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    previewProcess.on('close', (code) => {
      if (!resolvedOnce) {
        clearTimeout(timeout);
        reject(new Error(`Preview process exited with code ${code}`));
      }
    });
  });
}

async function captureOG() {
  let browser;
  try {
    if (!EXTERNAL_URL) {
      console.log(`Starting preview server on port ${PORT}...`);
      await startPreview();
    }

    console.log('Launching browser...');
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 630 });

    console.log('Navigating to preview...');
    await page.goto(`${EXTERNAL_URL ?? `http://127.0.0.1:${PORT}`}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the intro (cells fade in over 1400ms, the stage fades in with them)
    console.log('Waiting for intro animation to complete...');
    await page.waitForSelector('#stage.ready');
    await page.waitForTimeout(2600);

    // Hide the HUD and the list panel
    await page.addStyleTag({
      content: `
        .hud { display: none !important; }
        #list { display: none !important; }
      `,
    });

    console.log('Capturing screenshot...');
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Generated ${outputPath}`);
  } finally {
    if (browser) await browser.close();
    if (previewProcess) {
      previewProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Build first
console.log('Building site...');
const buildProcess = spawn('node', [path.join(projectRoot, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: projectRoot,
});

buildProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`Build failed with code ${code}`);
    process.exit(1);
  }

  captureOG().catch((err) => {
    console.error('Error generating OG image:', err);
    process.exit(1);
  });
});

buildProcess.on('error', (err) => {
  console.error('Build error:', err);
  process.exit(1);
});
