'use strict';

const { currentlyEffective, groupHistory } = require('./versionedRegistry');

// Same versioning shape as legalRegistry.js, keyed by entity+locale instead
// of entity+country — consent wording is compliance copy exactly like the
// risk warning (§9.4), so it gets the same "current row wins, history kept"
// treatment rather than being typed per popup.
function buildRegistry(rows, at) {
  const effective = currentlyEffective(rows, at);
  const registry = {};
  effective.forEach(function (r) {
    registry[r.entity] = registry[r.entity] || {};
    registry[r.entity][r.locale] = { v: r.version, text_template: r.text_template, links: r.links };
  });
  return registry;
}

module.exports = { buildRegistry: buildRegistry, groupHistory: groupHistory, currentlyEffective: currentlyEffective };
