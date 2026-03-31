const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'public', 'screenshots');

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
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions'
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Block heavy resources to speed up screenshots
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['media', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });

    // Wait a bit for above-fold content to render
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
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

module.exports = { takeScreenshot };
