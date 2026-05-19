require('dotenv').config();
const express = require('express');
const path = require('path');
const storage = require('./src/storage');
const { generateLeads, stopGeneration, replenishOne, getStatus } = require('./src/leadGenerator');

const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json());

// ── Optional HTTP Basic Auth ──────────────────────────────────────────────────
// Set ADMIN_PASSWORD env var to enable password protection.
if (process.env.ADMIN_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      if (pass === process.env.ADMIN_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="LeadFinder"');
    res.status(401).send('Zugangsdaten erforderlich');
  });
}

const publicDir      = process.env.PUBLIC_DIR      || path.join(__dirname, 'public');
const screenshotsDir = process.env.SCREENSHOTS_DIR || path.join(__dirname, 'public', 'screenshots');

app.use('/screenshots', express.static(screenshotsDir));
app.use(express.static(publicDir));

// ──────────────────────────────────────────────
// Leads
// ──────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await storage.getPendingLeads();
    res.json(leads.slice(0, 20)); // max 20 pending shown
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/accepted', async (req, res) => {
  try {
    res.json(await storage.getLeadsByStatus('accepted'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/rejected', async (req, res) => {
  try {
    res.json(await storage.getLeadsByStatus('rejected'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:id/accept', async (req, res) => {
  try {
    const lead = await storage.updateLeadStatus(req.params.id, 'accepted');
    replenishOne(); // fire & forget
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:id/reject', async (req, res) => {
  try {
    const lead = await storage.updateLeadStatus(req.params.id, 'rejected');
    replenishOne(); // fire & forget
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// Pipeline
// ──────────────────────────────────────────────
app.get('/api/pipeline', async (req, res) => {
  try { res.json(await storage.getPipelineLeads()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/leads/:id/pipeline', async (req, res) => {
  try {
    const lead = await storage.addToPipeline(req.params.id);
    res.json({ success: true, lead });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/leads/:id/pipeline', async (req, res) => {
  try {
    const lead = await storage.removeFromPipeline(req.params.id);
    res.json({ success: true, lead });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const VALID_PIPELINE_STAGES = ['angerufen', 'interesse', 'angebot', 'vertrag', 'abgeschlossen'];

app.put('/api/leads/:id/pipeline-status', async (req, res) => {
  try {
    const { status, note } = req.body;
    // Reject unknown stage values — an invalid stage makes the lead invisible in all columns
    if (status !== undefined && !VALID_PIPELINE_STAGES.includes(status)) {
      return res.status(400).json({ error: `Ungültiger Pipeline-Status: ${status}` });
    }
    const lead = await storage.updatePipelineStatus(req.params.id, status, note);
    res.json({ success: true, lead });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pipeline/export-csv', async (req, res) => {
  try {
    const leads = await storage.getPipelineLeads();
    const done = leads.filter(l => l.pipelineStatus === 'abgeschlossen');

    const escape = v => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const header = ['Firma', 'Website', 'E-Mail', 'Telefon', 'Notiz', 'Abgeschlossen am'].join(',');
    const rows = done.map(l => [
      escape(l.company),
      escape(l.website),
      escape(l.email),
      escape(l.phone),
      escape(l.pipelineNote),
      escape(l.pipelineUpdatedAt ? new Date(l.pipelineUpdatedAt).toLocaleString('de-CH') : '')
    ].join(','));

    const csv = [header, ...rows].join('\r\n');
    const filename = `abgeschlossen_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM für Excel
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────
// Generation
// ──────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const settings = await storage.getSettings();
  if (!settings.openaiKey) return res.status(400).json({ error: 'OpenAI API Key fehlt – bitte in Einstellungen eintragen.' });
  generateLeads().catch(err => console.error('[Generate]', err.message));
  res.json({ success: true, message: 'Suche gestartet' });
});

app.post('/api/stop', (req, res) => {
  stopGeneration();
  res.json({ success: true, message: 'Stopp-Signal gesendet' });
});

app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

// ──────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await storage.getStats();
    stats.checkedUrls = await storage.getCheckedCount();
    const pipeline = await storage.getPipelineLeads();
    stats.pipeline = pipeline.length;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const s = await storage.getSettings();
    // Mask key for security
    res.json({
      ...s,
      openaiKey:    s.openaiKey ? '••••••••' + s.openaiKey.slice(-4) : '',
      hasOpenaiKey: !!s.openaiKey
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const incoming = req.body;
    // Don't overwrite key with masked value or empty string
    if (!incoming.openaiKey || incoming.openaiKey.includes('••')) delete incoming.openaiKey;
    // saveSettings handles the merge internally under a file lock
    await storage.saveSettings(incoming);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// SPA fallback
// ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Startup: migrate JSON → SQLite, then listen ───────────────────────────────
function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`\n  ╔═══════════════════════════════════╗`);
    console.log(`  ║   Lead Finder läuft               ║`);
    console.log(`  ║   → http://localhost:${PORT}        ║`);
    console.log(`  ╚═══════════════════════════════════╝\n`);
  });
  server.on('error', (err) => {
    console.error('[Server] Fehler:', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} ist bereits belegt.`);
    }
  });
}

const migrationTimeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Migration timeout (5s)')), 5000)
);

Promise.race([storage.migrateFromJson(), migrationTimeout])
  .catch(err => console.warn('[migration] Übersprungen:', err.message))
  .finally(startServer);

