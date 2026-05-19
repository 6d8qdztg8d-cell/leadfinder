const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.join(__dirname, '..', 'public', 'screenshots');

// Browser-Pfade für Windows, Mac und Linux (Railway/Server)
function getExecutablePath() {
  const platform = process.platform;
  const fsSync = require('fs');

  if (platform === 'linux') {
    // Zuerst via PATH suchen (Railway/Nixpacks installiert chromium dort)
    try {
      const { execSync } = require('child_process');
      const found = execSync(
        'which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null',
        { encoding: 'utf8', timeout: 3000 }
      ).trim().split('\n')[0];
      if (found) return found;
    } catch {}

    // Bekannte Pfade als Fallback
    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/snap/bin/chromium',
    ];
    for (const p of candidates) {
      if (fsSync.existsSync(p)) return p;
    }
    return null;
  }

  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
      if (fsSync.existsSync(p)) return p;
    }
    return null;
  }

  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of candidates) {
      if (fsSync.existsSync(p)) return p;
    }
    return null;
  }

  return null;
}

async function ensureDir() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

async function takeScreenshot(url) {
  if (!url) return null;
  await ensureDir();

  const filename = `${uuidv4()}.jpg`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  let browser;
  try {
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions'
      ]
    };

    const execPath = getExecutablePath();
    if (!execPath) throw new Error('Kein Browser gefunden. Bitte Chrome oder Edge installieren.');
    const puppeteer = require('puppeteer-core');
    launchOptions.executablePath = execPath;
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 1500));

    await page.screenshot({
      path: filepath,
      type: 'jpeg',
      quality: 85,
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });

    return `/screenshots/${filename}`;
  } catch (err) {
    console.error(`Screenshot failed for ${url}:`, err.message);
    return null;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

module.exports = { takeScreenshot, SCREENSHOTS_DIR, getExecutablePath };
