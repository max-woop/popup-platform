'use strict';

// Admin-facing popup CRUD — read/write via the same SQLite table the /v1
// ingestion routes use, so a popup created by the source system shows up
// here immediately, and an operator pause/archive is visible to the next
// config publish.

const express = require('express');
const store = require('../lib/store');
const sqliteStore = require('../lib/sqliteStore');
const { requireRole, audit, popupSummary, popupDetail, republish } = require('../lib/adminHelpers');
const { IMAGE_HOST_PATTERN } = require('../lib/ingestSchemas');

const imageHostRe = new RegExp(IMAGE_HOST_PATTERN);

const router = express.Router();

router.get('/popups', function (req, res) {
  res.json(sqliteStore.listPopups().map(popupSummary));
});

router.get('/popups/:id', function (req, res) {
  const popup = sqliteStore.getByExternalId(req.params.id);
  if (!popup) return res.status(404).json({ error: 'not_found' });
  res.json(popupDetail(popup));
});

const EDITABLE_FIELDS = ['name', 'priority', 'starts_at', 'ends_at', 'devices', 'trigger', 'frequency', 'targeting', 'experiment'];

router.patch('/popups/:id', requireRole('operator'), function (req, res) {
  const db = store.load();
  const existing = sqliteStore.getByExternalId(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const before = JSON.parse(JSON.stringify(existing));
  const next = JSON.parse(JSON.stringify(existing));
  const body = req.body || {};

  EDITABLE_FIELDS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(body, key)) next[key] = body[key];
  });

  if (body.legal && typeof body.legal === 'object') {
    const nextMode = body.legal.mode;
    if (nextMode === 'custom' && req.actor.role !== 'compliance') {
      return res.status(403).json({ error: 'forbidden', message: 'Custom legal text requires the Compliance role (§11.3.1).' });
    }
    if (nextMode === 'off' && !body.legal.off_reason && !(next.content.legal && next.content.legal.off_reason)) {
      return res.status(422).json({ error: 'validation_failed', details: [{ path: 'legal.off_reason', message: 'required when mode is "off"' }] });
    }
    // Stronger than the Compliance-gate above: no role can turn this off
    // for the flagship brand, not just "requires a reason" — same rule the
    // ingestion API enforces (ingestSchemas.js's validateSemantics), so a
    // popup can't end up in this state by one path but not the other.
    if (nextMode === 'off' && next.content.broker === 'libertex.com') {
      return res.status(422).json({ error: 'validation_failed', details: [{ path: 'legal.mode', message: 'libertex.com content cannot set legal.mode to "off" — the risk warning is mandatory for this broker' }] });
    }
    next.content.legal = Object.assign({}, next.content.legal, body.legal);
  }

  // Content is otherwise source-system-owned (§10.1) — this is the one
  // deliberate, narrow exception (admin/HOW_TO_SEND_CONTENT.md), not a
  // general "edit any content field" door: only image_url/image_alt, and
  // image_url still has to pass the same CDN-host allowlist the ingestion
  // API enforces (ingestSchemas.js's IMAGE_HOST_PATTERN) so this can't
  // become a way to point a popup at an arbitrary image host by hand.
  if (body.content && typeof body.content === 'object') {
    if (Object.prototype.hasOwnProperty.call(body.content, 'image_url')) {
      const url = body.content.image_url;
      if (url && !imageHostRe.test(url)) {
        return res.status(422).json({ error: 'validation_failed', details: [{ path: 'content.image_url', message: 'must be an https://cdn.libertex.* URL' }] });
      }
      next.content.image_url = url || '';
    }
    if (Object.prototype.hasOwnProperty.call(body.content, 'image_alt')) {
      next.content.image_alt = String(body.content.image_alt || '').slice(0, 125);
    }
  }

  const now = new Date().toISOString();
  const { popup } = sqliteStore.upsertPopup(req.params.id, next, now);
  audit(db, req, 'popup.update', 'popup', req.params.id, before, JSON.parse(JSON.stringify(popup)));
  store.save(db);
  republish();
  res.json(popupDetail(popup));
});

router.post('/popups/:id/pause', requireRole('operator'), function (req, res) {
  const db = store.load();
  const existing = sqliteStore.getByExternalId(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const nextStatus = existing.status === 'live' ? 'paused' : 'live';
  const now = new Date().toISOString();
  sqliteStore.setStatus(req.params.id, nextStatus, now);
  audit(db, req, nextStatus === 'paused' ? 'popup.pause' : 'popup.resume', 'popup', req.params.id, { status: existing.status }, { status: nextStatus });
  store.save(db);
  republish();
  res.json(popupDetail(sqliteStore.getByExternalId(req.params.id)));
});

router.delete('/popups/:id', requireRole('operator'), function (req, res) {
  const db = store.load();
  const existing = sqliteStore.getByExternalId(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const now = new Date().toISOString();
  sqliteStore.setStatus(req.params.id, 'archived', now);
  audit(db, req, 'popup.archive', 'popup', req.params.id, { status: existing.status }, { status: 'archived' });
  store.save(db);
  republish();
  res.json(popupDetail(sqliteStore.getByExternalId(req.params.id)));
});

module.exports = router;
