'use strict';

const crypto = require('crypto');
const sqliteStore = require('./sqliteStore');
const alerts = require('./alerts');

const MAX_SKEW_SECONDS = 5 * 60; // §10.4 — reject skew > 5 min

// §10.4 — HMAC-SHA256 over `timestamp + method + path + body`, X-Signature /
// X-Timestamp headers, rotatable keys. Signature header format matches the
// §13.1 example: `X-Signature: sha256=<hex>`.
function computeSignature(secret, timestamp, method, path, rawBody) {
  const payload = String(timestamp) + method.toUpperCase() + path + (rawBody || '');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyIngestAuth(req, res, next) {
  const timestamp = req.header('x-timestamp');
  const signatureHeader = req.header('x-signature');

  if (!timestamp || !signatureHeader) {
    return res.status(401).json({ error: 'unauthorized', message: 'X-Timestamp and X-Signature headers are required.' });
  }

  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) {
    return res.status(401).json({ error: 'unauthorized', message: 'Timestamp skew exceeds ' + MAX_SKEW_SECONDS + 's.' });
  }

  const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
  const method = req.method;
  const path = req.originalUrl;

  const keys = sqliteStore.activeHmacKeys();
  const matchedKey = keys.find((k) => {
    try {
      const expected = computeSignature(k.secret, timestamp, method, path, rawBody);
      return timingSafeEqualHex(provided, expected);
    } catch (e) { return false; }
  });

  if (!matchedKey) {
    sqliteStore.logIngestAudit({
      externalId: req.params.external_id || '(unknown)', action: 'auth.reject',
      statusCode: 401, detail: { reason: 'no key matched signature' }
    });
    return res.status(401).json({ error: 'unauthorized', message: 'Signature does not match any active key.' });
  }

  req.hmacKeyId = matchedKey.id;
  next();
}

/* §16.1's alert table lists "unusual update rate from source system" as a
   signal to watch, but nothing actually bounded that rate until now — an
   HMAC key is long-lived and shared with an external system this platform
   doesn't control, so a leaked key or a misbehaving retry loop had an
   unthrottled path to the SQLite write path. Same sliding-window-bucket
   shape as collector.js's own rate limit (§10.4), keyed by hmacKeyId
   instead of an IP hash — ingestion is authenticated, so the key is the
   more precise "who" than an IP a NAT could be sharing across integrations.
   Deliberately after verifyIngestAuth, not before: an unauthenticated
   request already gets a cheap 401 without touching this bucket at all. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120; // per key per window — a full popup catalog re-push should never come close

const ingestRateBuckets = new Map(); // keyId -> { count, windowStart }

function rateLimitIngest(req, res, next) {
  const keyId = req.hmacKeyId;
  const now = Date.now();
  const bucket = ingestRateBuckets.get(keyId);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    ingestRateBuckets.set(keyId, { count: 1, windowStart: now });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    sqliteStore.logIngestAudit({
      externalId: req.params.external_id || '(unknown)', action: 'auth.rate_limited',
      keyId: keyId, statusCode: 429, detail: { count: bucket.count, windowMs: RATE_LIMIT_WINDOW_MS }
    });
    // Only once per window, not once per rejected request past the limit —
    // a client retrying into a 429 storm should not also cause an alert
    // storm. §16.1's "unusual update rate from source system" signal.
    if (bucket.count === RATE_LIMIT_MAX_REQUESTS + 1) {
      alerts.notify('unusual_update_rate', 'Ingestion key "' + keyId + '" exceeded ' + RATE_LIMIT_MAX_REQUESTS + ' requests/min', { keyId });
    }
    return res.status(429).json({
      error: 'rate_limited',
      message: 'This key has made more than ' + RATE_LIMIT_MAX_REQUESTS + ' ingestion requests in the last ' + (RATE_LIMIT_WINDOW_MS / 1000) + 's. Slow down and retry shortly.'
    });
  }
  next();
}

module.exports = { verifyIngestAuth, rateLimitIngest, computeSignature };
