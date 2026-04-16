const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEADS_FILE    = path.join(DATA_DIR, 'leads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CHECKED_FILE  = path.join(DATA_DIR, 'checked_urls.json');

// ── File lock (prevents concurrent read-modify-write races) ────────────────
// All mutating operations on the same file are serialized through this queue.
// Without this, two concurrent writes (e.g. auto-generate + user accepting a
// lead) would both read the same snapshot, then the last write would silently
// discard the first write's changes.
const _chains = new Map();

function withFileLock(file, fn) {
  const prev = _chains.get(file) ?? Promise.resolve();
  const next = prev.then(() => fn());
  // Store a failure-suppressed tail so one failed op doesn't block all future ops
  _chains.set(file, next.catch(() => {}));
  return next;
}

// ── Safe directory setup ────────────────────────────────────────────────────
async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// ── Atomic read with backup fallback ───────────────────────────────────────
// Never silently returns the default value for a file that EXISTS but is
// corrupt — that would cause a subsequent write to destroy all data.
async function readJSON(file, defaultValue) {
  // Try primary file
  try {
    const content = await fs.readFile(file, 'utf8');
    if (!content.trim()) throw new Error('empty file');
    return JSON.parse(content);
  } catch (primaryErr) {
    // File simply doesn't exist yet → use default (normal on first run)
    if (primaryErr.code === 'ENOENT') return defaultValue;

    // File exists but is corrupt → try backup before giving up
    try {
      const bak = await fs.readFile(file + '.bak', 'utf8');
      if (!bak.trim()) throw new Error('empty backup');
      const data = JSON.parse(bak);
      console.error(`[storage] WARNUNG: Primärdatei beschädigt, Backup geladen: ${file}`);
      return data;
    } catch {
      // Both primary and backup are gone/corrupt.
      // Throw so the caller cannot accidentally save an empty array over good data.
      throw new Error(
        `Datendatei beschädigt und kein Backup verfügbar: ${path.basename(file)}\n` +
        `Original-Fehler: ${primaryErr.message}`
      );
    }
  }
}

// ── Atomic write with backup ───────────────────────────────────────────────
// Writes to a .tmp file first, then rotates the old file to .bak, then renames
// .tmp → primary. A crash at any point leaves at least one valid file on disk.
async function writeJSON(file, data) {
  await ensureDataDir();
  const json = JSON.stringify(data, null, 2);
  const tmp = file + '.tmp';

  // 1. Write new content to temp file
  await fs.writeFile(tmp, json, 'utf8');

  // 2. Rotate current file → backup (ignore if current doesn't exist yet)
  try { await fs.copyFile(file, file + '.bak'); } catch {}

  // 3. Atomic rename: tmp → primary
  await fs.rename(tmp, file);
}

// ── Settings ───────────────────────────────────────────────────────────────
async function getSettings() {
  return readJSON(SETTINGS_FILE, {
    openaiKey: '',
    industry: 'Handwerker',
    autoGenerate: true
  });
}

async function saveSettings(settings) {
  return withFileLock(SETTINGS_FILE, async () => {
    const current = await readJSON(SETTINGS_FILE, {
      openaiKey: '',
      industry: 'Handwerker',
      autoGenerate: true
    });
    await writeJSON(SETTINGS_FILE, { ...current, ...settings });
  });
}

// ── Leads ──────────────────────────────────────────────────────────────────
async function getAllLeads() {
  return readJSON(LEADS_FILE, []);
}

// Internal: must be called inside a withFileLock(LEADS_FILE) block
async function _saveLeads(leads) {
  await writeJSON(LEADS_FILE, leads);
}

async function addLead(lead) {
  return withFileLock(LEADS_FILE, async () => {
    const leads = await readJSON(LEADS_FILE, []);
    leads.unshift(lead);
    await writeJSON(LEADS_FILE, leads);
  });
}

async function getPendingLeads() {
  const leads = await getAllLeads();
  return leads.filter(l => l.status === 'pending');
}

async function getLeadsByStatus(status) {
  const leads = await getAllLeads();
  return leads.filter(l => l.status === status);
}

async function updateLeadStatus(id, status) {
  return withFileLock(LEADS_FILE, async () => {
    const leads = await readJSON(LEADS_FILE, []);
    const lead = leads.find(l => l.id === id);
    if (lead) {
      lead.status = status;
      lead.updatedAt = new Date().toISOString();
      await writeJSON(LEADS_FILE, leads);
    }
    return lead;
  });
}

async function getStats() {
  const leads = await getAllLeads();
  return {
    total:    leads.length,
    pending:  leads.filter(l => l.status === 'pending').length,
    accepted: leads.filter(l => l.status === 'accepted').length,
    rejected: leads.filter(l => l.status === 'rejected').length
  };
}

// ── Checked URLs ───────────────────────────────────────────────────────────
function normalizeUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function getCheckedUrls() {
  return readJSON(CHECKED_FILE, {});
}

async function markUrlAsChecked(url, meta = {}) {
  return withFileLock(CHECKED_FILE, async () => {
    const checked = await readJSON(CHECKED_FILE, {});
    const key = normalizeUrl(url);
    if (!key) return;
    checked[key] = { checkedAt: new Date().toISOString(), ...meta };
    await writeJSON(CHECKED_FILE, checked);
  });
}

async function isUrlChecked(url) {
  const checked = await getCheckedUrls();
  const key = normalizeUrl(url);
  return key ? !!checked[key] : false;
}

async function getCheckedCount() {
  const checked = await getCheckedUrls();
  return Object.keys(checked).length;
}

// ── Pipeline ───────────────────────────────────────────────────────────────
async function addToPipeline(id) {
  return withFileLock(LEADS_FILE, async () => {
    const leads = await readJSON(LEADS_FILE, []);
    const lead = leads.find(l => l.id === id);
    if (lead) {
      lead.inPipeline = true;
      lead.pipelineStatus = lead.pipelineStatus || 'angerufen';
      lead.pipelineNote   = lead.pipelineNote   || '';
      lead.pipelineUpdatedAt = new Date().toISOString();
      await writeJSON(LEADS_FILE, leads);
    }
    return lead;
  });
}

async function removeFromPipeline(id) {
  return withFileLock(LEADS_FILE, async () => {
    const leads = await readJSON(LEADS_FILE, []);
    const lead = leads.find(l => l.id === id);
    if (lead) {
      lead.inPipeline    = false;
      lead.pipelineStatus = null;
      lead.pipelineNote   = '';
      lead.pipelineUpdatedAt = new Date().toISOString();
      await writeJSON(LEADS_FILE, leads);
    }
    return lead;
  });
}

async function updatePipelineStatus(id, status, note) {
  return withFileLock(LEADS_FILE, async () => {
    const leads = await readJSON(LEADS_FILE, []);
    const lead = leads.find(l => l.id === id);
    if (lead) {
      // Only overwrite pipelineStatus if a value was actually provided.
      // Sending only a note (no status) must never clear the current stage.
      if (status !== undefined) lead.pipelineStatus = status;
      if (note   !== undefined) lead.pipelineNote   = note;
      lead.pipelineUpdatedAt = new Date().toISOString();
      await writeJSON(LEADS_FILE, leads);
    }
    return lead;
  });
}

async function getPipelineLeads() {
  const leads = await getAllLeads();
  return leads.filter(l => l.inPipeline === true);
}

// ── Duplicate check ────────────────────────────────────────────────────────
async function leadExists(website, company) {
  if (website && await isUrlChecked(website)) return true;
  const leads = await getAllLeads();
  return leads.some(l => {
    if (company && l.company) {
      return l.company.toLowerCase().trim() === company.toLowerCase().trim();
    }
    return false;
  });
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
  getPipelineLeads
};
