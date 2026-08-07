'use strict';

// A/B test resolution (§15). Two ways a group resolves, both funnelling
// through resolveGroup() so pausing losers/auditing/republishing only
// happens in one place:
//   - automatic: resolveDue() runs on a timer (wired in index.js) and picks
//     the metric-leading variant once experiment.ends_at has passed.
//   - manual: an operator calls routes/experiments.js's resolve endpoint
//     and picks the winner themselves — resolveDue() never touches these,
//     since a group with no ends_at (or one in the future) never matches
//     its "past due" check regardless of mode.
// There's no separate "resolved" flag: pausing every variant except the
// winner IS the resolution, so a group already down to one live variant
// just stops appearing in liveGroups() on the next pass — nothing to
// double-resolve.

const store = require('./store');
const sqliteStore = require('./sqliteStore');
const { audit, republish } = require('./adminHelpers');

// Not a real signed-in identity — audit() only ever reads .actor.email/
// .actor.role off whatever's passed as `req`, so this satisfies that
// contract for actions nobody clicked a button to trigger.
const SYSTEM_ACTOR = { actor: { email: 'system', role: 'system' } };

// Wide enough to cover any real test's full run, not a "last N days"
// dashboard window — a test started 60 days ago should still be judged on
// its whole run when it resolves, not just its most recent slice.
const STATS_WINDOW_DAYS = 90;

function metricValue(summary, metric) {
  if (metric === 'leads') return summary.leads;
  if (metric === 'interactions') return summary.interactions;
  return summary.views ? summary.interactions / summary.views : 0; // conv_rate
}

// Every live popup, grouped by content.experiment.group, keeping only
// groups that still have more than one live variant — see the module
// comment above for why that's sufficient to mean "not yet resolved".
function liveGroups() {
  const groups = {};
  sqliteStore.listPopups().forEach((p) => {
    const exp = p.experiment;
    if (exp && exp.group && p.status === 'live') {
      (groups[exp.group] = groups[exp.group] || []).push(p);
    }
  });
  return Object.keys(groups).map((g) => groups[g]).filter((vs) => vs.length > 1);
}

function statsFor(variants) {
  const since = new Date(Date.now() - STATS_WINDOW_DAYS * 86400000).toISOString();
  return variants.map((p) => ({ popup: p, summary: sqliteStore.popupEventSummary(p.external_id, since) }));
}

// Returns the leading variant by `metric` without resolving anything —
// used both by resolveDue() and by the admin API's read-only "current
// standing" view, so a human reviewing a manual-mode test sees the exact
// same numbers automatic mode would act on.
function standings(variants, metric) {
  const rows = statsFor(variants).map((row) => Object.assign({}, row, { value: metricValue(row.summary, metric) }));
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

function resolveGroup(variants, winnerId, actorReq) {
  const winner = variants.find((p) => p.external_id === winnerId);
  if (!winner) return { ok: false, error: 'winner_not_in_group' };

  const db = store.load();
  const nowIso = new Date().toISOString();
  const group = variants[0].experiment.group;
  variants.forEach((p) => {
    if (p.external_id === winnerId) return;
    sqliteStore.setStatus(p.external_id, 'paused', nowIso);
    audit(db, actorReq, 'experiment.variant_paused', 'popup', p.external_id,
      { status: p.status }, { status: 'paused', experiment_group: group });
  });
  audit(db, actorReq, 'experiment.resolved', 'experiment', group, null, { winner: winnerId });
  store.save(db);
  republish();
  return { ok: true, winner: winnerId };
}

// Automatic-mode groups whose ends_at has passed. Skipped entirely (not
// just left alone) for manual-mode groups and for anything with no
// ends_at, so this never has to distinguish "manual" from "automatic but
// not due yet" — both just fail the same date check.
function resolveDue() {
  const now = Date.now();
  liveGroups().forEach((variants) => {
    const exp = variants[0].experiment;
    if (exp.mode !== 'automatic' || !exp.ends_at || Date.parse(exp.ends_at) > now) return;
    const metric = exp.success_metric || 'conv_rate';
    const ranked = standings(variants, metric);
    resolveGroup(variants, ranked[0].popup.external_id, SYSTEM_ACTOR);
  });
}

module.exports = { liveGroups, standings, resolveGroup, resolveDue, metricValue };
