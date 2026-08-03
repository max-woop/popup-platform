'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../lib/store');
const sqliteStore = require('../lib/sqliteStore');
const { requireRole, audit, republish } = require('../lib/adminHelpers');

const router = express.Router();

router.get('/settings', function (req, res) {
  const db = store.load();
  res.json(db.settings);
});

router.put('/settings', requireRole('operator'), function (req, res) {
  const db = store.load();
  const before = JSON.parse(JSON.stringify(db.settings));
  const body = req.body || {};
  if (typeof body.kill_switch === 'boolean') db.settings.kill_switch = body.kill_switch;
  if (body.global_caps) db.settings.global_caps = Object.assign({}, db.settings.global_caps, body.global_caps);
  audit(db, req, 'settings.update', 'settings', 'global', before, JSON.parse(JSON.stringify(db.settings)));
  store.save(db);
  republish();
  res.json(db.settings);
});

router.post('/settings/api-keys', requireRole('operator'), function (req, res) {
  const db = store.load();
  const name = (req.body && req.body.name) || 'Unnamed key';
  const id = 'key-' + crypto.randomUUID().slice(0, 8);
  const secret = crypto.randomBytes(24).toString('hex');
  const key = {
    id: id,
    name: name,
    prefix: 'lx_live_' + secret.slice(0, 8),
    created_at: new Date().toISOString(),
    last_used_at: null
  };
  db.settings.api_keys.push(key);
  audit(db, req, 'api_key.create', 'api_key', key.id, null, { name: key.name, prefix: key.prefix });
  store.save(db);

  // The full secret is stored here (symmetric HMAC, not a password) so /v1
  // requests signed with it actually verify. It is shown to the caller
  // exactly once, matching a real key-issuance flow — the admin-facing
  // settings record above only ever keeps the prefix.
  sqliteStore.addHmacKey(id, name, secret);

  res.status(201).json({ id: key.id, name: key.name, secret: secret });
});

router.delete('/settings/api-keys/:id', requireRole('operator'), function (req, res) {
  const db = store.load();
  const idx = db.settings.api_keys.findIndex(function (k) { return k.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removed = db.settings.api_keys.splice(idx, 1)[0];
  audit(db, req, 'api_key.revoke', 'api_key', removed.id, removed, null);
  store.save(db);
  sqliteStore.deactivateHmacKey(removed.id);
  res.status(204).end();
});

router.get('/audit-log', function (req, res) {
  const db = store.load();
  res.json(db.audit_log.slice(0, 200));
});

router.get('/ingest-audit-log', function (req, res) {
  res.json(sqliteStore.recentIngestAudit());
});

router.post('/dev/reset', function (req, res) {
  const db = store.reset();
  sqliteStore.resetToSeed();
  republish();
  res.json({ ok: true, popups: sqliteStore.listPopups().length });
});

module.exports = router;
