'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const store = require('./lib/store');
const publisher = require('./lib/publisher');
const collector = require('./lib/collector');

const popupsRoutes = require('./routes/popups');
const targetingRoutes = require('./routes/targeting');
const statsRoutes = require('./routes/stats');
const registrationRoutes = require('./routes/registration');
const legalTextsRoutes = require('./routes/legalTexts');
const settingsRoutes = require('./routes/settings');
const ingestionRoutes = require('./routes/ingestion');

const PORT = process.env.PORT || 8787;
const app = express();
app.use(cors());
// Capture the raw body alongside the parsed one — HMAC verification (§10.4)
// signs the exact bytes the source system sent, not a re-serialization.
app.use(express.json({ limit: '256kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// Simulated identity (§10.4: real deployment uses corporate SSO/OIDC with
// Viewer/Operator roles, plus Compliance for the legal registry per §11.3.6).
// The frontend's role switcher sends these headers; there is no real auth
// here, which is fine for a local admin prototype and not fine for anything
// that touches real popups.
app.use(function (req, res, next) {
  req.actor = {
    email: req.header('x-lx-actor') || 'demo@libertex.com',
    role: (req.header('x-lx-role') || 'viewer').toLowerCase()
  };
  next();
});

app.use('/api', popupsRoutes);
app.use('/api', targetingRoutes);
app.use('/api', statsRoutes);
app.use('/api', registrationRoutes);
app.use('/api', legalTextsRoutes);
app.use('/api', settingsRoutes);

// §14 — the Collector. Deliberately outside the HMAC-authed v1 router: a
// visitor's browser can't hold a signing secret, so this is authorized by
// shape-of-traffic (origin allowlist, rate limit, payload cap, dedup)
// instead (§10.4). Matches the SDK's `settings.collectUrl` (sdk.js §14.2).
// Registered before the /v1 router below so verifyIngestAuth never sees it.
app.post('/v1/events', collector.handleEvents);

app.use('/v1', ingestionRoutes);

// Serves the compiled config.json the way a CDN would (§3) — for local
// testing only; production serves this from S3 + CloudFront (§3.1).
app.get('/dist/config.json', function (req, res) {
  res.sendFile(publisher.CONFIG_PATH);
});

// Deployment (e.g. Railway) runs this as the single web process, so it also
// serves the built admin UI and the root-level SDK test harness — locally
// these are served by separate dev servers instead (admin/web's Vite dev
// server, `npx serve` for the harness), so both mounts are guarded and
// silently absent until `npm run build` has produced them.
const ADMIN_WEB_DIST = path.join(__dirname, '..', 'web', 'dist');
const REPO_ROOT = path.join(__dirname, '..', '..');

if (fs.existsSync(ADMIN_WEB_DIST)) {
  app.use(express.static(ADMIN_WEB_DIST));
}

// Explicit allowlist rather than express.static(REPO_ROOT) — the repo root
// also holds node_modules, .git, package.json, etc. that must never be served.
// config.json is deliberately NOT in this list: the repo-root copy is a
// frozen fixture for the root SDK spike's own test.js, not live data. The
// demo pages need the same publisher output /dist/config.json serves —
// otherwise every admin edit (popups, entity_domains, everything) would
// silently never appear on /demo/index.html or /demo/templates.html.
const DEMO_FILES = ['index.html', 'templates.html', 'sdk.js', 'tokens.css', 'mock-landing-api.js'];
DEMO_FILES.forEach(function (file) {
  app.get('/demo/' + file, function (req, res) {
    res.sendFile(path.join(REPO_ROOT, file));
  });
});

app.get('/demo/config.json', function (req, res) {
  res.sendFile(publisher.CONFIG_PATH);
});

// SPA catch-all for the React Router admin UI — must come last so it never
// shadows the /api, /v1, /dist, or /demo routes above.
if (fs.existsSync(ADMIN_WEB_DIST)) {
  app.get('*', function (req, res) {
    res.sendFile(path.join(ADMIN_WEB_DIST, 'index.html'));
  });
}

publisher.publish(store.load());

app.listen(PORT, function () {
  console.log('popup admin + ingestion API listening on http://localhost:' + PORT);
  console.log('dev HMAC key: id=key-dev-default secret=dev-secret-change-me (see scripts/sign-request.js)');
});
