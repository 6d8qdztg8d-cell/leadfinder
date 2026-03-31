const OpenAI = require('openai');
const axios = require('axios');

async function fetchHTML(url) {
  const response = await axios.get(url, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    maxRedirects: 5
  });
  return response.data;
}

async function analyzeWebsite(url, apiKey) {
  // Keine Website → sofortiger Lead
  if (!url) {
    return {
      isBadWebsite: true,
      score: 0,
      issues: ['Keine Website vorhanden'],
      summary: 'Das Unternehmen hat keine eigene Website. Idealer Kandidat für eine professionelle Web-Präsenz.'
    };
  }

  let html = '';
  let fetchError = null;

  try {
    html = await fetchHTML(url);
    html = html.substring(0, 8000);
  } catch (err) {
    fetchError = err.message;
  }

  if (fetchError) {
    return {
      isBadWebsite: true,
      score: 1,
      issues: ['Website nicht erreichbar oder extrem langsam'],
      summary: 'Die Website konnte nicht geladen werden – ein klares Zeichen für technische Mängel.'
    };
  }

  const client = new OpenAI({ apiKey });

  const prompt = `Du bist ein Webdesign-Experte und bewertest Schweizer Unternehmenswebsites als potenzielle Kunden für eine Webdesign-Agentur.

Bewerte diese Website nach folgenden Kriterien (gemäss Bewertungsrichtlinien):

1. DESIGN: Modern vs. veraltet (Flash, Tabellen-Layout, veraltete Fonts = schlecht)
2. STRUKTUR & UX: Klare Navigation, sinnvoller Aufbau, benutzerfreundlich?
3. MOBILE OPTIMIERUNG: Gibt es ein <meta name="viewport"> Tag? Responsives Design?
4. PERFORMANCE: Viele externe Scripts, riesige unoptimierte Bilder?
5. VORHANDENSEIN: Ist die Website professionell genug für ein Unternehmen?

URL: ${url}

HTML (Ausschnitt):
${html}

Antworte NUR mit diesem JSON (absolut kein anderer Text):
{
  "score": <0-10: 0=keine Website, 1-3=sehr veraltet/defekt, 4-5=schlecht, 6-7=mittelmässig, 8-10=modern und professionell>,
  "issues": [<max 4 konkrete Probleme auf Deutsch, z.B. "Kein responsives Design", "Veraltetes Tabellen-Layout", "Keine SSL-Verschlüsselung", "Extrem langsame Ladezeit">],
  "isBadWebsite": <true wenn score <= 5, sonst false>,
  "summary": "<1-2 Sätze auf Deutsch warum ein Redesign sinnvoll wäre. Konkret und überzeugend.>"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Du bist ein Webdesign-Experte. Antworte ausschliesslich mit validem JSON.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 400,
      temperature: 0.2
    });

    const content = completion.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Kein JSON');

    const result = JSON.parse(jsonMatch[0]);
    return {
      score: result.score ?? 3,
      issues: result.issues ?? [],
      isBadWebsite: (result.score ?? 3) <= 5,
      summary: result.summary ?? ''
    };
  } catch {
    return {
      isBadWebsite: true,
      score: 2,
      issues: ['Analyse nicht möglich – manuelle Prüfung empfohlen'],
      summary: 'Die automatische Analyse konnte nicht abgeschlossen werden.'
    };
  }
}

module.exports = { analyzeWebsite };
