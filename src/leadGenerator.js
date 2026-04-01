const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const storage = require('./storage');
const { findBusinessesForIndustry } = require('./webSearch');
const { takeScreenshot } = require('./screenshotter');
const { extractContacts } = require('./contactExtractor');

let isGenerating = false;
let shouldStop = false;
let generationStatus = { running: false, message: '', count: 0, total: 0 };

function getStatus() { return { ...generationStatus, running: isGenerating }; }
function setStatus(u) { generationStatus = { ...generationStatus, ...u }; }
function stopGeneration() { shouldStop = true; setStatus({ message: 'Wird gestoppt…' }); }

// ─────────────────────────────────────────────────────────
// GPT-4o Vision: Screenshot visuell bewerten
// ─────────────────────────────────────────────────────────
async function evaluateWithVision(screenshotPath, url, openaiKey) {
  const client = new OpenAI({ apiKey: openaiKey });

  let imageBase64;
  try { imageBase64 = fs.readFileSync(screenshotPath).toString('base64'); }
  catch { return null; }

  const prompt = `You are a lead qualification system for a Swiss web design agency. Analyze this screenshot.

## STEP 0: IS THIS A REAL BUSINESS WEBSITE?

First check: Is this actually a real company's own website?

IMMEDIATELY mark is_good_lead: false and business_score: 0 if this is:
- A directory, aggregator, or listing site (e.g. local.ch, treatwell, cylex, salonkee, revieweuro, topX lists)
- A portal or platform that lists multiple businesses
- A blog or magazine article ("Die besten X in Zürich...")
- A 404 error page or broken/unreachable site
- A tourism or city guide website
- A government or association website

Only continue scoring if this is a REAL company's own website.

---

## STEP 1: WEBSITE QUALITY (0-100)

How outdated or bad is the design?
- 0-50: Very bad (no mobile, terrible layout, broken elements, >10 years old design)
- 50-65: Mediocre (outdated but functional, old CMS, poor typography)
- 65-80: Decent (some issues but usable)
- 80-100: Modern and professional (no redesign needed)

---

## STEP 2: BUSINESS VALUE (0-100)

Is this a real Swiss local business worth approaching?

HIGH VALUE (70-100) — exactly what was accepted as good leads:
- Coiffeur/Friseur/Barbershop with a real salon
- Restaurant, Gasthaus, Café with physical location
- Handwerker: electrician, plumber, painter, carpenter, locksmith
- Medical: Zahnarzt, Arztpraxis, Physiotherapie
- Other local service businesses in Switzerland

MEDIUM VALUE (40-70):
- Small online shops
- Consultancies without clear physical presence
- Businesses with unclear services

LOW VALUE (0-40) — exactly what was rejected:
- Directories or portals listing other businesses
- Websites that are clearly not operating anymore
- Generic placeholder or template sites
- Aggregators, review sites, top-lists

---

## DECISION

is_good_lead: true ONLY if:
- website_score < 65 (needs redesign)
- business_score >= 65 (real local Swiss business)
- It is genuinely the company's OWN website

URL: ${url}

Respond ONLY with strict JSON:
{
  "website_score": <0-100>,
  "business_score": <0-100>,
  "is_good_lead": <true/false>,
  "confidence": <0-100>,
  "reasons": ["reason 1", "reason 2"],
  "summary": "<1-2 sentences in German>"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } },
          { type: 'text', text: prompt }
        ]
      }],
      max_tokens: 500,
      temperature: 0.2
    });

    const text = completion.choices[0].message.content.trim();
    const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const rawMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[0] : null);
    if (!jsonStr) throw new Error('Kein JSON');
    const r = JSON.parse(jsonStr);
    return {
      websiteScore:  Math.max(0, Math.min(100, r.website_score ?? 50)),
      businessScore: Math.max(0, Math.min(100, r.business_score ?? 50)),
      isGoodLead:    !!r.is_good_lead,
      confidence:    Math.max(0, Math.min(100, r.confidence ?? 50)),
      reasons:       Array.isArray(r.reasons) ? r.reasons : [],
      summary:       r.summary ?? ''
    };
  } catch (err) {
    console.error('[Vision]', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// Eine Firma verarbeiten → Lead oder verwerfen
// ─────────────────────────────────────────────────────────
async function processBusiness(biz, openaiKey, industry) {
  if (!biz.website) return null;

  console.log(`[📸] ${biz.company} → ${biz.website}`);
  const screenshot = await takeScreenshot(biz.website);

  await storage.markUrlAsChecked(biz.website, { company: biz.company, hasScreenshot: !!screenshot });

  if (!screenshot) {
    console.log(`[✗] Kein Screenshot: ${biz.company}`);
    return null;
  }

  const screenshotsDir = process.env.SCREENSHOTS_DIR || path.join(__dirname, '..', 'public', 'screenshots');
  const screenshotPath = path.join(screenshotsDir, path.basename(screenshot));
  const analysis = await evaluateWithVision(screenshotPath, biz.website, openaiKey);

  let contacts = {};
  try { contacts = await extractContacts(biz.website); } catch {}

  const websiteScore  = analysis?.websiteScore  ?? null;
  const businessScore = analysis?.businessScore ?? null;
  const isGoodLead    = analysis?.isGoodLead    ?? false;

  console.log(`[Lead] Web:${websiteScore} Biz:${businessScore} Good:${isGoodLead} — ${biz.company}`);

  return {
    id:            uuidv4(),
    company:       biz.company,
    website:       biz.website,
    email:         contacts.email || biz.email || null,
    phone:         contacts.phone || biz.phone || null,
    address:       biz.address || null,
    gmRating:      biz.gmRating || null,
    gmReviews:     biz.gmReviews || null,
    screenshot,
    websiteScore,
    businessScore,
    isGoodLead,
    confidence:    analysis?.confidence ?? null,
    reasons:       analysis?.reasons    ?? [],
    summary:       analysis?.summary    ?? '',
    industry,
    category:      'Bad Webdesign',
    status:        'pending',
    createdAt:     new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────
// Non-Stop Suche bis stopGeneration()
// ─────────────────────────────────────────────────────────
async function generateLeads() {
  if (isGenerating) return { started: false, reason: 'Läuft bereits' };

  isGenerating = true;
  shouldStop = false;
  setStatus({ running: true, message: 'Starte Suche via local.ch…', count: 0, total: 0 });

  try {
    const settings = await storage.getSettings();
    const { openaiKey, industry, location } = settings;

    if (!openaiKey) {
      setStatus({ running: false, message: 'OpenAI Key fehlt' });
      isGenerating = false;
      return { started: false, reason: 'OpenAI Key fehlt' };
    }

    const searchIndustry = industry || 'Handwerker';
    const searchLocation = location && location.trim() ? location.trim() : null;
    let totalFound = 0;
    let round = 0;

    while (!shouldStop) {
      round++;
      const checkedCount = await storage.getCheckedCount();
      setStatus({
        message: `Runde ${round} — Suche: ${searchIndustry} (${checkedCount} URLs geprüft)`,
        total: totalFound
      });

      // Callback: jede Query-Batch sofort verarbeiten
      const processBatch = async (batch) => {
        for (const biz of batch) {
          if (shouldStop) break;
          if (await storage.isUrlChecked(biz.website)) continue;

          setStatus({ message: `📸 ${biz.company}…`, total: totalFound });
          try {
            const lead = await processBusiness(biz, openaiKey, searchIndustry);
            if (lead) {
              await storage.addLead(lead);
              totalFound++;
              setStatus({ count: totalFound, total: totalFound });
            }
          } catch (err) {
            console.error(`[Fehler] ${biz.company}:`, err.message);
          }
        }
      };

      try {
        await findBusinessesForIndustry(searchIndustry, openaiKey, processBatch, searchLocation);
      } catch (err) {
        console.error(`[Runde ${round}] Fehler:`, err.message);
        if (!shouldStop) await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (!shouldStop) await new Promise(r => setTimeout(r, 2000));
    }

    setStatus({ running: false, message: `Gestoppt. ${totalFound} Leads gefunden.`, total: totalFound });
    return { started: true, stopped: true, total: totalFound };

  } catch (err) {
    setStatus({ running: false, message: `Fehler: ${err.message}` });
    throw err;
  } finally {
    isGenerating = false;
    shouldStop = false;
  }
}

async function replenishOne() {}

module.exports = { generateLeads, stopGeneration, replenishOne, getStatus };
