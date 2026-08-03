'use strict';

const express = require('express');
const sqliteStore = require('../lib/sqliteStore');
const { statsForPopup } = require('../lib/stats');
const statsAggregate = require('../lib/statsAggregate');
const { popupSummary } = require('../lib/adminHelpers');

const router = express.Router();

router.get('/stats', function (req, res) {
  const popupId = req.query.popup_id;
  const range = Math.max(1, Math.min(90, parseInt(req.query.range, 10) || 7));
  const device = req.query.device || 'all';

  const all = sqliteStore.listPopups();
  const popups = popupId ? all.filter(function (p) { return p.external_id === popupId; }) : all;
  if (popupId && !popups.length) return res.status(404).json({ error: 'not_found' });

  res.json(popups.map(function (p) {
    // Real events win when they exist; synthetic demo data is a clearly
    // labeled fallback so a brand-new popup's dashboard isn't just blank.
    const real = statsAggregate.aggregateForPopup(p, range, device);
    if (real) return real;
    return Object.assign({ source: 'synthetic' }, statsForPopup({ id: p.external_id, template: p.template }, range, device));
  }));
});

router.get('/questionnaire-popups', function (req, res) {
  res.json(sqliteStore.listPopups()
    .filter(function (p) { return p.template === 'questionnaire'; })
    .map(popupSummary));
});

router.get('/questionnaire-stats', function (req, res) {
  const popupId = req.query.popup_id;
  if (!popupId) return res.status(422).json({ error: 'validation_failed', details: [{ path: 'popup_id', message: 'required' }] });

  const popup = sqliteStore.getByExternalId(popupId);
  if (!popup || popup.template !== 'questionnaire') return res.status(404).json({ error: 'not_found' });

  const counts = sqliteStore.questionnaireAnswerCounts(popupId);
  const byQuestion = {};
  counts.forEach(function (row) {
    byQuestion[row.question_id] = byQuestion[row.question_id] || [];
    byQuestion[row.question_id].push(row);
  });

  const questions = (popup.content.questions || []).map(function (q) {
    const rows = byQuestion[q.id] || [];
    const total = rows.reduce(function (sum, r) { return sum + r.n; }, 0);
    const options = q.options.map(function (opt) {
      const row = rows.find(function (r) { return r.value === opt.value; });
      const count = row ? row.n : 0;
      return { value: opt.value, label: opt.label, count: count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 };
    });
    return { question_id: q.id, text: q.text, total_answers: total, options: options };
  });

  res.json({ popup_id: popupId, questions: questions });
});

router.get('/recent-events', function (req, res) {
  res.json(sqliteStore.recentEvents());
});

module.exports = router;
