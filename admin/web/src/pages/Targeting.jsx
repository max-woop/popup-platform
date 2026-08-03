import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';

const DIMENSIONS = ['path', 'url', 'query', 'referrer', 'device', 'datalayer', 'language', 'country'];
const OPERATORS_BY_DIM = {
  path: ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in'],
  url: ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in'],
  query: ['exists', 'equals'],
  referrer: ['contains', 'equals'],
  device: ['in'],
  datalayer: ['equals', 'in', 'exists'],
  language: ['equals', 'in'],
  country: ['equals', 'in']
};
const NEEDS_ATTR = new Set(['query', 'datalayer']);
const DEVICES = ['desktop', 'tablet', 'mobile'];

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

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>Rule builder</h2><p>OR within a group, AND across groups.</p></div>
        <select value={popupId} onChange={(e) => setPopupId(e.target.value)} style={{ minWidth: 220 }}>
          {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="card-pad stack">
        {groups.length === 0 && <p className="muted small">No targeting rules — popup shows on every page (still subject to schedule, devices, caps).</p>}

        {groups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="row" style={{ margin: '4px 0', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>AND</div>}
            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-pad stack" style={{ padding: 12 }}>
                {group.map((rule, ri) => {
                  const ops = OPERATORS_BY_DIM[rule.d] || [];
                  return (
                    <div key={ri}>
                      {ri > 0 && <div className="small muted" style={{ fontWeight: 700, margin: '2px 0' }}>OR</div>}
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <select disabled={!canOperate} value={rule.d}
                          onChange={(e) => updateRule(gi, ri, { d: e.target.value, op: OPERATORS_BY_DIM[e.target.value][0], v: '' })}>
                          {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                        {NEEDS_ATTR.has(rule.d) && (
                          <input type="text" disabled={!canOperate} placeholder="key (e.g. page_type)" style={{ width: 140 }}
                            value={rule.a || ''} onChange={(e) => updateRule(gi, ri, { a: e.target.value })} />
                        )}
                        <select disabled={!canOperate} value={rule.op}
                          onChange={(e) => updateRule(gi, ri, { op: e.target.value })}>
                          {ops.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                        {rule.d === 'device' ? (
                          <div className="chip-select">
                            {DEVICES.map((dv) => {
                              const arr = Array.isArray(rule.v) ? rule.v : [];
                              const sel = arr.includes(dv);
                              return (
                                <button key={dv} type="button" disabled={!canOperate}
                                  className={'chip' + (sel ? ' selected' : '')}
                                  onClick={() => updateRule(gi, ri, { v: sel ? arr.filter((x) => x !== dv) : [...arr, dv] })}>
                                  {dv}
                                </button>
                              );
                            })}
                          </div>
                        ) : rule.op !== 'exists' ? (
                          <input type="text" disabled={!canOperate} style={{ minWidth: 160, flex: 1 }}
                            value={valueFor(rule)} onChange={(e) => onValueChange(gi, ri, rule, e.target.value)} />
                        ) : null}
                        <label className="small muted row" style={{ gap: 4 }}>
                          <input type="checkbox" disabled={!canOperate} checked={!!rule.negate}
                            onChange={(e) => updateRule(gi, ri, { negate: e.target.checked })} /> negate
                        </label>
                        {canOperate && <button className="btn btn-sm btn-danger" onClick={() => removeRule(gi, ri)}>Remove</button>}
                      </div>
                    </div>
                  );
                })}
                {canOperate && <button className="btn btn-sm" onClick={() => addRule(gi)}>+ OR rule</button>}
              </div>
            </div>
            {canOperate && <button className="btn btn-sm btn-danger" style={{ marginTop: 6 }} onClick={() => removeGroup(gi)}>Remove group</button>}
          </div>
        ))}

        {canOperate && (
          <div className="row">
            <button className="btn" onClick={addGroup}>+ AND group</button>
            <button className="btn btn-accent" disabled={saving || !popupId} onClick={save}>{saving ? 'Saving…' : 'Save targeting'}</button>
            {savedAt && <span className="small muted">Saved {savedAt.toLocaleTimeString()}</span>}
          </div>
        )}
      </div>
    </div>
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
    <div className="card">
      <div className="card-header">
        <div><h2>URL tester</h2><p>Paste a URL — see what would show and why.</p></div>
      </div>
      <div className="card-pad stack">
        <div className="field">
          <label>URL</label>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Device</label>
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>country (data layer)</label>
            <input type="text" value={dataLayer.country} onChange={(e) => setDlField('country', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>page_type (data layer)</label>
            <input type="text" value={dataLayer.page_type} onChange={(e) => setDlField('page_type', e.target.value)} />
          </div>
          <div className="field">
            <label>language (data layer)</label>
            <input type="text" value={dataLayer.language} onChange={(e) => setDlField('language', e.target.value)} />
          </div>
        </div>

        <div><button className="btn btn-primary" disabled={running} onClick={run}>{running ? 'Testing…' : 'Run test'}</button></div>

        {error && <div className="alert alert-danger">{error}</div>}

        {result && (
          <div className="stack">
            <div className="alert alert-info">
              <div>
                <strong>{result.resolved_host}</strong> → entity <strong>{result.resolved_entity || 'unresolved'}</strong>
                {result.entity_suppressed && (
                  <div className="small">Unknown domain — any <code>auto</code>-mode popup is suppressed rather than shown without a warning (§11.3.3).</div>
                )}
              </div>
            </div>

            {result.popups.map((p) => (
              <div key={p.id} className="card" style={{ boxShadow: 'none', borderColor: p.id === result.winner ? 'var(--accent)' : undefined }}>
                <div className="card-pad" style={{ padding: 14 }}>
                  <div className="row-between">
                    <div className="row">
                      <strong>{p.name}</strong>
                      <span className="mono small muted">priority {p.priority}</span>
                      {p.id === result.winner && <span className="badge badge-live">Wins</span>}
                    </div>
                    <span className={p.would_render ? 'small' : 'small muted'} style={{ color: p.would_render ? 'var(--success)' : undefined }}>
                      {p.would_render ? 'Would render' : 'Suppressed'}
                    </span>
                  </div>
                  {p.blockers.length > 0 && (
                    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {p.blockers.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  )}
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Legal: {p.legal.suppressed ? <span style={{ color: 'var(--danger)' }}>suppressed — {p.legal.reason}</span> : (p.legal.text || '(none required)')}
                    {p.legal.version != null && !p.legal.suppressed && <span> · v{p.legal.version}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Targeting() {
  const [popups, setPopups] = useState([]);
  const load = useCallback(() => { api.popups.list().then(setPopups); }, []);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <RuleBuilder popups={popups} onSaved={load} />
      <UrlTester />
    </div>
  );
}
