'use strict';

const fs = require('fs');
const path = require('path');
const sqliteStore = require('./sqliteStore');
const legalRegistryLib = require('./legalRegistry');
const consentRegistryLib = require('./consentRegistry');

const DIST_DIR = path.join(__dirname, '..', 'data', 'dist');
const CONFIG_PATH = path.join(DIST_DIR, 'config.json');

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// Compiles the live popup set into the Appendix config.json shape — what a
// real publisher would push to CDN after schema validation (§3, "Publish
// flow"). Runs synchronously after every mutation here; the non-functional
// budget is 90s end-to-end (§2), which a debounce would matter for at real
// traffic but not for a single-operator prototype.
function publish(store) {
  const popups = sqliteStore.listPopups().filter((p) => p.status !== 'archived');
  const legalRegistry = legalRegistryLib.buildRegistry(store.legal_texts);
  const consentRegistry = consentRegistryLib.buildRegistry(store.consent_texts);

  const config = {
    version: Date.now(),
    generated_at: new Date().toISOString(),
    global: store.settings.global_caps,
    entity_domains: store.entity_domains,
    legal: legalRegistry,
    registration_domains: store.registration_domains,
    consent_texts: consentRegistry,
    popups: popups
      .filter((p) => p.status === 'live')
      .map((p) => ({
        id: p.external_id,
        template: p.template,
        priority: p.priority,
        starts_at: p.starts_at || undefined,
        ends_at: p.ends_at || undefined,
        devices: p.devices,
        trigger: p.trigger,
        frequency: p.frequency,
        targeting: (p.targeting || []).map((group) =>
          group.map((rule) => ({ d: rule.d, op: rule.op, v: rule.v, ...(rule.a ? { a: rule.a } : {}), ...(rule.negate ? { negate: true } : {}) }))
        ),
        content: p.content
      }))
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

module.exports = { publish, CONFIG_PATH };
