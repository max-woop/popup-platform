#!/usr/bin/env node
/* Phase 0 test suite.

   Priority order matches spec §15.3: the compliance fail-safe and the safe
   rendering path matter more than anything else here, because those are the
   two failures with consequences beyond a broken popup. */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SDK = fs.readFileSync(path.join(__dirname, 'dist', 'sdk.js'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  → ' + detail : ''}`); }
}

function group(name) { console.log(`\n${name}`); }

/* Boot the SDK inside a jsdom page at a given hostname with a given config. */
function boot({ url = 'https://libertex.com/promo/summer', config = CONFIG, dataLayer = {} } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div style="height:4000px"></div></body></html>`, {
    url,
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;

  win.LxPopup = {
    config: { configUrl: 'https://cdn.test/config.json', collectUrl: null, dataLayer, env: 'test' }
  };

  // Minimal fetch stub returning the config.
  win.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(config)))
  });
  win.navigator.sendBeacon = () => true;
  win.AbortController = win.AbortController || class { constructor(){ this.signal = null; } abort(){} };

  win.eval(SDK);
  return { dom, win };
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
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailed:');
    failures.forEach(f => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('All Phase 0 checks passed.');
})();
