import { Select } from 'evergreen-ui';

// Single source for the broker-entity list — was hand-copied into three
// forms (LegalTexts, Registration's domain + consent forms), which is
// exactly how `lbx` went missing from all three until fixed by hand in
// each one. A future entity now only needs adding here.
const ENTITIES = ['cysec', 'fcil', 'lbx'];

// "Entity" here and content.broker (Popup Settings' Content card,
// ingestSchemas.js's BROKER_VALUES) are the same concept named two
// different ways in two different corners of this codebase — this map is
// the one place that says so out loud, so picking an entity in this
// dropdown means something to whoever's separately looking at a popup's
// declared broker. Kept as a second static map next to ENTITIES rather
// than derived from live entity_domains, matching this file's own
// single-static-source reasoning above — entity_domains has many hostname
// keys per entity (promo.*, root, dev aliases); this only needs the
// handful of real broker domains, not all of them.
const ENTITY_BROKERS = {
  cysec: 'libertex.com',
  fcil: 'libertex.org, fxclub.org',
  lbx: 'lbx.com'
};

export function EntitySelect({ value, onChange }) {
  return (
    <Select value={value} onChange={onChange}>
      {ENTITIES.map((e) => <option key={e} value={e}>{e} — {ENTITY_BROKERS[e]}</option>)}
    </Select>
  );
}
