/* ──────────────────────────────────────────────────────
   Lead Finder — Frontend
────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────
let currentPage = 'leads';
let pollTimer = null;
let statusTimer = null;
let activeFilter = 'alle';
let allLeads = [];

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupButtons();
  loadPage('leads');
  loadStats();
  startPolling();
});

// ── Navigation ─────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  loadPage(page);
}

// ── Page loading ────────────────────────────────────────
async function loadPage(page) {
  switch (page) {
    case 'leads':    await loadLeads(); break;
    case 'accepted': await loadLeadsByStatus('accepted'); break;
    case 'rejected': await loadLeadsByStatus('rejected'); break;
    case 'pipeline': await loadPipeline(); break;
    case 'settings': await loadSettings(); break;
  }
}

// ── Polling ─────────────────────────────────────────────
function startPolling() {
  // Refresh leads and stats every 4 seconds
  pollTimer = setInterval(async () => {
    if (currentPage === 'leads') await loadLeads();
    await loadStats();
  }, 4000);

  // Check generation status every 1.5 seconds
  statusTimer = setInterval(checkGenerationStatus, 1500);
}

// ── Stats ───────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await apiFetch('/api/stats');
    document.getElementById('badge-pending').textContent  = s.pending;
    document.getElementById('badge-accepted').textContent = s.accepted;
    document.getElementById('badge-rejected').textContent = s.rejected;
    document.getElementById('badge-pipeline').textContent = s.pipeline || 0;
    document.getElementById('s-total').textContent    = s.total;
    document.getElementById('s-accepted').textContent = s.accepted;
    document.getElementById('s-checked').textContent  = s.checkedUrls || 0;
  } catch {}
}

// ── Generation status ────────────────────────────────────
async function checkGenerationStatus() {
  try {
    const status = await apiFetch('/api/status');
    const banner = document.getElementById('gen-banner');
    const sidebarStatus = document.getElementById('sidebar-status');

    const btnGen = document.getElementById('btn-generate');

    if (status.running) {
      banner.style.display = 'flex';
      document.getElementById('gen-message').textContent = status.message || 'Suche läuft…';
      document.getElementById('gen-count').textContent = status.total ? `${status.total} gefunden` : '';

      sidebarStatus.innerHTML = `
        <div class="status-running">
          <span class="status-dot dot-running"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;">${status.message || 'Läuft…'}</span>
        </div>`;

      btnGen.disabled = true;
      btnGen.innerHTML = `<span style="opacity:.5">Suche läuft…</span>`;
    } else {
      banner.style.display = 'none';
      sidebarStatus.innerHTML = `
        <div class="status-idle">
          <span class="status-dot dot-idle"></span>
          Bereit
        </div>`;
      btnGen.disabled = false;
      btnGen.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Suche starten`;
    }
  } catch {}
}

// ── Filter ───────────────────────────────────────────────
const INDUSTRY_FILTERS = ['Handwerker', 'Friseur', 'Restaurant', 'Autowerkstatt', 'Bäckerei', 'Arztpraxis', 'Reinigung', 'Coiffeur', 'Maler'];

async function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderLeadsGrid();

  // Industrie-Chips: nur Einstellung speichern, Suche NICHT unterbrechen
  if (INDUSTRY_FILTERS.includes(filter)) {
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: filter })
    });
  }
}

function applyFilter(leads) {
  if (activeFilter === 'alle') return leads;
  if (activeFilter === 'good') return leads.filter(l => l.isGoodLead === true);
  return leads.filter(l => {
    const ind = (l.industry || l.searchQuery || '').toLowerCase();
    return ind.includes(activeFilter.toLowerCase());
  });
}

function renderLeadsGrid() {
  const grid  = document.getElementById('leads-grid');
  const empty = document.getElementById('empty-state');
  const filtered = applyFilter(allLeads);

  if (!filtered.length) {
    grid.innerHTML = '';
    if (!allLeads.length) empty.style.display = 'flex';
    else empty.style.display = 'none'; // leads exist but filtered out
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = filtered.map(l => buildCard(l, true)).join('');
}

// ── Load leads (pending) ─────────────────────────────────
async function loadLeads() {
  try {
    const leads = await apiFetch('/api/leads');
    const empty = document.getElementById('empty-state');

    // Check if new leads arrived
    const prevIds = allLeads.map(l => l.id).join(',');
    const newIds  = leads.map(l => l.id).join(',');
    if (prevIds === newIds) return; // nichts geändert

    allLeads = leads;

    if (!leads.length) {
      empty.style.display = 'flex';
      document.getElementById('leads-grid').innerHTML = '';
      return;
    }

    empty.style.display = 'none';
    renderLeadsGrid();

  } catch (err) {
    console.error('loadLeads:', err);
  }
}

// ── Load accepted / rejected ──────────────────────────────
async function loadLeadsByStatus(status) {
  try {
    const leads = await apiFetch(`/api/leads/${status}`);
    const grid  = document.getElementById(`${status}-grid`);
    const empty = document.getElementById(`${status}-empty`);

    if (!leads.length) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';
    grid.innerHTML = leads.map(l => buildCard(l, false, status)).join('');
  } catch (err) {
    console.error(`load ${status}:`, err);
  }
}

// ── Build lead card HTML ─────────────────────────────────
function buildCard(lead, showActions = true, extraClass = '') {
  // Dual score system
  const webScore = lead.websiteScore  ?? null;
  const bizScore = lead.businessScore ?? null;
  const isGood   = lead.isGoodLead;
  const conf     = lead.confidence ?? null;

  // Colors
  function scoreColor(s) {
    if (s == null) return 'var(--text-muted)';
    if (s < 40)  return 'var(--score-bad)';
    if (s < 65)  return 'var(--score-mid)';
    if (s < 80)  return '#e0b830';
    return 'var(--score-ok)';
  }

  const goodLeadBadge = isGood === true
    ? `<span class="lead-badge badge-good">✓ Guter Lead</span>`
    : isGood === false
      ? `<span class="lead-badge badge-weak">Schwacher Lead</span>`
      : '';

  // Score bars (only if new format)
  const dualScoreHTML = webScore != null ? `
    <div class="dual-score">
      <div class="dscore-row">
        <span class="dscore-label">Website</span>
        <div class="dscore-bar-track">
          <div class="dscore-bar-fill" style="width:${webScore}%;background:${scoreColor(webScore)}"></div>
        </div>
        <span class="dscore-val" style="color:${scoreColor(webScore)}">${webScore}</span>
      </div>
      <div class="dscore-row">
        <span class="dscore-label">Business</span>
        <div class="dscore-bar-track">
          <div class="dscore-bar-fill" style="width:${bizScore}%;background:${scoreColor(bizScore)}"></div>
        </div>
        <span class="dscore-val" style="color:${scoreColor(bizScore)}">${bizScore}</span>
      </div>
      ${conf != null ? `<div class="dscore-conf">Konfidenz: ${conf}%</div>` : ''}
    </div>` : '';

  // Screenshot
  const screenshotHTML = lead.screenshot
    ? `<img src="${lead.screenshot}" alt="${esc(lead.company)}" loading="lazy" onerror="this.parentElement.innerHTML=noScreenshotHTML()">
       <div class="screenshot-overlay"></div>
       <span class="screenshot-zoom-hint">⤢ Vollbild</span>`
    : `<div class="screenshot-placeholder">
         <span class="placeholder-icon">◻</span>
         <span class="placeholder-text">Screenshot nicht verfügbar</span>
       </div>`;

  const screenshotClick = lead.screenshot
    ? `onclick="openModal('${lead.screenshot}', '${esc(lead.company)}')"` : '';

  // Meta rows
  const websiteRow = lead.website
    ? `<div class="meta-row"><span class="meta-icon">🌐</span><span class="meta-val"><a href="${lead.website}" target="_blank" rel="noopener">${fmtUrl(lead.website)}</a></span></div>` : '';
  const emailRow = lead.email
    ? `<div class="meta-row"><span class="meta-icon">✉</span><span class="meta-val">${esc(lead.email)}</span><button class="meta-copy" onclick="copyText('${esc(lead.email)}', this)">⎘</button></div>` : '';
  const phoneRow = lead.phone
    ? `<div class="meta-row"><span class="meta-icon">☎</span><span class="meta-val">${esc(lead.phone)}</span><button class="meta-copy" onclick="copyText('${esc(lead.phone)}', this)">⎘</button></div>` : '';
  const addressRow = lead.address
    ? `<div class="meta-row"><span class="meta-icon">📍</span><span class="meta-val">${esc(lead.address)}</span></div>` : '';

  // Reasons / Issues
  const items = lead.reasons?.length ? lead.reasons : (lead.issues || []);
  const issuesHTML = items.slice(0, 4).map(i => `<span class="issue-tag">${esc(i)}</span>`).join('');

  // Actions
  const actionsHTML = showActions
    ? `<div class="card-actions">
         <button class="btn-accept" onclick="acceptLead('${lead.id}', this)">✓ Annehmen</button>
         <button class="btn-reject" onclick="rejectLead('${lead.id}', this)">✗ Ablehnen</button>
       </div>` : '';

  // Pipeline button for accepted cards
  const pipelineHTML = extraClass === 'accepted'
    ? lead.inPipeline
      ? `<div class="card-pipeline-action"><span class="pipeline-badge">In Pipeline ✓</span></div>`
      : `<div class="card-pipeline-action"><button class="btn-pipeline" onclick="addLeadToPipeline('${lead.id}')">+ Pipeline hinzufügen</button></div>`
    : '';

  return `
    <div class="lead-card ${extraClass ? extraClass + '-card' : ''} ${isGood ? 'card-good-lead' : ''}" data-id="${lead.id}">
      <div class="card-screenshot" ${screenshotClick}>
        ${screenshotHTML}
        ${goodLeadBadge ? `<div class="card-badge-overlay">${goodLeadBadge}</div>` : ''}
      </div>
      <div class="card-body">
        <div class="card-company">${esc(lead.company)}</div>
        ${dualScoreHTML}
        <div class="card-meta">${websiteRow}${emailRow}${phoneRow}${addressRow}</div>
        ${issuesHTML ? `<div class="card-issues">${issuesHTML}</div>` : ''}
        ${lead.summary ? `<div class="card-summary">${esc(lead.summary)}</div>` : ''}
      </div>
      ${actionsHTML}
      ${pipelineHTML}
    </div>`;
}

function noScreenshotHTML() {
  return `<div class="screenshot-placeholder"><span class="placeholder-icon">◻</span><span class="placeholder-text">Screenshot nicht verfügbar</span></div>`;
}

// ── Accept / Reject ──────────────────────────────────────
async function acceptLead(id, btn) {
  disableCardButtons(btn);
  try {
    await apiFetch(`/api/leads/${id}/accept`, { method: 'POST' });
    removeCard(id);
    showToast('Lead angenommen ✓', 'success');
    await loadStats();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
    enableCardButtons(btn);
  }
}

async function rejectLead(id, btn) {
  disableCardButtons(btn);
  try {
    await apiFetch(`/api/leads/${id}/reject`, { method: 'POST' });
    removeCard(id);
    showToast('Lead abgelehnt', '');
    await loadStats();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
    enableCardButtons(btn);
  }
}

function disableCardButtons(btn) {
  const card = btn.closest('.lead-card');
  card.querySelectorAll('button').forEach(b => b.disabled = true);
}

function enableCardButtons(btn) {
  const card = btn.closest('.lead-card');
  card.querySelectorAll('button').forEach(b => b.disabled = false);
}

function removeCard(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    setTimeout(() => card.remove(), 300);
  }
}

// ── Generate / Stop ──────────────────────────────────────
async function handleGenerate() {
  try {
    await apiFetch('/api/generate', { method: 'POST' });
    showToast('Suche gestartet — läuft bis du stoppst', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    if (err.message && err.message.includes('Key')) {
      setTimeout(() => navigateTo('settings'), 500);
    }
  }
}

async function handleStop() {
  try {
    await apiFetch('/api/stop', { method: 'POST' });
    showToast('Stopp-Signal gesendet…', '');
  } catch (err) {
    showToast('Fehler beim Stoppen: ' + err.message, 'error');
  }
}

function setupButtons() {
  document.getElementById('btn-generate').addEventListener('click', handleGenerate);
  document.getElementById('btn-save').addEventListener('click', saveSettings);
}

// ── Settings ─────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await apiFetch('/api/settings');

    document.getElementById('location').value = s.location || '';
    document.getElementById('industry').value = s.industry || '';

    // Keys: show placeholder based on whether they're set
    const openaiInput = document.getElementById('openaiKey');

    openaiInput.placeholder = s.hasOpenaiKey ? '••••• (gesetzt – neu eingeben zum Ändern)' : 'sk-proj-…';
    openaiInput.value = '';

    updateKeyStatus('openai-status', s.hasOpenaiKey, 'OpenAI Key gesetzt ✓', 'OpenAI Key fehlt!');
  } catch (err) {
    showToast('Einstellungen konnten nicht geladen werden', 'error');
  }
}

function updateKeyStatus(id, isSet, okText, missingText) {
  const el = document.getElementById(id);
  el.textContent = isSet ? okText : missingText;
  el.className = 'key-status ' + (isSet ? 'set' : 'missing');
}

async function saveSettings() {
  const payload = {
    location: document.getElementById('location').value.trim(),
    industry: document.getElementById('industry').value.trim()
  };

  const openaiVal = document.getElementById('openaiKey').value.trim();
  if (openaiVal) payload.openaiKey = openaiVal;

  try {
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });

    // Show feedback
    const fb = document.getElementById('save-feedback');
    fb.textContent = '✓ Gespeichert';
    fb.classList.add('visible');
    setTimeout(() => fb.classList.remove('visible'), 2500);

    showToast('Einstellungen gespeichert', 'success');
    // Reload to show updated status
    await loadSettings();
  } catch (err) {
    showToast('Fehler beim Speichern: ' + err.message, 'error');
  }
}

function setIndustry(val) {
  document.getElementById('industry').value = val;
}

// ── Modal ─────────────────────────────────────────────────
function openModal(src, company) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-img').src = src;
  document.getElementById('modal-info').textContent = company;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Toggle password visibility ────────────────────────────
function toggleVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.style.color = 'var(--accent)';
  } else {
    input.type = 'password';
    btn.style.color = '';
  }
}

// ── Copy to clipboard ─────────────────────────────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = '✓';
    btn.style.color = 'var(--accent)';
    setTimeout(() => { btn.textContent = prev; btn.style.color = ''; }, 1500);
  } catch {
    showToast('Kopieren fehlgeschlagen', 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────
function showToast(message, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// ── Helpers ───────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Pipeline ──────────────────────────────────────────────

const PIPELINE_STAGES = ['angerufen', 'interesse', 'angebot', 'vertrag', 'abgeschlossen'];
const PIPELINE_LABELS = {
  angerufen:    '📞 Angerufen',
  interesse:    '✨ Interesse',
  angebot:      '📄 Angebot',
  vertrag:      '✍️ Vertrag',
  abgeschlossen:'✅ Abgeschlossen'
};

async function loadPipeline() {
  try {
    const leads = await apiFetch('/api/pipeline');
    const board = document.getElementById('pipeline-board');
    const empty = document.getElementById('pipeline-empty');

    if (!leads.length) {
      board.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    const doneCount = leads.filter(l => l.pipelineStatus === 'abgeschlossen').length;
    board.innerHTML = PIPELINE_STAGES.map(stage => {
      if (stage === 'abgeschlossen') {
        return `
          <div class="pipeline-column pipeline-column-done">
            <div class="pipeline-done-panel">
              <div class="pipeline-done-count">${doneCount}</div>
              <div class="pipeline-done-label">Abgeschlossen</div>
              <button class="btn-csv-export" onclick="exportPipelineCSV()">
                ⬇ CSV exportieren
              </button>
            </div>
          </div>`;
      }
      const stageLeads = leads.filter(l => l.pipelineStatus === stage);
      return `
        <div class="pipeline-column">
          ${stageLeads.length
            ? stageLeads.map(l => buildPipelineCard(l)).join('')
            : '<div class="pipeline-col-empty">—</div>'}
        </div>`;
    }).join('');
  } catch (err) {
    console.error('loadPipeline:', err);
  }
}

function buildPipelineCard(lead) {
  const currentIdx = PIPELINE_STAGES.indexOf(lead.pipelineStatus);

  const stepsHTML = PIPELINE_STAGES.map((s, i) => {
    const isActive  = i <= currentIdx;
    const isCurrent = s === lead.pipelineStatus;
    const dot = `<button class="pipeline-step ${isActive ? 'step-active' : ''} ${isCurrent ? 'step-current' : ''}"
      onclick="setPipelineStatus('${lead.id}', '${s}')" title="${PIPELINE_LABELS[s]}"></button>`;
    const connector = i < PIPELINE_STAGES.length - 1
      ? `<div class="step-connector ${i < currentIdx ? 'connector-active' : ''}"></div>` : '';
    return dot + connector;
  }).join('');

  const websiteRow = lead.website
    ? `<a href="${lead.website}" target="_blank" rel="noopener">${fmtUrl(lead.website)}</a>` : '';
  const phoneRow = lead.phone ? `<span>☎ ${esc(lead.phone)}</span>` : '';

  return `
    <div class="pipeline-card" data-id="${lead.id}">
      <div class="pipeline-card-header">
        <div class="pipeline-card-company">${esc(lead.company)}</div>
        <button class="btn-pipeline-remove" onclick="removeFromPipeline('${lead.id}')" title="Aus Pipeline entfernen">✕</button>
      </div>
      ${websiteRow || phoneRow ? `<div class="pipeline-card-meta">${websiteRow}${phoneRow}</div>` : ''}
      <div class="pipeline-steps-track">${stepsHTML}</div>
      <textarea class="pipeline-note" placeholder="Notiz…"
        onblur="savePipelineNote('${lead.id}', this)">${esc(lead.pipelineNote || '')}</textarea>
    </div>`;
}

async function setPipelineStatus(id, status) {
  try {
    await apiFetch(`/api/leads/${id}/pipeline-status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    await loadPipeline();
    await loadStats();
    showToast(`Status: ${PIPELINE_LABELS[status] || status}`, 'success');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function savePipelineNote(id, textarea) {
  try {
    await apiFetch(`/api/leads/${id}/pipeline-status`, {
      method: 'PUT',
      body: JSON.stringify({ note: textarea.value })
    });
  } catch {}
}

async function removeFromPipeline(id) {
  try {
    await apiFetch(`/api/leads/${id}/pipeline`, { method: 'DELETE' });
    await loadPipeline();
    await loadStats();
    showToast('Aus Pipeline entfernt', 'success');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function exportPipelineCSV() {
  const a = document.createElement('a');
  a.href = '/api/pipeline/export-csv';
  a.download = '';
  a.click();
}

async function addLeadToPipeline(id) {
  try {
    await apiFetch(`/api/leads/${id}/pipeline`, { method: 'POST' });
    showToast('Zur Pipeline hinzugefügt ✓', 'success');
    await loadLeadsByStatus('accepted');
    await loadStats();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}
