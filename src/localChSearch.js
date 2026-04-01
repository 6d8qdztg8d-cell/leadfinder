const puppeteer = require('puppeteer-core');
const { getExecutablePath } = require('./screenshotter');

const SWISS_CITIES = [
  'Zürich', 'Bern', 'Basel', 'Genf', 'Lausanne', 'Luzern', 'St. Gallen',
  'Winterthur', 'Lugano', 'Biel', 'Thun', 'Schaffhausen', 'Fribourg',
  'Chur', 'Neuchâtel', 'Aarau', 'Sion', 'Zug', 'Solothurn', 'Frauenfeld',
  'Uster', 'Olten', 'Baden', 'Wil', 'Kreuzlingen', 'Arbon'
];

const SKIP_DOMAINS = [
  'local.ch', 'localsearch.ch', 'search.ch', 'google.com', 'facebook.com',
  'instagram.com', 'swissmadesoftware.org', 'tripadvisor', 'booking.com',
  'linkedin.com', 'twitter.com', 'yellow.ch', 'zefix.ch', 'tiktok.com', 'youtube.com',
  'renovero.ch', 'localcities.ch', 'admin.ch', 'apple.com', 'whatsapp.com'
];

function isValidWebsite(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !SKIP_DOMAINS.some(d => host.includes(d));
  } catch { return false; }
}

async function launchBrowser() {
  const execPath = getExecutablePath();
  if (!execPath) throw new Error('Kein Browser gefunden. Bitte Chrome oder Edge installieren.');
  return puppeteer.launch({
    headless: true,
    executablePath: execPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
}

// Step 1: Get detail page URLs from search results
async function getDetailUrls(browser, query, city) {
  const searchUrl = `https://www.local.ch/de/q?what=${encodeURIComponent(query)}&where=${encodeURIComponent(city)}`;
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    const urls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/de/d/"]'))
        .map(a => a.href)
        .filter((v, i, arr) => arr.indexOf(v) === i); // dedupe
    });

    console.log(`[local.ch] "${query}" in ${city} → ${urls.length} Einträge`);
    return urls;
  } catch (err) {
    console.error(`[local.ch] Suche fehlgeschlagen für ${city}:`, err.message);
    return [];
  } finally {
    await page.close();
  }
}

// Step 2: Visit detail page and extract business info
async function getBusinessFromDetailPage(browser, detailUrl) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    return await page.evaluate((skipDomains) => {
      const company = document.querySelector('h1')?.innerText?.trim() || null;
      const phoneEl = document.querySelector('[href^="tel:"]');
      const phone = phoneEl?.innerText?.trim() || phoneEl?.getAttribute('href')?.replace('tel:', '') || null;

      // Address: look for structured address or text near the map
      const addrEl = document.querySelector('[class*="address"], address, [itemtype*="PostalAddress"]');
      const address = addrEl?.innerText?.trim()?.replace(/\s+/g, ' ') || null;

      // Website: external link where the link text looks like a domain (e.g. "example.ch")
      let website = null;
      const extLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
      for (const link of extLinks) {
        const href = link.href;
        const text = (link.innerText || '').trim().toLowerCase();
        if (skipDomains.some(d => href.includes(d))) continue;
        // Link text should look like a domain: contains a dot, no spaces, short
        const looksLikeDomain = text.includes('.') && !text.includes(' ') && text.length < 60;
        if (looksLikeDomain) {
          website = href;
          break;
        }
      }

      return { company, phone, address, website };
    }, SKIP_DOMAINS);
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function findBusinessesOnLocalCh(industry) {
  const seen = new Set();
  const results = [];

  const cities = [...SWISS_CITIES].sort(() => Math.random() - 0.5).slice(0, 6);
  const browser = await launchBrowser();

  try {
    for (const city of cities) {
      if (results.length >= 60) break;

      const detailUrls = await getDetailUrls(browser, industry, city);

      // Parallel: 5 Detail-Seiten gleichzeitig laden
      const newUrls = detailUrls.filter(u => !seen.has(u));
      newUrls.forEach(u => seen.add(u));

      const BATCH = 5;
      for (let i = 0; i < newUrls.slice(0, 30).length; i += BATCH) {
        const batch = newUrls.slice(i, i + BATCH);
        const businesses = await Promise.all(batch.map(u => getBusinessFromDetailPage(browser, u)));

        for (const biz of businesses) {
          if (!biz || !biz.company) continue;
          if (!isValidWebsite(biz.website)) continue;
          try {
            const domain = new URL(biz.website).hostname.replace('www.', '').toLowerCase();
            if (seen.has(domain)) continue;
            seen.add(domain);
            results.push(biz);
            console.log(`[local.ch] ✓ ${biz.company} → ${biz.website}`);
          } catch {}
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    await browser.close();
  }

  console.log(`[local.ch] Total: ${results.length} Firmen mit Website für "${industry}"`);
  return results;
}

// ── Kombinierte Suche: local.ch + DuckDuckGo Web ─────────
const { findBusinessesForIndustry: findBusinessesViaWeb } = require('./webSearch');

async function findBusinessesForIndustry(industry, openaiKey, onBatch, location) {
  const seen = new Set();

  console.log(`[Suche] Starte kombinierte Suche für "${industry}"…`);

  // Beide Quellen parallel
  const [localResults, webResults] = await Promise.all([
    findBusinessesOnLocalCh(industry),
    findBusinessesViaWeb(industry, openaiKey, null, location)
  ]);

  const combined = [];
  for (const biz of [...localResults, ...webResults]) {
    if (!biz.website) continue;
    try {
      const domain = new URL(biz.website).hostname.replace('www.', '').toLowerCase();
      if (seen.has(domain)) continue;
      seen.add(domain);
      combined.push(biz);
    } catch {}
  }

  console.log(`[Suche] Kombiniert: ${combined.length} Firmen (local.ch: ${localResults.length}, Web: ${webResults.length})`);
  return combined;
}

module.exports = { findBusinessesForIndustry };
