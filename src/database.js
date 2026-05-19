const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'leadfinder.db'));

// WAL = Write-Ahead Logging → crash-safe, concurrent reads, no corruption
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY,
    company         TEXT NOT NULL,
    website         TEXT,
    email           TEXT,
    phone           TEXT,
    address         TEXT,
    screenshot      TEXT,
    website_score   INTEGER,
    business_score  INTEGER,
    is_good_lead    INTEGER DEFAULT 0,
    confidence      INTEGER,
    reasons         TEXT DEFAULT '[]',
    summary         TEXT DEFAULT '',
    industry        TEXT,
    category        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    in_pipeline     INTEGER NOT NULL DEFAULT 0,
    pipeline_status TEXT,
    pipeline_note   TEXT DEFAULT '',
    pipeline_updated_at TEXT,
    gm_rating       REAL,
    gm_reviews      INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(in_pipeline);
  CREATE INDEX IF NOT EXISTS idx_leads_created  ON leads(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_company  ON leads(company);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checked_urls (
    hostname      TEXT PRIMARY KEY,
    checked_at    TEXT NOT NULL,
    company       TEXT,
    has_screenshot INTEGER DEFAULT 0
  );
`);

module.exports = db;
