'use strict';

const express = require('express');
const store = require('../lib/store');
const sqliteStore = require('../lib/sqliteStore');
const targeting = require('../lib/targeting');
const legalRegistryLib = require('../lib/legalRegistry');

const router = express.Router();

router.post('/url-tester', function (req, res) {
  const db = store.load();
  const { url, dataLayer, device } = req.body || {};
  if (!url) return res.status(422).json({ error: 'validation_failed', details: [{ path: 'url', message: 'required' }] });

  let parsed;
  try { parsed = new URL(url); } catch (e) {
    return res.status(422).json({ error: 'validation_failed', details: [{ path: 'url', message: 'not a valid URL' }] });
  }

  const dl = dataLayer || {};
  const deviceClass = device || 'desktop';
  const entity = targeting.resolveEntity(db.entity_domains, parsed.hostname);
  const legalRegistry = legalRegistryLib.buildRegistry(db.legal_texts);

  const ctx = {
    path: parsed.pathname,
    url: parsed.toString(),
    referrer: dl.referrer || '',
    device: deviceClass,
    dataLayer: dl,
    locale: dl.language || 'en',
    country: dl.country || null
  };

  const results = sqliteStore.listPopups()
    .filter(function (p) { return p.status !== 'archived'; })
    .map(function (popup) {
      const scheduleCheck = targeting.withinSchedule(popup, Date.now());
      const deviceCheck = targeting.allowedOnDevice(popup, deviceClass);
      const targetingResult = targeting.evaluateTargeting(popup, ctx);
      const legal = targeting.resolveLegal(legalRegistry, popup, entity, ctx.country, ctx.locale);

      const blockers = [];
      if (popup.status !== 'live') blockers.push('popup status is "' + popup.status + '", not live');
      if (!scheduleCheck.ok) blockers.push(scheduleCheck.reason);
      if (!deviceCheck.ok) blockers.push(deviceCheck.reason);
      if (!targetingResult.matched) blockers.push('targeting rules did not match');
      if (legal.suppressed) blockers.push('legal fail-safe suppressed: ' + legal.reason);

      return {
        id: popup.external_id, name: popup.name, template: popup.template, priority: popup.priority,
        would_render: blockers.length === 0,
        blockers: blockers,
        schedule: scheduleCheck,
        device_check: deviceCheck,
        targeting: targetingResult,
        legal: legal
      };
    })
    .sort(function (a, b) { return b.priority - a.priority; });

  const winner = results.find(function (r) { return r.would_render; }) || null;

  res.json({
    resolved_host: parsed.hostname,
    resolved_entity: entity,
    entity_suppressed: entity === null,
    winner: winner ? winner.id : null,
    popups: results
  });
});

module.exports = router;
