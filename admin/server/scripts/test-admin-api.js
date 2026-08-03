#!/usr/bin/env node
'use strict';

// Smoke test for the /api/* admin routes (routes/popups.js, targeting.js,
// stats.js, registration.js, legalTexts.js, settings.js) — run it against a
// live `npm start` server. There is no role/HMAC auth to sign here, just the
// X-Lx-Role/X-Lx-Actor headers the admin UI itself sends (§10.4's stand-in).

const BASE = process.env.BASE_URL || 'http://localhost:8787';

async function call(method, path, body, role) {
  const headers = { 'Content-Type': 'application/json', 'X-Lx-Role': role || 'compliance', 'X-Lx-Actor': 'test@libertex.com' };
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function expect(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  // Fresh, known seed state.
  let r = await call('POST', '/api/dev/reset', null, 'operator');
  expect('dev/reset -> 200 with seeded popups', r.status === 200 && r.json.popups > 0);

  console.log('== popups ==');
  r = await call('GET', '/api/popups');
  expect('GET /api/popups -> array', r.status === 200 && Array.isArray(r.json) && r.json.length > 0);
  const popupId = r.json[0].id;

  r = await call('GET', '/api/popups/' + popupId);
  expect('GET /api/popups/:id -> matches id', r.status === 200 && r.json.id === popupId);

  r = await call('GET', '/api/popups/does-not-exist');
  expect('GET unknown popup -> 404', r.status === 404);

  r = await call('PATCH', '/api/popups/' + popupId, { priority: 77 }, 'viewer');
  expect('PATCH as viewer -> 403 (requires operator)', r.status === 403);

  r = await call('PATCH', '/api/popups/' + popupId, { priority: 77 }, 'operator');
  expect('PATCH as operator -> 200, priority updated', r.status === 200 && r.json.priority === 77);

  r = await call('PATCH', '/api/popups/' + popupId, { legal: { mode: 'custom', custom_text: 'x' } }, 'operator');
  expect('PATCH legal.mode=custom as operator -> 403 (compliance only, §11.3.1)', r.status === 403);

  r = await call('POST', '/api/popups/' + popupId + '/pause', null, 'operator');
  expect('pause -> status paused or live (toggled)', r.status === 200 && ['paused', 'live'].includes(r.json.status));

  console.log('== targeting / url-tester ==');
  r = await call('POST', '/api/url-tester', { url: 'https://libertex.com/promo/summer', device: 'desktop', dataLayer: {} });
  expect('url-tester resolves cysec for libertex.com', r.status === 200 && r.json.resolved_entity === 'cysec');

  r = await call('POST', '/api/url-tester', { url: 'not a url' });
  expect('url-tester rejects malformed URL -> 422', r.status === 422);

  console.log('== stats / questionnaires ==');
  r = await call('GET', '/api/stats?popup_id=' + popupId);
  expect('GET /api/stats -> array with a summary', r.status === 200 && Array.isArray(r.json) && r.json[0].summary);

  r = await call('GET', '/api/questionnaire-popups');
  expect('GET /api/questionnaire-popups -> only questionnaire templates', r.status === 200 && r.json.every((p) => p.template === 'questionnaire'));

  if (r.json.length) {
    const qId = r.json[0].id;
    r = await call('GET', '/api/questionnaire-stats?popup_id=' + qId);
    expect('GET /api/questionnaire-stats -> has questions[]', r.status === 200 && Array.isArray(r.json.questions));
  }

  r = await call('GET', '/api/recent-events');
  expect('GET /api/recent-events -> array', r.status === 200 && Array.isArray(r.json));

  console.log('== registration ==');
  r = await call('GET', '/api/registration-domains');
  expect('GET /api/registration-domains -> object', r.status === 200 && typeof r.json === 'object');

  r = await call('POST', '/api/registration-domains', { host: 'test.libertex.com', entity: 'cysec', script_src: 'https://lib.libertex.com/x.js', api_key: 'k' }, 'operator');
  expect('POST registration-domains as operator -> 403 (compliance only)', r.status === 403);

  r = await call('POST', '/api/registration-domains', { host: 'test.libertex.com', entity: 'cysec', script_src: 'https://lib.libertex.com/x.js', api_key: 'k' }, 'compliance');
  expect('POST registration-domains as compliance -> 201', r.status === 201);

  r = await call('GET', '/api/consent-texts');
  expect('GET /api/consent-texts -> registry + history', r.status === 200 && r.json.registry && r.json.history);

  console.log('== legal texts ==');
  r = await call('GET', '/api/legal-texts');
  expect('GET /api/legal-texts -> domains + registry + history', r.status === 200 && r.json.domains && r.json.registry && r.json.history);

  r = await call('POST', '/api/legal-texts', { entity: 'cysec', text: 'test warning', effective_from: new Date().toISOString() }, 'compliance');
  expect('POST legal-texts as compliance -> 201', r.status === 201);

  console.log('== settings ==');
  r = await call('GET', '/api/settings');
  expect('GET /api/settings -> has kill_switch', r.status === 200 && typeof r.json.kill_switch === 'boolean');

  r = await call('PUT', '/api/settings', { kill_switch: true }, 'operator');
  expect('PUT settings kill_switch=true -> reflected', r.status === 200 && r.json.kill_switch === true);
  await call('PUT', '/api/settings', { kill_switch: false }, 'operator'); // restore

  r = await call('POST', '/api/settings/api-keys', { name: 'test key' }, 'operator');
  expect('POST api-keys -> 201 with a secret', r.status === 201 && !!r.json.secret);
  const keyId = r.json.id;

  r = await call('DELETE', '/api/settings/api-keys/' + keyId, null, 'operator');
  expect('DELETE api-keys/:id -> 204', r.status === 204);

  r = await call('GET', '/api/audit-log');
  expect('GET /api/audit-log -> array, has entries from the calls above', r.status === 200 && Array.isArray(r.json) && r.json.length > 0);

  r = await call('GET', '/api/ingest-audit-log');
  expect('GET /api/ingest-audit-log -> array', r.status === 200 && Array.isArray(r.json));

  // Leave the store in a clean, seeded state for whatever runs next.
  r = await call('POST', '/api/dev/reset', null, 'operator');
  expect('final dev/reset -> 200', r.status === 200);

  console.log('\nDone.');
})();
