const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(__dirname, '..', 'data');
const LEADS_FILE    = path.join(DATA_DIR, 'leads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CHECKED_FILE  = path.join(DATA_DIR, 'checked_urls.json'); // bereits geprüfte URLs

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJSON(file, defaultValue) {
  try {
    const content = await fs.readFile(file, 'utf8');
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

async function writeJSON(file, data) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Settings ───────────────────────────────────────────
async function getSettings() {
  return readJSON(SETTINGS_FILE, {
    openaiKey: '',
    googleMapsKey: '',
    industry: 'Handwerker',
    autoGenerate: true
  });
}

async function saveSettings(settings) {
  const current = await getSettings();
  await writeJSON(SETTINGS_FILE, { ...current, ...settings });
}

// ── Leads ──────────────────────────────────────────────
async function getAllLeads() {
  return readJSON(LEADS_FILE, []);
}

async function saveLeads(leads) {
  await writeJSON(LEADS_FILE, leads);
}

async function addLead(lead) {
  const leads = await getAllLeads();
  leads.unshift(lead);
  await saveLeads(leads);
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
  const leads = await getAllLeads();
  const lead = leads.find(l => l.id === id);
  if (lead) {
    lead.status = status;
    lead.updatedAt = new Date().toISOString();
    await saveLeads(leads);
  }
  return lead;
}

async function getStats() {
  const leads = await getAllLeads();
  return {
    total: leads.length,
    pending:  leads.filter(l => l.status === 'pending').length,
    accepted: leads.filter(l => l.status === 'accepted').length,
    rejected: leads.filter(l => l.status === 'rejected').length
  };
}

// ── Checked URLs Datenbank ─────────────────────────────
// Speichert JEDE geprüfte URL (egal ob gut oder schlecht)
// damit sie nie doppelt analysiert wird

function normalizeUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function getCheckedUrls() {
  return readJSON(CHECKED_FILE, {}); // { "domain.ch": { checkedAt, score, company } }
}

async function markUrlAsChecked(url, meta = {}) {
  const checked = await getCheckedUrls();
  const key = normalizeUrl(url);
  if (!key) return;
  checked[key] = {
    checkedAt: new Date().toISOString(),
    ...meta
  };
  await writeJSON(CHECKED_FILE, checked);
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

// Altes leadExists bleibt für Kompatibilität
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
  getCheckedCount
};
