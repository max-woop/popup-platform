'use strict';

// Shared by legalRegistry.js and consentRegistry.js — both are versioned,
// entity-scoped compliance copy (risk warning vs. consent wording) with the
// same "current row wins, history kept" lifecycle, keyed to a moment in
// time by effective_from/effective_to. Only the row → registry-entry shape
// differs between the two (legal keys by country too; consent doesn't),
// which is why each file keeps its own buildRegistry().
function currentlyEffective(rows, at) {
  const now = at ? new Date(at).getTime() : Date.now();
  return rows.filter(function (r) {
    const from = r.effective_from ? Date.parse(r.effective_from) : -Infinity;
    const to = r.effective_to ? Date.parse(r.effective_to) : Infinity;
    return now >= from && now < to;
  });
}

function groupHistory(rows) {
  const byEntity = {};
  rows
    .slice()
    .sort(function (a, b) { return b.version - a.version; })
    .forEach(function (r) {
      byEntity[r.entity] = byEntity[r.entity] || [];
      byEntity[r.entity].push(r);
    });
  return byEntity;
}

module.exports = { currentlyEffective: currentlyEffective, groupHistory: groupHistory };
