'use strict';

const express = require('express');
const sqliteStore = require('../lib/sqliteStore');
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
    return statsAggregate.aggregateForPopup(p, range, device);
  }));
});

// Site-wide analytics (every popup combined) — visitor geography, referrer,
// and page breakdowns, distinct from /stats above which is always scoped to
// one popup at a time.
router.get('/stats/overview', function (req, res) {
  const range = Math.max(1, Math.min(90, parseInt(req.query.range, 10) || 30));
  res.json(statsAggregate.siteOverview(range));
});

router.get('/stats/leaderboard', function (req, res) {
  const range = Math.max(1, Math.min(90, parseInt(req.query.range, 10) || 30));
  res.json(statsAggregate.leaderboard(range));
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

  // Step-by-step drop-off, not just per-question answer breakdown above.
  // buildQuestionnaire() (sdk.js) is a strict wizard — one question at a
  // time, `current` only advances on an answer — so answering question i
  // structurally requires having answered every question before it; each
  // question's total_answers is already a valid funnel step count, not
  // something that needs its own separate "reached this step" query.
  // "Clicked" is the completion CTA's click — the only clickable target at
  // that stage, so plain `click` events are an honest proxy for it without
  // needing a dedicated event type of their own.
  const views = sqliteStore.eventCountForPopupByType(popupId, 'impression');
  const clicks = sqliteStore.eventCountForPopupByType(popupId, 'click');
  const funnelSteps = [{ label: 'Views', count: views }]
    .concat(questions.map(function (q, i) { return { label: 'Q' + (i + 1) + ' answered', count: q.total_answers }; }))
    .concat([{ label: 'Completion CTA clicked', count: clicks }]);
  const funnel = funnelSteps.map(function (step, i) {
    const prev = i === 0 ? null : funnelSteps[i - 1].count;
    return Object.assign({}, step, {
      pct_of_views: views ? Math.round((step.count / views) * 1000) / 10 : 0,
      pct_of_prev: (prev != null && prev > 0) ? Math.round((step.count / prev) * 1000) / 10 : null
    });
  });

  res.json({ popup_id: popupId, questions: questions, funnel: funnel });
});

// Gamification's own step-down (§5.5): unlike questionnaire, there's only
// one real step between viewing and picking a side — game_result fires
// once, covering the whole pick-and-reveal interaction in one event — so
// this is a shorter 3-step funnel, not a dedicated stats screen, surfaced
// inline on the popup's own Settings page instead of a nav item.
router.get('/gamification-funnel', function (req, res) {
  const popupId = req.query.popup_id;
  if (!popupId) return res.status(422).json({ error: 'validation_failed', details: [{ path: 'popup_id', message: 'required' }] });

  const popup = sqliteStore.getByExternalId(popupId);
  if (!popup || popup.template !== 'gamification') return res.status(404).json({ error: 'not_found' });

  const views = sqliteStore.eventCountForPopupByType(popupId, 'impression');
  const played = sqliteStore.eventCountForPopupByType(popupId, 'game_result');
  const clicked = sqliteStore.eventCountForPopupByType(popupId, 'click');
  const steps = [
    { label: 'Views', count: views },
    { label: 'Played (picked + revealed)', count: played },
    { label: 'Clicked CTA', count: clicked }
  ];
  const funnel = steps.map(function (step, i) {
    const prev = i === 0 ? null : steps[i - 1].count;
    return Object.assign({}, step, {
      pct_of_views: views ? Math.round((step.count / views) * 1000) / 10 : 0,
      pct_of_prev: (prev != null && prev > 0) ? Math.round((step.count / prev) * 1000) / 10 : null
    });
  });

  res.json({ popup_id: popupId, funnel: funnel });
});

router.get('/recent-events', function (req, res) {
  res.json(sqliteStore.recentEvents());
});

module.exports = router;
