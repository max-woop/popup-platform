#!/usr/bin/env node
/* Inlines tokens.css into sdk.js and emits dist/sdk.js.
   No dependencies — runs on any Node 14+.

   Inlining rather than fetching the CSS separately saves a request on every
   uncached page view, and keeps the stylesheet version-locked to the SDK. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = __dirname;
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });

// Fonts aren't inlined (§8.1's budget is for sdk.js itself — a few hundred
// KB of woff2 would blow it instantly) — copied alongside instead, so
// dist/fonts/ sits next to dist/sdk.js the same way admin/server later
// serves /dist/fonts next to /dist/sdk.js. tokens.css's __LX_FONT_BASE__
// placeholder is what actually points at this directory at runtime (see
// sdk.js's fontBaseUrl()), not anything build.js does here.
const fontsDir = path.join(src, 'fonts');
const distFontsDir = path.join(dist, 'fonts');
if (fs.existsSync(fontsDir)) {
  fs.mkdirSync(distFontsDir, { recursive: true });
  fs.readdirSync(fontsDir).forEach(function (file) {
    if (!/\.woff2?$/.test(file)) return;
    fs.copyFileSync(path.join(fontsDir, file), path.join(distFontsDir, file));
  });
  console.log('copied ' + fs.readdirSync(distFontsDir).length + ' font file(s) to dist/fonts/');
}

const css = fs.readFileSync(path.join(src, 'tokens.css'), 'utf8');
const sdk = fs.readFileSync(path.join(src, 'sdk.js'), 'utf8');

// Banned-API lint (§10.2). These are the APIs that turn content into markup.
// Enforced at build time so the rule cannot quietly erode in review.
const BANNED = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'];
// Blank out block comments while preserving line numbering, then drop line
// comments — otherwise the lint flags its own documentation.
const stripped = sdk
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n')
  .map(l => l.split('//')[0]);

const violations = [];
stripped.forEach((code, i) => {
  BANNED.forEach(api => {
    if (code.indexOf(api) !== -1) {
      violations.push(`  line ${i + 1}: ${api} — ${sdk.split('\n')[i].trim()}`);
    }
  });
});
if (violations.length) {
  console.error('✗ FAIL: banned DOM APIs found in sdk.js (§10.2)\n' + violations.join('\n'));
  process.exit(1);
}
console.log('✓ no banned DOM APIs in sdk.js (§10.2)');

// Strip /* */ block comments before shipping (§8.1's budget is bytes over
// the wire, not bytes in the source file — the doc comments stay in sdk.js
// and tokens.css for maintainers). Verified safe against both files: neither
// contains `/*` or `*/` inside a string literal, so this can't truncate code
// the way stripping `//` would (sdk.js has `'http://...'` string literals).
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n[ \t]*\n+/g, '\n');
}

const cssLiteralStripped = JSON.stringify(stripBlockComments(css));
const sdkStripped = stripBlockComments(sdk);

const banner = `/* Libertex Popup SDK — Phase 0 spike — built ${new Date().toISOString()} */\n`;
const inject = `(function(){window.LxPopup=window.LxPopup||{};window.LxPopup.__css=${cssLiteralStripped};})();\n`;

const out = banner + inject + sdkStripped;
const outPath = path.join(dist, 'sdk.js');
fs.writeFileSync(outPath, out);

// SRI hash for the Tealium loader (§10.3).
const hash = crypto.createHash('sha384').update(out).digest('base64');
fs.writeFileSync(path.join(dist, 'sdk.js.sri'), `sha384-${hash}\n`);

const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
let gz = 'n/a';
try {
  gz = (require('zlib').gzipSync(out).length / 1024).toFixed(1);
} catch (e) {}

console.log(`built dist/sdk.js  ${kb} KB raw  ${gz} KB gzipped`);
console.log(`SRI  sha384-${hash}`);

// Budget gate from spec §8.1 — fail the build rather than discover it later.
const BUDGET_KB = 20;
if (gz !== 'n/a' && parseFloat(gz) > BUDGET_KB) {
  console.error(`\n✗ FAIL: ${gz} KB gzipped exceeds the ${BUDGET_KB} KB budget (§8.1)`);
  process.exit(1);
}
console.log(`✓ within the ${BUDGET_KB} KB gzipped budget (§8.1)`);
