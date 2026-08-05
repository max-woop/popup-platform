/* ============================================================================
   Libertex Popup Platform — SDK (Phase 0 spike)

   Purpose of this spike (spec §16): validate the two integration risks that
   could force a design change — the Tealium loading path, and CSP
   compatibility on promo pages.

   Implemented here:
     · Entity resolution from hostname          (§11.3.2)
     · Legal text resolution + fail-safe        (§11.3.3)
     · Path/query/device/referrer targeting     (§6.1)
     · delay / scroll / exit_intent triggers    (§6.2)
     · Frequency capping + global caps          (§6.3)
     · Closed Shadow DOM rendering              (§8.2)
     · Safe rendering — no innerHTML anywhere   (§10.2)
     · Focus trap, ESC, scroll lock, a11y       (§8.4)
     · Batched events via sendBeacon            (§14.2)
     · Kill switch, preview mode, fail-silent   (§7.4, §8.5)

   Deferred to Phase 1+: forms, A/B variants, data layer targeting,
   inactivity/element_click triggers.
   ========================================================================= */

(function () {
  'use strict';

  var NS = 'LxPopup';
  var STORAGE_KEY = 'lx_popup_state_v1';
  var SESSION_MS = 30 * 60 * 1000;
  var CONFIG_TIMEOUT_MS = 3000;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var root = window[NS] = window[NS] || {};
  var settings = root.config || {};

  /* ---------------------------------------------------------------- utils */

  var debugOn = false;
  function log() {
    if (!debugOn) return;
    try { console.log.apply(console, ['[lx-popup]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // Every public entry point is wrapped. A popup must never break a page.
  function safe(fn, label) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (err) { log('caught in ' + label, err); return undefined; }
    };
  }

  function round4(n) { return Math.round(n / 4) * 4; }

  function deviceClass() {
    var w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function isTouch() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  // SVG built via createElementNS rather than innerHTML, so the "no innerHTML"
  // lint rule (§10.2) holds with no exceptions anywhere in the file.
  function svg(paths, viewBox) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', viewBox || '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  /* -------------------------------------------------------------- storage */

  function readState() {
    var empty = { v: 1, popups: {}, session: null };
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      return (parsed && parsed.v === 1) ? parsed : empty;
    } catch (e) {
      return empty;  // storage blocked → in-memory only, caps apply per page view
    }
  }

  function writeState(state) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* private mode / quota — degrade silently */ }
  }

  function currentSession(state) {
    var now = Date.now();
    if (!state.session || (now - state.session.last) > SESSION_MS) {
      state.session = { id: uuid(), started: now, last: now, pageviews: 0, shown: 0 };
    }
    state.session.last = now;
    return state.session;
  }

  /* --------------------------------------------------- entity  (§11.3.2) */

  // Exact hostname match only. A suffix check (endsWith) would match
  // "libertex.com.evil.example" and would silently mis-assign any future
  // subdomain — either failure serves the wrong regulator's warning.
  function resolveEntity(config, hostname) {
    var map = (config && config.entity_domains) || {};
    var host = String(hostname || '').toLowerCase().replace(/^www\./, '').split(':')[0];
    return Object.prototype.hasOwnProperty.call(map, host) ? map[host] : null;
  }

  /* ---------------------------------------------------- legal  (§11.3.3) */

  // Returns { text } to render, { text: null } when Compliance has marked the
  // jurisdiction as not requiring a warning, or null meaning SUPPRESS.
  //
  // This deliberately inverts the platform's fail-silent principle. Everywhere
  // else a failure means no popup and no harm; here a promotional popup shown
  // without a risk warning is worse than no popup at all.
  function resolveLegal(config, popup, entity, country, locale) {
    var mode = (popup.content && popup.content.legal && popup.content.legal.mode) || 'auto';

    if (mode === 'off')    return { text: null, version: null, mode: 'off' };
    if (mode === 'custom') {
      var custom = popup.content.legal.custom_text;
      return custom ? { text: custom, version: 'custom', mode: 'custom' } : null;
    }

    if (!entity) { log('suppress: unknown host', location.hostname); return null; }

    var bucket = (config.legal || {})[entity];
    if (!bucket) { log('suppress: no legal bucket for', entity); return null; }

    var entry = (country && bucket[country + ':' + locale]) ||
                (country && bucket[country]) ||
                bucket['_default'];

    if (!entry) { log('suppress: no legal entry for', entity, country); return null; }
    if (entry.required === false) return { text: null, version: entry.v, mode: 'auto' };
    if (!entry.text) { log('suppress: entry required but empty', entity); return null; }

    return { text: entry.text, version: entry.v, mode: 'auto' };
  }

  /* ------------------------------------------------ registration (§9) */

  // Same exact-hostname pattern as resolveEntity (§11.3.2/§9.3) — the
  // widget's script/apiKey/field-set are looked up by domain, never typed
  // per popup. An unmapped host means no registration path exists here, so
  // modal_form must not render (§9.3's fail-safe).
  function resolveRegistrationConfig(config, hostname) {
    var map = (config && config.registration_domains) || {};
    var host = String(hostname || '').toLowerCase().replace(/^www\./, '').split(':')[0];
    return Object.prototype.hasOwnProperty.call(map, host) ? map[host] : null;
  }

  // Consent wording is compliance copy exactly like the risk warning (§9.4)
  // — resolved centrally by entity/locale, never supplied by a popup.
  function resolveConsentText(config, entity, locale) {
    var bucket = (config && config.consent_texts && config.consent_texts[entity]) || null;
    if (!bucket) return null;
    return bucket[locale] || bucket.en || null;
  }

  // Builds { privacy: <a>, ... } text interleaved with real links from a
  // template string + a typed link map — never innerHTML (§10.2). An
  // unrecognised {placeholder} renders literally rather than vanishing, so
  // a registry typo is visible instead of silently swallowing a legal link.
  function buildConsentLabel(entry) {
    var span = el('span');
    var template = entry.text_template || '';
    var re = /\{(\w+)\}/g;
    var lastIndex = 0;
    var match;
    while ((match = re.exec(template))) {
      if (match.index > lastIndex) span.appendChild(document.createTextNode(template.slice(lastIndex, match.index)));
      var link = entry.links && entry.links[match[1]];
      if (link) {
        var a = document.createElement('a');
        var href = safeUrl(link.url);
        if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.textContent = link.label || match[1];
        // This label is slotted light-DOM content (§9.5) — same inline-
        // style reasoning as FORM_STYLE below; a class here would need a
        // shadow-tree selector that can't reach a slotted descendant.
        a.style.cssText = 'color:inherit;text-decoration:underline;';
        span.appendChild(a);
      } else {
        span.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < template.length) span.appendChild(document.createTextNode(template.slice(lastIndex)));
    return span;
  }

  /* ------------------------------------------------- targeting  (§6.1) */

  function testOperator(actual, op, expected) {
    var a = actual == null ? '' : String(actual);
    switch (op) {
      case 'equals':      return a === String(expected);
      case 'not_equals':  return a !== String(expected);
      case 'contains':    return a.indexOf(String(expected)) !== -1;
      case 'starts_with': return a.indexOf(String(expected)) === 0;
      case 'ends_with':   return a.length >= String(expected).length &&
                                 a.slice(-String(expected).length) === String(expected);
      case 'in':          return Array.isArray(expected) && expected.map(String).indexOf(a) !== -1;
      case 'not_in':      return Array.isArray(expected) && expected.map(String).indexOf(a) === -1;
      case 'exists':      return a !== '';
      case 'regex':
        // Patterns are validated server-side at save time (length cap, no
        // nested quantifiers). Kept guarded here as defence in depth.
        try { return new RegExp(String(expected)).test(a); } catch (e) { return false; }
      default:            return false;
    }
  }

  // rule.a is the cookie name (same convention as query/datalayer).
  function readCookie(name) {
    if (!name) return null;
    var pairs = document.cookie.split('; ');
    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf('=');
      if (pairs[i].slice(0, eq) === name) return decodeURIComponent(pairs[i].slice(eq + 1));
    }
    return null;
  }

  function dimensionValue(rule, ctx) {
    switch (rule.d) {
      case 'path':      return ctx.path;
      case 'url':       return ctx.url;
      case 'query':     return new URLSearchParams(ctx.search).get(rule.a);
      case 'referrer':  return ctx.referrer;
      case 'device':    return ctx.device;
      case 'language':  return ctx.locale;
      case 'country':   return ctx.country;
      case 'datalayer': return ctx.dataLayer ? ctx.dataLayer[rule.a] : undefined;
      case 'cookie':    return readCookie(rule.a);
      case 'element_exists': // rule.v is a selector; pair with op:'exists'
        try { return document.querySelector(rule.v) ? 'yes' : ''; } catch (e) { return ''; }
      default:          return undefined;
    }
  }

  // Groups are OR within, AND across (§6.1).
  function matchesTargeting(popup, ctx) {
    var groups = popup.targeting || [];
    if (!groups.length) return true;
    return groups.every(function (group) {
      if (!group || !group.length) return true;
      return group.some(function (rule) {
        var hit = testOperator(dimensionValue(rule, ctx), rule.op, rule.v);
        return rule.negate ? !hit : hit;
      });
    });
  }

  function withinSchedule(popup, now) {
    if (popup.starts_at && now < Date.parse(popup.starts_at)) return false;
    if (popup.ends_at   && now > Date.parse(popup.ends_at))   return false;
    return true;
  }

  function allowedOnDevice(popup, device) {
    var list = popup.devices || ['desktop', 'tablet', 'mobile'];
    if (list.indexOf(device) === -1) return false;
    var ov = popup.content && popup.content.overrides && popup.content.overrides[device];
    return !(ov && ov.hidden);
  }

  function withinFrequency(popup, state, session) {
    var f = popup.frequency || {};
    var rec = state.popups[popup.id];
    if (!rec) return true;
    if (rec.dismissed_until && Date.now() < rec.dismissed_until) return false;

    var max = f.max_impressions;
    if (max == null) return true;

    if (f.per === 'session') return (rec.session_id === session.id ? rec.session_count : 0) < max;
    if (f.per === 'day') {
      var sameDay = rec.last_seen &&
        new Date(rec.last_seen).toDateString() === new Date().toDateString();
      return !sameDay || rec.day_count < max;
    }
    return (rec.total || 0) < max;   // lifetime
  }

  /* ------------------------------------------------ device overrides */

  // Merges base content with the override for the current device. The `legal`
  // field is deliberately never merged — overrides cannot reach it (§11.3.4).
  function resolveContent(popup, device) {
    var base = popup.content || {};
    var ov = (base.overrides && base.overrides[device]) || {};
    var out = {};
    Object.keys(base).forEach(function (k) {
      if (k !== 'overrides' && k !== 'legal') out[k] = base[k];
    });
    Object.keys(ov).forEach(function (k) {
      if (k !== 'hidden' && ov[k] != null) out[k] = ov[k];
    });
    return out;
  }

  /* ---------------------------------------------------- events  (§14) */

  var queue = [];
  var flushTimer = null;

  function track(type, popup, extra) {
    if (engine.previewing) return;   // preview never pollutes statistics
    var ev = {
      popup_id: popup.id,
      impression_id: popup._impressionId,
      type: type,
      page_url: location.pathname,   // path only — query strings leak PII
      referrer: document.referrer,   // collector stores hostname only, same reasoning
      device: deviceClass(),
      session_id: engine.session ? engine.session.id : null,
      legal_version: popup._legalVersion || null,
      occurred_at: new Date().toISOString()
    };
    if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
    queue.push(ev);
    log('event', type, popup.id);
    if (!flushTimer) flushTimer = setTimeout(flush, 2000);
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!queue.length || !settings.collectUrl) { queue = []; return; }
    var body = JSON.stringify({ events: queue });
    queue = [];
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(settings.collectUrl, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(settings.collectUrl, {
          method: 'POST', body: body, keepalive: true,
          headers: { 'Content-Type': 'application/json' }
        }).catch(function () {});
      }
    } catch (e) { /* collector unreachable → drop, never retry-loop */ }
  }

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  /* --------------------------------------------------- rendering (§8) */

  function applyLayout(host) {
    // §4.7.1 — margin = shorter side / 20, floored at 24px below 768px,
    // 40px above. Decided exception to the brand's flat 40px floor.
    var shorter = Math.min(window.innerWidth, window.innerHeight);
    var floor = window.innerWidth < 768 ? 24 : 40;
    var margin = Math.max(round4(shorter / 20), floor);
    host.style.setProperty('--lx-margin', margin + 'px');
    host.style.setProperty('--lx-gutter', round4(margin / 2) + 'px');
  }

  function attachStyles(shadow) {
    // Prefer adoptedStyleSheets: it avoids needing `style-src 'unsafe-inline'`
    // on promo pages that enforce a strict CSP (§10.3).
    var css = root.__css || '';
    if (window.CSSStyleSheet && 'adoptedStyleSheets' in shadow) {
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return 'adopted';
      } catch (e) { /* fall through */ }
    }
    var style = document.createElement('style');
    style.textContent = css;   // textContent, not innerHTML
    shadow.appendChild(style);
    return 'style-element';
  }

  // The only place URLs become live. javascript: and data: are rejected here.
  function safeUrl(url) {
    try {
      var parsed = new URL(String(url), location.origin);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch (e) { return null; }
  }

  /* The real Libertex logo/symbol artwork, from the brand's own supplied
     SVG files (Logo Black/White, Symbol Orange/White) — background rects
     stripped so it renders transparent over any surface, path data run
     through svgo (lossless: merged same-fill shapes into fewer subpaths,
     shorter number formatting) to fit the §8.1 size budget. The wordmark's
     letterform paths are identical between the Black-bg and White-bg logo
     files (only fill differs), so they're stored once here and coloured
     with currentColor, which follows --fg (§4.7.3) — light on dark themes,
     dark on light ones, automatically. The symbol paths are likewise
     identical between the Orange and White symbol files; the fill picked
     here defaults to the logo's own orange (baked into the supplied files
     as #FF6633 — distinct from the platform's primary Electric Orange
     #FF4C0B used everywhere else, per §4.2's separately-sourced palette)
     and switches to white specifically on an orange-family background,
     where an orange symbol loses contrast — exactly the case the supplied
     Symbol(White) asset exists for. */
  var SYMBOL_PATH_LOCKUP = 'M187 84v13l-33 33H99l-37 36v-13l33-33h56zM161 145h-56l-43 42h125v-69zm-72-40h55l43-42H62v69z';

  var WORDMARK_PATH = 'M249 187V63h20v106h50v18ZM355 81h-20V63h20Zm0 106h-19V94h19Zm119-46c0 28-20 49-49 49a47 47 0 0 1-33-13l-3 10h-13V63h19v40a47 47 0 0 1 30-11c29 0 49 21 49 49m-20 0c0-18-13-31-30-31s-31 13-31 31c0 17 13 30 31 30s30-13 30-30m126 6h-75q4 24 28 25 17-1 25-14h20q-12 31-45 32c-27 0-48-21-48-49s21-49 48-49c29 0 48 22 48 49zm-75-15h57q-7-22-29-23-22 1-28 23m136-20q-24 0-24 26v49h-19V94h12l4 13q10-13 29-13h8v18Zm72 58q-18 0-18-17v-41h28V95h-28V75l-37 37h18v42q2 32 33 33h14v-17Zm116-23h-76q5 24 29 25 17-1 25-14h20q-12 31-45 32c-27 0-48-21-48-49s20-49 48-49 47 22 47 49zm-75-15h56q-6-22-28-23-23 1-28 23m96 55h-21l33-48-30-45h21l21 32 21-32h21l-31 44 34 49h-22l-23-35Zm75-122h-6v16h-3V65h-6v-2h15Zm13 16-7-14-2 14h-3l3-18h3l6 13 6-13h3l3 18h-3l-2-14Z';

  function symbolFillFor(theme) {
    return /^orange/.test(theme || '') ? '#fff' : '#FF6633';
  }

  function buildBrandLockup(theme) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 1000 250');
    s.setAttribute('aria-hidden', 'true');
    var symbol = document.createElementNS(SVG_NS, 'path');
    symbol.setAttribute('d', SYMBOL_PATH_LOCKUP);
    symbol.setAttribute('fill', symbolFillFor(theme));
    s.appendChild(symbol);
    var word = document.createElementNS(SVG_NS, 'path');
    word.setAttribute('d', WORDMARK_PATH);
    word.setAttribute('fill', 'currentColor');
    s.appendChild(word);
    return s;
  }

  function buildLogo(content) {
    if (!content.show_logo) return null;
    /* LBX is a separate brand entity from Libertex (§4.2) — no real LBX logo
       asset exists, and showing the Libertex mark on an LBX-themed popup
       would misrepresent the entity. Fail-safe to no logo rather than guess,
       the same suppression principle §11.3.3 applies to legal text. */
    if (String(content.theme || '').indexOf('lbx') === 0) return null;

    /* §4.7.3 — logo occupies 2% of canvas area; height = sqrt(area / 7). */
    var w = Math.min(window.innerWidth, 460);
    var h = Math.min(window.innerHeight, 560);
    var logoHeight = round4(Math.sqrt((w * h * 0.02) / 7));
    var markHeight = Math.max(logoHeight, 16);

    var wrap = el('div', 'lx-logo');
    wrap.style.height = markHeight + 'px';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Libertex');
    wrap.appendChild(buildBrandLockup(content.theme));
    return wrap;
  }

  function buildPanel(popup, content, legal, headingId) {
    var panel = el('div', 'lx-panel lx-theme-' + (content.theme || 'white-black'));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', headingId);
    /* Square is only reachable on `modal` — modal_media's schema never
       declares `shape`, so its content can't set it (§5.1's per-template
       gate), which is what keeps this one shared builder safe for both. */
    if (content.shape === 'square') panel.dataset.shape = 'square';

    var close = el('button', 'lx-close');
    close.type = 'button';
    close.setAttribute('aria-label', root.strings.close);
    close.appendChild(svg(['M18 6 6 18', 'M6 6l12 12']));
    panel.appendChild(close);

    var logo = buildLogo(content);
    if (logo) panel.appendChild(logo);

    var wrap = el('div', 'lx-content');

    if (content.image_url) {
      var src = safeUrl(content.image_url);
      if (src) {
        var img = el('img', 'lx-media');
        img.src = src;
        img.alt = content.image_alt || '';
        img.loading = 'lazy';
        wrap.appendChild(img);
      }
    }

    var h = el('h2', 'lx-heading');
    h.id = headingId;
    h.textContent = content.heading || '';       // textContent, never innerHTML
    wrap.appendChild(h);

    if (content.subheading) {
      var sh = el('p', 'lx-subheading');
      sh.textContent = content.subheading;
      wrap.appendChild(sh);
    }

    if (content.body) {
      var b = el('p', 'lx-body');
      b.textContent = content.body;
      wrap.appendChild(b);
    }

    var href = safeUrl(content.cta_url);
    if (href && content.cta_label) {
      var cta = el('a', 'lx-cta');
      cta.href = href;
      cta.rel = 'noopener noreferrer';
      cta.textContent = content.cta_label;
      var arrow = svg(['M5 12h14', 'M13 6l6 6-6 6']);
      arrow.setAttribute('class', 'lx-cta-arrow');
      cta.appendChild(arrow);
      cta.dataset.lxCta = '1';
      wrap.appendChild(cta);
    }

    panel.appendChild(wrap);

    // Legal slot is appended by the template, after content, always last.
    if (legal && legal.text) {
      var lg = el('p', 'lx-legal');
      lg.textContent = legal.text;
      panel.appendChild(lg);
    }

    return { panel: panel, close: close };
  }

  function buildBanner(popup, content, legal, headingId) {
    var bar = el('div', 'lx-banner lx-theme-' + (content.theme || 'orange-black'));
    bar.dataset.position = content.position === 'bottom' ? 'bottom' : 'top';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-labelledby', headingId);

    var wrap = el('div', 'lx-content');
    var h = el('p', 'lx-body');
    h.id = headingId;
    h.textContent = content.heading || '';
    wrap.appendChild(h);
    bar.appendChild(wrap);

    var href = safeUrl(content.cta_url);
    if (href && content.cta_label) {
      var cta = el('a', 'lx-cta');
      cta.href = href;
      cta.rel = 'noopener noreferrer';
      cta.textContent = content.cta_label;
      cta.dataset.lxCta = '1';
      bar.appendChild(cta);
    }

    var close = el('button', 'lx-close');
    close.type = 'button';
    close.setAttribute('aria-label', root.strings.close);
    close.appendChild(svg(['M18 6 6 18', 'M6 6l12 12']));
    bar.appendChild(close);

    if (legal && legal.text) {
      var lg = el('p', 'lx-legal');
      lg.textContent = legal.text;
      bar.appendChild(lg);
    }

    return { panel: bar, close: close };
  }

  /* ------------------------------------------------------- form (§9) */

  // §9.1 — modal_form embeds the existing llLanding registration widget
  // already live on production Libertex domains; this platform does not
  // capture, validate, or forward the fields below. It only renders brand
  // chrome around them and finds out whether registrationCallback fired.

  var scriptLoadPromises = {};
  function loadScriptOnce(src) {
    if (scriptLoadPromises[src]) return scriptLoadPromises[src];
    scriptLoadPromises[src] = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return scriptLoadPromises[src];
  }

  function pushRegistrationTealium(tealiumCfg, result) {
    try {
      if (window.utag && typeof window.utag.view === 'function') {
        window.utag.view({
          page_broker: tealiumCfg.page_broker,
          page_language: tealiumCfg.page_language,
          page_system: tealiumCfg.page_system,
          product_category: 'registration',
          event_type: 'order',
          customer_profile_id: result && result.data && result.data.clientID
        });
      }
    } catch (e) { log('utag.view failed', e); }
  }

  /* §9.5's Shadow DOM exception has a CSS consequence worth spelling out:
     `::slotted()` only ever matches the single slotted element itself, never
     its descendants — so the shadow stylesheet's `.lx-field`/`.lx-checkbox-
     row`/etc rules (which target *children* of the slotted <form>) cannot
     reach any of this. Every visual property below is applied inline
     instead, referencing the same design tokens via var() — those inherit
     across the shadow boundary just fine, only class-based descendant
     selectors don't. tokens.css remains the source of truth for the actual
     values; only *how* they're applied differs for this one template. */
  var FORM_STYLE = {
    form: 'display:flex;flex-direction:column;gap:16px;font-family:var(--lx-font);margin:0 0 8px;',
    field: 'display:flex;flex-direction:column;gap:4px;',
    label: 'font-size:var(--lx-size-label);font-weight:var(--lx-weight-medium);font-family:var(--lx-font);color:var(--fg);',
    input: 'font-family:var(--lx-font);font-size:var(--lx-size-body);color:var(--fg);background:var(--bg);' +
           'padding:12px;border-radius:var(--lx-radius-sm);border:1px solid color-mix(in srgb, var(--fg) 25%, transparent);' +
           'width:100%;box-sizing:border-box;',
    checkboxRow: 'display:flex;align-items:flex-start;gap:8px;font-size:var(--lx-size-label);line-height:1.4;color:var(--fg);font-family:var(--lx-font);cursor:pointer;',
    checkboxInput: 'margin-top:3px;flex:none;',
    link: 'color:inherit;text-decoration:underline;',
    submit: 'display:inline-flex;align-items:center;justify-content:center;background:var(--cta-bg);color:var(--cta-fg);' +
            'font-family:var(--lx-font);font-size:var(--lx-size-button);font-weight:var(--lx-weight-medium);line-height:1;' +
            'padding:16px 24px;border:0;border-radius:var(--lx-radius-sm);cursor:pointer;width:100%;box-sizing:border-box;'
  };

  // Theme → the same four custom properties `.lx-theme-*` sets inside the
  // shadow tree (tokens.css), mirrored here only because slotted content
  // can't inherit a class-scoped custom property from inside the shadow
  // tree — it needs these forwarded onto `host` itself instead (§9.5).
  // Token *names* are duplicated, not color values — tokens.css is still
  // the only place an actual hex/value is written.
  var THEME_VARS = {
    'white-black':     { bg: '--lx-white',      fg: '--lx-black',  ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'white-orange':    { bg: '--lx-white',      fg: '--lx-orange', ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'black-white':     { bg: '--lx-black',      fg: '--lx-white',  ctaBg: '--lx-orange', ctaFg: '--lx-white' },
    'black-orange':    { bg: '--lx-black',      fg: '--lx-orange', ctaBg: '--lx-orange', ctaFg: '--lx-white' },
    'orange-black':    { bg: '--lx-orange',     fg: '--lx-black',  ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'orange-white':    { bg: '--lx-orange',     fg: '--lx-white',  ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'orange-brown':    { bg: '--lx-orange',     fg: '--lx-brown',  ctaBg: '--lx-brown',  ctaFg: '--lx-white' },
    'brown-orange':    { bg: '--lx-brown',      fg: '--lx-orange', ctaBg: '--lx-orange', ctaFg: '--lx-white' },
    'neon-black':      { bg: '--lx-neon',       fg: '--lx-black',  ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'offwhite-orange': { bg: '--lx-off-white',  fg: '--lx-orange', ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'orange200-black': { bg: '--lx-orange-200', fg: '--lx-black',  ctaBg: '--lx-black',  ctaFg: '--lx-white' },
    'silver-orange':   { bg: '--lx-silver',     fg: '--lx-orange', ctaBg: '--lx-black',  ctaFg: '--lx-white' }
  };

  function applyThemeVarsToHost(host, themeName) {
    var pair = THEME_VARS[themeName] || THEME_VARS['white-black'];
    host.style.setProperty('--bg', 'var(' + pair.bg + ')');
    host.style.setProperty('--fg', 'var(' + pair.fg + ')');
    host.style.setProperty('--cta-bg', 'var(' + pair.ctaBg + ')');
    host.style.setProperty('--cta-fg', 'var(' + pair.ctaFg + ')');
  }

  // Field name is fixed by the widget, not by us (§9.3) — llLanding reads
  // these by `name`, so `login`/`password`/`phone` aren't ours to rename.
  function buildRegField(opts) {
    var wrap = el('div', 'lx-field');
    wrap.style.cssText = FORM_STYLE.field;

    var label = el('label');
    label.textContent = opts.label;
    label.htmlFor = opts.id;
    label.style.cssText = FORM_STYLE.label;
    wrap.appendChild(label);

    var input = el('input');
    input.type = opts.type;
    input.name = opts.name;
    input.id = opts.id;
    if (opts.autocomplete) input.autocomplete = opts.autocomplete;
    if (opts.type === 'email') input.inputMode = 'email';
    if (opts.type === 'tel') input.inputMode = 'tel';
    input.style.cssText = FORM_STYLE.input;
    wrap.appendChild(input);

    return { wrap: wrap, input: input };
  }

  function buildForm(popup, content, legal, headingId) {
    var registrationConfig = resolveRegistrationConfig(engine.config, location.hostname);
    if (!registrationConfig) {
      log('suppress: no registration_domains entry for', location.hostname);
      return null;
    }
    var locale = (engine.ctx && engine.ctx.locale) || 'en';
    var consent = resolveConsentText(engine.config, registrationConfig.entity, locale);
    if (!consent) {
      log('suppress: no consent text for', registrationConfig.entity, locale);
      return null;
    }

    var panel = el('div', 'lx-panel lx-theme-' + (content.theme || 'white-black'));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', headingId);

    var close = el('button', 'lx-close');
    close.type = 'button';
    close.setAttribute('aria-label', root.strings.close);
    close.appendChild(svg(['M18 6 6 18', 'M6 6l12 12']));
    panel.appendChild(close);

    var logo = buildLogo(content);
    if (logo) panel.appendChild(logo);

    var wrap = el('div', 'lx-content');

    var h = el('h2', 'lx-heading');
    h.id = headingId;
    h.textContent = content.heading || '';
    wrap.appendChild(h);

    if (content.body) {
      var b = el('p', 'lx-body');
      b.textContent = content.body;
      wrap.appendChild(b);
    }

    // §9.5 — the real <form> is a light DOM child of `host`, not part of
    // this shadow tree. It's projected into position here via <slot> so
    // llLanding's document.querySelector can still find and bind to it —
    // shadow roots are otherwise invisible to that kind of lookup.
    var formSlotWrap = el('div', 'lx-form-slot');
    formSlotWrap.appendChild(document.createElement('slot'));
    wrap.appendChild(formSlotWrap);

    panel.appendChild(wrap);

    if (legal && legal.text) {
      var lg = el('p', 'lx-legal');
      lg.textContent = legal.text;
      panel.appendChild(lg);
    }

    // --- the light-DOM form itself -----------------------------------
    var formId = 'lx-reg-' + uuid();
    var form = el('form', 'lx-form');
    form.id = formId;
    form.method = 'post';
    form.noValidate = true;
    form.style.cssText = FORM_STYLE.form;

    var formStarted = false;
    function trackStart() { if (!formStarted) { formStarted = true; track('form_start', popup); } }

    var email = buildRegField({ name: 'login', type: 'email', id: formId + '-login', label: root.strings.emailLabel, autocomplete: 'email' });
    form.appendChild(email.wrap);
    email.input.addEventListener('focus', trackStart);

    var password = buildRegField({ name: 'password', type: 'password', id: formId + '-password', label: root.strings.passwordLabel, autocomplete: 'new-password' });
    form.appendChild(password.wrap);
    password.input.addEventListener('focus', trackStart);

    if ((registrationConfig.fields || []).indexOf('phone') !== -1) {
      var phone = buildRegField({ name: 'phone', type: 'tel', id: formId + '-phone', label: root.strings.phoneLabel, autocomplete: 'tel' });
      form.appendChild(phone.wrap);
      phone.input.addEventListener('focus', trackStart);
    }

    // Consent — real resolved wording with real links (§9.4), never a
    // per-popup field. `agreedToTermsAndConditions` is the widget's fixed
    // field name, same reasoning as login/password above.
    var consentRow = el('label', 'lx-checkbox-row');
    consentRow.style.cssText = FORM_STYLE.checkboxRow;
    var consentBox = el('input');
    consentBox.type = 'checkbox';
    consentBox.name = 'agreedToTermsAndConditions';
    consentBox.id = formId + '-agree';
    consentBox.required = true;
    consentBox.style.cssText = FORM_STYLE.checkboxInput;
    consentRow.appendChild(consentBox);
    consentRow.appendChild(buildConsentLabel(consent));
    form.appendChild(consentRow);

    // No CAPTCHA markup here — that's llLanding's own concern. Its script
    // inserts whatever challenge it needs once it binds to this form; the
    // exact markup is version/domain-specific and isn't ours to fake.

    var submit = el('input', 'lx-cta om-trigger-conversion');
    submit.type = 'submit';
    submit.value = content.cta_label || root.strings.submit;
    submit.dataset.wait = root.strings.pleaseWait;
    submit.style.cssText = FORM_STYLE.submit;
    form.appendChild(submit);

    function showSuccess() {
      // formSlotWrap lives in the shadow tree (unlike the form itself), so
      // it can be styled/replaced normally — only the <form> was the §9.5
      // exception. The light-DOM form node still exists after this, just no
      // longer assigned to a slot, so it stops rendering.
      formSlotWrap.textContent = '';
      var msg = el('p', 'lx-form-success');
      msg.setAttribute('role', 'status');
      msg.textContent = root.strings.success;
      formSlotWrap.appendChild(msg);
    }

    return {
      panel: panel,
      close: close,
      lightDomForm: form,
      mountRegistration: function (host) {
        applyThemeVarsToHost(host, content.theme || 'white-black');
        loadScriptOnce(registrationConfig.script_src).then(function () {
          if (!window.llLanding || typeof window.llLanding.create !== 'function') {
            log('registration script loaded but window.llLanding.create is missing');
            return;
          }
          window.llLanding.create({
            form: '#' + formId,
            apiKey: registrationConfig.api_key,
            registrationCallback: function (data, goFurther) {
              track('form_submit', popup);
              pushRegistrationTealium(registrationConfig.tealium, data);
              showSuccess();
              goFurther();
            }
          });
        }).catch(function (e) { log('registration script failed to load', e); });
      }
    };
  }

  /* ---------------------------------------------- questionnaire (§5.4) */

  // Button-only answers, one question at a time. No free-text input exists
  // to validate or sanitize — every tap is already a complete, final answer,
  // so there's no "submit" step and no payload that could ever be markup.
  function buildQuestionnaire(popup, content, legal, headingId) {
    var panel = el('div', 'lx-panel lx-theme-' + (content.theme || 'white-black'));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', headingId);

    var close = el('button', 'lx-close');
    close.type = 'button';
    close.setAttribute('aria-label', root.strings.close);
    close.appendChild(svg(['M18 6 6 18', 'M6 6l12 12']));
    panel.appendChild(close);

    var logo = buildLogo(content);
    if (logo) panel.appendChild(logo);

    var wrap = el('div', 'lx-content');

    var h = el('h2', 'lx-heading');
    h.id = headingId;
    h.textContent = content.heading || '';
    wrap.appendChild(h);

    if (content.body) {
      var b = el('p', 'lx-body');
      b.textContent = content.body;
      wrap.appendChild(b);
    }

    var questions = content.questions || [];
    var progress = el('div', 'lx-q-progress');
    questions.forEach(function () { progress.appendChild(el('span', 'lx-q-dot')); });
    wrap.appendChild(progress);

    var stage = el('div');
    wrap.appendChild(stage);

    var current = 0;

    function renderStep() {
      stage.textContent = '';
      Array.prototype.forEach.call(progress.children, function (dot, i) {
        dot.setAttribute('data-done', i < current ? 'true' : 'false');
      });

      if (current >= questions.length) {
        var comp = content.completion || {};
        if (comp.heading) {
          var ch = el('p', 'lx-q-text');
          ch.textContent = comp.heading;
          stage.appendChild(ch);
        }
        if (comp.body) {
          var cb = el('p', 'lx-body');
          cb.textContent = comp.body;
          stage.appendChild(cb);
        }
        var href = safeUrl(comp.cta_url);
        if (href && comp.cta_label) {
          var cta = el('a', 'lx-cta');
          cta.href = href;
          cta.rel = 'noopener noreferrer';
          cta.textContent = comp.cta_label;
          var arrow = svg(['M5 12h14', 'M13 6l6 6-6 6']);
          arrow.setAttribute('class', 'lx-cta-arrow');
          cta.appendChild(arrow);
          cta.dataset.lxCta = '1';
          stage.appendChild(cta);
        }
        return;
      }

      var q = questions[current];
      var qTextId = headingId + '-q' + current;
      var qText = el('p', 'lx-q-text');
      qText.id = qTextId;
      qText.textContent = q.text;
      stage.appendChild(qText);

      var options = el('div', 'lx-q-options');
      options.setAttribute('role', 'group');
      options.setAttribute('aria-labelledby', qTextId);
      (q.options || []).forEach(function (opt) {
        var btn = el('button', 'lx-q-option');
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          Array.prototype.forEach.call(options.children, function (b) { b.disabled = true; });
          btn.setAttribute('data-selected', 'true');
          track('questionnaire_answer', popup, { question_id: q.id, value: opt.value });
          current++;
          setTimeout(renderStep, 180); // let the selection be visible before advancing
        });
        options.appendChild(btn);
      });
      stage.appendChild(options);
    }

    renderStep();
    panel.appendChild(wrap);

    if (legal && legal.text) {
      var lg = el('p', 'lx-legal');
      lg.textContent = legal.text;
      panel.appendChild(lg);
    }

    return { panel: panel, close: close };
  }

  /* ------------------------------------------------ gamification (§5.5) */
  /* Market Prediction Challenge: pick an asset, predict higher/lower, a
     short countdown, reveal. Not a real market feed — see the persistent
     .lx-game-disclaimer this renders and §5.5's note on why that has to be
     persistent, not a one-time footnote, on a platform that sells CFDs. */

  function formatPrice(n) {
    // More decimals for sub-10 instruments (FX pairs, e.g. 1.0845) than for
    // larger ones (indices, crypto, metals priced in the thousands).
    var decimals = n < 10 ? 4 : n < 1000 ? 2 : 0;
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function buildGamification(popup, content, legal, headingId) {
    var panel = el('div', 'lx-panel lx-theme-' + (content.theme || 'white-black'));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', headingId);

    var close = el('button', 'lx-close');
    close.type = 'button';
    close.setAttribute('aria-label', root.strings.close);
    close.appendChild(svg(['M18 6 6 18', 'M6 6l12 12']));
    panel.appendChild(close);

    var logo = buildLogo(content);
    if (logo) panel.appendChild(logo);

    var wrap = el('div', 'lx-content');

    var h = el('h2', 'lx-heading');
    h.id = headingId;
    h.textContent = content.heading || '';
    wrap.appendChild(h);

    if (content.body) {
      var b = el('p', 'lx-body');
      b.textContent = content.body;
      wrap.appendChild(b);
    }

    var assets = content.assets || [];
    var durationMs = content.duration_ms || 5000;
    var volatilityPct = (typeof content.volatility_pct === 'number' ? content.volatility_pct : 0.4) / 100;

    var stage = el('div');
    wrap.appendChild(stage);

    function buildCta(container) {
      var href = safeUrl(content.cta_url);
      if (href && content.cta_label) {
        var cta = el('a', 'lx-cta');
        cta.href = href;
        cta.rel = 'noopener noreferrer';
        cta.textContent = content.cta_label;
        var arrow = svg(['M5 12h14', 'M13 6l6 6-6 6']);
        arrow.setAttribute('class', 'lx-cta-arrow');
        cta.appendChild(arrow);
        cta.dataset.lxCta = '1';
        container.appendChild(cta);
      }
    }

    function renderResult(asset, guess, startPrice, closePrice) {
      stage.textContent = '';
      var closedHigher = closePrice > startPrice;
      var correct = (guess === 'higher' && closedHigher) || (guess === 'lower' && !closedHigher);

      track('game_result', popup, { prize_label: asset.symbol + ':' + guess + ':' + (correct ? 'correct' : 'incorrect') });

      var badge = el('span', 'lx-game-result-badge');
      badge.textContent = correct
        ? (content.win_body ? content.win_body : 'Correct call!')
        : (content.lose_body ? content.lose_body : 'Not quite this time.');
      stage.appendChild(badge);

      var prices = el('div', 'lx-game-result-prices');
      var startEl = el('span'); startEl.textContent = 'Start: ' + formatPrice(startPrice);
      var closeEl = el('span'); closeEl.textContent = 'Close: ' + formatPrice(closePrice);
      prices.appendChild(startEl);
      prices.appendChild(closeEl);
      stage.appendChild(prices);

      buildCta(stage);
    }

    function renderCountdown(asset, guess, startPrice) {
      stage.textContent = '';

      var price = el('p', 'lx-game-price');
      price.textContent = asset.label + ' ' + formatPrice(startPrice);
      stage.appendChild(price);

      var disclaimer = el('p', 'lx-game-disclaimer');
      disclaimer.textContent = 'Simulated for this challenge — not a live quote';
      stage.appendChild(disclaimer);

      var countdown = el('p', 'lx-game-countdown');
      countdown.textContent = 'You predicted ' + guess + '. Revealing shortly…';
      stage.appendChild(countdown);

      var track_ = el('div', 'lx-game-countdown-track');
      var fill = el('div', 'lx-game-countdown-fill');
      fill.style.transitionDuration = durationMs + 'ms';
      track_.appendChild(fill);
      stage.appendChild(track_);
      // Kick the transition off on the next frame so it actually animates
      // from 100% down to 0, rather than snapping straight to the end state.
      requestAnimationFrame(function () { fill.style.width = '0%'; });

      setTimeout(function () {
        var closePrice = startPrice * (1 + (Math.random() * 2 - 1) * volatilityPct);
        renderResult(asset, guess, startPrice, closePrice);
      }, durationMs);
    }

    function renderDirectionPicker(asset) {
      stage.textContent = '';

      var price = el('p', 'lx-game-price');
      price.textContent = asset.label + ' ' + formatPrice(asset.start_price);
      stage.appendChild(price);

      var disclaimer = el('p', 'lx-game-disclaimer');
      disclaimer.textContent = 'Simulated for this challenge — not a live quote';
      stage.appendChild(disclaimer);

      var prompt = el('p', 'lx-q-text');
      prompt.textContent = 'Will it close higher or lower?';
      stage.appendChild(prompt);

      var row = el('div', 'lx-game-direction-row');
      [['higher', '▲ Higher'], ['lower', '▼ Lower']].forEach(function (pair) {
        var btn = el('button', 'lx-game-direction-btn');
        btn.type = 'button';
        btn.textContent = pair[1];
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          Array.prototype.forEach.call(row.children, function (b) { b.disabled = true; });
          btn.setAttribute('data-selected', 'true');
          track('click', popup, { element_id: 'predict:' + pair[0] });
          setTimeout(function () { renderCountdown(asset, pair[0], asset.start_price); }, 150);
        });
        row.appendChild(btn);
      });
      stage.appendChild(row);
    }

    function renderAssetPicker() {
      stage.textContent = '';

      if (assets.length === 1) { renderDirectionPicker(assets[0]); return; }

      var prompt = el('p', 'lx-q-text');
      prompt.textContent = 'Pick an asset to predict';
      stage.appendChild(prompt);

      var options = el('div', 'lx-q-options');
      assets.forEach(function (asset) {
        var btn = el('button', 'lx-q-option');
        btn.type = 'button';
        btn.textContent = asset.label;
        btn.addEventListener('click', function () {
          track('click', popup, { element_id: 'asset:' + asset.symbol });
          renderDirectionPicker(asset);
        });
        options.appendChild(btn);
      });
      stage.appendChild(options);
    }

    renderAssetPicker();
    panel.appendChild(wrap);

    if (legal && legal.text) {
      var lg = el('p', 'lx-legal');
      lg.textContent = legal.text;
      panel.appendChild(lg);
    }

    return { panel: panel, close: close };
  }

  /* ------------------------------------------------ focus trap (§8.4) */

  // `extraRoot` covers §9.5's exception: modal_form's actual <form> is a
  // light-DOM sibling of this shadow tree, not a descendant of `container`,
  // so container.querySelectorAll alone would miss every field in it.
  function trapFocus(container, onEscape, extraRoot) {
    var previous = document.activeElement;
    var selector = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    var shadowHost = container.getRootNode().host;

    function focusables() {
      var list = [].slice.call(container.querySelectorAll(selector));
      if (extraRoot) list = list.concat([].slice.call(extraRoot.querySelectorAll(selector)));
      return list;
    }

    // document.activeElement is retargeted to the shadow host itself when
    // focus sits inside a *closed* shadow root — ask the root directly in
    // that case. Focus on the slotted light-DOM form isn't retargeted, so
    // document.activeElement already reports it correctly.
    function activeElement() {
      var a = document.activeElement;
      return a === shadowHost ? container.getRootNode().activeElement : a;
    }

    function onKey(e) {
      if (e.key === 'Escape') { onEscape(); return; }
      if (e.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      var active = activeElement();
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKey, true);
    var initial = focusables()[0];
    if (initial) setTimeout(function () { initial.focus(); }, 0);

    return function release() {
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus) { try { previous.focus(); } catch (e) {} }
    };
  }

  /* -------------------------------------------------------- the engine */

  var engine = {
    config: null,
    ctx: null,
    session: null,
    state: null,
    shownThisPageview: 0,
    active: [],
    previewing: false
  };

  function buildContext() {
    var dl = settings.dataLayer || window.utag_data || {};
    return {
      url: location.href,
      path: location.pathname,
      search: location.search,
      referrer: document.referrer,
      device: deviceClass(),
      locale: (navigator.language || 'en').slice(0, 2),
      country: dl.country || null,
      dataLayer: dl
    };
  }

  function eligible(popup) {
    var now = Date.now();
    if (popup.status && popup.status !== 'live') return false;
    if (!withinSchedule(popup, now)) return false;
    if (!allowedOnDevice(popup, engine.ctx.device)) return false;
    if (!matchesTargeting(popup, engine.ctx)) return false;
    if (!withinFrequency(popup, engine.state, engine.session)) return false;
    return true;
  }

  // Template dispatch shared by show() (the fixed-overlay real popup) and
  // renderInline() (the in-page preview a template gallery uses) — one
  // place deciding which builder owns a given template.
  function buildForTemplate(popup, content, legal, headingId) {
    if (popup.template === 'banner') return buildBanner(popup, content, legal, headingId);
    if (popup.template === 'modal_form') return buildForm(popup, content, legal, headingId);
    if (popup.template === 'questionnaire') return buildQuestionnaire(popup, content, legal, headingId);
    if (popup.template === 'gamification') return buildGamification(popup, content, legal, headingId);
    return buildPanel(popup, content, legal, headingId);
  }

  function show(popup, opts) {
    opts = opts || {};
    var content = resolveContent(popup, engine.ctx.device);
    var entity = resolveEntity(engine.config, location.hostname);
    var legal = resolveLegal(engine.config, popup, entity, engine.ctx.country, engine.ctx.locale);

    // Fail-safe: no resolvable warning → render nothing at all (§11.3.3).
    if (legal === null) {
      log('SUPPRESSED — no legal text resolves', { popup: popup.id, host: location.hostname, entity: entity });
      return false;
    }

    popup._impressionId = uuid();
    popup._legalVersion = legal.version;

    var host = el('div');
    host.id = 'lx-popup-' + popup.id;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;';
    document.body.appendChild(host);
    applyLayout(host);

    var shadow = host.attachShadow({ mode: 'closed' });
    var styleMode = attachStyles(shadow);
    log('styles attached via', styleMode);

    var headingId = 'lx-h-' + popup.id;
    var isBanner = popup.template === 'banner';
    var built = buildForTemplate(popup, content, legal, headingId);

    // buildForm returns null when no registration_domains/consent_texts
    // entry resolves (§9.3/§9.4) — same fail-safe shape as the legal check
    // above: a registration popup with nothing to register against is
    // worse than no popup.
    if (!built) {
      if (host.parentNode) host.parentNode.removeChild(host);
      return false;
    }

    var container;
    if (isBanner) {
      container = built.panel;
      shadow.appendChild(container);
    } else {
      container = el('div', 'lx-backdrop');
      container.appendChild(built.panel);
      shadow.appendChild(container);
    }

    // §9.5 — the registration form is the one light-DOM exception to this
    // popup's otherwise full Shadow DOM isolation. It's a real child of
    // `host`, projected into the shadow tree's <slot>, so llLanding's own
    // document.querySelector can find and bind to it.
    if (built.lightDomForm) {
      host.appendChild(built.lightDomForm);
      built.mountRegistration(host);
    }

    var release = isBanner ? function () {} : trapFocus(built.panel, function () { dismiss('escape'); }, built.lightDomForm);
    var priorOverflow = document.body.style.overflow;
    if (!isBanner) document.body.style.overflow = 'hidden';

    var instance = { popup: popup, host: host, destroyed: false };

    function destroy() {
      if (instance.destroyed) return;
      instance.destroyed = true;
      release();
      if (!isBanner) document.body.style.overflow = priorOverflow;
      if (host.parentNode) host.parentNode.removeChild(host);
      engine.active = engine.active.filter(function (i) { return i !== instance; });
    }

    function dismiss(method) {
      track('close', popup, { method: method });
      recordDismissal(popup);
      destroy();
    }

    built.close.addEventListener('click', function () { dismiss('button'); });

    if (!isBanner) {
      container.addEventListener('click', function (e) {
        if (e.target === container) dismiss('overlay');
      });
    }

    container.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-lx-cta]') : null;
      if (target) track('click', popup, { element_id: 'cta' });
    });

    // `view` is the honest denominator — a popup rendered and instantly
    // dismissed is not a real impression (§14.1).
    if (window.IntersectionObserver) {
      var seen = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!seen && entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            seen = true;
            setTimeout(function () { if (!instance.destroyed) track('view', popup); }, 1000);
            io.disconnect();
          }
        });
      }, { threshold: [0.5] });
      io.observe(built.panel);
    }

    window.addEventListener('resize', function () { applyLayout(host); });

    engine.active.push(instance);
    engine.shownThisPageview++;
    recordImpression(popup);
    track('impression', popup);
    instance.destroy = destroy;
    return true;
  }

  function recordImpression(popup) {
    var s = engine.state;
    var rec = s.popups[popup.id] || { total: 0, session_count: 0, day_count: 0 };
    var today = new Date().toDateString();
    rec.total = (rec.total || 0) + 1;
    rec.session_count = (rec.session_id === engine.session.id ? rec.session_count : 0) + 1;
    rec.session_id = engine.session.id;
    rec.day_count = (rec.last_day === today ? rec.day_count : 0) + 1;
    rec.last_day = today;
    rec.last_seen = Date.now();
    s.popups[popup.id] = rec;
    engine.session.shown = (engine.session.shown || 0) + 1;
    writeState(s);
  }

  function recordDismissal(popup) {
    var days = (popup.frequency && popup.frequency.dismiss_ttl_days) || 0;
    if (!days) return;
    var rec = engine.state.popups[popup.id] || {};
    rec.dismissed_until = Date.now() + days * 86400000;
    engine.state.popups[popup.id] = rec;
    writeState(engine.state);
  }

  /* ------------------------------------------------------- triggers */

  function arm(popup) {
    var t = popup.trigger || { type: 'delay', value: 3000 };

    if (t.type === 'immediate') { show(popup); return; }

    if (t.type === 'delay') {
      setTimeout(function () { if (stillAllowed(popup)) show(popup); }, t.value || 3000);
      return;
    }

    if (t.type === 'scroll') {
      var target = (t.value || 40) / 100;
      var onScroll = function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var pct = max > 0 ? window.scrollY / max : 1;
        if (pct >= target) {
          window.removeEventListener('scroll', onScroll);
          if (stillAllowed(popup)) show(popup);
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      return;
    }

    if (t.type === 'exit_intent') {
      // No meaningful mouse-leave signal on touch (§5.3) — fall back to delay.
      if (isTouch()) {
        setTimeout(function () { if (stillAllowed(popup)) show(popup); }, 8000);
        return;
      }
      var onLeave = function (e) {
        if (e.clientY > 0) return;
        document.removeEventListener('mouseleave', onLeave);
        if (stillAllowed(popup)) show(popup);
      };
      document.addEventListener('mouseleave', onLeave);
      return;
    }

    if (t.type === 'element_click') {
      if (!t.selector) return;
      var onClick = function (e) {
        if (!e.target || !e.target.closest || !e.target.closest(t.selector)) return;
        document.removeEventListener('click', onClick);
        if (stillAllowed(popup)) show(popup);
      };
      document.addEventListener('click', onClick);
      return;
    }

    if (t.type === 'inactivity') {
      var ms = (t.value || 30) * 1000; // seconds, not ms
      var evts = ['mousemove', 'keydown', 'scroll', 'touchstart'];
      var timer;
      var fire = function () {
        evts.forEach(function (e) { window.removeEventListener(e, reset); });
        if (stillAllowed(popup)) show(popup);
      };
      var reset = function () { clearTimeout(timer); timer = setTimeout(fire, ms); };
      evts.forEach(function (e) { window.addEventListener(e, reset, { passive: true }); });
      reset();
      return;
    }

    log('unsupported trigger in spike:', t.type);
  }

  function stillAllowed(popup) {
    var g = engine.config.global || {};
    if (engine.shownThisPageview >= (g.max_per_pageview || 1)) return false;
    if (engine.session.shown >= (g.max_per_session || 2)) return false;
    return withinFrequency(popup, engine.state, engine.session);
  }

  /* -------------------------------------------------------- lifecycle */

  function selectAndArm() {
    var candidates = (engine.config.popups || []).filter(eligible);

    // Priority ascending, then newest start date (§6.3).
    candidates.sort(function (a, b) {
      var d = (a.priority || 100) - (b.priority || 100);
      if (d !== 0) return d;
      return Date.parse(b.starts_at || 0) - Date.parse(a.starts_at || 0);
    });

    log('eligible popups:', candidates.map(function (p) { return p.id; }));

    var g = engine.config.global || {};
    var budget = Math.max(0, (g.max_per_pageview || 1) - engine.shownThisPageview);
    candidates.slice(0, budget).forEach(arm);
  }

  function previewId() {
    try { return new URLSearchParams(location.search).get('lx_preview'); }
    catch (e) { return null; }
  }

  function fetchConfig(url) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, CONFIG_TIMEOUT_MS);
    return fetch(url, {
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('config ' + r.status);
      return r.json();
    });
  }

  function boot() {
    if (root.disabled === true) { log('kill switch active'); return; }
    if (!settings.configUrl) { log('no configUrl'); return; }

    fetchConfig(settings.configUrl).then(function (config) {
      if (!config || !Array.isArray(config.popups)) throw new Error('malformed config');
      engine.config = config;
      engine.state = readState();
      engine.session = currentSession(engine.state);
      engine.session.pageviews++;
      writeState(engine.state);
      engine.ctx = buildContext();

      var pid = previewId();
      if (pid) {
        engine.previewing = true;
        var target = config.popups.filter(function (p) { return p.id === pid; })[0];
        if (target) { log('preview', pid); show(target); }
        else log('preview id not found', pid);
        return;
      }

      selectAndArm();
    }).catch(function (err) {
      log('boot failed — no popup', err);   // fail silent (§8.5)
    });
  }

  /* ------------------------------------------------------ public API */

  root.strings = root.strings || {
    close: 'Close',
    submit: 'Submit',
    success: 'Thanks — you are signed up.',
    required: 'This field is required.',
    invalidEmail: 'Enter a valid email address.',
    submitFailed: 'Something went wrong. Try again.',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    phoneLabel: 'Phone',
    pleaseWait: 'Please wait...'
  };

  root.pageView = safe(function (ctx) {
    if (!engine.config) return;
    engine.shownThisPageview = 0;
    if (ctx && ctx.dataLayer) settings.dataLayer = ctx.dataLayer;
    engine.ctx = buildContext();
    engine.session.pageviews++;
    writeState(engine.state);
    selectAndArm();
  }, 'pageView');

  root.show = safe(function (id, opts) {
    if (!engine.config) return;
    var p = engine.config.popups.filter(function (x) { return x.id === id; })[0];
    if (p) show(p, opts);
  }, 'show');

  root.hide = safe(function (id) {
    engine.active.slice().forEach(function (i) {
      if (!id || i.popup.id === id) i.destroy();
    });
  }, 'hide');

  root.getActive = safe(function () {
    return engine.active.map(function (i) { return i.popup.id; });
  }, 'getActive');

  /* Renders a popup definition into normal page flow instead of the fixed,
     full-viewport overlay show() uses — for a template gallery / style-guide
     page, not for real triggered popups. Reuses the exact same builders, so
     it's an accurate preview rather than a hand-drawn mockup: real themes,
     real legal resolution (including the §11.3.3 fail-safe), real form
     validation. `popup` need not be a member of a loaded config's popup
     list — only popup.content.legal.mode and the config's entity/legal maps
     matter for resolution. */
  root.renderInline = safe(function (popup, container) {
    if (!container) return;

    function proceed(config) {
      // buildForm() (§9) reads engine.config/engine.ctx directly rather than
      // via a threaded parameter, since it's also called from show()'s path
      // where those are always set by boot(). renderInline can run with
      // boot() disabled (a gallery page, say) and do its own independent
      // fetch — without this, that fetch's result would never reach
      // buildForm, and modal_form would always look unresolvable.
      engine.config = engine.config || config;
      engine.ctx = engine.ctx || buildContext();

      var device = deviceClass();
      var content = resolveContent(popup, device);
      var entity = resolveEntity(config, location.hostname);
      var dl = settings.dataLayer || {};
      var legal = resolveLegal(config, popup, entity, dl.country, dl.language);

      container.textContent = '';
      if (legal === null) {
        var suppressed = el('p');
        suppressed.textContent = 'Suppressed — no legal text resolves for this host/entity (§11.3.3).';
        container.appendChild(suppressed);
        return;
      }

      var host = el('div');
      host.style.cssText = 'all:initial; display:block; position:relative;';
      container.appendChild(host);
      applyLayout(host);

      // Open, not closed — a gallery page benefits from being inspectable;
      // the real show() above stays closed (§8.2), which is what ships.
      var shadow = host.attachShadow({ mode: 'open' });
      attachStyles(shadow);

      var headingId = 'lx-h-preview-' + uuid();
      var built = buildForTemplate(popup, content, legal, headingId);
      if (!built) {
        var regSuppressed = el('p');
        regSuppressed.textContent = 'Suppressed — no registration_domains/consent_texts entry resolves for this host (§9.3/§9.4).';
        container.appendChild(regSuppressed);
        return;
      }
      built.panel.style.position = 'static';
      // Entrance animations (slide/rise/fade) are meaningful for a real
      // triggered popup, not a static side-by-side gallery — skip them so
      // every card is at rest immediately.
      built.panel.style.animation = 'none';

      if (popup.template === 'banner') {
        // Banners are full-width bars by design — 100% is correct here.
        built.panel.style.maxWidth = 'none';
        built.panel.style.width = '100%';
        shadow.appendChild(built.panel);
      } else {
        // .lx-panel's own `width:100%` needs a definite containing-block
        // width to resolve against — a gallery's container is often itself
        // shrink-to-fit (centered flex cells), so without a fixed width here
        // the panel and every ancestor collapse to their content's minimum,
        // wrapping text to one word per line. A comfortable fixed width,
        // capped by the viewport, is what a static preview card needs.
        built.panel.style.width = '380px';
        built.panel.style.maxWidth = '100%';
        var wrap = el('div', 'lx-backdrop');
        wrap.style.position = 'static';
        wrap.style.background = 'transparent';
        wrap.style.padding = '0';
        wrap.appendChild(built.panel);
        shadow.appendChild(wrap);
      }

      if (built.lightDomForm) {
        host.appendChild(built.lightDomForm);
        built.mountRegistration(host);
      }

      built.close.addEventListener('click', function () { host.remove(); });
    }

    if (engine.config) proceed(engine.config);
    else fetchConfig(settings.configUrl).then(proceed).catch(function (e) { log('renderInline: config fetch failed', e); });
  }, 'renderInline');

  root.debug = safe(function (on) { debugOn = !!on; }, 'debug');

  // Exposed for the spike's diagnostics page — not part of the public API.
  root._diagnostics = safe(function () {
    var entity = engine.config ? resolveEntity(engine.config, location.hostname) : null;
    return {
      host: location.hostname,
      entity: entity,
      device: deviceClass(),
      touch: isTouch(),
      configLoaded: !!engine.config,
      popupCount: engine.config ? engine.config.popups.length : 0,
      eligible: engine.config ? engine.config.popups.filter(eligible).map(function (p) { return p.id; }) : [],
      session: engine.session
    };
  }, 'diagnostics');

  /* ---------------------------------------------------------------------
     SPIKE-ONLY TEST HOOKS — remove before Phase 1.
     These exist so the harness can prove the §11.3.3 fail-safe actually
     suppresses rather than falling through. They must not ship: anything
     that can unmap a host from the browser is a compliance hazard.
     --------------------------------------------------------------------- */
  root._simulateUnknownHost = safe(function () {
    if (!engine.config) return;
    root.__savedDomains = root.__savedDomains || engine.config.entity_domains;
    engine.config.entity_domains = {};
    log('TEST: entity_domains cleared — auto-mode popups should now suppress');
  }, 'simulateUnknownHost');

  root._restoreHosts = safe(function () {
    if (!engine.config || !root.__savedDomains) return;
    engine.config.entity_domains = root.__savedDomains;
    log('TEST: entity_domains restored');
  }, 'restoreHosts');

  // Bypasses the 2s batching timer so the harness can show events landed
  // without waiting or closing the tab (§14.2's flush triggers — timer,
  // visibilitychange, pagehide — are unchanged for real traffic).
  root._flushNow = safe(function () { flush(); }, 'flushNow');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safe(boot, 'boot'));
  } else {
    safe(boot, 'boot')();
  }
})();
