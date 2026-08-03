# Project status — Libertex Popup Platform

Snapshot of what exists in this repo, what state it's in, and how to pick
the work back up. The design source of truth is
[`popup-platform-spec.md`](popup-platform-spec.md); this file is about the
*implementation* built against that spec, and what's still open.

---

## What this is

An internal popup platform for Libertex promo pages: a source system creates
popup content via API, this platform decides where/when to show it, renders
it in brand design, and reports how it performed. Two things exist side by
side in this one repo:

1. **The Phase 0 SDK spike** (repo root) — the client-side SDK that actually
   renders popups in a visitor's browser, plus a local test harness.
2. **The admin/ingestion/collector stack** (`admin/`) — a separate Express +
   React app implementing the backend the spec describes (§9, §12, §13, §14).

They're connected at runtime (the SDK's `collectUrl` posts events to the
admin server's collector; both read/write the same *shape* of `config.json`)
but are two different Node projects with their own `package.json`s.

---

## Repo map

```
popup-platform-spec.md   the design doc — source of truth, kept up to date
                          as decisions were made or corrected this session

sdk.js                   the client SDK (vanilla JS, no build step required
                          to run locally — see "known gaps" below)
tokens.css                brand design tokens, injected into the SDK's
                          Shadow DOM at runtime (see "known gaps")
config.json               example CDN config: entity_domains, legal,
                          registration_domains, consent_texts, popups
index.html                interactive test harness — manual triggers,
                          diagnostics, legal fail-safe test, collected-events
                          panel. Real popup triggers (delay/scroll/etc) are
                          live here.
templates.html            style-guide gallery — all six templates rendered
                          side by side via a preview-only SDK API
                          (renderInline()), not full-viewport triggers,
                          plus a square-shaped `modal` card (real logo,
                          adaptive wordmark) and an LBX-themed card proving
                          any template can take any theme
mock-landing-api.js       safe local stand-in for the real third-party
                          registration widget (see "registration form")
build.js / test.js        Phase-0 build/lint/test scripts — inline CSS,
                          lint banned DOM APIs, strip comments to stay
                          under the §8.1 size budget, then run 26 checks
tealium-tag.html          the loader snippet to paste into Tealium iQ

admin/
  README.md               detailed docs for everything below
  HOW_TO_SEND_CONTENT.md  practical guide for the source system: PUT a
                          popup, get it live — HMAC signing, per-template
                          content examples, troubleshooting. Every example
                          in it is verified against a running server, not
                          just written
  server/                 Express: /api/* (admin) + /v1/popups/* (ingestion,
                           §13) + /v1/events (collector, §14). index.js just
                           wires the app together — routes/ has one file per
                           resource (popups, targeting, stats, registration,
                           legalTexts, settings, ingestion), sharing
                           requireRole/audit/popup(Summary|Detail)/republish
                           from lib/adminHelpers.js
    seed.json                seed data for both the JSON store and SQLite —
                              lives outside data/ on purpose: a Railway
                              Volume mounted at data/ shadows whatever's
                              baked into the image at that path, so seed
                              data has to sit next to it, not inside it
    data/db.json            JSON store (legal texts, registration domains,
                             consent texts, settings, audit log) — mutable,
                             regenerated from seed.json by /api/dev/reset
    data/ingestion.db        SQLite: popups + raw_events (real DB, real
                              constraints — stands in for Postgres, §3.1)
    data/dist/config.json    compiled output of the publisher — what a CDN
                              would actually serve
    lib/                    targeting.js, hmacAuth.js, ingestSchemas.js,
                            collector.js, legalRegistry.js,
                            consentRegistry.js, statsAggregate.js, etc.
    scripts/                sign-request.js (manual HMAC testing),
                            test-ingest.js (18-check smoke test)
  web/                    React (Vite) admin UI — Popups, Targeting,
                           Statistics, Questionnaires, Templates, Legal
                           texts, Registration, Settings
```

---

## Run everything

```bash
cd admin/server && npm install && npm start          # :8787 — admin API + ingestion + collector
cd admin/web    && npm install && npm run dev         # :5173 — admin UI (proxies /api to :8787)
python3 -m http.server 8080                           # from repo root — serves index.html / templates.html
```

Then:
- `http://localhost:5173` — admin UI
- `http://localhost:8080/index.html` — SDK test harness (real triggers)
- `http://localhost:8080/templates.html` — template style guide (static previews)

`curl -X POST localhost:8787/api/dev/reset` resets the admin server's data
to seed state (popups, legal texts, registration domains, consent texts,
settings, raw events — not HMAC keys other than the seeded dev default).

`cd admin/server && npm run test:ingest` runs the 19-check ingestion smoke
test against a running server; `npm run test:admin-api` runs the 25-check
smoke test for the `/api/*` admin routes (popup CRUD/role-gating,
url-tester, stats, registration, legal/consent text publishing, settings).

---

## What's implemented and real (not mocked)

- **Full targeting/entity/legal resolution** — `admin/server/lib/targeting.js`
  ports the exact same logic as `sdk.js` (`resolveEntity`, `resolveLegal`,
  targeting-group evaluation, schedule/device checks), so the admin's URL
  tester gives the same answer a visitor's browser would compute.
- **Ingestion API** (§13) — real HMAC-SHA256 request signing, ajv schema
  validation per template, idempotency-key replay/conflict handling, a
  publisher that recompiles `config.json` after every mutation.
- **Collector** (§14) — origin allowlist, rate limiting, payload cap, dedup
  by `(impression_id, type, field_id, element_id)`. Verified end-to-end from
  a real browser tab through to the Statistics screen.
- **Statistics** — real aggregation over collected events; falls back to
  clearly-labeled synthetic demo data (`source: "synthetic"`) only for
  popups with zero real traffic.
- **All six templates render via the SDK** — `banner`, `modal`,
  `modal_media`, `modal_form`, `questionnaire`, `gamification` all have real
  `sdk.js` builders (`buildBanner`/`buildPanel`/`buildForm`/
  `buildQuestionnaire`/`buildGamification`), not mockups. `templates.html`
  proves this by rendering all of them through the real code path, and the
  admin app's **Templates** nav item (iframes that same page) puts the
  gallery one click away from Popups/Targeting/Statistics.
- **`questionnaire`** (§5.4) — 1–3 button-only questions, one at a time, no
  free-text input anywhere. Every tap fires `questionnaire_answer`
  immediately (no submit step); an optional `completion` message + CTA
  replaces the last question.
- **`gamification`** (§5.5) — **Market Prediction Challenge**, reworked from
  an earlier spin-to-win wheel. Visitor picks an asset (Gold/EUR-USD/
  Bitcoin, or whatever the popup configures), sees a content-supplied
  `start_price` (never a live quote this platform fetches or invents — the
  UI carries a persistent "Simulated for this challenge" disclaimer, not a
  one-time footnote), predicts higher/lower, waits out a short countdown,
  then sees a client-simulated result against the prediction. Fires
  `click` (`element_id: 'asset:<symbol>'` / `'predict:higher|lower'`) then
  `game_result` (`prize_label` = `"<symbol>:<guess>:<correct|incorrect>"`).
- **Questionnaire answer stats** — a dedicated **Questionnaires** admin
  screen (separate from the general Statistics screen) aggregates
  `questionnaire_answer` events per question/option with counts and
  percentages (`GET /api/questionnaire-stats`), computed from real
  collected events, not synthetic data.
- **Three brokers now, not two** — **LBX** (`lbx.com`/`promo.lbx.com`)
  joins `cysec`/`fcil` in `entity_domains`, with a **real** risk warning
  (sourced from `lbx.com`'s own footer: operated by MAEX LIMITED, Mauritius
  FSC-regulated, generic risk wording rather than a loss percentage — a
  materially different disclosure shape than CySEC's, which is exactly why
  the legal registry is keyed by entity rather than one hard-coded string).
  No `registration_domains` row exists for `lbx.com` yet, deliberately —
  nothing confirms it runs the same llLanding widget as Libertex (open
  question 4e).
- **Theme system clarified**: three canonical Libertex identities
  (`orange`/`black`/`white`, aliases onto existing approved pairings) plus
  three **LBX** identities (`lbx-blue`/`lbx-black`/`lbx-white`) using colours
  extracted directly from `lbx.com`'s own CSS custom properties
  (`--brand-primary: #012AFF`) and rendered buttons — not invented. Every
  template accepts every theme; `templates.html`'s last card proves it by
  rendering the same `modal` builder themed for LBX instead of Libertex.
  Validated at ingestion against a fixed enum (`ingestSchemas.js`'s
  `VALID_THEMES`), so a typo'd theme name is a `400`, not a silent break.
- **Logo — the real asset, not a recreation.** The user supplied the actual
  Libertex logo/symbol SVG files (Logo Black/White, Symbol Orange/White) at
  file paths. `buildBrandLockup()` in `sdk.js` uses their exact wordmark and
  symbol path data (background rects stripped so it's transparent; run
  through `svgo` at low precision, losslessly for practical purposes —
  verified by rendering the original file next to the minified one at
  120px and finding them visually indistinguishable). The wordmark path is
  shared between the black-bg/white-bg source files (only fill differs) and
  is stored once, coloured `currentColor` so it follows `--fg` automatically
  on any Libertex theme. The symbol defaults to the logo's own orange
  (`#FF6633` — baked into the supplied files, distinct from the platform's
  primary Electric Orange `#FF4C0B` used everywhere else, per §4.2's
  separately-sourced palette) and switches to white on an orange-family
  background specifically, using the supplied white-symbol artwork, since an
  orange symbol on an orange background loses contrast — verified live
  (`theme:'orange'` → symbol fill `#fff`, wordmark computed colour
  `rgb(0,0,0)`). Still renders nothing on LBX themes (verified live:
  `show_logo:true` + `theme:'lbx-black'` → zero `.lx-logo` elements), since
  no real LBX logo asset exists. This closes Q1e for real.
- **`modal` square shape** — `content.shape: 'square'` (§4.7.2) gives `modal`
  a fixed 1:1 aspect-ratio card: logo/heading/subhead grouped near the top,
  CTA pushed toward the bottom via `margin-top:auto`, legal slot pinned
  right after it at the bottom edge — matching the brand's own layout
  examples exactly (verified live: a 380×380 panel with the legal slot
  sitting flush against the bottom padding). `modal_media`'s schema never
  declares `shape`, so it can't accidentally reach this code path even
  though the builder is shared.
- **"Preview theme" toggle on `templates.html`** — As configured / Light /
  Dark segmented control, top right of the gallery. Light/Dark override
  every card to the same canonical pair (`white`/`black` for Libertex,
  `lbx-white`/`lbx-black` for LBX) via `renderInline()`'s idempotent re-render
  (it clears and rebuilds the container each call), so any theme, contrast,
  or logo issue can be checked without hunting for the one card that happens
  to already use that background. "As configured" restores each card's
  original demonstration theme. Verified live across all 9 cards (2 banners
  + 6 modal-family panels + the LBX card) in both directions.
- **Registration form** (§9, rewritten this session) — `modal_form` embeds
  the real third-party **llLanding** widget already live on
  `libertex.com`/`.org` (discovered from actual production page source, not
  assumed). Two new registries mirror the legal-registry pattern exactly:
  `registration_domains` (script/API key/fields per host) and
  `consent_texts` (compliance-owned wording with real links, versioned).
  Both have an admin screen (Registration) and appear in `config.json`.
- **`admin/server` restructured for size, not behavior** — `index.js` was a
  615-line file mixing app setup with ~10 unrelated route groups; it's now a
  ~60-line file that just wires together one Express Router per resource
  under `routes/` (popups, targeting, stats, registration, legalTexts,
  settings, ingestion), sharing `requireRole`/`audit`/`popupSummary`/
  `popupDetail`/`republish` from a new `lib/adminHelpers.js`. Also
  consolidated `legalRegistry.js`/`consentRegistry.js`'s byte-for-byte
  duplicate `currentlyEffective()`/`groupHistory()` into `lib/
  versionedRegistry.js`. Zero route paths, response shapes, or status codes
  changed — verified with a new `scripts/test-admin-api.js` (25 checks
  covering every moved route, including role-gating) plus the existing
  19-check `test-ingest.js`, both passing, plus a full manual click-through
  of every admin/web page. `sdk.js` was deliberately left as one file:
  splitting it would mean adding a bundler, which is a complexity increase,
  not a decrease, for a project whose stated build is "no dependencies,
  runs on any Node 14+."
- **Second simplification pass, same principle** — found two more instances
  of the identical-code-copied-N-times pattern and fixed both: (1) the
  `cysec`/`fcil`/`lbx` entity `<select>` was hand-copied 3× across
  `LegalTexts.jsx` and `Registration.jsx` — the exact duplication pattern
  that let `lbx` go missing from all three until it was fixed by hand in
  each earlier this session. Extracted to `admin/web/src/components/
  EntitySelect.jsx`; a future entity now needs adding in one place, not
  three. (2) `cta_label`/`cta_url`'s schema fragment was identical across
  `banner`/`modal`/`modal_media`/`gamification`/questionnaire's `completion`
  in `ingestSchemas.js` — extracted to a shared `CTA_FIELDS` object, spread
  in via `Object.assign`. Deliberately *not* added to `modal_form` (no
  `cta_url` field — its button submits the embedded llLanding widget, not a
  link) — verified live that `modal_form` still rejects a `cta_url` it
  doesn't declare, and that `gamification`/square-`modal`/questionnaire's
  nested `completion.cta_url` all still validate correctly, including still
  rejecting a `javascript:` URL. Considered and declined a third
  extraction: `LegalTexts.jsx` and `Registration.jsx` both render a
  "versioned history table" (same current-badge/date-range logic, 2
  instances, different columns) — a generic column-configurable table would
  cut the duplication but adds a layer of indirection for what's currently
  only 2 call sites; not worth it yet.

### The one deliberate architecture exception: Shadow DOM + `modal_form`

The llLanding widget binds to the form via `document.querySelector`, which
cannot see into a Shadow DOM. Every other template is 100% Shadow DOM
isolated (§8.2); `modal_form`'s actual `<form>` element is a **light DOM
child** of the popup host, projected into position via `<slot>`. This is
documented in the spec at §8.2 and §9.5. The practical consequence: that one
template's CSS is applied via inline styles referencing the same design
tokens (`var(--fg)`, `var(--lx-radius-sm)`, etc.) rather than shadow-scoped
classes, because `::slotted()` can only style the slotted element itself,
never its descendants. See `sdk.js`'s `FORM_STYLE`/`THEME_VARS` constants and
the comments around `buildForm()`.

## What's simulated/mocked, and why

- **`mock-landing-api.js`** stands in for the real llLanding script in all
  local testing — same call shape
  (`llLanding.create({ form, apiKey, registrationCallback })`), zero network
  calls. This was a deliberate safety choice: the real widget's API key and
  endpoint are already public (embedded in production page source), but
  nothing in this repo should ever actually submit a registration to
  Libertex's real backend. Swapping `registration_domains[host].script_src`
  to the real URL is the only change needed for a real deployment.
- Statistics synthetic fallback, SQLite standing in for Postgres, admin
  identity via a role-switcher instead of real SSO — all pre-existing,
  documented in `admin/README.md`'s "What's real vs. simulated" section.

---

## Known gaps / open items

1. ~~`build.js` / `test.js` are broken in this checkout.~~ **Fixed** — both
   scripts expected a `src/tokens.css` / `src/sdk.js` / `public/config.json`
   layout that was never actually created (the real files sit flat at the
   repo root); `build.js` and `test.js` now read from the repo root instead.
   A root `package.json` was added with `jsdom` as a devDependency (`npm
   install` once, then `node build.js` / `node test.js` both run clean — 26/26
   checks pass). `build.js` also now strips `/* */` block comments from
   `sdk.js`/`tokens.css` before measuring/shipping — the source files keep
   their full comments, but the session's feature growth (LBX theme,
   Market Prediction Challenge, questionnaire) had pushed the shipped bundle
   to 22.7 KB gzipped, over the §8.1 20 KB budget; comment-stripping alone
   brings it back to ~19.2 KB without touching runtime behavior.
2. **`window.LxPopup.__css` is populated at runtime, not build time**, in
   both `index.html` and `templates.html` — they `fetch('./tokens.css')` and
   set it before loading `sdk.js`, independent of whether `build.js` has been
   run. This is fine for local dev; a real deployment should go through the
   actual build so `dist/sdk.js` ships with CSS inlined (saves a request per
   page view, per `build.js`'s own comment).
3. **Entity naming: `"fcil"` vs `"bvi"`.** Real production Tealium calls from
   `libertex.org` send `page_broker: "bvi"`, never `"fcil"` — but this
   repo's `entity_domains`/`legal_texts`/`registration_domains` all still
   say `"fcil"` (matching the original spec, before this discrepancy was
   found). Flagged as open question 4d in the spec. Don't silently rename
   without confirming with Compliance/Analytics whether they're the same
   thing under two names or genuinely different.
4. **FCIL/bvi has no seeded consent text.** The real `.org` registration
   form snippet had no visible consent checkbox (unlike `.com`'s), so no
   fake wording was invented for it — `consent_texts` only has a real,
   evidenced `cysec`/`de` row. A `modal_form` popup on an `fcil`/`bvi` domain
   will correctly fail-safe-suppress until Compliance provides real wording.
5. **Typography (§4.3), extended color spectrum hex values (§4.2 Q1b), tone
   of voice (§4.5)** are all still placeholders per the spec's open
   questions — cosmetic, swap-in-place once Design responds. **The logo
   (§4.4) is resolved** — `buildBrandLockup()` in `sdk.js` now uses the real
   Libertex logo/symbol SVG path data, supplied directly as files, not a
   hand-traced approximation. The wordmark's actual custom typeface still
   isn't available as a font file, but the artwork itself (mark + wordmark
   as vector shapes) is the genuine asset. Two things worth knowing if this
   comes up again: (1) the symbol's own orange (`#FF6633`, baked into the
   supplied files) differs slightly from the platform's primary Electric
   Orange (`#FF4C0B`) — both are used, each in its own place, rather than
   forcing one to match the other; (2) the path data is `svgo`-minified at
   low precision to fit the §8.1 size budget — verified visually
   indistinguishable from the original at 120px before shipping it, not
   just assumed safe.
6. **Browser-automation-sandbox quirks observed this session** (documented
   inline, not real bugs): `navigator.sendBeacon` silently fails
   cross-origin in this specific sandboxed browser tool (verified via a
   working `fetch` to the identical URL — use the SDK's existing
   `fetch(keepalive)` fallback path to test instead); pure-white shadow-DOM
   backgrounds don't composite into this tool's screenshots (confirmed via
   `getComputedStyle`/`getBoundingClientRect` — real browsers render it
   fine). Neither affects real users.

## Where the spec changed from its original version

`popup-platform-spec.md` §9 (Registration form), §10.1 (threat table),
§12 (admin screens), §14.1 (events table), §16 (phases), §17 (open
questions), and the Appendix (`config.json` shape) were all rewritten this
session once real production form code revealed the original §9 design
(a self-built lead-capture-and-forward backend) doesn't match reality. Read
§9 in full before touching anything registration-related — it explains the
llLanding integration, the two new registries, and the Shadow DOM exception
with full reasoning, not just the "what."
