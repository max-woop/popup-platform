'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../lib/store');
const legalRegistryLib = require('../lib/legalRegistry');
const { requireRole, audit, republish } = require('../lib/adminHelpers');

const router = express.Router();

router.get('/legal-texts', function (req, res) {
  const db = store.load();
  res.json({
    domains: db.entity_domains,
    registry: legalRegistryLib.buildRegistry(db.legal_texts),
    history: legalRegistryLib.groupHistory(db.legal_texts)
  });
});

// Domain → entity mapping (§11.3.2) — unlike registration_domains/consent_texts,
// this had no write path at all before: entity_domains only ever came from
// seed data, so adding a demo/staging host required a redeploy and, worse, a
// full reseed (which a persistent Volume blocks). This makes it a normal
// admin-editable registry like the others.
router.post('/entity-domains', requireRole('compliance-only'), function (req, res) {
  const db = store.load();
  const body = req.body || {};
  if (!body.host || !body.entity) {
    return res.status(422).json({
      error: 'validation_failed',
      details: [{ path: 'host|entity', message: 'required' }]
    });
  }
  const before = db.entity_domains[body.host] || null;
  db.entity_domains[body.host] = body.entity;
  audit(db, req, 'entity_domain.upsert', 'entity_domain', body.host, before, body.entity);
  store.save(db);
  republish();
  res.status(before ? 200 : 201).json({ host: body.host, entity: body.entity });
});

router.post('/legal-texts', requireRole('compliance-only'), function (req, res) {
  const db = store.load();
  const body = req.body || {};
  if (!body.entity || !body.text || !body.effective_from) {
    return res.status(422).json({
      error: 'validation_failed',
      details: [{ path: 'entity|text|effective_from', message: 'required' }]
    });
  }

  const priorVersions = db.legal_texts
    .filter(function (r) { return r.entity === body.entity && (r.country || null) === (body.country || null); })
    .map(function (r) { return r.version; });
  const nextVersion = priorVersions.length ? Math.max.apply(null, priorVersions) + 1 : 1;

  // Close out whichever row is currently open-ended for this entity/country.
  db.legal_texts.forEach(function (r) {
    if (r.entity === body.entity && (r.country || null) === (body.country || null) && !r.effective_to) {
      r.effective_to = body.effective_from;
    }
  });

  const row = {
    id: 'lt-' + crypto.randomUUID().slice(0, 8),
    entity: body.entity,
    country: body.country || null,
    locale: body.locale || 'en',
    required: body.required !== false,
    text: body.text,
    version: nextVersion,
    effective_from: body.effective_from,
    effective_to: null,
    approved_by: req.actor.email
  };
  db.legal_texts.push(row);
  audit(db, req, 'legal_text.publish', 'legal_text', row.id, null, row);
  store.save(db);
  republish();
  res.status(201).json(row);
});

module.exports = router;
