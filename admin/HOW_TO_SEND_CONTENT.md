# How to send popup content

For the **source system** — whatever creates and updates popup content (a
campaign tool, a CMS, a script someone runs by hand). This is the practical,
copy-pasteable version of `popup-platform-spec.md` §13; read that for the
*why*, read this for the *how*.

**The short version:** `PUT` a JSON document to
`/v1/popups/{your_external_id}`, signed with HMAC-SHA256, and it's live
within seconds (a real deployment budgets 90s end-to-end, §2). No login, no
admin UI action required — the admin app is for targeting/stats/kill-switch,
not for authoring; content always comes from you.

---

## 1. Get an API key

Ask an Operator to issue one from the admin app's **Settings** screen
("Issue new key"). You'll get a name, an ID, and a **secret shown exactly
once** — store it in whatever secrets manager your source system uses. If
you lose it, ask for a new one; keys don't come back, only forward.

Local dev has a working key out of the box, no admin action needed:
```
id:     key-dev-default
secret: dev-secret-change-me
```
Everything below uses that key against `http://localhost:8787` — swap in
your own host and a real, non-default key for anything beyond local
testing. Current production deployment:
```
https://popup-banner-platform-production.up.railway.app
```

## 2. Sign the request

Every `/v1/popups/*` request needs two headers:

```
X-Timestamp: <unix seconds>
X-Signature: sha256=<hex>
```

The signature is `HMAC-SHA256(secret, timestamp + METHOD + path + rawBody)`
— note **no separators** between those four parts, and `path` includes the
leading `/v1/...` (not the host), and `rawBody` is the exact bytes you're
about to send (empty string for a body-less request like `GET`).

```js
// Node — also see admin/server/scripts/sign-request.js, same logic
const crypto = require('crypto');
const timestamp = Math.floor(Date.now() / 1000);
const method = 'PUT';
const path = '/v1/popups/my-popup-id';
const body = JSON.stringify(payload); // exact string you'll POST
const signature = crypto
  .createHmac('sha256', secret)
  .update(String(timestamp) + method + path + body)
  .digest('hex');
```

```bash
# Or from the shell, no admin server required:
node admin/server/scripts/sign-request.js PUT /v1/popups/my-popup-id '{"...":"..."}'
# prints ready-to-paste -H "X-Timestamp: ..." -H "X-Signature: sha256=..."
```

**Clock skew matters.** Requests more than 5 minutes off the server's clock
are rejected (`401`) — this is what stops a captured request from being
replayed hours later, so don't cache a signature and reuse it.

## 3. Send it

```bash
curl -X PUT http://localhost:8787/v1/popups/summer-promo-2026 \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: 1785700000" \
  -H "X-Signature: sha256=<computed above>" \
  -d '{
    "name": "Summer promo 2026",
    "template_id": "modal_media",
    "status": "live",
    "priority": 50,
    "starts_at": "2026-08-01T00:00:00Z",
    "ends_at": "2026-08-31T23:59:59Z",
    "devices": ["desktop", "tablet", "mobile"],
    "trigger": { "type": "delay", "value": 2000 },
    "frequency": { "max_impressions": 2, "per": "session", "dismiss_ttl_days": 14 },
    "targeting": [[ { "d": "path", "op": "starts_with", "v": "/promo" } ]],
    "content": {
      "theme": "orange",
      "heading": "Markets move fast",
      "body": "Open an account in minutes and start trading on desktop or mobile.",
      "image_url": "https://cdn.libertex.com/promo/summer.webp",
      "image_alt": "Trader looking at charts on a laptop",
      "cta_label": "Open an account",
      "cta_url": "https://libertex.com/signup",
      "legal": { "mode": "auto" }
    }
  }'
```

`{your_external_id}` in the URL — `summer-promo-2026` above — is **yours to
pick and reuse**. PUT-ing the same `external_id` again updates that popup in
place (`200`); a new one creates it (`201`). There's no separate "create"
vs. "update" call — upsert semantics, on purpose, so a retry after a network
blip is always safe.

## 4. Read the response

| Code | Meaning | What to do |
|---|---|---|
| `200` | Updated existing popup | Nothing — you're done |
| `201` | Created new popup | Nothing — you're done |
| `400` | Schema validation failed | Fix the field(s) named in `details`, retry |
| `401` | Bad signature or clock skew | Recheck secret/timestamp/path — see §2 |
| `409` | `Idempotency-Key` reused with a different body | You reused a key for a genuinely different request — use a new key, or confirm the body matches what you sent before |
| `422` | Semantically invalid (e.g. `ends_at` before `starts_at`) | Fix the logic error named in `details`, retry |
| `429` | More than 120 requests from your key in the last 60s | Back off and retry after the window rolls over — this is a per-key sliding window, not a hard daily cap |

`400`/`422` bodies are always field-level, so you can act on them without
guessing:
```json
{
  "error": "validation_failed",
  "details": [
    { "path": "content.heading", "message": "must NOT have more than 80 characters" },
    { "path": "content.image_url", "message": "must match pattern \"^https://cdn\\.libertex\\..*\"" }
  ]
}
```

## 5. Idempotency (optional, recommended for anything automated)

Add `Idempotency-Key: <a UUID you generate>` to a `PUT`. Retry the exact
same request with the exact same key as many times as you want — you get
the exact same response back (`200`/`201`, same body), not a second
creation. Reuse the key with a **different** body and you get `409`,
loudly, instead of the platform quietly picking one version. Skip it for
anything you're only ever sending once by hand.

## 6. Other endpoints

```
GET    /v1/popups/{external_id}          read current state
POST   /v1/popups/{external_id}/pause    immediate suppression (toggles)
DELETE /v1/popups/{external_id}          archive (soft delete)
GET    /v1/popups/{external_id}/stats    impressions/views/clicks/etc back to you
```

All four need the same `X-Timestamp`/`X-Signature` headers as `PUT` (empty
string for the body portion of the signature on `GET`/`DELETE`/`POST`
without a body).

## 7. A/B testing (optional)

Nothing to opt into up front — a test starts the moment you `PUT` two (or
more) `status: "live"` popups that share the same `experiment.group`.
Each is one variant; whichever isn't paused stays live. There's no
separate campaign-level object to create first and no separate "launch"
call — the two `PUT`s above already are the launch.

`experiment` is a top-level field, a sibling of `trigger`/`frequency`/
`targeting`, not something inside `content` — it decides *which popup* a
visitor sees, not what that popup displays once picked.

```bash
# Variant A
curl -X PUT http://localhost:8787/v1/popups/hero-cta-test-a \
  -H "Content-Type: application/json" -H "X-Timestamp: ..." -H "X-Signature: ..." \
  -d '{
    "name": "Hero CTA test — A",
    "template_id": "modal",
    "status": "live",
    "experiment": { "group": "hero-cta-test", "variant": "A", "weight": 50 },
    "content": { "heading": "Markets move fast", "cta_label": "View instruments", "cta_url": "https://libertex.com/instruments" }
  }'

# Variant B — same group, different variant label and content
curl -X PUT http://localhost:8787/v1/popups/hero-cta-test-b \
  -H "Content-Type: application/json" -H "X-Timestamp: ..." -H "X-Signature: ..." \
  -d '{
    "name": "Hero CTA test — B",
    "template_id": "modal",
    "status": "live",
    "experiment": { "group": "hero-cta-test", "variant": "B", "weight": 50 },
    "content": { "heading": "Markets move fast", "cta_label": "See what'"'"'s trending", "cta_url": "https://libertex.com/instruments" }
  }'
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `experiment.group` | string, 1–80 chars, required | — | Same value on every variant in the test. Any string you like — it's never shown to visitors. |
| `experiment.variant` | string, 1–20 chars, required | — | Your label for this arm (`"A"`, `"control"`, …), shown in the admin UI only. |
| `experiment.weight` | integer, 1–100 | `50` | Relative traffic share. Doesn't need to sum to 100 across the group. |
| `experiment.mode` | `"manual"` \| `"automatic"` | `"manual"` | `manual` — someone declares a winner in the admin UI, whenever they want. `automatic` — resolves itself once `ends_at` passes, no admin action needed. |
| `experiment.success_metric` | `"leads"` \| `"interactions"` \| `"conv_rate"` | `"conv_rate"` | Which stat `automatic` mode ranks variants by. Ignored in `manual` mode. |
| `experiment.ends_at` | ISO date-time or `null` | `null` | **Required** if `mode: "automatic"` — rejected with a `422` otherwise, since there'd be no deadline to resolve on. |

A visitor who lands on either variant keeps seeing that same one on every
later visit — assignment is sticky per visitor, not re-rolled per
pageview. Resolving a test (manually via the admin "Declare winner"
button, or automatically once `ends_at` passes) pauses every variant
except the winner — `PATCH`ing their `status` back to `"live"` yourself,
same as unpausing any other popup, undoes that if needed. Nothing is
deleted. Every variant still goes through the normal schema/legal checks
independently — including the `broker: "libertex.com"` fail-safe above —
so a test is never a way to get non-compliant content live on one arm.

This platform never picks a winner for you unprompted in `manual` mode; if
you want a fully hands-off test, set `mode: "automatic"` and `ends_at` up
front. Full design and resolution mechanics: spec §15.

---

## Content parameter reference

One table, every field `content` can hold across all seven templates — for
the exact JSON shape per template (which fields go together, full working
examples), see **Content shape per template** right below this. This table
is generated from the actual validation schema
(`admin/server/lib/ingestSchemas.js`), not hand-maintained separately, so
it can't drift from what the API actually accepts.

| Field | Type / limit | Templates | Required |
|---|---|---|---|
| `heading` | string, ≤80 chars (≤120 on `banner`) | all seven | ✓ everywhere it appears |
| `subheading` | string, ≤100 chars | `modal` | — |
| `body` | string, ≤400 chars (`modal`, `modal_media`, `modal_form`, `modal_form_media`) or ≤200 (`questionnaire`, `gamification`) | all except `banner` | — |
| `cta_label` | string, ≤30 chars | `banner`, `modal`, `modal_media`, `modal_form`, `modal_form_media`, `gamification`, `questionnaire.completion` | `modal_media` only |
| `cta_url` | string, must start `https://` | `banner`, `modal`, `modal_media`, `gamification`, `questionnaire.completion` | `modal_media` only |
| `image_url` | string, must match `https://cdn.libertex.*` — any other host is a `400`, no exceptions | `modal_media`, `modal_form_media` | ✓ on `modal_media`, optional on `modal_form_media` |
| `image_alt` | string, ≤125 chars | `modal_media`, `modal_form_media` | — |
| `theme` | one of the 18 canonical names — see below | all seven | — |
| `show_logo` | boolean, default `false` | all seven | — |
| `offer` | string, ≤80 chars — free-text campaign/offer label, shown as its own column on the admin Popups list | all seven | — |
| `broker` | one of `"libertex.com"`, `"libertex.org"`, `"fxclub.org"`, `"lbx.com"` — same domain keys the `entity_domains`/`registration_domains` registries use, not an independent label (§11.3.7) | all seven | ✓ on `modal_form`/`modal_form_media` only |
| `shape` | `"auto"` \| `"square"`, default `"auto"` | `modal` | — |
| `position` | `"top"` \| `"bottom"`, default `"top"` | `banner` | — |
| `countdown` | boolean, default `false` — formats this popup's own top-level `ends_at` into a live countdown next to the CTA | `banner`, `modal`, `modal_media` | requires top-level `ends_at` to be set — `422` otherwise |
| `proof_text` | string, ≤80 chars — a short trust line rendered as-is next to the CTA (`"140 accounts opened this week"`), never a live count this platform computes | `modal`, `modal_media` | — |
| `legal` | object — see **Legal modes** below | all seven | — (defaults to `{ "mode": "auto" }`) |
| `overrides` | object, one key per device — see below | all seven | — |
| `questions` | array, 1–3 items | `questionnaire` | ✓ |
| `completion` | object (`heading`/`body`/`cta_label`/`cta_url`) | `questionnaire` | — |
| `duration_ms` | integer, 2000–15000, default 5000 | `gamification` | — |
| `volatility_pct` | number, 0.05–5 | `gamification` | — |
| `win_body` / `lose_body` | string, ≤200 chars each | `gamification` | — |
| `assets` | array, 1–4 items (`symbol`/`label`/`start_price` each) | `gamification` | ✓ |

**`modal_form` and `modal_form_media` have no `cta_url`.** Their button
submits the embedded registration widget, not a link — see those
templates' sections below for why the rest of the form (fields, consent
wording) isn't content you send at all. `modal_form_media` is otherwise
identical to `modal_form` with one field added, the same way `modal_media`
is `modal` with one field added.

**Themes:** `orange`, `black`, `white` · `white-black`, `white-orange`,
`black-white`, `black-orange`, `orange-black`, `orange-white`,
`orange-brown`, `brown-orange`, `neon-black`, `offwhite-orange`,
`orange200-black`, `silver-orange` · `lbx-blue`, `lbx-black`, `lbx-white`
(LBX only — never mixed with Libertex content). Anything else is a `400`.

**Legal modes** (`legal.mode`):
| Mode | Extra required field | Behaviour |
|---|---|---|
| `auto` (default) | — | Resolves the risk warning from the registry by host+entity. Suppresses the whole popup if nothing resolves (§11.3.3) — never renders promotional content with no warning. |
| `off` | `off_reason` (string, ≤200) | No legal slot — for genuinely non-promotional content (maintenance notices, etc). Audit-logged. |
| `custom` | `custom_text` (string, ≤500) | Your exact wording, verbatim — Compliance-restricted in the admin UI, not enforced by this endpoint. |

**`content.broker: "libertex.com"` can never pair with `legal.mode: "off"`.**
The API rejects that combination with a `422` regardless of who's sending
the request — the flagship brand's risk warning isn't a per-popup choice
the way it is for other brokers. This is enforced independently of the
registry-based resolution `auto` mode does by hostname (§11.3.2/§11.3.3).

**`broker` is declared by you, but no longer just trusted (spec §11.3.7).**
`libertex.com`/`libertex.org`/`fxclub.org`/`lbx.com` are the exact same
domain keys the `entity_domains`/`registration_domains` registries already
use — `broker` and "entity" are one concept, not two independent axes — so
whatever you declare gets checked against the registries, twice: at
ingestion (this endpoint), and again by the SDK at the moment a real
visitor would actually see the popup. A popup only ever renders where the
visitor's own resolved entity matches the entity your declared `broker`
resolves to; a targeting mistake that lets a popup reach the wrong domain
now fails safe (no render) instead of showing broker-mismatched content.
`modal_form`/`modal_form_media` feel this most directly, since a mismatch
there would otherwise mean embedding one broker's registration widget
under another broker's popup.

**`overrides`** (per-device content swaps): `{ "mobile": {...}, "tablet": {...}, "desktop": {...} }`,
each a subset of `{ hidden, heading, body, image_url }`. `legal` cannot
appear inside an override — that's not a convention, it's structurally
impossible (the override schema doesn't have that property at all), so a
device override can never hide a risk warning.

### Updating content that's already live

Same endpoint, same verb — `PUT /v1/popups/{external_id}` with the full
new `content` object. There's no partial-update/PATCH for content: send
the whole object every time, including fields you're not changing. The
response code tells you which happened (`200` update, `201` create); the
platform doesn't distinguish "changed the heading" from "changed
everything" — both are just the current state replacing the last one.

### About "sending data through Railway"

There's no Railway-specific content channel — Railway is just where this
same HTTPS API happens to be hosted once deployed. Point your source
system at `https://popup-banner-platform-production.up.railway.app/v1/popups/{external_id}`
instead of `http://localhost:8787/v1/popups/{external_id}`, sign the
request the same way (§2 above), and everything else in this guide is
identical.
Railway environment variables are for the platform's own static
configuration (`COLLECTOR_ALLOWED_ORIGINS`, `PORT`) — not a mechanism for
per-popup content, which is always structured data sent to this API, not
a config value.

---

## Content shape per template

`content` is validated against a **different schema per `template_id`** —
send a field a template doesn't recognize and you get a `400` naming it,
not a silently-dropped value. Every template shares these fields:

| Field | Notes |
|---|---|
| `theme` | One of the canonical names below — **not** a free colour choice |
| `show_logo` | `false` by default |
| `legal` | `{ "mode": "auto" }` (default, resolves from the registry) \| `{ "mode": "off", "off_reason": "..." }` \| `{ "mode": "custom", "custom_text": "..." }` (Compliance-restricted in the admin UI, not enforced by this endpoint) |
| `overrides` | `{ "mobile": {...}, "tablet": {...}, "desktop": {...} }` — **never** `legal`; that field doesn't exist inside `overrides` at all, structurally, so a device override can't hide a risk warning |

**Themes:** `orange`, `black`, `white` (Libertex's three canonical
identities) · `lbx-blue`, `lbx-black`, `lbx-white` (LBX's own palette — use
these only for `lbx.com`/`promo.lbx.com` content, never mixed with Libertex
content) · the extended-spectrum names if you specifically need one:
`white-orange`, `black-orange`, `orange-black`, `orange-white`,
`orange-brown`, `brown-orange`, `neon-black`, `offwhite-orange`,
`orange200-black`, `silver-orange`.

### `banner`
```json
{ "heading": "Scheduled maintenance Sunday 02:00–04:00 UTC.",
  "cta_label": "Details", "cta_url": "https://libertex.com/status",
  "position": "top", "theme": "white",
  "legal": { "mode": "off", "off_reason": "Operational notice, not a financial promotion" } }
```
`heading` required. `position` is `"top"` or `"bottom"`.

### `modal`
```json
{ "heading": "Still reading?", "body": "See this quarter's most traded instruments.",
  "cta_label": "View instruments", "cta_url": "https://libertex.com/instruments",
  "theme": "black", "show_logo": true, "legal": { "mode": "auto" } }
```
`heading` required. `subheading` is also accepted (smaller line above `body`).

Add `"shape": "square"` for a 1:1 aspect-ratio card — logo/heading/subhead
grouped near the top, CTA and legal pinned to the bottom edge:
```json
{ "heading": "Trade gold, FX, and crypto", "subheading": "One account, over 300 instruments, tight spreads.",
  "cta_label": "Open an account", "cta_url": "https://libertex.com/signup",
  "theme": "white", "show_logo": true, "shape": "square", "legal": { "mode": "auto" } }
```
`show_logo` (any template, default `false`) renders a real Libertex mark +
wordmark, colour-adaptive to the theme — it renders nothing on `lbx-*`
themes, since no real LBX logo asset exists yet.

Add `"countdown": true` (needs a top-level `ends_at` — `422` without one)
and `"proof_text"` for an urgency variant — both render next to the CTA,
countdown first:
```json
{ "heading": "Flash sale", "cta_label": "Buy", "cta_url": "https://libertex.com/x",
  "theme": "white", "countdown": true, "proof_text": "140 accounts opened this week",
  "ends_at": "2026-08-10T00:00:00Z", "legal": { "mode": "auto" } }
```
Note `ends_at` is a **top-level** field alongside `template_id`/`status`
(see step 3's example above), not inside `content` — `countdown` just
formats whatever it's already set to, live, ticking once a second for as
long as the popup stays open. `modal_media` accepts both the same way.

### `modal_media`
```json
{ "heading": "Markets move fast", "body": "Open an account in minutes.",
  "image_url": "https://cdn.libertex.com/promo/summer.webp", "image_alt": "Trader at a laptop",
  "cta_label": "Open an account", "cta_url": "https://libertex.com/signup",
  "theme": "white", "legal": { "mode": "auto" } }
```
`heading`, `cta_label`, `cta_url` required. **`image_url` must be on
`cdn.libertex.*`** — anything else is a `400`, no exceptions, regardless of
how trustworthy the host looks.

### `modal_form` (registration)
```json
{ "heading": "Open a live account", "body": "Registration takes under two minutes.",
  "cta_label": "Create account", "theme": "white", "broker": "libertex.com",
  "legal": { "mode": "auto" } }
```
`heading` **and `broker` required** — unlike every other template, where
`broker` is optional. Beyond the required check, `broker` is validated
against the registration-widget registry: a broker with no configured
widget yet (currently `fxclub.org`/`lbx.com` — see spec §9.3) is rejected
with a `422` naming the field, not accepted and left to silently
fail-safe-suppress for real visitors later. **That's otherwise the whole
schema** — no `fields`, no `forward_to`. The actual form (which inputs,
CAPTCHA, consent wording) is resolved centrally per domain, not authored
per popup; see spec §9 if you need to add or change a domain's
registration widget, that's a different, Compliance-involved change, not
something this endpoint controls.

**`broker` isn't just a label here.** It has to resolve to the same entity
as whatever domain the popup actually ends up shown on (spec §11.3.7) — a
`libertex.org`-broker form popup will never render for a `libertex.com`
visitor, even if `targeting` would otherwise match. Point `broker` at
whichever domain this campaign is actually for.

### `modal_form_media`
```json
{ "heading": "Open a live account", "body": "Registration takes under two minutes.",
  "image_url": "https://cdn.libertex.com/promo/registration-hero.webp", "image_alt": "Trading dashboard on a laptop",
  "cta_label": "Create account", "theme": "white", "broker": "libertex.com",
  "legal": { "mode": "auto" } }
```
`modal_form` with one field added — `heading` and `broker` required (same
as `modal_form`, see above), `image_url`/`image_alt` optional (omit them
and it renders exactly like `modal_form`). Same fail-safe, same
centrally-resolved form: everything in `modal_form`'s section above
applies here too.

### `questionnaire`
```json
{ "heading": "Quick one for you", "body": "Two questions, ten seconds.",
  "theme": "white", "legal": { "mode": "auto" },
  "questions": [
    { "id": "market", "text": "Which market interests you most?",
      "options": [
        { "label": "Forex", "value": "forex" },
        { "label": "Crypto", "value": "crypto" },
        { "label": "Stocks", "value": "stocks" }
      ] }
  ],
  "completion": { "heading": "Thanks!", "body": "See instruments matched to your pick.",
    "cta_label": "View instruments", "cta_url": "https://libertex.com/instruments" } }
```
`heading`, `questions` required. 1–3 questions, 2–5 options each, `id`
lowercase/snake_case. `completion` is optional (shown after the last
question); omit it and the questionnaire just ends silently.

### `gamification` (Market Prediction Challenge)
```json
{ "heading": "Think you can call the market?", "body": "Pick an asset and predict its next move.",
  "theme": "black", "legal": { "mode": "auto" },
  "duration_ms": 5000, "volatility_pct": 0.4,
  "win_body": "Correct call! Here's 10% off your next deposit fee.",
  "lose_body": "Not quite — try a demo account instead.",
  "cta_label": "Open an account", "cta_url": "https://libertex.com/signup",
  "assets": [
    { "symbol": "XAUUSD", "label": "Gold", "start_price": 2380.5 },
    { "symbol": "EURUSD", "label": "EUR/USD", "start_price": 1.0845 }
  ] }
```
`heading`, `assets` required (1–4 assets). **`start_price` is content you
supply, never a live quote this platform fetches** — pick a plausible
number and own keeping it roughly current; the platform simulates a small
movement from it (`volatility_pct`, default ±0.4%) and never claims it's
real market data. `duration_ms` (2000–15000, default 5000) is how long the
countdown runs before revealing the result.

---

## Troubleshooting

- **"Signature does not match any active key"** — your key may have been
  revoked, or the signature payload doesn't match exactly (check for
  trailing whitespace/newlines in the body string you signed vs. sent —
  they must be byte-identical).
- **Popup created but not showing up on the page** — check the admin app's
  **Targeting → URL tester** (paste the exact page URL); it'll tell you
  exactly which rule blocked it, or whether the legal fail-safe suppressed
  it (unmapped domain, missing risk-warning wording). This is the single
  fastest way to answer "why isn't my popup showing," faster than reading
  logs.
- **`content.legal` rejected** — `off` mode requires `off_reason`; `custom`
  mode requires `custom_text` and (in the admin UI, not this endpoint) is
  restricted to the Compliance role.
- **Change isn't live yet** — this local dev server publishes synchronously
  on every write; a real deployment budgets up to 90s (§2) for the CDN
  config to refresh. If it's been longer than that, something's actually
  wrong, not just propagating.
