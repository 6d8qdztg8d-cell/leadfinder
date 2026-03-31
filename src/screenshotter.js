const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Pfad neben der .exe wenn als pkg, sonst normal
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');

const SCREENSHOTS_DIR = path.join(BASE_DIR, 'public', 'screenshots');

// Browser-Pfade für Windows und Mac
function getExecutablePath() {
  const platform = process.platform;

  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const fsSync = require('fs');
    for (const p of candidates) {
      if (fsSync.existsSync(p)) return p;
    }
    return null; // keiner gefunden
  }

  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    const fsSync = require('fs');
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

    // Im pkg-Modus oder wenn kein Chromium: System-Browser nutzen
    const execPath = getExecutablePath();
    if (process.pkg || execPath) {
      if (!execPath) throw new Error('Kein Browser gefunden (Chrome/Edge benötigt)');
      const puppeteer = require('puppeteer-core');
      launchOptions.executablePath = execPath;
      browser = await puppeteer.launch(launchOptions);
    } else {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch(launchOptions);
    }

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

module.exports = { takeScreenshot, SCREENSHOTS_DIR };
