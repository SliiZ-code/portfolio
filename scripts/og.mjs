import { chromium } from '/tmp/shot/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '../public/og.png');
const projectRoot = path.join(__dirname, '..');

const PORT = 4411;
let previewProcess;

async function startPreview() {
  return new Promise((resolve, reject) => {
    previewProcess = spawn('npm', ['run', 'preview', '--', '--port', String(PORT)], {
      cwd: projectRoot,
    });

    let resolvedOnce = false;

    const timeout = setTimeout(() => {
      if (previewProcess && !resolvedOnce) {
        previewProcess.kill();
        reject(new Error('Preview server startup timeout'));
      }
    }, 60000);

    previewProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log('[preview stdout]', text);
      // Check for successful startup - look for port 4411 in output
      if (text.includes(String(PORT)) && !resolvedOnce) {
        resolvedOnce = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(), 1500);
      }
    });

    previewProcess.stderr.on('data', (data) => {
      console.log('[preview stderr]', data.toString());
    });

    previewProcess.on('error', (err) => {
      if (!resolvedOnce) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    previewProcess.on('close', (code) => {
      if (!resolvedOnce && code !== 0) {
        reject(new Error(`Preview process exited with code ${code}`));
      }
    });
  });
}

async function captureOG() {
  let browser;
  try {
    // Start the preview server
    console.log(`Starting preview server on port ${PORT}...`);
    await startPreview();

    // Verify server is up
    let connected = false;
    for (let i = 0; i < 20; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/`);
        if (response.ok) {
          connected = true;
          break;
        }
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!connected) {
      throw new Error('Could not connect to preview server');
    }

    console.log('Server is up, launching browser...');

    // Launch browser
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 630 });

    // Navigate to the site
    console.log('Navigating to preview...');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for intro animation to finish
    console.log('Waiting for intro animation to complete...');
    await page.waitForTimeout(4000);

    // Hide the HUD and minimap by injecting CSS
    await page.addStyleTag({
      content: `
        .hud { display: none !important; }
        .minimap { display: none !important; }
        [data-hud] { display: none !important; }
      `,
    });

    // Take screenshot
    console.log('Capturing screenshot...');
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Generated ${outputPath}`);
  } finally {
    if (browser) await browser.close();
    if (previewProcess) {
      previewProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Build first
console.log('Building site...');
const buildProcess = spawn('npm', ['run', 'build'], {
  cwd: projectRoot,
});

buildProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`Build failed with code ${code}`);
    process.exit(1);
  }

  // Proceed with OG generation
  captureOG().catch((err) => {
    console.error('Error generating OG image:', err);
    process.exit(1);
  });
});

buildProcess.on('error', (err) => {
  console.error('Build error:', err);
  process.exit(1);
});
