const express = require('express');
const path = require('path');
const storage = require('./src/storage');
const { generateLeads, stopGeneration, replenishOne, getStatus } = require('./src/leadGenerator');


const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json());

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

app.put('/api/leads/:id/pipeline-status', async (req, res) => {
  try {
    const { status, note } = req.body;
    const lead = await storage.updatePipelineStatus(req.params.id, status, note);
    res.json({ success: true, lead });
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
    const current = await storage.getSettings();
    const incoming = req.body;
    // Don't overwrite key with masked value
    if (incoming.openaiKey && incoming.openaiKey.includes('••')) delete incoming.openaiKey;
    await storage.saveSettings({ ...current, ...incoming });
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

const server = app.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════╗`);
  console.log(`  ║   Lead Finder läuft               ║`);
  console.log(`  ║   → http://localhost:${PORT}        ║`);
  console.log(`  ╚═══════════════════════════════════╝\n`);
});

server.on('error', (err) => {
  console.error('[Server] Fehler:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] Port ${PORT} ist bereits belegt. Vorherige Instanz läuft noch?`);
  }
});
