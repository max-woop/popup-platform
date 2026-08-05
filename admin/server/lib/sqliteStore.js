'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ingestion.db');
// Sibling of data/, not inside it — see the same note in store.js.
const SEED_PATH = path.join(__dirname, '..', 'seed.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Popups table stands in for the PostgreSQL + JSONB layer described in §3.1.
// `body` holds the full popup document (content, targeting, trigger,
// frequency, devices) as JSON — the columns that exist outside it are the
// ones we actually need to query/filter/sort by.
db.exec(`
  CREATE TABLE IF NOT EXISTS popups (
    id           TEXT PRIMARY KEY,
    external_id  TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    template     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'live',
    priority     INTEGER NOT NULL DEFAULT 50,
    body         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key           TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    body_hash     TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (key, external_id)
  );

  CREATE TABLE IF NOT EXISTS hmac_keys (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    secret     TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingest_audit (
    id          TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    action      TEXT NOT NULL,
    key_id      TEXT,
    status_code INTEGER NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL
  );

  -- §14.1/§14.2 — one row per SDK event. Raw retention is 90 days per
  -- §14.3; nothing here enforces that automatically, it's a prototype.
  CREATE TABLE IF NOT EXISTS raw_events (
    id            TEXT PRIMARY KEY,
    popup_id      TEXT NOT NULL,
    impression_id TEXT NOT NULL,
    type          TEXT NOT NULL,
    page_url      TEXT,
    device        TEXT,
    session_id    TEXT,
    legal_version TEXT,
    field_id      TEXT,
    element_id    TEXT,
    occurred_at   TEXT NOT NULL,
    received_at   TEXT NOT NULL,
    origin        TEXT,
    ip_hash       TEXT,
    referrer      TEXT,
    country       TEXT,
    UNIQUE (impression_id, type, field_id, element_id)
  );
  CREATE INDEX IF NOT EXISTS idx_raw_events_popup_date ON raw_events (popup_id, occurred_at);
`);

// referrer/country were added after raw_events already shipped — CREATE
// TABLE IF NOT EXISTS above is a no-op against a database file that already
// has the table, so a database from before this change needs these columns
// added explicitly. Safe to run every boot: the catch is just "already there."
['referrer', 'country'].forEach(function (col) {
  try { db.exec('ALTER TABLE raw_events ADD COLUMN ' + col + ' TEXT'); } catch (e) { /* column already exists */ }
});

function rowToPopup(row) {
  if (!row) return null;
  const body = JSON.parse(row.body);
  return Object.assign({
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    template: row.template,
    status: row.status,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at
  }, body);
}

function popupToRow(popup) {
  const { id, external_id, name, template, status, priority, created_at, updated_at, ...rest } = popup;
  return {
    id, external_id, name, template, status,
    priority: priority == null ? 50 : priority,
    body: JSON.stringify(rest),
    created_at, updated_at
  };
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM popups').get().n;
  if (count > 0) return;
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO popups (id, external_id, name, template, status, priority, body, created_at, updated_at)
    VALUES (@id, @external_id, @name, @template, @status, @priority, @body, @created_at, @updated_at)
  `);
  const tx = db.transaction((popups) => { popups.forEach((p) => insert.run(popupToRow(p))); });
  tx(seed.popups);

  // A default dev signing key so the ingestion API is testable out of the
  // box. Rotate/replace before anything resembling production.
  const hasKey = db.prepare('SELECT COUNT(*) AS n FROM hmac_keys').get().n;
  if (!hasKey) {
    db.prepare('INSERT INTO hmac_keys (id, name, secret, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run('key-dev-default', 'Local dev default', 'dev-secret-change-me', new Date().toISOString());
  }
}
seedIfEmpty();

const stmts = {
  all: db.prepare('SELECT * FROM popups ORDER BY priority DESC'),
  byId: db.prepare('SELECT * FROM popups WHERE id = ?'),
  byExternalId: db.prepare('SELECT * FROM popups WHERE external_id = ?'),
  insert: db.prepare(`
    INSERT INTO popups (id, external_id, name, template, status, priority, body, created_at, updated_at)
    VALUES (@id, @external_id, @name, @template, @status, @priority, @body, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE popups SET name=@name, template=@template, status=@status, priority=@priority,
      body=@body, updated_at=@updated_at WHERE external_id=@external_id
  `),
  setStatus: db.prepare('UPDATE popups SET status = ?, updated_at = ? WHERE external_id = ?'),
  idemGet: db.prepare('SELECT * FROM idempotency_keys WHERE key = ? AND external_id = ?'),
  idemInsert: db.prepare(`
    INSERT INTO idempotency_keys (key, external_id, body_hash, response_status, response_body, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  activeHmacKeys: db.prepare('SELECT * FROM hmac_keys WHERE active = 1'),
  insertHmacKey: db.prepare('INSERT INTO hmac_keys (id, name, secret, active, created_at) VALUES (?, ?, ?, 1, ?)'),
  deactivateHmacKey: db.prepare('UPDATE hmac_keys SET active = 0 WHERE id = ?'),
  insertIngestAudit: db.prepare(`
    INSERT INTO ingest_audit (id, external_id, action, key_id, status_code, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  recentIngestAudit: db.prepare('SELECT * FROM ingest_audit ORDER BY created_at DESC LIMIT 100'),

  insertEvent: db.prepare(`
    INSERT OR IGNORE INTO raw_events
      (id, popup_id, impression_id, type, page_url, device, session_id, legal_version, field_id, element_id, occurred_at, received_at, origin, ip_hash, referrer, country)
    VALUES (@id, @popup_id, @impression_id, @type, @page_url, @device, @session_id, @legal_version, @field_id, @element_id, @occurred_at, @received_at, @origin, @ip_hash, @referrer, @country)
  `),
  eventCountForPopup: db.prepare('SELECT COUNT(*) AS n FROM raw_events WHERE popup_id = ?'),
  eventsForPopupSince: db.prepare('SELECT * FROM raw_events WHERE popup_id = ? AND occurred_at >= ? ORDER BY occurred_at ASC'),
  recentEvents: db.prepare('SELECT * FROM raw_events ORDER BY received_at DESC LIMIT 200'),
  // field_id/element_id hold question_id/value for this event type (see
  // collector.js) — grouping by them is the whole aggregation.
  questionnaireAnswerCounts: db.prepare(`
    SELECT field_id AS question_id, element_id AS value, COUNT(*) AS n
    FROM raw_events
    WHERE popup_id = ? AND type = 'questionnaire_answer'
    GROUP BY field_id, element_id
    ORDER BY field_id, n DESC
  `),

  // Site-wide analytics (all popups combined) — "views"/"leads" are exact
  // event types; "interaction" is any active engagement past just seeing
  // the popup, which is the one definition that means something across
  // every template (a banner's only interaction is a click; a
  // questionnaire's is answering; a form's is starting/submitting it).
  overviewSummary: db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'impression' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN type = 'form_submit' THEN 1 ELSE 0 END) AS leads,
      SUM(CASE WHEN type IN ('click','form_start','form_submit','questionnaire_answer','game_result') THEN 1 ELSE 0 END) AS interactions
    FROM raw_events
    WHERE occurred_at >= ?
  `),
  overviewByReferrer: db.prepare(`
    SELECT
      COALESCE(NULLIF(referrer, ''), '(direct)') AS label,
      SUM(CASE WHEN type = 'impression' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN type IN ('click','form_start','form_submit','questionnaire_answer','game_result') THEN 1 ELSE 0 END) AS interactions
    FROM raw_events
    WHERE occurred_at >= ?
    GROUP BY label
    ORDER BY views DESC
    LIMIT 20
  `),
  overviewByPage: db.prepare(`
    SELECT
      COALESCE(NULLIF(page_url, ''), '(unknown)') AS label,
      SUM(CASE WHEN type = 'impression' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN type IN ('click','form_start','form_submit','questionnaire_answer','game_result') THEN 1 ELSE 0 END) AS interactions
    FROM raw_events
    WHERE occurred_at >= ?
    GROUP BY label
    ORDER BY views DESC
    LIMIT 20
  `),
  overviewByCountry: db.prepare(`
    SELECT
      COALESCE(NULLIF(country, ''), '(unknown)') AS label,
      SUM(CASE WHEN type = 'impression' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN type IN ('click','form_start','form_submit','questionnaire_answer','game_result') THEN 1 ELSE 0 END) AS interactions
    FROM raw_events
    WHERE occurred_at >= ?
    GROUP BY label
    ORDER BY views DESC
    LIMIT 20
  `)
};

function listPopups() { return stmts.all.all().map(rowToPopup); }
function getByExternalId(externalId) { return rowToPopup(stmts.byExternalId.get(externalId)); }

function upsertPopup(externalId, doc, now) {
  const existing = stmts.byExternalId.get(externalId);
  const merged = Object.assign({}, doc, {
    id: existing ? existing.id : 'pop-' + crypto.randomUUID().slice(0, 12),
    external_id: externalId,
    created_at: existing ? existing.created_at : now,
    updated_at: now
  });
  const row = popupToRow(merged);
  if (existing) {
    stmts.update.run(row);
    return { popup: rowToPopup(row), created: false };
  }
  stmts.insert.run(row);
  return { popup: rowToPopup(row), created: true };
}

function setStatus(externalId, status, now) {
  const info = stmts.setStatus.run(status, now, externalId);
  return info.changes > 0;
}

function getIdempotency(key, externalId) { return stmts.idemGet.get(key, externalId); }
function saveIdempotency(key, externalId, bodyHash, status, body) {
  stmts.idemInsert.run(key, externalId, bodyHash, status, JSON.stringify(body), new Date().toISOString());
}

function activeHmacKeys() { return stmts.activeHmacKeys.all(); }
function addHmacKey(id, name, secret) { stmts.insertHmacKey.run(id, name, secret, new Date().toISOString()); }
function deactivateHmacKey(id) { stmts.deactivateHmacKey.run(id); }

function logIngestAudit({ externalId, action, keyId, statusCode, detail }) {
  stmts.insertIngestAudit.run(
    'ia-' + crypto.randomUUID().slice(0, 8), externalId, action, keyId || null, statusCode,
    detail ? JSON.stringify(detail) : null, new Date().toISOString()
  );
}
function recentIngestAudit() {
  return stmts.recentIngestAudit.all().map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

function resetToSeed() {
  db.exec('DELETE FROM popups; DELETE FROM idempotency_keys; DELETE FROM ingest_audit; DELETE FROM raw_events;');
  seedIfEmpty();
}

// Returns { inserted, duplicate } — duplicates are silently absorbed
// (INSERT OR IGNORE against the UNIQUE constraint), not an error, since a
// visitor's sendBeacon retry or an overlapping flush is expected traffic,
// not an attack (§10.1 "fake events / stat poisoning" is a separate control
// — origin allowlist + rate limit, upstream of this function).
function insertEvent(ev) {
  const info = stmts.insertEvent.run(ev);
  return info.changes > 0;
}

function eventCountForPopup(popupId) { return stmts.eventCountForPopup.get(popupId).n; }
function eventsForPopupSince(popupId, sinceIso) { return stmts.eventsForPopupSince.all(popupId, sinceIso); }
function recentEvents() { return stmts.recentEvents.all(); }
function questionnaireAnswerCounts(popupId) { return stmts.questionnaireAnswerCounts.all(popupId); }

function overviewSummary(sinceIso) {
  const row = stmts.overviewSummary.get(sinceIso);
  return { views: row.views || 0, leads: row.leads || 0, interactions: row.interactions || 0 };
}
function overviewByReferrer(sinceIso) { return stmts.overviewByReferrer.all(sinceIso); }
function overviewByPage(sinceIso) { return stmts.overviewByPage.all(sinceIso); }
function overviewByCountry(sinceIso) { return stmts.overviewByCountry.all(sinceIso); }

module.exports = {
  listPopups, getByExternalId, upsertPopup, setStatus,
  getIdempotency, saveIdempotency,
  activeHmacKeys, addHmacKey, deactivateHmacKey,
  logIngestAudit, recentIngestAudit,
  insertEvent, eventCountForPopup, eventsForPopupSince, recentEvents,
  questionnaireAnswerCounts,
  overviewSummary, overviewByReferrer, overviewByPage, overviewByCountry,
  resetToSeed
};
