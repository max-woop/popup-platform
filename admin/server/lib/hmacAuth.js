'use strict';

const crypto = require('crypto');
const sqliteStore = require('./sqliteStore');

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

module.exports = { verifyIngestAuth, computeSignature };
