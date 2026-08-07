'use strict';

/* Periodic checks for the two §16.1 alert signals that don't happen at a
   single call site (publish failure and unusual update rate both already
   fire inline, from adminHelpers.js and hmacAuth.js respectively) — these
   two are about a *rate over a window*, so they need to be evaluated on a
   timer instead. Same shape as experiments.js's resolveDue(): run once at
   boot, then on a setInterval from index.js, and note honestly is here
   too — "SDK JS error rate" is wired and ready, but will never actually
   fire yet, because sdk.js doesn't emit an `error` event anywhere today
   (§8.3's "emit error beacon" was specified, not built). Fixing that is a
   client-side change with its own §8.1 gzip-budget cost and its own
   decision about what counts as reportable — deliberately left as a
   separate, later change rather than smuggled in here under time
   pressure. This still runs the check every cycle so the moment that
   instrumentation lands, alerting is already in place for it. */

const sqliteStore = require('./sqliteStore');
const alerts = require('./alerts');

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const ERROR_RATE_THRESHOLD = 0.005; // 0.5% of loads, per §16.1's table
const IMPRESSION_DROP_THRESHOLD = 0.5; // > 50% down vs. same hour last week

function checkImpressionDrop(now) {
  const hourEnd = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  const hourStart = new Date(hourEnd.getTime() - HOUR_MS);
  const baselineEnd = new Date(hourEnd.getTime() - WEEK_MS);
  const baselineStart = new Date(hourStart.getTime() - WEEK_MS);

  const current = sqliteStore.eventCountInWindow('impression', hourStart.toISOString(), hourEnd.toISOString());
  const baseline = sqliteStore.eventCountInWindow('impression', baselineStart.toISOString(), baselineEnd.toISOString());

  // No baseline (fresh install, or genuinely zero traffic that hour last
  // week) isn't a signal either way — alerting on it would just be noise
  // every single hour until the platform has a week of real history.
  if (baseline === 0) return;
  if (current < baseline * (1 - IMPRESSION_DROP_THRESHOLD)) {
    alerts.notify('impressions_drop',
      'Impressions for ' + hourStart.toISOString() + '–' + hourEnd.toISOString() + ' are down ' +
      Math.round((1 - current / baseline) * 100) + '% vs. the same hour last week',
      { current, baseline, hourStart: hourStart.toISOString() });
  }
}

function checkErrorRate(now) {
  const windowEnd = new Date(now);
  const windowStart = new Date(now - HOUR_MS);
  const loads = sqliteStore.eventCountInWindow('impression', windowStart.toISOString(), windowEnd.toISOString());
  if (loads === 0) return; // nothing to divide by, and nothing worth alerting on
  const errors = sqliteStore.eventCountInWindow('error', windowStart.toISOString(), windowEnd.toISOString());
  if (errors / loads > ERROR_RATE_THRESHOLD) {
    alerts.notify('sdk_error_rate',
      'SDK error rate over the last hour is ' + (100 * errors / loads).toFixed(2) + '% (' + errors + '/' + loads + ' loads)',
      { errors, loads });
  }
}

function runChecks() {
  const now = Date.now();
  checkImpressionDrop(now);
  checkErrorRate(now);
}

module.exports = { runChecks, checkImpressionDrop, checkErrorRate };
