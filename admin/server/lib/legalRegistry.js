'use strict';

const { currentlyEffective, groupHistory } = require('./versionedRegistry');

// Collapses the versioned legal_texts rows (§11.3.2 registry table) into the
// { entity: { country|_default: entry } } shape resolveLegal() expects —
// equivalent to what the publisher bakes into config.json (§11.3.3), except
// computed on the fly here since this prototype has no publish step yet.
function buildRegistry(rows, at) {
  const effective = currentlyEffective(rows, at);
  const registry = {};
  effective.forEach(function (r) {
    registry[r.entity] = registry[r.entity] || {};
    const key = r.country ? (r.country + (r.locale ? ':' + r.locale : '')) : '_default';
    registry[r.entity][key] = { v: r.version, required: r.required, text: r.text };
  });
  return registry;
}

module.exports = { buildRegistry: buildRegistry, groupHistory: groupHistory, currentlyEffective: currentlyEffective };
