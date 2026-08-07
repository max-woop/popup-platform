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
const experimentsRoutes = require('./routes/experiments');
const ingestionRoutes = require('./routes/ingestion');
const uploadsRoutes = require('./routes/uploads');
const experiments = require('./lib/experiments');
const monitor = require('./lib/monitor');

const PORT = process.env.PORT || 8787;
const app = express();
// Railway (and most PaaS hosts) sit the app behind exactly one reverse-proxy
// hop — without this, req.ip resolves to the proxy's own address for every
// request, silently breaking both the collector's per-visitor rate limit
// (lib/collector.js) and its geo-IP country resolution (§14.2).
app.set('trust proxy', 1);
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
app.use('/api', experimentsRoutes);
app.use('/api', uploadsRoutes);
// Served from the same origin the upload endpoint stamps into the URL it
// returns (routes/uploads.js) — image_url values it produces are only ever
// valid because this mount exists at that exact path.
app.use('/uploads', express.static(uploadsRoutes.UPLOADS_DIR));

// §15 — automatic A/B resolution. A plain setInterval rather than a real
// job scheduler: this is a single Railway process with no separate worker,
// and "check every 5 minutes whether any automatic-mode test's ends_at has
// passed" doesn't need more than that. Runs once at boot too, so a test
// whose end date passed while the process was down still resolves on the
// next deploy/restart instead of waiting a full interval.
experiments.resolveDue();
setInterval(experiments.resolveDue, 5 * 60 * 1000);

// §16.1 — the two rate-over-a-window alert signals (impressions drop,
// SDK error rate); the other four either fire inline at their own call
// site or don't apply anymore (see monitor.js's own comment). Every
// 15 minutes is frequent enough that an hour-long dip is caught with time
// to act, without re-running an hour-wide SQL scan on every request.
monitor.runChecks();
setInterval(monitor.runChecks, 15 * 60 * 1000);

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

// Same /dist/ prefix, a different physical directory: config.json above
// comes from admin/server/data/dist (the live publisher output), sdk.js
// here comes from the repo-root dist/ (node build.js's output — CSS
// pre-inlined, under the §8.1 size budget) — this is what the website
// install snippet in the admin Settings screen actually points at.
// Guarded like the other build-output mounts below: absent until
// `npm run build` has run.
const BUILT_SDK_PATH = path.join(__dirname, '..', '..', 'dist', 'sdk.js');
if (fs.existsSync(BUILT_SDK_PATH)) {
  app.get('/dist/sdk.js', function (req, res) {
    res.sendFile(BUILT_SDK_PATH);
  });
}

// Brand fonts (Q1) — build.js copies repo-root fonts/ here as part of
// `npm run build`. sdk.js resolves tokens.css's __LX_FONT_BASE__ placeholder
// against settings.configUrl, which for every real embed points at
// /dist/config.json — so fonts have to live at this exact sibling path for
// that resolution to land anywhere real.
const BUILT_FONTS_DIR = path.join(__dirname, '..', '..', 'dist', 'fonts');
if (fs.existsSync(BUILT_FONTS_DIR)) {
  app.use('/dist/fonts', express.static(BUILT_FONTS_DIR));
}

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

// /demo/sdk.js is the raw source file (unlike /dist/sdk.js above), so its
// tokens.css comes from the demo pages fetching /demo/tokens.css directly
// rather than a build-time inline — same reason this points straight at the
// repo-root fonts/ source instead of the dist/fonts/ build output.
app.use('/demo/fonts', express.static(path.join(REPO_ROOT, 'fonts')));

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
