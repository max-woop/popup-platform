#!/usr/bin/env node
'use strict';

// Ad-hoc smoke test for the /v1 ingestion API — not the unit test suite,
// just a readable script to exercise HMAC auth, schema validation, and
// idempotency against a running server (npm start in another terminal).
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const SECRET = 'dev-secret-change-me';

function sign(method, path, body, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const payload = String(ts) + method.toUpperCase() + path + body;
  return { ts, sig: crypto.createHmac('sha256', SECRET).update(payload).digest('hex') };
}

async function call(method, path, body, { timestamp, badSig, idemKey, noAuth } = {}) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Content-Type': 'application/json' };
  if (!noAuth) {
    const { ts, sig } = sign(method, path, bodyStr, timestamp);
    headers['X-Timestamp'] = String(ts);
    headers['X-Signature'] = 'sha256=' + (badSig ? 'f'.repeat(64) : sig);
  }
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch(BASE + path, { method, headers, body: bodyStr || undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function expect(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  console.log('== auth ==');
  let r = await call('PUT', '/v1/popups/smoke-1', {}, { noAuth: true });
  expect('no auth headers -> 401', r.status === 401);

  r = await call('PUT', '/v1/popups/smoke-1', {}, { badSig: true });
  expect('bad signature -> 401', r.status === 401);

  r = await call('PUT', '/v1/popups/smoke-1', {}, { timestamp: Math.floor(Date.now() / 1000) - 1000 });
  expect('stale timestamp (>5min skew) -> 401', r.status === 401);

  console.log('== schema validation ==');
  r = await call('PUT', '/v1/popups/smoke-2', { name: 'x' }); // missing template_id/content
  expect('missing required top-level fields -> 400', r.status === 400 && r.json.details.length > 0);

  r = await call('PUT', '/v1/popups/smoke-3', {
    name: 'XSS test', template_id: 'modal',
    content: { heading: '<script>alert(1)</script>', cta_label: 'go', cta_url: 'javascript:alert(1)' }
  });
  // heading itself isn't rejected by schema (it's just a string — textContent
  // rendering is what neutralizes it, per §10.2) but the javascript: cta_url
  // must fail the https-only pattern.
  expect('javascript: cta_url rejected by schema -> 400', r.status === 400 &&
    r.json.details.some((d) => d.path.includes('cta_url')));

  r = await call('PUT', '/v1/popups/smoke-4', {
    name: 'Bad image host', template_id: 'modal_media',
    content: { heading: 'h', cta_label: 'c', cta_url: 'https://libertex.com/x', image_url: 'https://evil.example/x.png' }
  });
  expect('non-allowlisted image host rejected -> 400', r.status === 400 &&
    r.json.details.some((d) => d.path.includes('image_url')));

  r = await call('PUT', '/v1/popups/smoke-5', {
    name: 'Overlong heading', template_id: 'modal',
    content: { heading: 'x'.repeat(500), cta_label: 'c', cta_url: 'https://libertex.com/x' }
  });
  expect('heading over maxLength rejected -> 400', r.status === 400 &&
    r.json.details.some((d) => d.path.includes('heading')));

  r = await call('PUT', '/v1/popups/smoke-6', {
    name: 'Legal off without reason', template_id: 'modal',
    content: { heading: 'h', cta_label: 'c', cta_url: 'https://libertex.com/x', legal: { mode: 'off' } }
  });
  expect('legal.mode=off without off_reason rejected -> 400', r.status === 400 &&
    r.json.details.some((d) => d.path.includes('legal')));

  r = await call('PUT', '/v1/popups/smoke-7', {
    name: 'Override tries to smuggle legal', template_id: 'modal',
    content: { heading: 'h', cta_label: 'c', cta_url: 'https://libertex.com/x', overrides: { mobile: { legal: { mode: 'off' } } } }
  });
  expect('override cannot carry a legal field -> 400', r.status === 400 &&
    r.json.details.some((d) => d.path.includes('overrides')));

  console.log('== semantic validation ==');
  r = await call('PUT', '/v1/popups/smoke-8', {
    name: 'Bad dates', template_id: 'modal', starts_at: '2026-08-01T00:00:00Z', ends_at: '2026-07-01T00:00:00Z',
    content: { heading: 'h', cta_label: 'c', cta_url: 'https://libertex.com/x' }
  });
  expect('ends_at before starts_at -> 422', r.status === 422);

  console.log('== upsert + idempotency ==');
  const goodBody = {
    name: 'Autumn teaser', template_id: 'modal', status: 'live', priority: 40,
    content: { heading: 'Autumn is here', cta_label: 'See offers', cta_url: 'https://libertex.com/autumn' }
  };
  r = await call('PUT', '/v1/popups/autumn-teaser', goodBody, { idemKey: 'idem-abc' });
  expect('valid create -> 201', r.status === 201);
  const firstBody = r.json;

  r = await call('PUT', '/v1/popups/autumn-teaser', goodBody, { idemKey: 'idem-abc' });
  expect('same Idempotency-Key + same body -> replay of first response', r.status === 201 && JSON.stringify(r.json) === JSON.stringify(firstBody));

  r = await call('PUT', '/v1/popups/autumn-teaser', Object.assign({}, goodBody, { priority: 99 }), { idemKey: 'idem-abc' });
  expect('same Idempotency-Key + different body -> 409', r.status === 409);

  r = await call('PUT', '/v1/popups/autumn-teaser', Object.assign({}, goodBody, { priority: 77 }));
  expect('re-PUT same external_id without idem key -> 200 (update, not create)', r.status === 200 && r.json.priority === 77);

  console.log('== read/pause/archive/stats ==');
  r = await call('GET', '/v1/popups/autumn-teaser', null);
  expect('GET returns the popup', r.status === 200 && r.json.name === 'Autumn teaser');

  r = await call('POST', '/v1/popups/autumn-teaser/pause', null);
  expect('pause -> status paused', r.status === 200 && r.json.status === 'paused');

  r = await call('GET', '/v1/popups/autumn-teaser/stats', null);
  expect('stats endpoint responds', r.status === 200 && typeof r.json.summary === 'object');

  r = await call('DELETE', '/v1/popups/autumn-teaser', null);
  expect('archive -> status archived', r.status === 200 && r.json.status === 'archived');

  r = await call('GET', '/v1/popups/does-not-exist', null);
  expect('unknown external_id -> 404', r.status === 404);

  console.log('\nDone.');
})();
