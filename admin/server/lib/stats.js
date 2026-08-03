'use strict';

// Deterministic synthetic metrics so the Statistics screen (§14.3) has
// something to render without a real Collector/aggregation pipeline behind
// it yet. Seeded per popup+day so numbers are stable across requests instead
// of jumping around on every refresh.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return h;
}

const DEVICES = ['desktop', 'tablet', 'mobile'];

function dayKey(d) { return d.toISOString().slice(0, 10); }

function statsForPopup(popup, days, deviceFilter) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const series = [];
  let totals = { impressions: 0, views: 0, clicks: 0, closes: 0, form_starts: 0, form_submits: 0 };
  const byDevice = { desktop: 0, tablet: 0, mobile: 0 };
  const hasForm = popup.template === 'modal_form';

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const rand = mulberry32(seedFrom(popup.id + dayKey(d)));
    let impressions = 0, views = 0, clicks = 0, closes = 0, formStarts = 0, formSubmits = 0;

    DEVICES.forEach(function (device) {
      if (deviceFilter !== 'all' && deviceFilter !== device) return;
      const base = Math.floor(40 + rand() * 260);
      const devImpr = Math.round(base * (device === 'mobile' ? 1.4 : device === 'desktop' ? 1 : 0.5));
      const devViews = Math.round(devImpr * (0.55 + rand() * 0.2));
      const devCloses = Math.round(devViews * (0.3 + rand() * 0.2));
      const devClicks = Math.round(devViews * (0.05 + rand() * 0.12));
      impressions += devImpr; views += devViews; closes += devCloses; clicks += devClicks;
      byDevice[device] += devImpr;
      if (hasForm) {
        const fs = Math.round(devClicks * (0.6 + rand() * 0.3));
        const fsub = Math.round(fs * (0.4 + rand() * 0.3));
        formStarts += fs; formSubmits += fsub;
      }
    });

    series.push({
      date: dayKey(d), impressions: impressions, views: views, clicks: clicks,
      closes: closes, form_starts: formStarts, form_submits: formSubmits
    });
    totals.impressions += impressions; totals.views += views; totals.clicks += clicks;
    totals.closes += closes; totals.form_starts += formStarts; totals.form_submits += formSubmits;
  }

  const ctr = totals.views ? totals.clicks / totals.views : 0;
  const closeRate = totals.views ? totals.closes / totals.views : 0;
  const formConversion = totals.form_starts ? totals.form_submits / totals.form_starts : 0;

  return {
    popup_id: popup.id,
    range_days: days,
    summary: {
      impressions: totals.impressions,
      views: totals.views,
      clicks: totals.clicks,
      ctr: round2(ctr),
      closes: totals.closes,
      close_rate: round2(closeRate),
      form_starts: totals.form_starts,
      form_submits: totals.form_submits,
      form_conversion: hasForm ? round2(formConversion) : null
    },
    by_device: byDevice,
    timeseries: series
  };
}

function round2(n) { return Math.round(n * 1000) / 1000; }

module.exports = { statsForPopup: statsForPopup };
