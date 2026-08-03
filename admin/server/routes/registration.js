'use strict';

// No Leads screen/routes here anymore — §9's rewrite means registration
// goes through the existing llLanding widget straight to Libertex's real
// backend (§9.1). This platform never captures a lead to store or forward.

const express = require('express');
const crypto = require('crypto');
const store = require('../lib/store');
const consentRegistryLib = require('../lib/consentRegistry');
const { requireRole, audit, republish } = require('../lib/adminHelpers');

const router = express.Router();

router.get('/registration-domains', function (req, res) {
  const db = store.load();
  res.json(db.registration_domains);
});

router.post('/registration-domains', requireRole('compliance-only'), function (req, res) {
  const db = store.load();
  const body = req.body || {};
  if (!body.host || !body.entity || !body.script_src || !body.api_key) {
    return res.status(422).json({
      error: 'validation_failed',
      details: [{ path: 'host|entity|script_src|api_key', message: 'required' }]
    });
  }
  const before = db.registration_domains[body.host] || null;
  const entry = {
    entity: body.entity,
    script_src: body.script_src,
    api_key: body.api_key,
    fields: Array.isArray(body.fields) ? body.fields : ['email', 'password'],
    tealium: body.tealium || {}
  };
  db.registration_domains[body.host] = entry;
  audit(db, req, 'registration_domain.upsert', 'registration_domain', body.host, before, entry);
  store.save(db);
  republish();
  res.status(before ? 200 : 201).json({ host: body.host, entry: entry });
});

router.get('/consent-texts', function (req, res) {
  const db = store.load();
  res.json({
    registry: consentRegistryLib.buildRegistry(db.consent_texts),
    history: consentRegistryLib.groupHistory(db.consent_texts)
  });
});

router.post('/consent-texts', requireRole('compliance-only'), function (req, res) {
  const db = store.load();
  const body = req.body || {};
  if (!body.entity || !body.locale || !body.text_template || !body.links) {
    return res.status(422).json({
      error: 'validation_failed',
      details: [{ path: 'entity|locale|text_template|links', message: 'required' }]
    });
  }

  const priorVersions = db.consent_texts
    .filter(function (r) { return r.entity === body.entity && r.locale === body.locale; })
    .map(function (r) { return r.version; });
  const nextVersion = priorVersions.length ? Math.max.apply(null, priorVersions) + 1 : 1;

  db.consent_texts.forEach(function (r) {
    if (r.entity === body.entity && r.locale === body.locale && !r.effective_to) {
      r.effective_to = body.effective_from || new Date().toISOString();
    }
  });

  const row = {
    id: 'ct-' + crypto.randomUUID().slice(0, 8),
    entity: body.entity,
    locale: body.locale,
    version: nextVersion,
    text_template: body.text_template,
    links: body.links,
    effective_from: body.effective_from || new Date().toISOString(),
    effective_to: null,
    approved_by: req.actor.email
  };
  db.consent_texts.push(row);
  audit(db, req, 'consent_text.publish', 'consent_text', row.id, null, row);
  store.save(db);
  republish();
  res.status(201).json(row);
});

module.exports = router;
