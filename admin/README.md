# Popup Platform — Admin UI + Ingestion API + Collector

Implements §12 (admin tool), §13 (ingestion API), and §14 (collector) of
`popup-platform-spec.md`.

```
admin/
  server/   Express — /api/* (admin: targeting eval, stats, legal registry,
            registration-domain + consent-text registries, settings, audit
            log), /v1/popups/* (§13 ingestion: HMAC auth, schema validation,
            idempotency, publish), and POST /v1/events (§14 collector:
            origin allowlist, rate limit, payload cap, dedup).
            Popups + raw events live in SQLite (data/ingestion.db); everything else
            (legal texts, registration domains, consent texts, settings, audit log)
            is a JSON file store (data/db.json, seeded from ../seed.json —
            kept outside data/ so it survives a Railway Volume mounted there).
            index.js just wires an Express app together — the actual routes
            live one file per resource in routes/ (popups, targeting, stats,
            registration, legalTexts, settings, ingestion, experiments §15,
            uploads §12.2), sharing requireRole/audit/popupSummary/
            popupDetail/republish from lib/adminHelpers.js. Two things run
            on a timer rather than per-request: lib/experiments.js resolves
            due A/B tests, lib/monitor.js checks the two rate-over-a-window
            alert signals (§16.1) — both setInterval, both also run once at
            boot. scripts/test-admin-api.js smoke-tests all of it;
            scripts/test-ingest.js covers /v1 specifically.
  web/      React (Vite) admin UI — one screen per §12 row.
```

No Leads screen — §9's rewrite means registration goes through the existing
llLanding widget straight to Libertex's real backend; this platform never
captures a lead to store, search, or forward.

Both route groups share one popup table, so a popup created via `/v1` PUT
shows up in the admin Popup list immediately, and pausing it in the admin UI
is reflected the next time `/v1` or the URL tester reads it.

## Run it

```bash
cd admin/server && npm install && npm start   # http://localhost:8787
cd admin/web    && npm install && npm run dev # http://localhost:5173 (proxies /api)
```

`POST /api/dev/reset` restores the seed popups/legal-texts/registration-domains/
consent-texts/settings (doesn't touch HMAC keys other than the seeded dev default).

## Ingestion API (§13)

`PUT /v1/popups/:external_id` — full request/response contract at
`popup-platform-spec.md` §13.1. Requires:

- `X-Timestamp` (unix seconds) and `X-Signature: sha256=<hex>`, where the hex
  is `HMAC-SHA256(secret, timestamp + METHOD + path + rawBody)` (§10.4).
  Rejects >5 min skew. `lib/hmacAuth.js`.
- Schema validation per template (`lib/ingestSchemas.js`, ajv) — the same
  constraints as §5.1: maxLengths, `image_url` restricted to
  `cdn.libertex.*`, `cta_url`/other URLs restricted to `https://`, `legal`
  forbidden inside `overrides.*` (structural, §11.3.4), `off` mode requires
  `off_reason`, `custom` requires `custom_text`. Failures → `400` with
  field-level `details`.
- Semantic checks (`ends_at` before `starts_at`, etc.) → `422`.
- `Idempotency-Key` — same key + same body replays the original response
  (including its status code); same key + different body → `409`.
- Successful writes trigger `lib/publisher.js`, which recompiles
  `data/dist/config.json` (the Appendix shape) — served locally at
  `GET /dist/config.json`, standing in for the CDN artifact (§3).

Other routes: `GET /v1/popups/:external_id`, `POST .../pause`,
`DELETE /v1/popups/:external_id` (archive), `GET .../stats`.

**Getting a signed request:**

```bash
node admin/server/scripts/sign-request.js PUT /v1/popups/my-popup '{"...":"..."}'
# prints -H "X-Timestamp: ..." -H "X-Signature: sha256=..." to paste into curl
```

A dev key is seeded automatically: `id=key-dev-default`,
`secret=dev-secret-change-me` (printed on server boot). Issuing a new key
from the admin Settings screen also inserts a real HMAC secret — that key
immediately works against `/v1`; revoking it there immediately stops it from
authenticating. The two *original seed* keys shown in Settings
("Source system production/staging") are mock display-only rows with no
matching secret — they predate this feature and can't sign requests; issue a
fresh one instead.

`admin/server/scripts/test-ingest.js` is a smoke-test script (not a unit
test suite) covering auth, schema/semantic validation, idempotency
replay/conflict, and the read/pause/archive/stats routes — run it against a
live `npm start` server (`npm run test:ingest`). `scripts/test-admin-api.js`
(`npm run test:admin-api`) is the equivalent for the `/api/*` admin routes —
popup CRUD/role-gating, url-tester, stats, questionnaire stats, registration,
consent/legal text publishing, settings, and API keys.

## Collector (§14)

`POST /v1/events` — unauthenticated by necessity (a visitor's browser can't
hold an HMAC secret), so it's gated by shape-of-traffic instead (§10.4):

- **Origin allowlist** (`lib/collector.js`, `COLLECTOR_ALLOWED_ORIGINS` env
  var) — defaults to `localhost:8080`/`127.0.0.1:8080` (the root repo's
  Phase-0 spike harness) and `localhost:5173` (this admin app). Anything
  else → `403`.
- **Rate limit** — 120 batches/minute per IP hash (in-memory sliding
  window), **payload cap** — 50 events/batch, **dedup** — unique on
  `(impression_id, type, field_id, element_id)`, so a `sendBeacon` retry or
  overlapping flush doesn't double-count.
- A coarse "implausible timing" check (event more than 1 min in the future
  or >24h old) stands in for the full bot-filtering pass §14.3 describes at
  aggregation time.

Events land in `raw_events` (SQLite) and `GET /api/stats` aggregates them
live (`lib/statsAggregate.js`) — always real, correctly zero-filled data,
no synthetic fallback. A popup with no traffic yet just shows zeros with a
plain "no events collected yet" message, not fabricated numbers.

**Wired to the Phase-0 SDK spike** (`../index.html`, `../sdk.js` at the repo
root): `collectUrl` there now points at `http://localhost:8787/v1/events`
(previously `./collect-noop` — the spike explicitly deferred this). Serve
that page (`python3 -m http.server 8080` from the repo root) with this
server running, trigger a popup, and its events land here — the harness's
new "Collected events" panel reads them back via `GET /api/recent-events`.

**Known quirk, not a bug in this code:** in at least one browser-automation
sandbox, `navigator.sendBeacon` silently fails cross-origin (preflight
succeeds, the actual POST doesn't) while a plain `fetch` to the identical
URL succeeds instantly. `sdk.js`'s existing `fetch(keepalive: true)`
fallback (§8.3's documented failure path, used when `sendBeacon` is
unavailable) was verified instead and works correctly. Ordinary browsers
support `sendBeacon` cross-origin without issue; this only surfaced under
automated control.

## Identity and roles

There's no real SSO here — the spec calls for corporate SSO/OIDC (§10.4) for
the *admin* UI, which is out of scope for a local prototype (the ingestion
API's auth, above, is real HMAC). The role switcher in the top bar sends
`X-Lx-Role` / `X-Lx-Actor` headers that the server trusts, standing in for
three identities:

| Role | Can |
|---|---|
| Viewer | Read everything |
| Operator | Pause/archive popups, edit schedule/targeting/frequency/devices, toggle legal `auto`/`off`, kill switch, API keys |
| Compliance | Everything Operator can, **plus** set legal mode to `custom` (§11.3.1) and publish new Legal texts registry versions (§11.3.6) |

Every mutation is written to the admin audit log (Settings screen); ingestion
writes go to a separate `ingest_audit` table (`GET /api/ingest-audit-log`),
matching §10.4's "all mutations write to an audit log" requirement.

## What's real vs. simulated

**Real:**
- HMAC request signing, schema validation, idempotency, and the popup store
  itself (SQLite, not a JSON blob) for the ingestion API.
- The Collector (§14): origin/rate-limit/payload/dedup controls, and real
  event storage — verified end-to-end from the actual `sdk.js` running in a
  browser through to the Statistics screen (see Collector section above).
- Targeting/entity/legal resolution shares logic with `../sdk.js`
  (`lib/targeting.js` ports `resolveEntity`, `resolveLegal`, targeting-group
  evaluation, schedule, and device checks — §6.1, §11.3.2, §11.3.3 — including
  the exact-hostname match and the fail-safe suppression rule). The URL
  tester (§12.1) calls this, so its answer is the one a visitor's browser
  would actually compute.

**Simulated:**
- The hourly-rollup aggregation job §14.3 describes doesn't exist — stats
  aggregate `raw_events` on the fly instead, fine at prototype volume.
- `mock-landing-api.js` (repo root) stands in for the real llLanding widget —
  same call shape, zero network calls, so registration-form previews never
  hit Libertex's actual registration API (§9.1). Real deployments point
  `registration_domains[host].script_src` at the real widget URL instead.
- SQLite stands in for PostgreSQL (§3.1) — real transactions and constraints,
  but no separate DB process; fine for this prototype, not a production claim.
- Admin identity — see Identity and roles, above.

## Screens (§12)

Popup list · Popup settings (schedule, frequency, trigger, devices, legal
toggle) · Targeting (rule builder + URL tester — built first, per §12.1's
"highest-value feature" call-out) · Statistics · Questionnaires (per-question
answer counts/percentages for `questionnaire`-template popups, aggregated
from real `questionnaire_answer` events via `GET /api/questionnaire-stats`)
· Templates (all seven template previews, every theme, §5 — embeds
`../../templates.html` via iframe rather than reimplementing the gallery, so
there's one source of truth) · Legal texts (registry, version history,
Compliance-only publish) · Registration (registration-domain + consent-text
registries, mirrors Legal texts — §9.3, §9.4) · Settings (kill switch, global
caps, API keys, audit log).

Templates screen requires the repo-root static server running
(`python3 -m http.server 8080` from the repo root) — it's a separate process
from `admin/server`/`admin/web`, documented in the repo-root README.
