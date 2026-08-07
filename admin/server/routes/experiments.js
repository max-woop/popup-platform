'use strict';

// Admin-facing A/B test visibility + manual resolution (§15). Automatic-mode
// resolution itself lives in lib/experiments.js's resolveDue(), run on a
// timer (index.js) — nothing here is on that path, this is purely for a
// human to see standings and, for manual-mode tests, declare a winner.

const express = require('express');
const sqliteStore = require('../lib/sqliteStore');
const experiments = require('../lib/experiments');
const { requireRole } = require('../lib/adminHelpers');

const router = express.Router();

function groupByExternalId(group) {
  return sqliteStore.listPopups().filter((p) => p.experiment && p.experiment.group === group);
}

// Every experiment group with 2+ variants, live or already resolved (a
// resolved group just has one live + N paused) — resolved ones stay
// listed so the outcome remains visible, not just the still-running ones.
router.get('/experiments', function (req, res) {
  const groups = {};
  sqliteStore.listPopups().forEach((p) => {
    const exp = p.experiment;
    if (exp && exp.group) (groups[exp.group] = groups[exp.group] || []).push(p);
  });
  const list = Object.keys(groups).filter((g) => groups[g].length > 1).map((g) => {
    const variants = groups[g];
    const exp = variants[0].experiment;
    const metric = exp.success_metric || 'conv_rate';
    const ranked = experiments.standings(variants, metric);
    const resolved = variants.filter((p) => p.status === 'live').length <= 1;
    return {
      group: g,
      mode: exp.mode || 'manual',
      success_metric: metric,
      ends_at: exp.ends_at || null,
      resolved: resolved,
      variants: ranked.map((r) => ({
        id: r.popup.external_id, name: r.popup.name, variant: r.popup.experiment.variant,
        weight: r.popup.experiment.weight || 50, status: r.popup.status,
        views: r.summary.views, leads: r.summary.leads, interactions: r.summary.interactions,
        value: Math.round(r.value * 1000) / 1000
      }))
    };
  });
  res.json(list);
});

router.post('/experiments/:group/resolve', requireRole('operator'), function (req, res) {
  const variants = groupByExternalId(req.params.group);
  if (variants.length < 2) return res.status(404).json({ error: 'not_found', message: 'No active experiment with 2+ variants for this group.' });
  const winnerId = req.body && req.body.winner_id;
  if (!winnerId) return res.status(422).json({ error: 'validation_failed', details: [{ path: 'winner_id', message: 'required' }] });

  const result = experiments.resolveGroup(variants, winnerId, req);
  if (!result.ok) return res.status(422).json({ error: result.error });
  res.json(result);
});

module.exports = router;
