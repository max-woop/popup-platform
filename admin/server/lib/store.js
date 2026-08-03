'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const SEED_PATH = path.join(__dirname, '..', 'data', 'seed.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.copyFileSync(SEED_PATH, DB_PATH);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Prototype-scale store: whole file rewritten on every mutation. Fine for a
// single-operator admin tool backed by a handful of KB of JSON; a real
// deployment is Postgres (§3.1), not this.
function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function reset() {
  fs.copyFileSync(SEED_PATH, DB_PATH);
  return load();
}

module.exports = { load, save, reset };
