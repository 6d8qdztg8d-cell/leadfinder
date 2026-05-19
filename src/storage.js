const path = require('path');

// Lazy-load db so tests / migration can skip it if needed
let _db = null;
function db() {
  if (!_db) _db = require('./database');
  return _db;
}

// ── Row → lead object ────────────────────────────────────────────────────────
function rowToLead(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    company:            row.company,
    website:            row.website,
    email:              row.email,
    phone:              row.phone,
    address:            row.address,
    screenshot:         row.screenshot,
    websiteScore:       row.website_score  ?? null,
    businessScore:      row.business_score ?? null,
    isGoodLead:         row.is_good_lead === 1,
    confidence:         row.confidence     ?? null,
    reasons:            safeJsonParse(row.reasons, []),
    summary:            row.summary || '',
    industry:           row.industry,
    category:           row.category,
    status:             row.status,
    inPipeline:         row.in_pipeline === 1,
    pipelineStatus:     row.pipeline_status,
    pipelineNote:       row.pipeline_note || '',
    pipelineUpdatedAt:  row.pipeline_updated_at,
    gmRating:           row.gm_rating,
    gmReviews:          row.gm_reviews,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at
  };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str || 'null') ?? fallback; } catch { return fallback; }
}

function normalizeUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  const rows = db().prepare('SELECT key, value FROM settings').all();
  const s = { openaiKey: '', industry: 'Handwerker', autoGenerate: true };
  for (const row of rows) {
    if (row.key === 'autoGenerate') s[row.key] = row.value === 'true';
    else s[row.key] = row.value;
  }
  return s;
}

async function saveSettings(incoming) {
  const upsert = db().prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  );
  const run = db().transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) {
      upsert.run(k, String(v));
    }
  });
  run(incoming);
}

// ── Leads ─────────────────────────────────────────────────────────────────────

async function getAllLeads() {
  return db().prepare('SELECT * FROM leads ORDER BY created_at DESC').all().map(rowToLead);
}

async function addLead(lead) {
  db().prepare(`
    INSERT INTO leads (
      id, company, website, email, phone, address, screenshot,
      website_score, business_score, is_good_lead, confidence,
      reasons, summary, industry, category, status,
      in_pipeline, pipeline_status, pipeline_note, pipeline_updated_at,
      gm_rating, gm_reviews, created_at, updated_at
    ) VALUES (
      @id, @company, @website, @email, @phone, @address, @screenshot,
      @website_score, @business_score, @is_good_lead, @confidence,
      @reasons, @summary, @industry, @category, @status,
      @in_pipeline, @pipeline_status, @pipeline_note, @pipeline_updated_at,
      @gm_rating, @gm_reviews, @created_at, @updated_at
    )
  `).run({
    id:                lead.id,
    company:           lead.company,
    website:           lead.website           ?? null,
    email:             lead.email             ?? null,
    phone:             lead.phone             ?? null,
    address:           lead.address           ?? null,
    screenshot:        lead.screenshot        ?? null,
    website_score:     lead.websiteScore      ?? null,
    business_score:    lead.businessScore     ?? null,
    is_good_lead:      lead.isGoodLead ? 1 : 0,
    confidence:        lead.confidence        ?? null,
    reasons:           JSON.stringify(lead.reasons ?? []),
    summary:           lead.summary           ?? '',
    industry:          lead.industry          ?? null,
    category:          lead.category          ?? null,
    status:            lead.status            ?? 'pending',
    in_pipeline:       lead.inPipeline ? 1 : 0,
    pipeline_status:   lead.pipelineStatus    ?? null,
    pipeline_note:     lead.pipelineNote      ?? '',
    pipeline_updated_at: lead.pipelineUpdatedAt ?? null,
    gm_rating:         lead.gmRating          ?? null,
    gm_reviews:        lead.gmReviews         ?? null,
    created_at:        lead.createdAt         ?? new Date().toISOString(),
    updated_at:        lead.updatedAt         ?? null
  });
}

async function getPendingLeads() {
  return db().prepare(
    "SELECT * FROM leads WHERE status = 'pending' ORDER BY created_at DESC"
  ).all().map(rowToLead);
}

async function getLeadsByStatus(status) {
  return db().prepare(
    'SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC'
  ).all(status).map(rowToLead);
}

async function updateLeadStatus(id, status) {
  db().prepare(
    'UPDATE leads SET status = ?, updated_at = ? WHERE id = ?'
  ).run(status, new Date().toISOString(), id);
  return rowToLead(db().prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

async function getStats() {
  const row = db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM leads
  `).get();
  return {
    total:    row.total    || 0,
    pending:  row.pending  || 0,
    accepted: row.accepted || 0,
    rejected: row.rejected || 0
  };
}

// ── Checked URLs ──────────────────────────────────────────────────────────────

async function getCheckedUrls() {
  const rows = db().prepare('SELECT * FROM checked_urls').all();
  const map = {};
  for (const r of rows) map[r.hostname] = { checkedAt: r.checked_at, company: r.company };
  return map;
}

async function markUrlAsChecked(url, meta = {}) {
  const hostname = normalizeUrl(url);
  if (!hostname) return;
  db().prepare(`
    INSERT INTO checked_urls(hostname, checked_at, company, has_screenshot)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      checked_at     = excluded.checked_at,
      company        = excluded.company,
      has_screenshot = excluded.has_screenshot
  `).run(
    hostname,
    new Date().toISOString(),
    meta.company ?? null,
    meta.hasScreenshot ? 1 : 0
  );
}

async function isUrlChecked(url) {
  const hostname = normalizeUrl(url);
  if (!hostname) return false;
  return !!db().prepare('SELECT 1 FROM checked_urls WHERE hostname = ?').get(hostname);
}

async function getCheckedCount() {
  return db().prepare('SELECT COUNT(*) as n FROM checked_urls').get().n;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function addToPipeline(id) {
  db().prepare(`
    UPDATE leads SET
      in_pipeline         = 1,
      pipeline_status     = COALESCE(NULLIF(pipeline_status,''), 'angerufen'),
      pipeline_note       = COALESCE(pipeline_note, ''),
      pipeline_updated_at = ?,
      updated_at          = ?
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), id);
  return rowToLead(db().prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

async function removeFromPipeline(id) {
  db().prepare(`
    UPDATE leads SET
      in_pipeline         = 0,
      pipeline_status     = NULL,
      pipeline_note       = '',
      pipeline_updated_at = ?,
      updated_at          = ?
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), id);
  return rowToLead(db().prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

async function updatePipelineStatus(id, status, note) {
  // Build update dynamically so passing only a note never clears the stage
  const sets = ['pipeline_updated_at = ?', 'updated_at = ?'];
  const vals = [new Date().toISOString(), new Date().toISOString()];

  if (status !== undefined) { sets.push('pipeline_status = ?'); vals.push(status); }
  if (note   !== undefined) { sets.push('pipeline_note = ?');   vals.push(note); }

  vals.push(id);
  db().prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return rowToLead(db().prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

async function getPipelineLeads() {
  return db().prepare(
    'SELECT * FROM leads WHERE in_pipeline = 1 ORDER BY pipeline_updated_at DESC'
  ).all().map(rowToLead);
}

// ── Duplicate check ───────────────────────────────────────────────────────────

async function leadExists(website, company) {
  if (website && await isUrlChecked(website)) return true;
  if (!company) return false;
  const row = db().prepare(
    'SELECT 1 FROM leads WHERE LOWER(TRIM(company)) = LOWER(TRIM(?)) LIMIT 1'
  ).get(company);
  return !!row;
}

// ── JSON → SQLite migration (runs once on first startup) ─────────────────────

async function migrateFromJson() {
  const fs   = require('fs').promises;
  const path = require('path');

  const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const LEADS_FILE   = path.join(DATA_DIR, 'leads.json');
  const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
  const CHECKED_FILE  = path.join(DATA_DIR, 'checked_urls.json');

  // Only migrate if DB is empty
  const count = db().prepare('SELECT COUNT(*) as n FROM leads').get().n;
  if (count > 0) return;

  let migrated = 0;

  // leads.json
  try {
    const raw = await fs.readFile(LEADS_FILE, 'utf8');
    const leads = JSON.parse(raw);
    if (Array.isArray(leads) && leads.length) {
      const insertMany = db().transaction((arr) => {
        for (const l of arr) {
          try { db().prepare(`
            INSERT OR IGNORE INTO leads (
              id, company, website, email, phone, address, screenshot,
              website_score, business_score, is_good_lead, confidence,
              reasons, summary, industry, category, status,
              in_pipeline, pipeline_status, pipeline_note, pipeline_updated_at,
              gm_rating, gm_reviews, created_at, updated_at
            ) VALUES (
              @id,@company,@website,@email,@phone,@address,@screenshot,
              @website_score,@business_score,@is_good_lead,@confidence,
              @reasons,@summary,@industry,@category,@status,
              @in_pipeline,@pipeline_status,@pipeline_note,@pipeline_updated_at,
              @gm_rating,@gm_reviews,@created_at,@updated_at
            )`).run({
              id:                l.id,
              company:           l.company,
              website:           l.website           ?? null,
              email:             l.email             ?? null,
              phone:             l.phone             ?? null,
              address:           l.address           ?? null,
              screenshot:        l.screenshot        ?? null,
              website_score:     l.websiteScore      ?? null,
              business_score:    l.businessScore     ?? null,
              is_good_lead:      l.isGoodLead ? 1 : 0,
              confidence:        l.confidence        ?? null,
              reasons:           JSON.stringify(l.reasons ?? []),
              summary:           l.summary           ?? '',
              industry:          l.industry          ?? null,
              category:          l.category          ?? null,
              status:            l.status            ?? 'pending',
              in_pipeline:       l.inPipeline ? 1 : 0,
              pipeline_status:   l.pipelineStatus    ?? null,
              pipeline_note:     l.pipelineNote      ?? '',
              pipeline_updated_at: l.pipelineUpdatedAt ?? null,
              gm_rating:         l.gmRating          ?? null,
              gm_reviews:        l.gmReviews         ?? null,
              created_at:        l.createdAt         ?? new Date().toISOString(),
              updated_at:        l.updatedAt         ?? null
            });
            migrated++;
          } catch { /* skip duplicate / corrupt */ }
        }
      });
      insertMany(leads);
      console.log(`[migration] ${migrated} Leads aus leads.json importiert`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[migration] leads.json:', e.message);
  }

  // settings.json
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const s = JSON.parse(raw);
    const upsert = db().prepare(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    );
    const run = db().transaction((obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v !== null && v !== undefined) upsert.run(k, String(v));
      }
    });
    run(s);
    console.log('[migration] settings.json importiert');
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[migration] settings.json:', e.message);
  }

  // checked_urls.json
  try {
    const raw = await fs.readFile(CHECKED_FILE, 'utf8');
    const urls = JSON.parse(raw);
    if (typeof urls === 'object' && urls) {
      const ins = db().prepare(
        'INSERT OR IGNORE INTO checked_urls(hostname,checked_at,company,has_screenshot) VALUES(?,?,?,?)'
      );
      const run = db().transaction((obj) => {
        for (const [hostname, meta] of Object.entries(obj)) {
          ins.run(hostname, meta.checkedAt || new Date().toISOString(), meta.company ?? null, meta.hasScreenshot ? 1 : 0);
        }
      });
      run(urls);
      console.log(`[migration] ${Object.keys(urls).length} geprüfte URLs importiert`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[migration] checked_urls.json:', e.message);
  }
}

module.exports = {
  getSettings,
  saveSettings,
  getAllLeads,
  addLead,
  getPendingLeads,
  getLeadsByStatus,
  updateLeadStatus,
  getStats,
  leadExists,
  markUrlAsChecked,
  isUrlChecked,
  getCheckedCount,
  addToPipeline,
  removeFromPipeline,
  updatePipelineStatus,
  getPipelineLeads,
  migrateFromJson
};
