import { useEffect, useState, useCallback, Fragment } from 'react';
import {
  Pane, Text, TextInput, Select, Button, Checkbox, Alert, Badge, UnorderedList, ListItem
} from 'evergreen-ui';
import { api } from '../lib/api';
import { Card } from '../components/Card.jsx';
import { Chip } from '../components/Chip.jsx';
import { useRole } from '../lib/RoleContext.jsx';

const ACCENT = '#FF4C0B';
const DIMENSIONS = ['path', 'url', 'query', 'referrer', 'device', 'datalayer', 'language', 'country', 'cookie', 'element_exists'];
const OPERATORS_BY_DIM = {
  path: ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in'],
  url: ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in'],
  query: ['exists', 'equals'],
  referrer: ['contains', 'equals'],
  device: ['in'],
  datalayer: ['equals', 'in', 'exists'],
  language: ['equals', 'in'],
  country: ['equals', 'in'],
  cookie: ['exists', 'equals', 'contains'],
  // Presence-only — evaluated client-side (§6.1); the URL tester can't see
  // a real DOM, so it flags any rule using this dimension as unverifiable.
  element_exists: ['exists']
};
const NEEDS_ATTR = new Set(['query', 'datalayer', 'cookie']);
const DEVICES = ['desktop', 'tablet', 'mobile'];
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'de', label: 'German' }, { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' }, { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' }, { code: 'ar', label: 'Arabic' }, { code: 'zh', label: 'Chinese' }
];

// Drives itself off whatever language/in rule already exists in `groups`
// (any position) rather than owning separate state — so it stays in sync
// with the generic rule builder below instead of becoming a second source
// of truth for the same data.
function BrowserLanguagePicker({ groups, setGroups, canOperate }) {
  let gi = -1, ri = -1;
  groups.forEach((g, i) => (g || []).forEach((r, j) => { if (r.d === 'language' && gi === -1) { gi = i; ri = j; } }));
  const rule = gi === -1 ? null : groups[gi][ri];
  const selected = !rule ? [] : Array.isArray(rule.v) ? rule.v : [rule.v].filter(Boolean);

  function toggle(code) {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    setGroups((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (gi === -1) {
        if (next.length) copy.push([{ d: 'language', op: 'in', v: next }]);
        return copy;
      }
      if (next.length) { copy[gi][ri] = { d: 'language', op: 'in', v: next }; return copy; }
      copy[gi].splice(ri, 1);
      if (!copy[gi].length) copy.splice(gi, 1);
      return copy;
    });
  }

  return (
    <Pane border="1px solid #E4E7EE" borderRadius={8} padding={12}>
      <Text size={300} color="muted" display="block" marginBottom={6}>Browser language</Text>
      <Pane display="flex" gap={8} flexWrap="wrap">
        {LANGUAGES.map((l) => (
          <Chip key={l.code} selected={selected.includes(l.code)} disabled={!canOperate} onClick={() => toggle(l.code)}>
            {l.label}
          </Chip>
        ))}
      </Pane>
      <Text size={300} color="muted" display="block" marginTop={8}>
        {selected.length ? 'Shows only for these browser languages.' : 'No restriction — shows for any browser language.'}
      </Text>
    </Pane>
  );
}

function emptyRule() { return { d: 'path', op: 'starts_with', v: '/promo', a: '', negate: false }; }

function RuleBuilder({ popups, onSaved }) {
  const { identity } = useRole();
  const canOperate = identity.role === 'operator' || identity.role === 'compliance';
  const [popupId, setPopupId] = useState('');
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!popupId && popups.length) setPopupId(popups[0].id);
  }, [popups, popupId]);

  useEffect(() => {
    if (!popupId) return;
    api.popups.get(popupId).then((p) => setGroups(JSON.parse(JSON.stringify(p.targeting || []))));
    setSavedAt(null);
  }, [popupId]);

  function updateRule(gi, ri, patch) {
    setGroups((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      next[gi][ri] = { ...next[gi][ri], ...patch };
      return next;
    });
  }
  function addGroup() { setGroups((prev) => [...prev, [emptyRule()]]); }
  function removeGroup(gi) { setGroups((prev) => prev.filter((_, i) => i !== gi)); }
  function addRule(gi) { setGroups((prev) => prev.map((g, i) => (i === gi ? [...g, emptyRule()] : g))); }
  function removeRule(gi, ri) {
    setGroups((prev) => prev.map((g, i) => (i === gi ? g.filter((_, j) => j !== ri) : g)));
  }

  function valueFor(rule) {
    if (rule.op === 'in' || rule.op === 'not_in') return (Array.isArray(rule.v) ? rule.v.join(', ') : rule.v || '');
    return rule.v ?? '';
  }
  function onValueChange(gi, ri, rule, raw) {
    if (rule.op === 'in' || rule.op === 'not_in') {
      updateRule(gi, ri, { v: raw.split(',').map((s) => s.trim()).filter(Boolean) });
    } else {
      updateRule(gi, ri, { v: raw });
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.popups.update(popupId, { targeting: groups });
      setSavedAt(new Date());
      onSaved?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  // The language rule the picker above owns is rendered as chips, not
  // again as a raw dropdown row below — same underlying data, shown once.
  // langGi/langRi is the first language rule anywhere.
  let langGi = -1, langRi = -1;
  groups.forEach((g, i) => (g || []).forEach((r, j) => { if (r.d === 'language' && langGi === -1) { langGi = i; langRi = j; } }));
  const otherRulesExist = groups.some((g, gi) => (g || []).some((r, ri) => !(gi === langGi && ri === langRi)));

  return (
    <Card title="Rule builder" subtitle="OR within a group, AND across groups."
      right={<Select value={popupId} onChange={(e) => setPopupId(e.target.value)} width={230}>
        {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>}>
      <Pane display="flex" flexDirection="column" gap={16}>
        <BrowserLanguagePicker groups={groups} setGroups={setGroups} canOperate={canOperate} />

        {!otherRulesExist && (
          <Text size={300} color="muted">No other targeting rules — popup shows on every page (still subject to schedule, devices, caps).</Text>
        )}

        {groups.map((group, gi) => {
          const visible = group.map((rule, ri) => ({ rule, ri })).filter(({ ri }) => !(gi === langGi && ri === langRi));
          if (!visible.length) return null;
          return (
            <Fragment key={gi}>
              {gi > 0 && <Text size={300} fontWeight={700} color="muted">AND</Text>}
              <Pane border="1px solid #E4E7EE" borderRadius={8} padding={12}>
                <Pane display="flex" flexDirection="column" gap={10}>
                  {visible.map(({ rule, ri }) => {
                    const ops = OPERATORS_BY_DIM[rule.d] || [];
                    return (
                      <Pane key={ri}>
                        {ri > 0 && <Text size={300} fontWeight={700} color="muted" display="block" marginBottom={4}>OR</Text>}
                        <Pane display="flex" gap={8} alignItems="center" flexWrap="wrap">
                          <Select disabled={!canOperate} value={rule.d} width={140}
                            onChange={(e) => updateRule(gi, ri, { d: e.target.value, op: OPERATORS_BY_DIM[e.target.value][0], v: '' })}>
                            {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </Select>
                          {NEEDS_ATTR.has(rule.d) && (
                            <TextInput disabled={!canOperate} placeholder="key (e.g. page_type)" width={150}
                              value={rule.a || ''} onChange={(e) => updateRule(gi, ri, { a: e.target.value })} />
                          )}
                          <Select disabled={!canOperate} value={rule.op} width={130}
                            onChange={(e) => updateRule(gi, ri, { op: e.target.value })}>
                            {ops.map((op) => <option key={op} value={op}>{op}</option>)}
                          </Select>
                          {rule.d === 'device' ? (
                            <Pane display="flex" gap={6} flexWrap="wrap">
                              {DEVICES.map((dv) => {
                                const arr = Array.isArray(rule.v) ? rule.v : [];
                                const sel = arr.includes(dv);
                                return (
                                  <Chip key={dv} selected={sel} disabled={!canOperate}
                                    onClick={() => updateRule(gi, ri, { v: sel ? arr.filter((x) => x !== dv) : [...arr, dv] })}>
                                    {dv}
                                  </Chip>
                                );
                              })}
                            </Pane>
                          ) : rule.d === 'element_exists' ? (
                            <TextInput disabled={!canOperate} placeholder="CSS selector, e.g. .promo-banner" flex={1} minWidth={200}
                              value={valueFor(rule)} onChange={(e) => onValueChange(gi, ri, rule, e.target.value)} />
                          ) : rule.op !== 'exists' ? (
                            <TextInput disabled={!canOperate} flex={1} minWidth={160}
                              value={valueFor(rule)} onChange={(e) => onValueChange(gi, ri, rule, e.target.value)} />
                          ) : null}
                          <Pane is="label" display="flex" alignItems="center" gap={4}>
                            <Checkbox disabled={!canOperate} checked={!!rule.negate} label="negate" margin={0}
                              onChange={(e) => updateRule(gi, ri, { negate: e.target.checked })} />
                          </Pane>
                          {canOperate && <Button size="small" intent="danger" onClick={() => removeRule(gi, ri)}>Remove</Button>}
                        </Pane>
                      </Pane>
                    );
                  })}
                  {canOperate && <Pane><Button size="small" onClick={() => addRule(gi)}>+ OR rule</Button></Pane>}
                </Pane>
              </Pane>
              {canOperate && <Pane><Button size="small" intent="danger" onClick={() => removeGroup(gi)}>Remove group</Button></Pane>}
            </Fragment>
          );
        })}

        {canOperate && (
          <Pane display="flex" alignItems="center" gap={12}>
            <Button onClick={addGroup}>+ AND group</Button>
            <Button appearance="primary" disabled={saving || !popupId} onClick={save}>{saving ? 'Saving…' : 'Save targeting'}</Button>
            {savedAt && <Text size={300} color="muted">Saved {savedAt.toLocaleTimeString()}</Text>}
          </Pane>
        )}
      </Pane>
    </Card>
  );
}

function UrlTester() {
  const [url, setUrl] = useState('https://libertex.com/promo/summer');
  const [device, setDevice] = useState('desktop');
  const [dataLayer, setDataLayer] = useState({ page_type: 'promo', country: 'CY', language: 'en', user_logged_in: 'false' });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  function setDlField(key, value) { setDataLayer((prev) => ({ ...prev, [key]: value })); }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await api.urlTester({ url, device, dataLayer });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card title="URL tester" subtitle="Paste a URL — see what would show and why.">
      <Pane display="flex" flexDirection="column" gap={14}>
        <Pane>
          <Text size={300} display="block" marginBottom={4}>URL</Text>
          <TextInput width="100%" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Pane>
        <Pane display="flex" gap={16} flexWrap="wrap">
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Device</Text>
            <Select value={device} onChange={(e) => setDevice(e.target.value)} width={150}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>country (data layer)</Text>
            <TextInput value={dataLayer.country} onChange={(e) => setDlField('country', e.target.value)} />
          </Pane>
        </Pane>
        <Pane display="flex" gap={16} flexWrap="wrap">
          <Pane>
            <Text size={300} display="block" marginBottom={4}>page_type (data layer)</Text>
            <TextInput value={dataLayer.page_type} onChange={(e) => setDlField('page_type', e.target.value)} />
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>language (data layer)</Text>
            <TextInput value={dataLayer.language} onChange={(e) => setDlField('language', e.target.value)} />
          </Pane>
        </Pane>

        <Pane><Button appearance="primary" disabled={running} onClick={run}>{running ? 'Testing…' : 'Run test'}</Button></Pane>

        {error && <Alert intent="danger">{error}</Alert>}

        {result && (
          <Pane display="flex" flexDirection="column" gap={12}>
            <Alert intent="none" title={<>{result.resolved_host} → entity {result.resolved_entity || 'unresolved'}</>}>
              {result.entity_suppressed && (
                <Text size={300} display="block" marginTop={4}>
                  Unknown domain — any <Text is="code" size={300}>auto</Text>-mode popup is suppressed rather than shown without a warning (§11.3.3).
                </Text>
              )}
            </Alert>

            {result.popups.map((p) => (
              <Pane key={p.id} border={p.id === result.winner ? '2px solid ' + ACCENT : '1px solid #E4E7EE'} borderRadius={8} padding={14}>
                <Pane display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={8}>
                  <Pane display="flex" alignItems="center" gap={8}>
                    <Text fontWeight={600}>{p.name}</Text>
                    <Text fontFamily="mono" size={300} color="muted">priority {p.priority}</Text>
                    {p.id === result.winner && <Badge color="green">Wins</Badge>}
                  </Pane>
                  <Text size={300} color={p.would_render ? 'success' : 'muted'}>
                    {p.would_render ? 'Would render' : 'Suppressed'}
                  </Text>
                </Pane>
                {p.blockers.length > 0 && (
                  <UnorderedList size={300} color="muted" marginTop={8}>
                    {p.blockers.map((b, i) => <ListItem key={i}>{b}</ListItem>)}
                  </UnorderedList>
                )}
                {p.caveats?.length > 0 && (
                  <Alert intent="none" marginTop={8}>
                    {p.caveats.map((c, i) => <Text key={i} size={300} display="block">⚠ {c}</Text>)}
                  </Alert>
                )}
                <Text size={300} color="muted" display="block" marginTop={8}>
                  Legal: {p.legal.suppressed ? <Text color="danger" size={300}>suppressed — {p.legal.reason}</Text> : (p.legal.text || '(none required)')}
                  {p.legal.version != null && !p.legal.suppressed && <Text size={300} color="muted"> · v{p.legal.version}</Text>}
                </Text>
              </Pane>
            ))}
          </Pane>
        )}
      </Pane>
    </Card>
  );
}

export default function Targeting() {
  const [popups, setPopups] = useState([]);
  const load = useCallback(() => { api.popups.list().then(setPopups); }, []);
  useEffect(load, [load]);

  return (
    <Pane display="flex" flexDirection="column" gap={16}>
      <RuleBuilder popups={popups} onSaved={load} />
      <UrlTester />
    </Pane>
  );
}
