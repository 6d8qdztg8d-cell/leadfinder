const puppeteer = require('puppeteer-core');
const { getExecutablePath } = require('./screenshotter');
const OpenAI = require('openai');

const SWISS_CITIES = [
  'Zürich', 'Bern', 'Basel', 'Genf', 'Lausanne', 'Luzern', 'St. Gallen',
  'Winterthur', 'Lugano', 'Biel', 'Thun', 'Schaffhausen', 'Fribourg',
  'Chur', 'Neuchâtel', 'Aarau', 'Sion', 'Zug', 'Solothurn', 'Olten',
  'Baden', 'Wil', 'Frauenfeld', 'Arbon', 'Kreuzlingen', 'Uster',
  'Arlesheim', 'Liestal', 'Rheinfelden', 'Arth', 'Küsnacht', 'Horgen',
  'Wettingen', 'Dietikon', 'Regensdorf', 'Urdorf', 'Schlieren', 'Opfikon'
];

const SKIP_DOMAINS = [
  // Soziale Netzwerke
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'tiktok.com',
  'youtube.com', 'xing.com', 'pinterest.com', 'snapchat.com',
  // Suchmaschinen & Portale
  'google.com', 'google.ch', 'bing.com', 'duckduckgo.com', 'yahoo.com',
  // Schweizer Verzeichnisse
  'local.ch', 'search.ch', 'yellow.ch', 'zefix.ch', 'monsterakku.ch',
  'firmenabc.ch', 'cylex.ch', 'cylex-swiss.ch', 'branchenbuch.ch', 'toprated.ch',
  // Aggregatoren / Portale
  'tripadvisor', 'booking.com', 'yelp.com', 'trustpilot.com',
  'profifinder.ch', 'helply.ch', 'daibau.ch', 'houzy.ch', 'ofri.ch',
  'renovero.ch', 'buildigo.ch', 'localsearch.ch', 'localcities.ch',
  'homify.ch', 'comparis.ch', 'tutti.ch', 'ricardo.ch', 'anibis.ch',
  'homegate.ch', 'immoscout24.ch', 'myjob.ch', 'jobs.ch',
  'handwerker-vergleich.ch', 'swissprofessionals.ch',
  // Aus abgelehnten Leads gelernt
  'revieweuro.com', 'salonkee.ch', 'zurich10.com', 'topzuerich.online',
  'zuri.net', 'treatwell.ch', 'yably.ch', 'stilpunkte.de',
  'checkeria.ch', 'zuerich.com', 'bern.place', 'easaswitzerland.ch',
  'unilocal.de', 'schoenesleben.ch', 'schweizer-illustrierte.ch',
  'baerner-meitschi.ch', 'handwerkerportal.live', 'artisanat.ch',
  // Sonstige
  'wikipedia.org', 'admin.ch', 'apple.com', 'whatsapp.com',
  'reddit.com', 'swissmadesoftware.org', 'digitalone.site',
  'wko.at', 'suissetec.ch', 'baulink.ch'
];

function isValidWebsite(url) {
  if (!url || !url.startsWith('http')) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host.match(/^\d+\.\d+/)) return false;
    return !SKIP_DOMAINS.some(d => host.includes(d));
  } catch { return false; }
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '').toLowerCase(); } catch { return null; }
}

// ── OpenAI: Suchbegriffe generieren ──────────────────────
async function generateQueries(industry, openaiKey, location = null) {
  const cityContext = location
    ? `Suche NUR in: ${location}. Alle Suchbegriffe müssen "${location}" enthalten.`
    : `Städte variieren: Zürich, Bern, Basel, Luzern, Genf, Lausanne, St. Gallen, Winterthur, Chur, Aarau, Schaffhausen, Zug, Thun, Sion, Fribourg, Olten, Wil, Frauenfeld, Biel, Lugano`;

  try {
    const client = new OpenAI({ apiKey: openaiKey });
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Erstelle 25 Suchbegriffe für Google um Schweizer KMUs und Einzelunternehmer der Branche "${industry}" zu finden.

Zielgruppe: KMUs, Einzelunternehmer, Pizzerias, Bäckereien, Handwerker, Reinigungen, lokale Kleinbetriebe.

Regeln:
- Format: "[Branche] [Stadt]" oder "[Firmentyp] [Stadt]"
- Synonyme auf Deutsch, Französisch, Italienisch verwenden
- ${cityContext}
- KEINE Superlative: NICHT "beste", "besten", "top", "empfehlung", "empfehlungen", "beliebt"
- KEINE Listen-Suchanfragen wie "Restaurants in Zürich" → NUR direkte Firmensuchen
- KEINE Aggregatoren-Keywords (kein "liste", "verzeichnis", "directory")
- Ziel: direkte Website einzelner Betriebe finden, NICHT Portale oder Bestenlisten

Antworte NUR mit JSON-Array: ["Begriff 1", "Begriff 2", ...]`
      }],
      max_tokens: 600,
      temperature: 0.9
    });
    const match = res.choices[0].message.content.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (err) {
    console.log('[Queries] OpenAI Fallback:', err.message);
  }

  // Fallback ohne OpenAI
  const cities = location ? [location] : SWISS_CITIES.slice(0, 12);
  return cities.flatMap(c => [`${industry} ${c}`, `${industry} ${c} website`]);
}

// Negative Keywords um Aggregatoren auszuschliessen
const NEGATIVE = '-treatwell -yably -local.ch -search.ch -tripadvisor -booking.com -yelp -zuri.net -toprated -stilpunkte -easaswitzerland -unilocal -schoenesleben -schweizer-illustrierte';

// ── Bing Suche ────────────────────────────────────────────
async function searchBing(page, query) {
  try {
    const fullQuery = `${query} ${NEGATIVE}`;
    const url = `https://www.bing.com/search?q=${encodeURIComponent(fullQuery)}&setlang=de&cc=CH&count=20`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('#b_results .b_algo').forEach(el => {
        const a = el.querySelector('h2 a');
        if (!a) return;
        const href = a.href || '';
        const title = a.innerText?.trim() || '';
        if (href.startsWith('http')) results.push({ title, website: href });
      });
      return results;
    });
  } catch (err) {
    console.error('[Bing] Fehler:', err.message);
    return [];
  }
}

// ── DuckDuckGo Suche (Backup) ─────────────────────────────
async function searchDDG(page, query) {
  try {
    const fullQuery = `${query} ${NEGATIVE}`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(fullQuery)}&kl=ch-de`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.result__title a, .result__a').forEach(a => {
        let href = a.href || '';
        try {
          const u = new URL(href);
          const uddg = u.searchParams.get('uddg');
          if (uddg) href = decodeURIComponent(uddg);
        } catch {}
        const title = a.innerText?.trim() || '';
        if (href.startsWith('http')) results.push({ title, website: href });
      });
      return results;
    });
  } catch { return []; }
}

// ── Hauptfunktion ─────────────────────────────────────────
// onBatch(businesses[]) wird nach jeder Query sofort aufgerufen
async function findBusinessesForIndustry(industry, openaiKey, onBatch = null, location = null) {
  const queries = await generateQueries(industry, openaiKey, location);
  console.log(`[WebSearch] ${queries.length} Suchbegriffe für "${industry}"`);

  const seen = new Set();
  const allResults = [];

  const execPath = getExecutablePath();
  if (!execPath) throw new Error('Kein Browser gefunden. Bitte Chrome oder Edge installieren.');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: execPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    let useBing = true;
    for (const query of queries) {
      if (allResults.length >= 80) break;

      let hits = useBing
        ? await searchBing(page, query)
        : await searchDDG(page, query);

      if (hits.length === 0 && useBing) {
        hits = await searchDDG(page, query);
        if (hits.length > 0) useBing = false;
      }

      const batch = [];
      for (const hit of hits) {
        if (!isValidWebsite(hit.website)) continue;
        const domain = getDomain(hit.website);
        if (!domain || seen.has(domain)) continue;
        seen.add(domain);

        const company = hit.title
          .split('|')[0].split('–')[0].split(' - ')[0]
          .trim().slice(0, 80) || domain;

        const biz = { company, website: hit.website, phone: null, address: null };
        batch.push(biz);
        allResults.push(biz);
      }

      if (batch.length > 0) {
        console.log(`[WebSearch] "${query}" → +${batch.length} (total: ${allResults.length})`);
        // Sofort verarbeiten statt warten bis alle Queries durch sind
        if (onBatch) await onBatch(batch);
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`[WebSearch] Gesamt: ${allResults.length} Websites für "${industry}"`);
  return allResults;
}

module.exports = { findBusinessesForIndustry };
