import { Select } from 'evergreen-ui';

// Single source for the broker-entity list — was hand-copied into three
// forms (LegalTexts, Registration's domain + consent forms), which is
// exactly how `lbx` went missing from all three until fixed by hand in
// each one. A future entity now only needs adding here.
const ENTITIES = ['cysec', 'fcil', 'lbx'];

export function EntitySelect({ value, onChange }) {
  return (
    <Select value={value} onChange={onChange}>
      {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
    </Select>
  );
}
