'use strict';

/**
 * Targeting, entity, and legal-resolution logic mirrored from ../../sdk.js
 * (§6.1, §11.3.2, §11.3.3) so the admin URL tester (§12.1) gives an answer
 * that matches what the SDK actually does in a visitor's browser — the
 * whole point of the tester is that it must not lie.
 */

function resolveEntity(entityDomains, hostname) {
  var host = String(hostname || '').toLowerCase().replace(/^www\./, '').split(':')[0];
  var map = entityDomains || {};
  return Object.prototype.hasOwnProperty.call(map, host) ? map[host] : null;
}

function resolveLegal(legalRegistry, popup, entity, country, locale) {
  var mode = (popup.content && popup.content.legal && popup.content.legal.mode) || 'auto';

  if (mode === 'off') {
    return { mode: 'off', text: null, version: null, suppressed: false };
  }
  if (mode === 'custom') {
    var custom = popup.content && popup.content.legal && popup.content.legal.custom_text;
    if (!custom) return { mode: 'custom', text: null, version: null, suppressed: true, reason: 'custom mode set but no custom_text' };
    return { mode: 'custom', text: custom, version: 'custom', suppressed: false };
  }

  if (!entity) {
    return { mode: 'auto', text: null, version: null, suppressed: true, reason: 'unknown host — not in entity_domains map' };
  }

  var bucket = (legalRegistry || {})[entity];
  if (!bucket) {
    return { mode: 'auto', text: null, version: null, suppressed: true, reason: 'no legal registry entries for entity "' + entity + '"' };
  }

  var entry = (country && bucket[country + ':' + locale]) ||
              (country && bucket[country]) ||
              bucket._default;

  if (!entry) {
    return { mode: 'auto', text: null, version: null, suppressed: true, reason: 'no registry row resolves for ' + entity + '/' + country };
  }
  if (entry.required === false) {
    return { mode: 'auto', text: null, version: entry.v, suppressed: false, reason: 'jurisdiction does not require a warning (Compliance decision)' };
  }
  if (!entry.text) {
    return { mode: 'auto', text: null, version: entry.v, suppressed: true, reason: 'registry row required=true but text is empty' };
  }

  return { mode: 'auto', text: entry.text, version: entry.v, suppressed: false };
}

function testOperator(actual, op, expected) {
  var a = actual == null ? '' : String(actual);
  switch (op) {
    case 'equals':      return a === String(expected);
    case 'not_equals':  return a !== String(expected);
    case 'contains':    return a.indexOf(String(expected)) !== -1;
    case 'starts_with': return a.indexOf(String(expected)) === 0;
    case 'ends_with':   return a.length >= String(expected).length &&
                               a.slice(-String(expected).length) === String(expected);
    case 'in':          return Array.isArray(expected) && expected.map(String).indexOf(a) !== -1;
    case 'not_in':      return Array.isArray(expected) && expected.map(String).indexOf(a) === -1;
    case 'exists':      return a !== '';
    case 'regex':
      try { return new RegExp(String(expected)).test(a); } catch (e) { return false; }
    default:            return false;
  }
}

// cookie/element_exists read document.cookie / the live DOM — neither exists
// for a hypothetical URL evaluated server-side. Flagged unverifiable rather
// than silently evaluated (and likely wrong), per this file's job of never
// lying to whoever's reading the URL tester's answer.
var CLIENT_ONLY_DIMENSIONS = { cookie: true, element_exists: true };

function dimensionValue(rule, ctx) {
  switch (rule.d) {
    case 'path':      return ctx.path;
    case 'url':       return ctx.url;
    case 'query':     return ctx.query ? ctx.query[rule.a] : undefined;
    case 'referrer':  return ctx.referrer;
    case 'device':    return ctx.device;
    case 'language':  return ctx.locale;
    case 'country':   return ctx.country;
    case 'datalayer': return ctx.dataLayer ? ctx.dataLayer[rule.a] : undefined;
    default:          return undefined;
  }
}

// Groups are OR within, AND across (§6.1). Returns per-rule detail so the
// URL tester can explain exactly which rule blocked a popup.
function evaluateTargeting(popup, ctx) {
  var groups = popup.targeting || [];
  if (!groups.length) return { matched: true, groups: [], hasUnverifiable: false };

  var hasUnverifiable = false;
  var groupResults = groups.map(function (group) {
    var rules = (group || []).map(function (rule) {
      var unverifiable = !!CLIENT_ONLY_DIMENSIONS[rule.d];
      if (unverifiable) hasUnverifiable = true;
      var actual = unverifiable ? undefined : dimensionValue(rule, ctx);
      var hit = unverifiable ? false : testOperator(actual, rule.op, rule.v);
      if (rule.negate && !unverifiable) hit = !hit;
      return { dimension: rule.d, attr: rule.a, operator: rule.op, expected: rule.v, actual: actual, matched: hit, unverifiable: unverifiable };
    });
    var groupMatched = rules.length === 0 ? true : rules.some(function (r) { return r.matched; });
    return { matched: groupMatched, rules: rules };
  });

  var matched = groupResults.every(function (g) { return g.matched; });
  return { matched: matched, groups: groupResults, hasUnverifiable: hasUnverifiable };
}

function withinSchedule(popup, now) {
  if (popup.starts_at && now < Date.parse(popup.starts_at)) return { ok: false, reason: 'before starts_at (' + popup.starts_at + ')' };
  if (popup.ends_at && now > Date.parse(popup.ends_at)) return { ok: false, reason: 'after ends_at (' + popup.ends_at + ')' };
  return { ok: true };
}

function allowedOnDevice(popup, device) {
  var list = popup.devices || ['desktop', 'tablet', 'mobile'];
  if (list.indexOf(device) === -1) return { ok: false, reason: 'device "' + device + '" not in devices list' };
  var ov = popup.content && popup.content.overrides && popup.content.overrides[device];
  if (ov && ov.hidden) return { ok: false, reason: 'hidden via overrides.' + device + '.hidden' };
  return { ok: true };
}

module.exports = {
  resolveEntity: resolveEntity,
  resolveLegal: resolveLegal,
  evaluateTargeting: evaluateTargeting,
  withinSchedule: withinSchedule,
  allowedOnDevice: allowedOnDevice
};
