#!/usr/bin/env node
'use strict';

// Prints ready-to-use curl headers for a §10.4-signed ingestion request.
//
//   node scripts/sign-request.js PUT /v1/popups/test-1 '{"name":"x", ...}' [secret]
//
// Defaults to the seeded dev key (id=key-dev-default, secret=dev-secret-change-me).
const crypto = require('crypto');

const [, , method, path, body = '', secret = 'dev-secret-change-me'] = process.argv;

if (!method || !path) {
  console.error('Usage: node scripts/sign-request.js <METHOD> <PATH> [JSON_BODY] [SECRET]');
  process.exit(1);
}

const timestamp = Math.floor(Date.now() / 1000);
const payload = String(timestamp) + method.toUpperCase() + path + body;
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

console.log('-H "X-Timestamp: ' + timestamp + '"');
console.log('-H "X-Signature: sha256=' + signature + '"');
