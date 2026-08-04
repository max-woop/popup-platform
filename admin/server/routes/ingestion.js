'use strict';

// §13 — Ingestion API. This is what the source system calls (F-1). Every
// route requires the HMAC auth in lib/hmacAuth.js; there is no session/role
// concept here, only "does the signature match an active key." index.js
// mounts this at /v1, and must mount it after /v1/events (the collector) —
// verifyIngestAuth must never see visitor-browser collector traffic.

const express = require('express');
const crypto = require('crypto');
const sqliteStore = require('../lib/sqliteStore');
const { verifyIngestAuth } = require('../lib/hmacAuth');
const { validateUpsertBody, validateSemantics } = require('../lib/ingestSchemas');
const statsAggregate = require('../lib/statsAggregate');
const { popupDetail, republish } = require('../lib/adminHelpers');

const router = express.Router();
router.use(verifyIngestAuth);

function computeBodyHash(rawBody) {
  return crypto.createHash('sha256').update(rawBody || '').digest('hex');
}

router.put('/popups/:external_id', function (req, res) {
  const externalId = req.params.external_id;
  const idemKey = req.header('idempotency-key');
  const bodyHash = computeBodyHash(req.rawBody ? req.rawBody.toString('utf8') : '');

  if (idemKey) {
    const existing = sqliteStore.getIdempotency(idemKey, externalId);
    if (existing) {
      if (existing.body_hash !== bodyHash) {
        return res.status(409).json({ error: 'idempotency_conflict', message: 'Idempotency-Key reused with a different request body.' });
      }
      return res.status(existing.response_status).json(JSON.parse(existing.response_body));
    }
  }

  function respond(status, body) {
    if (idemKey) sqliteStore.saveIdempotency(idemKey, externalId, bodyHash, status, body);
    sqliteStore.logIngestAudit({ externalId, action: 'popup.upsert', keyId: req.hmacKeyId, statusCode: status, detail: status >= 400 ? body : undefined });
    return res.status(status).json(body);
  }

  const body = req.body || {};
  const shape = validateUpsertBody(body);
  if (!shape.ok) {
    return respond(400, { error: 'validation_failed', details: shape.details });
  }
  const semantics = validateSemantics(body);
  if (!semantics.ok) {
    return respond(422, { error: 'semantically_invalid', details: semantics.details });
  }

  const now = new Date().toISOString();
  const doc = {
    name: body.name,
    template: body.template_id,
    status: body.status || 'live',
    priority: body.priority == null ? 50 : body.priority,
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
    devices: body.devices || ['desktop', 'tablet', 'mobile'],
    trigger: body.trigger || { type: 'immediate' },
    frequency: body.frequency || {},
    targeting: body.targeting || [],
    content: body.content
  };

  const { popup, created } = sqliteStore.upsertPopup(externalId, doc, now);
  republish();
  respond(created ? 201 : 200, popupDetail(popup));
});

router.get('/popups/:external_id', function (req, res) {
  const popup = sqliteStore.getByExternalId(req.params.external_id);
  if (!popup) return res.status(404).json({ error: 'not_found' });
  res.json(popupDetail(popup));
});

router.post('/popups/:external_id/pause', function (req, res) {
  const existing = sqliteStore.getByExternalId(req.params.external_id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const now = new Date().toISOString();
  sqliteStore.setStatus(req.params.external_id, 'paused', now);
  republish();
  sqliteStore.logIngestAudit({ externalId: req.params.external_id, action: 'popup.pause', keyId: req.hmacKeyId, statusCode: 200 });
  res.json(popupDetail(sqliteStore.getByExternalId(req.params.external_id)));
});

router.delete('/popups/:external_id', function (req, res) {
  const existing = sqliteStore.getByExternalId(req.params.external_id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const now = new Date().toISOString();
  sqliteStore.setStatus(req.params.external_id, 'archived', now);
  republish();
  sqliteStore.logIngestAudit({ externalId: req.params.external_id, action: 'popup.archive', keyId: req.hmacKeyId, statusCode: 200 });
  res.json(popupDetail(sqliteStore.getByExternalId(req.params.external_id)));
});

router.get('/popups/:external_id/stats', function (req, res) {
  const popup = sqliteStore.getByExternalId(req.params.external_id);
  if (!popup) return res.status(404).json({ error: 'not_found' });
  const range = Math.max(1, Math.min(90, parseInt(req.query.range, 10) || 30));
  res.json(statsAggregate.aggregateForPopup(popup, range, 'all'));
});

module.exports = router;
