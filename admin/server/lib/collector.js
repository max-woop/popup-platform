'use strict';

const crypto = require('crypto');
const sqliteStore = require('./sqliteStore');

// §10.4 — "Collector: unauthenticated by necessity; protected by origin
// allowlist, rate limit, payload cap, and dedup." No HMAC here: the visitor's
// browser can't hold a secret, so the controls are all shape-of-traffic based.

const ALLOWED_ORIGINS = (process.env.COLLECTOR_ALLOWED_ORIGINS ||
  'http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const ALLOWED_TYPES = new Set([
  'impression', 'view', 'click', 'close', 'form_start', 'form_submit', 'form_error', 'error',
  'questionnaire_answer', // §5.4 — carries question_id/value, reusing the field_id/element_id columns below
  'game_result'           // §5.5 — carries prize_label, reusing the element_id column below
]);
const MAX_EVENTS_PER_BATCH = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_BATCHES = 120; // per IP hash per window — generous for a single visitor's tab

const rateBuckets = new Map(); // ipHash -> { count, windowStart }

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

function checkOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function checkRateLimit(ipHash) {
  const now = Date.now();
  const bucket = rateBuckets.get(ipHash);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ipHash, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_BATCHES;
}

function sanitizePageUrl(url) {
  // §14.2 — "send path only, strip query strings and fragments." Enforced
  // server-side too, since a client bug shouldn't be the only thing standing
  // between a query string and the events table.
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, 'http://placeholder.invalid');
    return parsed.pathname;
  } catch (e) {
    return url.split('?')[0].split('#')[0];
  }
}

// Coarse "impossible timings" bot signal (§14.3) applied at ingest rather
// than at the aggregation step the spec describes — a simplification, not
// a full replacement for a real bot-filtering pass over raw events.
function withinPlausibleWindow(occurredAt) {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t <= now + 60_000 && t >= now - 24 * 3600_000;
}

function validateEvent(ev) {
  if (!ev || typeof ev !== 'object') return 'not an object';
  if (!ev.popup_id || typeof ev.popup_id !== 'string') return 'popup_id required';
  if (!ev.impression_id || typeof ev.impression_id !== 'string') return 'impression_id required';
  if (!ALLOWED_TYPES.has(ev.type)) return 'unknown event type';
  if (!ev.occurred_at || !withinPlausibleWindow(ev.occurred_at)) return 'occurred_at missing or implausible';
  if (ev.type === 'form_error' && !ev.field_id) return 'form_error requires field_id';
  if (ev.type === 'questionnaire_answer' && (!ev.question_id || ev.value == null)) return 'questionnaire_answer requires question_id and value';
  if (ev.type === 'game_result' && !ev.prize_label) return 'game_result requires prize_label';
  return null;
}

function handleEvents(req, res) {
  const origin = req.header('origin');
  if (!checkOrigin(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  const ipHash = hashIp(req.ip);
  if (!checkRateLimit(ipHash)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events) return res.status(400).json({ error: 'validation_failed', message: '"events" array required' });
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return res.status(400).json({ error: 'validation_failed', message: 'batch exceeds ' + MAX_EVENTS_PER_BATCH + ' events' });
  }

  const now = new Date().toISOString();
  let inserted = 0, duplicate = 0, rejected = 0;

  events.forEach((raw) => {
    const reason = validateEvent(raw);
    if (reason) { rejected += 1; return; }

    const row = {
      id: 'ev-' + crypto.randomUUID().slice(0, 12),
      popup_id: raw.popup_id,
      impression_id: raw.impression_id,
      type: raw.type,
      page_url: sanitizePageUrl(raw.page_url) || '',
      device: ['desktop', 'tablet', 'mobile'].includes(raw.device) ? raw.device : 'desktop',
      session_id: typeof raw.session_id === 'string' ? raw.session_id : '',
      legal_version: raw.legal_version == null ? '' : String(raw.legal_version),
      // field_id/element_id are reused for questionnaire_answer (question_id/
      // value) and game_result (prize_label) rather than migrating the
      // schema — same "which sub-part / which specific thing" shape as the
      // form_error/click cases they were named for.
      field_id: raw.field_id || raw.question_id || '',
      element_id: raw.element_id || raw.value || raw.prize_label || '',
      occurred_at: raw.occurred_at,
      received_at: now,
      origin: origin,
      ip_hash: ipHash
    };

    const wasInserted = sqliteStore.insertEvent(row);
    if (wasInserted) inserted += 1; else duplicate += 1;
  });

  res.json({ received: events.length, inserted, duplicate, rejected });
}

module.exports = { handleEvents, ALLOWED_ORIGINS };
