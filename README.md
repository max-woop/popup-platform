# Libertex Popup Platform — Phase 0 spike

Runnable proof of the delivery path described in `popup-platform-spec.md` §17.

Its job is narrow: validate the two integration risks most likely to force a
design change — **the Tealium loading path** and **CSP compatibility on promo
pages** — plus prove the compliance fail-safe (§11.3.3) actually suppresses
rather than falling through.

---

## Run it

```bash
npm install                    # one-time: installs jsdom for test.js
node build.js                  # inlines tokens.css, lints, checks size budget
node test.js                   # 26 checks, no browser needed
python3 -m http.server 8080    # from the repo root
```

Then open <http://localhost:8080>. The harness shows live diagnostics: resolved
entity, device class, eligible popups, and a one-click fail-safe test.

Also open <http://localhost:8080/templates.html> — a style-guide page showing
all seven templates (§5) side by side with representative content, rendered
through the real SDK (`window.LxPopup.renderInline()`, a preview-only API
that reuses the exact same builders/theme/legal resolution as a real
triggered popup). Useful for a design review without clicking through
individual triggers. Also reachable from the admin app's **Templates** nav
item (`admin/web`), which iframes this same page. The **Preview theme**
toggle (top right) forces every card to the same Light or Dark background
on demand — useful for checking contrast or the logo without hunting for
the one card that already happens to use that background.

`localhost` and `127.0.0.1` are mapped to `cysec` in `config.json` so the
CySEC risk warning renders locally. **Remove those two entries before any real
deployment** — they exist only so the spike runs offline.

---

## What's in here

```
build.js            inline CSS → dist/sdk.js, lint, size gate, SRI hash
test.js             26 checks (jsdom)
tealium-tag.html    the loader to paste into Tealium iQ
tokens.css          brand tokens — §4.2, §4.6, §4.7
sdk.js              the SDK
config.json         example config with the real CYSEC/FCIL/LBX domain map
index.html          local test harness with diagnostics
templates.html      style-guide gallery — all seven templates, every theme
```

---

## Build gates

Both fail the build rather than surfacing later:

| Gate | Threshold | Current |
|---|---|---|
| Bundle size (§8.1) | ≤ 20 KB gzipped | **12.7 KB** |
| Banned DOM APIs (§10.2) | zero | **zero** |

The lint blocks `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and
`document.write` in SDK source. This is what makes XSS structurally impossible
rather than defensively filtered — verified against a negative control.

---

## Test coverage

```
Entity resolution from hostname (§11.3.2)          5 checks
Legal fail-safe (§11.3.3)                          6 checks
Device overrides cannot reach legal slot (§11.3.4) 1 check
Targeting (§6.1)                                   3 checks
Safe rendering (§10.2)                             4 checks
Resilience (§8.5)                                  3 checks
Frequency and global caps (§6.3)                   1 check
Accessibility (§8.4)                               3 checks
```

Three worth knowing about specifically:

**`libertex.com.evil.example` → `null`.** Exact hostname matching, not suffix.
An `endsWith()` check would have mapped that host to `cysec` and served a
visitor the wrong regulator's warning.

**Unknown host suppresses an `auto`-mode popup.** This deliberately inverts the
platform's fail-silent principle. Everywhere else a failure means no popup and
no harm; here a promotional popup with no risk warning is worse than no popup.
A new promo domain that isn't in the map shows nothing — visibly broken, rather
than quietly non-compliant.

**A device override cannot switch `legal` to `off`.** The override merge skips
the `legal` key entirely, so even a hostile or buggy payload from the source
system cannot suppress a warning on mobile only.

---

## Implemented

Entity resolution · legal resolution with fail-safe · path/query/device/
referrer/datalayer targeting · delay, scroll, and exit-intent triggers ·
frequency capping and global caps · closed Shadow DOM · safe rendering ·
focus trap, ESC, scroll lock, reduced motion · batched `sendBeacon` events ·
kill switch · preview mode · all seven templates: `banner` / `modal` /
`modal_media` / `modal_form` / `modal_form_media` / `questionnaire` /
`gamification`.
`modal_form` embeds the real third-party **llLanding** registration widget
already live on `libertex.com`/`.org` (§9, rewritten once production form
code showed the original self-built lead-forwarding design didn't match
reality) — see `buildForm()` and `mock-landing-api.js` (the safe local
stand-in this repo actually loads). `questionnaire` (§5.4) is button-only
answers, one question at a time; `gamification` (§5.5) is the **Market
Prediction Challenge** — pick an asset, predict higher/lower, wait out a
short countdown, see a client-simulated result against a content-supplied
start price (never a live quote) — see `buildQuestionnaire()`/
`buildGamification()`. Every template also takes a `theme`: three canonical
Libertex identities (`orange`/`black`/`white`) or three LBX-brand ones
(`lbx-blue`/`lbx-black`/`lbx-white`) — see `tokens.css`. `modal` additionally
takes `shape: 'square'` (§4.7.2) for a 1:1 aspect-ratio card with the CTA and
legal slot pinned to the bottom edge, matching the brand's own layout
examples. The optional logo slot (`show_logo`, off by default) renders the
real Libertex mark + wordmark, from the actual supplied logo/symbol SVG
files — the wordmark uses `currentColor` so it adapts to any Libertex
theme's background automatically, and the symbol switches from its own
orange to white specifically on an orange-family background, where an
orange symbol would lose contrast. Renders nothing at all on LBX themes,
since no real LBX logo asset exists yet and showing Libertex's mark there
would misrepresent the entity — see `buildLogo()`/`buildBrandLockup()`.

## Deferred to Phase 1+

A/B variants · `inactivity` and `element_click` triggers.

The admin UI, ingestion API, and Collector now exist as a prototype in
[`admin/`](admin/README.md) — a separate Express + React app, not part of
this spike's build. `collectUrl` above points at it
(`http://localhost:8787/v1/events`); run `admin/server` alongside this
harness (`python3 -m http.server 8080`) to see events actually land and show
up in the admin Statistics screen. Statistics aggregation there is real for
any popup with collected events, synthetic demo data otherwise.

## Must be removed before Phase 1

`_simulateUnknownHost()`, `_restoreHosts()`, and `_flushNow()` in
`sdk.js`. The first two exist so the harness can prove suppression
works; `_flushNow()` bypasses the 2s batching timer so the harness can show
collected events without waiting. All three are debug hooks with no place
in a real release. Anything that can unmap a host from
the browser is a compliance hazard and must not ship.

---

## Deploying the spike

1. `node build.js`
2. Upload `dist/sdk.js` to `cdn.libertex.com/popups/v1/sdk.<hash>.js` (immutable
   path, long TTL)
3. Upload `config.json` to `cdn.libertex.com/popups/v1/config.json`
   (60s TTL) — **after removing the localhost entries**
4. In `tealium-tag.html`: set the real hostnames, paste the SRI hash from
   `dist/sdk.js.sri`, set `env`
5. Paste into Tealium iQ → Tags → Custom Container
6. Load rule: all promo pages, excluding account, auth, and payment flows (§7.2)
7. Publish to the **dev profile first**

### What to check on the dev profile

- [ ] Tag fires; `sdk.js` loads with no SRI mismatch
- [ ] **Does the promo page CSP allow it?** Check the console for `style-src`
      violations. The SDK prefers `adoptedStyleSheets` to avoid needing
      `'unsafe-inline'`, and falls back to a `<style>` element — the harness
      logs which path was taken. If the fallback triggers under a strict CSP,
      that's the finding this spike exists to surface.
- [ ] Correct entity resolves per domain (check all eight — cysec/fcil/lbx)
- [ ] Risk warning renders and matches what Compliance expects
- [ ] No layout shift; page unaffected when the config 404s
- [ ] Keyboard: Tab cycles inside the modal, ESC closes, focus returns

---

## Known placeholders

These are cosmetic and swap out without structural change:

| Item | Status | Spec |
|---|---|---|
| Typography | System font stack | Q1 — **blocks Phase 1** |
| Extended spectrum hex | Sampled approximations, marked `PLACEHOLDER` | Q1b |
| Error colour | Mapped to Brown | Q1c |
| Logo SVG | ~~Hand-traced~~ **Resolved** — real logo/symbol path data, from the actual supplied SVG files | Q1e |
| FCIL risk warning | Placeholder string in `config.json` | Q4 |
| Cap-height offset | `-.08em` guess | Needs font metrics (Q1) |

The typography gap is the real blocker. The `-.08em` cap-height offset in
`tokens.css` implements §4.7.2's "cap height aligns to the top margin" rule, but
the correct value derives from the brand font's metrics — so the type spec has
to land before templates can be called done.
