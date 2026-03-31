const axios = require('axios');
const OpenAI = require('openai');

const BLOCKED_DOMAINS = [
  'facebook.com', 'instagram.com', 'google.com', 'tripadvisor',
  'yelp.com', 'linkedin.com', 'twitter.com', 'booking.com',
  'local.ch', 'search.ch', 'yellow.ch', 'zefix.ch', 'monsterakku.ch'
];

// ─────────────────────────────────────────────────────────
// OpenAI generiert vielfältige Suchbegriffe für die Branche
// ─────────────────────────────────────────────────────────
async function generateSearchQueries(industry, openaiKey) {
  const client = new OpenAI({ apiKey: openaiKey });

  const prompt = `Du generierst Suchbegriffe für Google Maps um Schweizer Kleinbetriebe der Branche "${industry}" zu finden.

Erstelle 20 verschiedene Suchbegriffe. Variiere dabei:
- Synonyme auf Deutsch, Französisch, Italienisch (Coiffeur/Friseur/Parrucchiere, Sanitär/Plombier, Maler/Peintre, etc.)
- Kombination mit Schweizer Städten und Regionen (Zürich, Bern, Basel, Genf, Lausanne, Luzern, Lugano, St. Gallen, Winterthur, Aarau, Chur, Thun, Biel, Schaffhausen, Zug, Frauenfeld, Solothurn, Sion, Neuchâtel, Fribourg)
- Unterkategorien und Spezialisierungen
- Verschiedene Formulierungen (Betrieb, Unternehmen, Firma, Werkstatt, Atelier, Studio)

Antworte NUR mit einem JSON-Array, kein anderer Text:
["Begriff 1", "Begriff 2", ...]`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
      temperature: 0.95
    });

    const content = response.choices[0].message.content || '';
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      const queries = JSON.parse(match[0]);
      if (Array.isArray(queries) && queries.length > 0) return queries;
    }
  } catch (err) {
    console.error('[PlacesSearch] Query-Generierung fehlgeschlagen:', err.message);
  }

  // Fallback: Basisbegriffe
  return [
    industry,
    `${industry} Zürich`, `${industry} Bern`, `${industry} Basel`,
    `${industry} Genf`, `${industry} Lausanne`, `${industry} Luzern`
  ];
}

// ─────────────────────────────────────────────────────────
// Google Places API (New) — Text Search
// ─────────────────────────────────────────────────────────
async function searchPlaces(query, googleMapsKey) {
  const response = await axios.post(
    'https://places.googleapis.com/v1/places:searchText',
    {
      textQuery: query,
      languageCode: 'de',
      regionCode: 'CH',
      maxResultCount: 20
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleMapsKey,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.nationalPhoneNumber',
          'places.websiteUri',
          'places.rating',
          'places.userRatingCount'
        ].join(',')
      },
      timeout: 15000
    }
  );

  return (response.data.places || [])
    .filter(p => {
      if (!p.websiteUri) return false;
      try {
        const host = new URL(p.websiteUri).hostname.toLowerCase();
        return !BLOCKED_DOMAINS.some(d => host.includes(d));
      } catch { return false; }
    })
    .map(p => ({
      company:  p.displayName?.text || '',
      website:  p.websiteUri,
      phone:    p.nationalPhoneNumber || null,
      address:  p.formattedAddress || null,
      gmRating: p.rating || null,
      gmReviews:p.userRatingCount || null
    }));
}

// ─────────────────────────────────────────────────────────
// Alle Firmen für eine Branche sammeln (dedupliziert)
// ─────────────────────────────────────────────────────────
async function findBusinessesForIndustry(industry, googleMapsKey, openaiKey) {
  const queries = await generateSearchQueries(industry, openaiKey);
  console.log(`[Places] ${queries.length} Suchbegriffe generiert für: ${industry}`);

  const seen = new Set();
  const results = [];

  for (const query of queries) {
    try {
      const places = await searchPlaces(query, googleMapsKey);
      for (const biz of places) {
        try {
          const domain = new URL(biz.website).hostname.replace('www.', '').toLowerCase();
          if (!seen.has(domain)) {
            seen.add(domain);
            results.push(biz);
          }
        } catch {}
      }
      console.log(`[Places] "${query}" → ${places.length} Treffer (gesamt: ${results.length})`);
    } catch (err) {
      console.error(`[Places] Fehler bei "${query}":`, err.message);
    }

    // Kurze Pause gegen Rate-Limiting
    await new Promise(r => setTimeout(r, 250));
  }

  return results;
}

module.exports = { findBusinessesForIndustry, generateSearchQueries, searchPlaces };
