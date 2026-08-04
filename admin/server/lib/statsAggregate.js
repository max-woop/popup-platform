'use strict';

const sqliteStore = require('./sqliteStore');

// Real aggregation over raw_events (§14.3), computed on the fly rather than
// via the hourly rollup job the spec describes — fine at prototype volume,
// not a substitute for a real aggregates table at real traffic.
function dayKey(iso) { return iso.slice(0, 10); }

function aggregateForPopup(popup, days, deviceFilter) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const events = sqliteStore.eventsForPopupSince(popup.external_id, since)
    .filter((e) => deviceFilter === 'all' || e.device === deviceFilter);

  const byDay = new Map();
  const byDevice = { desktop: 0, tablet: 0, mobile: 0 };
  const totals = { impressions: 0, views: 0, clicks: 0, closes: 0, form_starts: 0, form_submits: 0 };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(new Date(today.getTime() - i * 86400000).toISOString());
    byDay.set(d, { date: d, impressions: 0, views: 0, clicks: 0, closes: 0, form_starts: 0, form_submits: 0 });
  }

  events.forEach((e) => {
    const d = dayKey(e.occurred_at);
    const bucket = byDay.get(d);
    if (e.type === 'impression') {
      totals.impressions++;
      if (bucket) bucket.impressions++;
      byDevice[e.device] = (byDevice[e.device] || 0) + 1;
    }
    if (e.type === 'view') { totals.views++; if (bucket) bucket.views++; }
    if (e.type === 'click') { totals.clicks++; if (bucket) bucket.clicks++; }
    if (e.type === 'close') { totals.closes++; if (bucket) bucket.closes++; }
    if (e.type === 'form_start') { totals.form_starts++; if (bucket) bucket.form_starts++; }
    if (e.type === 'form_submit') { totals.form_submits++; if (bucket) bucket.form_submits++; }
  });

  const ctr = totals.views ? totals.clicks / totals.views : 0;
  const closeRate = totals.views ? totals.closes / totals.views : 0;
  const formConversion = totals.form_starts ? totals.form_submits / totals.form_starts : 0;
  const hasForm = popup.template === 'modal_form';

  return {
    popup_id: popup.external_id,
    range_days: days,
    source: 'real',
    summary: {
      impressions: totals.impressions,
      views: totals.views,
      clicks: totals.clicks,
      ctr: round(ctr),
      closes: totals.closes,
      close_rate: round(closeRate),
      form_starts: totals.form_starts,
      form_submits: totals.form_submits,
      form_conversion: hasForm ? round(formConversion) : null
    },
    by_device: byDevice,
    timeseries: Array.from(byDay.values())
  };
}

function round(n) { return Math.round(n * 1000) / 1000; }

module.exports = { aggregateForPopup };
