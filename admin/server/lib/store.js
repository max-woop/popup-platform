'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
// Sibling of data/, not inside it — data/ is where a Railway Volume gets
// mounted for persistence, and Volumes shadow whatever's baked into the
// image at that path. seed.json must survive outside the mount to be
// readable on a fresh (empty) volume.
const SEED_PATH = path.join(__dirname, '..', 'seed.json');

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
