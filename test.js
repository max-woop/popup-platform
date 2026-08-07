#!/usr/bin/env node
/* Phase 0 test suite.

   Priority order matches spec §16.3: the compliance fail-safe and the safe
   rendering path matter more than anything else here, because those are the
   two failures with consequences beyond a broken popup. */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SDK = fs.readFileSync(path.join(__dirname, 'dist', 'sdk.js'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const AXE = fs.readFileSync(path.join(__dirname, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  → ' + detail : ''}`); }
}

function group(name) { console.log(`\n${name}`); }

/* Boot the SDK inside a jsdom page at a given hostname with a given config.
   localStorageSeed pre-populates lx_popup_state_v1 before the SDK's own
   boot() runs, so a test can simulate "this is a returning visitor" rather
   than only ever a fresh one — needed for the A/B persistence check below.
   spyIntervals wraps setInterval/clearInterval before the SDK loads, so a
   test can assert the countdown's timer lifecycle (§8.2) without needing
   DOM access into show()'s closed shadow root, which is the one thing
   renderInline()'s open one can't stand in for. */
function boot({ url = 'https://libertex.com/promo/summer', config = CONFIG, dataLayer = {}, localStorageSeed = null, spyIntervals = false } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div style="height:4000px"></div></body></html>`, {
    url,
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;
  if (localStorageSeed) win.localStorage.setItem('lx_popup_state_v1', JSON.stringify(localStorageSeed));

  win.LxPopup = {
    config: { configUrl: 'https://cdn.test/config.json', collectUrl: null, dataLayer, env: 'test' }
  };

  // Minimal fetch stub returning the config.
  win.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(config)))
  });
  win.navigator.sendBeacon = () => true;
  win.AbortController = win.AbortController || class { constructor(){ this.signal = null; } abort(){} };

  const intervalStats = { created: 0, cleared: 0 };
  if (spyIntervals) {
    const realSetInterval = win.setInterval.bind(win);
    const realClearInterval = win.clearInterval.bind(win);
    win.setInterval = function (fn, ms) { intervalStats.created++; return realSetInterval(fn, ms); };
    win.clearInterval = function (id) { intervalStats.cleared++; return realClearInterval(id); };
  }

  win.eval(SDK);
  return { dom, win, intervalStats };
}

const settle = (win, ms = 60) => new Promise(r => win.setTimeout(r, ms));

/* Count rendered popup hosts. Shadow roots are closed, so we count host
   elements — which is exactly what "did something render" means. */
function rendered(win) {
  return win.document.querySelectorAll('[id^="lx-popup-"]').length;
}

(async function run() {

  /* ------------------------------------------------------------------ */
  group('Entity resolution from hostname (§11.3.2)');
  {
    const { win } = boot({ url: 'https://libertex.com/' });
    await settle(win);
    check('libertex.com → cysec', win.LxPopup._diagnostics().entity === 'cysec');
  }
  {
    const { win } = boot({ url: 'https://promo.fxclub.org/promo/x' });
    await settle(win);
    check('promo.fxclub.org → fcil', win.LxPopup._diagnostics().entity === 'fcil');
  }
  {
    const { win } = boot({ url: 'https://www.libertex.org/' });
    await settle(win);
    check('www. prefix stripped → fcil', win.LxPopup._diagnostics().entity === 'fcil');
  }
  {
    // The reason exact matching matters: a suffix check would map this to cysec.
    const { win } = boot({ url: 'https://libertex.com.evil.example/' });
    await settle(win);
    check('libertex.com.evil.example → null (not cysec)',
      win.LxPopup._diagnostics().entity === null,
      'suffix matching would have returned cysec');
  }
  {
    const { win } = boot({ url: 'https://promo.libertex.io/' });
    await settle(win);
    check('unmapped new domain → null', win.LxPopup._diagnostics().entity === null);
  }

  /* ------------------------------------------------------------------ */
  group('Legal fail-safe (§11.3.3) — the compliance-critical path');
  {
    const { win } = boot({ url: 'https://libertex.com/quiet' });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('auto mode renders when entity resolves', rendered(win) === 1);
  }
  {
    // Unknown host + auto mode must suppress, not fall through.
    const { win } = boot({ url: 'https://promo.libertex.io/quiet' });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('unknown host SUPPRESSES auto-mode popup', rendered(win) === 0,
      'a promo rendered with no risk warning');
  }
  {
    // Entity resolves but the legal bucket is missing.
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    delete cfg.legal.cysec;
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('missing legal bucket SUPPRESSES', rendered(win) === 0);
  }
  {
    // required:true but empty text is a data error — must not render.
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.legal.cysec._default.text = '';
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('required-but-empty text SUPPRESSES', rendered(win) === 0);
  }
  {
    // required:false is an explicit Compliance decision — render without text.
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.legal.cysec._default.required = false;
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('required:false renders without legal text', rendered(win) === 1);
  }
  {
    // mode:off on an unknown host is allowed — it is not a financial promotion.
    const { win } = boot({ url: 'https://promo.libertex.io/quiet' });
    await settle(win);
    win.LxPopup.show('notice-maintenance');
    await settle(win);
    check('mode:off renders even on unmapped host', rendered(win) === 1);
  }

  /* ------------------------------------------------------------------ */
  group('Broker/entity consistency (§11.3.7)');
  {
    // content.broker uses the same domain keys entity_domains does — a
    // declared broker that resolves to the *same* entity as the visitor's
    // hostname must render exactly as it would with no broker declared.
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.popups.find((p) => p.id === 'promo-summer-2026').content.broker = 'libertex.com';
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('matching broker renders normally', rendered(win) === 1);
  }
  {
    // Declared for .org, visited on .com — different entity. Must suppress
    // even though legal.mode would otherwise resolve fine on this host.
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.popups.find((p) => p.id === 'promo-summer-2026').content.broker = 'libertex.org';
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('mismatched broker SUPPRESSES', rendered(win) === 0,
      'a libertex.org-broker popup rendered for a libertex.com visitor');
  }
  {
    // A broker value with no entity_domains entry at all (schema would
    // reject this at ingestion — checked here as defence in depth, same
    // reasoning as the "unknown host" legal test above).
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.popups.find((p) => p.id === 'promo-summer-2026').content.broker = 'not-a-real-broker.example';
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('unresolvable broker SUPPRESSES', rendered(win) === 0);
  }
  {
    // No broker declared at all — existing, broker-less popups (still the
    // common case outside modal_form/modal_form_media) must be completely
    // unaffected by this check.
    const { win } = boot({ url: 'https://libertex.com/quiet' });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('no broker declared is unaffected', rendered(win) === 1);
  }

  /* ------------------------------------------------------------------ */
  group('Device overrides cannot reach the legal slot (§11.3.4)');
  {
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    // Hostile override attempting to suppress the warning.
    cfg.popups[0].content.overrides.mobile.legal = { mode: 'off', off_reason: 'x' };
    const { win } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('override cannot switch legal to off', rendered(win) === 1,
      'popup should still render WITH the warning');
  }

  /* ------------------------------------------------------------------ */
  group('Targeting (§6.1)');
  {
    const { win } = boot({ url: 'https://libertex.com/promo/summer' });
    await settle(win);
    check('path starts_with /promo → banner auto-renders', rendered(win) === 1);
  }
  {
    const { win } = boot({ url: 'https://libertex.com/about' });
    await settle(win);
    check('banner does not fire off /promo', rendered(win) === 0);
  }
  {
    const { win } = boot({ url: 'https://libertex.com/promo/summer' });
    await settle(win);
    check('global cap stops a second popup on same pageview', rendered(win) === 1);
  }

  /* ------------------------------------------------------------------ */
  group('Safe rendering (§10.2)');
  {
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    const p = cfg.popups[0].content;
    p.heading = '<img src=x onerror=alert(1)>';
    p.body = '<script>alert(2)<\/script>';
    p.cta_url = 'javascript:alert(3)';
    const { win, dom } = boot({ url: 'https://libertex.com/quiet', config: cfg });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);

    const html = dom.serialize();
    check('no <script> injected from content', !/<script>alert\(2\)/.test(html));
    check('no onerror attribute injected', !/onerror=/i.test(html));
    check('javascript: URL rejected', !/href="javascript:/i.test(html));
    check('popup still rendered (payload became inert text)', rendered(win) === 1);
  }

  /* ------------------------------------------------------------------ */
  group('Resilience (§8.5)');
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://libertex.com/', runScripts: 'outside-only' });
    const win = dom.window;
    win.LxPopup = { config: { configUrl: 'https://cdn.test/config.json', dataLayer: {} } };
    win.fetch = () => Promise.reject(new Error('network down'));
    win.navigator.sendBeacon = () => true;
    win.eval(SDK);
    await settle(win, 80);
    check('config fetch failure → no popup, no throw', rendered(win) === 0);
  }
  {
    const { win } = boot({ url: 'https://libertex.com/quiet', config: { version: 1, popups: 'not-an-array' } });
    await settle(win);
    check('malformed config → no popup, no throw', rendered(win) === 0);
  }
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://libertex.com/quiet', runScripts: 'outside-only' });
    const win = dom.window;
    win.LxPopup = { disabled: true, config: { configUrl: 'https://cdn.test/config.json', dataLayer: {} } };
    let fetched = false;
    win.fetch = () => { fetched = true; return Promise.resolve({ ok: true, json: () => Promise.resolve(CONFIG) }); };
    win.eval(SDK);
    await settle(win);
    check('kill switch prevents config fetch entirely', fetched === false);
  }

  /* ------------------------------------------------------------------ */
  group('Frequency and global caps (§6.3)');
  {
    const { win } = boot({ url: 'https://libertex.com/quiet' });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    check('explicit show() is not blocked by caps (by design)', rendered(win) === 2);
  }

  /* ------------------------------------------------------------------ */
  group('A/B testing (§15)');
  {
    function abConfig(weightA, weightB) {
      const base = {
        template: 'modal', status: 'live', priority: 50, starts_at: null, ends_at: null,
        devices: ['desktop', 'tablet', 'mobile'], trigger: { type: 'immediate' },
        frequency: {}, targeting: [[{ d: 'path', op: 'starts_with', v: '/' }]],
        content: { theme: 'white', heading: 'x', legal: { mode: 'off', off_reason: 'test' } }
      };
      return Object.assign({}, CONFIG, {
        popups: [
          Object.assign({}, base, { id: 'ab-a', experiment: { group: 'g1', variant: 'A', weight: weightA } }),
          Object.assign({}, base, { id: 'ab-b', experiment: { group: 'g1', variant: 'B', weight: weightB } })
        ]
      });
    }

    {
      const { win } = boot({ url: 'https://libertex.com/', config: abConfig(50, 50) });
      await settle(win);
      const d = win.LxPopup._diagnostics();
      check('exactly one variant active, never both', d.active.length === 1, JSON.stringify(d.active));
      check('the active one is a real group member', ['ab-a', 'ab-b'].includes(d.active[0]));
    }

    {
      // Same visitor returning — pre-seed the exact state a first visit
      // would have written, confirm the second boot reuses it rather than
      // re-rolling (a test that reshuffles per pageview isn't a test).
      const { win: win1 } = boot({ url: 'https://libertex.com/', config: abConfig(50, 50) });
      await settle(win1);
      const firstPick = win1.LxPopup._diagnostics().active[0];
      const state = JSON.parse(win1.localStorage.getItem('lx_popup_state_v1'));
      check('assignment persisted to storage', !!(state && state.exp && state.exp.g1));

      const { win: win2 } = boot({ url: 'https://libertex.com/', config: abConfig(50, 50), localStorageSeed: state });
      await settle(win2);
      const secondPick = win2.LxPopup._diagnostics().active[0];
      check('returning visitor sees the same variant', secondPick === firstPick, `${firstPick} → ${secondPick}`);
    }

    {
      // Heavily skewed weights, many fresh (unseeded) visitors — the split
      // should trend hard toward A without ever making B literally
      // impossible. Wide tolerance on purpose: this asserts the mechanism
      // isn't broken (e.g. always picking one, or crashing), not an exact
      // statistical bound — that would make the suite flaky by design.
      let aCount = 0;
      const N = 40;
      for (let i = 0; i < N; i++) {
        const { win } = boot({ url: 'https://libertex.com/', config: abConfig(90, 10) });
        await settle(win);
        if (win.LxPopup._diagnostics().active[0] === 'ab-a') aCount++;
      }
      check(`weighted split trends toward the heavier variant (A won ${aCount}/${N}, expect >20)`, aCount > 20);
    }

    {
      // Once a group is down to one live popup (the loser paused after a
      // real resolution — admin/server/lib/experiments.js), there's
      // nothing to pick between; the survivor just behaves like any
      // ordinary popup.
      const cfg = abConfig(50, 50);
      cfg.popups[1].status = 'paused';
      const { win } = boot({ url: 'https://libertex.com/', config: cfg });
      await settle(win);
      check('a resolved group (one live variant) passes through untouched', win.LxPopup._diagnostics().active[0] === 'ab-a');
    }
  }

  /* ------------------------------------------------------------------ */
  group('Countdown (§5.1)');
  {
    function withCountdownPopup(id, extra, contentExtra) {
      const cfg = JSON.parse(JSON.stringify(CONFIG));
      cfg.popups.push(Object.assign({
        id, template: 'modal', status: 'live', priority: 999,
        devices: ['desktop', 'tablet', 'mobile'], trigger: { type: 'immediate' }, frequency: {}, targeting: []
      }, extra, {
        content: Object.assign({
          heading: 'Countdown test', theme: 'white', cta_label: 'Go', cta_url: 'https://libertex.com/x',
          legal: { mode: 'off', off_reason: 'test' }
        }, contentExtra)
      }));
      return cfg;
    }

    {
      // renderInline()'s open shadow root is the only way to read the
      // rendered text at all — show()'s is closed (§8.2) — but the
      // formatting logic is identical either way, so this is a real check
      // of it, not a workaround.
      const futureEnds = new Date(Date.now() + (2 * 86400000 + 3 * 3600000 + 5 * 60000)).toISOString();
      const cfg = withCountdownPopup('countdown-static', { ends_at: futureEnds }, { countdown: true });
      const { win } = boot({ config: cfg });
      await settle(win);
      const popup = cfg.popups.find((p) => p.id === 'countdown-static');
      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      win.LxPopup.renderInline(popup, container);
      await settle(win);
      const host = container.firstElementChild;
      const text = host && host.shadowRoot && host.shadowRoot.querySelector('.lx-countdown');
      check('renders "Nd HH:MM:SS" for a multi-day deadline', !!text && /^2d \d{2}:\d{2}:\d{2}$/.test(text.textContent),
        text && text.textContent);
    }

    {
      const cfg = withCountdownPopup('countdown-off', {}, {}); // no ends_at, no countdown flag
      const { win, intervalStats } = boot({ url: 'https://libertex.com/quiet', config: cfg, spyIntervals: true });
      await settle(win);
      win.LxPopup.show('countdown-off');
      await settle(win);
      check('no countdown declared → no timer started', intervalStats.created === 0);
      win.LxPopup.hide();
    }

    {
      // countdown:true but ends_at already passed — buildCountdown() (sdk.js)
      // returns null past expiry, so there's nothing to tick; must not
      // start a timer for a deadline that's already gone.
      const cfg = withCountdownPopup('countdown-expired', { ends_at: new Date(Date.now() - 5000).toISOString() }, { countdown: true });
      const { win, intervalStats } = boot({ url: 'https://libertex.com/quiet', config: cfg, spyIntervals: true });
      await settle(win);
      win.LxPopup.show('countdown-expired');
      await settle(win);
      check('already-expired ends_at → no timer started', intervalStats.created === 0);
      win.LxPopup.hide();
    }

    {
      // The real lifecycle check: exactly one timer per shown countdown,
      // cleared exactly once on dismiss — never leaked, never double-freed.
      const cfg = withCountdownPopup('countdown-live', { ends_at: new Date(Date.now() + 60000).toISOString() }, { countdown: true });
      const { win, intervalStats } = boot({ url: 'https://libertex.com/quiet', config: cfg, spyIntervals: true });
      await settle(win);
      win.LxPopup.show('countdown-live');
      await settle(win);
      check('exactly one timer started for a live countdown', intervalStats.created === 1);
      win.LxPopup.hide();
      await settle(win);
      check('exactly one timer cleared on dismiss', intervalStats.cleared === 1);
    }
  }

  /* ------------------------------------------------------------------ */
  group('Accessibility (§8.4)');
  {
    const { win, dom } = boot({ url: 'https://libertex.com/quiet' });
    await settle(win);
    win.LxPopup.show('promo-summer-2026');
    await settle(win);
    const host = win.document.querySelector('[id^="lx-popup-"]');
    check('host element created', !!host);
    check('body scroll locked while modal open', win.document.body.style.overflow === 'hidden');
    win.LxPopup.hide();
    await settle(win);
    check('scroll lock released on close', win.document.body.style.overflow !== 'hidden');
  }

  /* ------------------------------------------------------------------ */
  group('Automated accessibility audit — axe-core (§16.3)');
  {
    // renderInline() (§9's own comment: "for a template gallery / style-
    // guide page") is used here rather than show() for one structural
    // reason, not a preference: show() attaches a *closed* shadow root
    // (§8.2), which axe-core (like any outside script) simply cannot see
    // into — there'd be nothing to audit. renderInline()'s shadow root is
    // open specifically so tooling can inspect it, which is exactly what's
    // needed here.
    const { win } = boot({ url: 'https://localhost/quiet' });
    await settle(win);
    win.eval(AXE);

    const byTemplate = (t) => CONFIG.popups.find((p) => p.template === t);
    const samples = {
      banner: byTemplate('banner'),
      modal: byTemplate('modal'),
      modal_media: byTemplate('modal_media'),
      questionnaire: byTemplate('questionnaire'),
      gamification: byTemplate('gamification'),
      // Not in config.json (no registration_domains entry there needed one
      // until now) — minimal, valid popups built the same shape ingestion
      // would require: broker required (§11.3.7), legal auto-resolvable at
      // this boot's host.
      modal_form: {
        id: 'axe-form', template: 'modal_form', status: 'live',
        content: { heading: 'Open a live account', broker: 'libertex.com', legal: { mode: 'auto' } }
      },
      modal_form_media: {
        id: 'axe-form-media', template: 'modal_form_media', status: 'live',
        content: {
          heading: 'Open a live account', broker: 'libertex.com', legal: { mode: 'auto' },
          image_url: 'https://cdn.libertex.com/promo/registration-hero.webp', image_alt: 'Trading dashboard on a laptop'
        }
      }
    };

    for (const [template, popup] of Object.entries(samples)) {
      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      win.LxPopup.renderInline(popup, container);
      await settle(win);

      const host = container.firstElementChild;
      if (!host) { check(`${template}: renders (nothing to audit)`, false, 'renderInline produced no host — fail-safe suppressed?'); continue; }

      const results = await win.axe.run(host, {
        // Colour contrast needs real layout metrics jsdom doesn't compute
        // (getComputedStyle in jsdom never resolves used values for
        // background/foreground the way a real renderer does) — every
        // other rule category still runs. Real-browser contrast is a
        // visual/manual check per spec §16.3's own testing-priorities
        // table, not something this harness can honestly automate.
        rules: { 'color-contrast': { enabled: false } }
      });
      check(`${template}: no axe violations`, results.violations.length === 0,
        results.violations.map((v) => v.id + ' (' + v.nodes.length + ')').join(', '));
    }
  }

  /* ------------------------------------------------------------------ */
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailed:');
    failures.forEach(f => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('All Phase 0 checks passed.');
})();
