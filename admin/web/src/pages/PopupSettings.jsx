import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useRole } from '../lib/RoleContext.jsx';

const DEVICES = ['desktop', 'tablet', 'mobile'];
const FREQ_PER = ['session', 'day', 'lifetime'];

const TRIGGER_ICON_PATHS = {
  immediate: <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  delay: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 3.5" /></>,
  scroll: <><path d="M12 4v13" /><path d="M6.5 12.5L12 18l5.5-5.5" /></>,
  exit_intent: <><path d="M15 3h6v6" /><path d="M21 3l-9 9" /><path d="M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
  element_click: <path d="M6 3l14 6-6 2-2 6-6-14z" />,
  inactivity: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>
};

const TRIGGER_OPTIONS = [
  { value: 'immediate', label: 'Immediate', desc: 'Shows as soon as the page loads.' },
  { value: 'delay', label: 'Delay', desc: 'Shows after a fixed number of milliseconds.' },
  { value: 'scroll', label: 'Scroll depth', desc: 'Shows once the visitor scrolls past a depth.' },
  { value: 'inactivity', label: 'Inactivity', desc: 'Shows after the visitor stops interacting for a while.' },
  { value: 'exit_intent', label: 'Exit intent', desc: 'Shows when the cursor moves to leave. Desktop only.' },
  { value: 'element_click', label: 'Element click', desc: 'Shows when a specific page element is clicked.' }
];

function TriggerIcon({ type }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {TRIGGER_ICON_PATHS[type]}
    </svg>
  );
}

// Content is a different shape per template (ingestSchemas.js's
// CONTENT_SCHEMAS) — heading/cta/theme are common, but subheading/shape
// only exist on modal, position only on banner, questions/completion only
// on questionnaire, duration_ms/assets/etc only on gamification, and so on.
// Hardcoding a fixed field list here means it silently stops showing
// whatever the schema grows next — this renders whatever's actually on
// the popup instead, so it can't fall out of sync with ingestSchemas.js
// the way the old fixed list already had (see admin/HOW_TO_SEND_CONTENT.md
// for what each template can carry).
const CONTENT_FIELD_LABELS = {
  heading: 'Heading', subheading: 'Subheading', body: 'Body', theme: 'Theme',
  show_logo: 'Show logo', shape: 'Shape', position: 'Position',
  image_url: 'Image', image_alt: 'Image alt text',
  duration_ms: 'Duration (ms)', volatility_pct: 'Volatility', win_body: 'Win message', lose_body: 'Lose message'
};
// Rendered elsewhere on this page (CTA combined below; legal has its own
// editable card; overrides gets its own summary row) — never duplicated.
const CONTENT_FIELDS_HANDLED_SEPARATELY = new Set(['heading', 'cta_label', 'cta_url', 'legal', 'overrides']);

function humanizeContentKey(key) {
  return CONTENT_FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function ContentValue({ value }) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return value.join(', ');
  if (typeof value === 'object') {
    return <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>;
  }
  return String(value);
}

function toLocalInput(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

export default function PopupSettings() {
  const { id } = useParams();
  const { identity } = useRole();
  const [popup, setPopup] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const canOperate = identity.role === 'operator' || identity.role === 'compliance';
  const canCustomLegal = identity.role === 'compliance';

  const load = useCallback(() => {
    api.popups.get(id).then(setPopup).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!popup) return <div className="empty-state">Loading…</div>;

  function setField(path, value) {
    setPopup((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      let obj = next;
      const keys = path.split('.');
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function toggleDevice(device) {
    const set = new Set(popup.devices || []);
    set.has(device) ? set.delete(device) : set.add(device);
    setField('devices', DEVICES.filter((d) => set.has(d)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        name: popup.name,
        priority: popup.priority,
        starts_at: popup.starts_at,
        ends_at: popup.ends_at,
        devices: popup.devices,
        trigger: popup.trigger,
        frequency: popup.frequency,
        legal: popup.content.legal
      };
      const updated = await api.popups.update(id, patch);
      setPopup(updated);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const legal = popup.content.legal || { mode: 'auto' };

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <Link to="/popups" className="small muted">← All popups</Link>
          <h2 style={{ marginTop: 6 }}>{popup.name}</h2>
        </div>
        <div className="row">
          <StatusBadge status={popup.status} />
          <span className="mono small muted">{popup.template}</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div><h2>Schedule &amp; priority</h2><p>Highest priority wins among matches.</p></div>
            </div>
            <div className="card-pad">
              <div className="field-row">
                <div className="field">
                  <label>Starts at</label>
                  <input type="datetime-local" disabled={!canOperate}
                    value={toLocalInput(popup.starts_at)}
                    onChange={(e) => setField('starts_at', fromLocalInput(e.target.value))} />
                </div>
                <div className="field">
                  <label>Ends at</label>
                  <input type="datetime-local" disabled={!canOperate}
                    value={toLocalInput(popup.ends_at)}
                    onChange={(e) => setField('ends_at', fromLocalInput(e.target.value))} />
                </div>
              </div>
              <div className="field" style={{ maxWidth: 160 }}>
                <label>Priority</label>
                <input type="number" disabled={!canOperate} value={popup.priority}
                  onChange={(e) => setField('priority', parseInt(e.target.value, 10) || 0)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h2>User behavior</h2><p>When would you like the popup to show up?</p></div></div>
            <div className="card-pad">
              <div className="field">
                <label>Trigger type</label>
                <div className="choice-grid">
                  {TRIGGER_OPTIONS.map((opt) => {
                    const selected = (popup.trigger?.type || 'immediate') === opt.value;
                    return (
                      <button key={opt.value} type="button" disabled={!canOperate}
                        className={'choice-card' + (selected ? ' selected' : '')}
                        onClick={() => setField('trigger', { type: opt.value, value: popup.trigger?.value, selector: popup.trigger?.selector })}>
                        {selected && <span className="choice-badge">✓</span>}
                        <span className="choice-icon"><TriggerIcon type={opt.value} /></span>
                        <span className="choice-title">{opt.label}</span>
                        <span className="choice-desc">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {['delay', 'scroll', 'inactivity'].includes(popup.trigger?.type) && (
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>
                    {popup.trigger.type === 'delay' ? 'Delay (ms)'
                      : popup.trigger.type === 'scroll' ? 'Scroll depth (%)'
                      : 'Inactivity (seconds)'}
                  </label>
                  <input type="number" disabled={!canOperate} value={popup.trigger.value || 0}
                    onChange={(e) => setField('trigger.value', parseInt(e.target.value, 10) || 0)} />
                </div>
              )}
              {popup.trigger?.type === 'element_click' && (
                <div className="field" style={{ maxWidth: 320 }}>
                  <label>CSS selector</label>
                  <input type="text" disabled={!canOperate} placeholder="e.g. #open-account-btn"
                    value={popup.trigger.selector || ''}
                    onChange={(e) => setField('trigger.selector', e.target.value)} />
                  <p className="field-hint">Fires when the visitor clicks any element matching this selector.</p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h2>Frequency</h2><p>How often can this popup show, and when should it stop?</p></div></div>
            <div className="card-pad stack">
              <div className="field">
                <label>Display frequency</label>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="small muted">Show up to</span>
                  <input type="number" style={{ width: 70 }} disabled={!canOperate}
                    value={popup.frequency?.max_impressions ?? ''} placeholder="∞"
                    onChange={(e) => setField('frequency.max_impressions', e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0))} />
                  <span className="small muted">times per</span>
                  <select disabled={!canOperate} value={popup.frequency?.per || 'session'}
                    onChange={(e) => setField('frequency.per', e.target.value)}>
                    {FREQ_PER.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <p className="field-hint">
                  {popup.frequency?.max_impressions == null
                    ? 'No per-popup cap — blank means display on every page view (still subject to the platform cap below).'
                    : null}
                </p>
              </div>
              <div className="field">
                <label>Stop displaying after user action</label>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="small muted">Don't show again for</span>
                  <input type="number" style={{ width: 70 }} disabled={!canOperate}
                    value={popup.frequency?.dismiss_ttl_days ?? 0}
                    onChange={(e) => setField('frequency.dismiss_ttl_days', parseInt(e.target.value, 10) || 0)} />
                  <span className="small muted">days after it's dismissed</span>
                </div>
                <p className="field-hint">
                  {!popup.frequency?.dismiss_ttl_days ? 'Never stop displaying the popup after a dismissal (0 days).' : null}
                </p>
              </div>
              <p className="field-hint">Platform cap still applies on top: 1 per page view, 2 per session.</p>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2>Devices</h2></div>
            <div className="card-pad">
              <div className="chip-select">
                {DEVICES.map((d) => (
                  <button key={d} type="button" disabled={!canOperate}
                    className={'chip' + ((popup.devices || []).includes(d) ? ' selected' : '')}
                    onClick={() => toggleDevice(d)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <LegalCard legal={legal} canOperate={canOperate} canCustomLegal={canCustomLegal}
            onChange={(next) => setField('content.legal', next)} />

          {canOperate && (
            <div className="row">
              <button className="btn btn-accent" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {savedAt && <span className="small muted">Saved {savedAt.toLocaleTimeString()}</span>}
              {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
            </div>
          )}
          {!canOperate && <p className="small muted">Viewer role — read only. Switch to Operator to edit.</p>}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header"><div><h2>Content</h2><p>Read-only — authored by the source system.</p></div></div>
            <div className="card-pad">
              <dl className="kv">
                <dt>Heading</dt><dd>{popup.content.heading}</dd>
                {popup.content.cta_label && <><dt>CTA</dt><dd>{popup.content.cta_label} → {popup.content.cta_url}</dd></>}

                {Object.keys(popup.content)
                  .filter((k) => !CONTENT_FIELDS_HANDLED_SEPARATELY.has(k) && popup.content[k] != null && popup.content[k] !== '')
                  .map((k) => (
                    <Fragment key={k}>
                      <dt>{humanizeContentKey(k)}</dt>
                      <dd className={typeof popup.content[k] === 'object' ? 'mono small' : undefined}>
                        <ContentValue value={popup.content[k]} />
                      </dd>
                    </Fragment>
                  ))}

                {popup.content.overrides && Object.keys(popup.content.overrides).length > 0 && (
                  <>
                    <dt>Overrides</dt>
                    <dd className="mono small">
                      {Object.entries(popup.content.overrides).map(([device, ov]) => (
                        <div key={device}>{device}: {Object.keys(ov).join(', ') || '(empty)'}</div>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegalCard({ legal, canOperate, canCustomLegal, onChange }) {
  const [offReason, setOffReason] = useState(legal.off_reason || '');
  const [customText, setCustomText] = useState(legal.custom_text || '');

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>Legal / risk warning</h2><p>Cannot be device-overridden or hidden.</p></div>
      </div>
      <div className="card-pad">
        <div className="radio-group">
          <label className={'radio-option' + (legal.mode === 'auto' ? ' selected' : '')}>
            {legal.mode === 'auto' && <span className="choice-badge">✓</span>}
            <input type="radio" name="legal-mode" disabled={!canOperate} checked={legal.mode === 'auto'}
              onChange={() => onChange({ mode: 'auto' })} />
            <div>
              <div className="radio-title">Auto <span className="small muted">(default)</span></div>
              <div className="radio-desc">Resolved automatically from the registry by broker and country.</div>
            </div>
          </label>

          <label className={'radio-option' + (legal.mode === 'off' ? ' selected' : '')}>
            {legal.mode === 'off' && <span className="choice-badge">✓</span>}
            <input type="radio" name="legal-mode" disabled={!canOperate} checked={legal.mode === 'off'}
              onChange={() => onChange({ mode: 'off', off_reason: offReason })} />
            <div style={{ flex: 1 }}>
              <div className="radio-title">Off <span className="small" style={{ color: 'var(--danger)' }}>⚠ requires reason</span></div>
              <div className="radio-desc">No legal text shown. Audit-logged.</div>
              {legal.mode === 'off' && (
                <input type="text" placeholder="Reason (required)" disabled={!canOperate}
                  style={{ marginTop: 8, width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}
                  value={offReason}
                  onChange={(e) => { setOffReason(e.target.value); onChange({ mode: 'off', off_reason: e.target.value }); }} />
              )}
            </div>
          </label>

          <label className={'radio-option' + (legal.mode === 'custom' ? ' selected' : '')}>
            {legal.mode === 'custom' && <span className="choice-badge">✓</span>}
            <input type="radio" name="legal-mode" disabled={!canOperate || !canCustomLegal} checked={legal.mode === 'custom'}
              onChange={() => onChange({ mode: 'custom', custom_text: customText })} />
            <div style={{ flex: 1 }}>
              <div className="radio-title">Custom <span className="small muted">(restricted — Compliance only)</span></div>
              <div className="radio-desc">Text supplied directly. No one from Compliance reviewed it unless entered here.</div>
              {legal.mode === 'custom' && (
                <textarea placeholder="Custom legal text" disabled={!canOperate || !canCustomLegal}
                  style={{ marginTop: 8, width: '100%' }}
                  value={customText}
                  onChange={(e) => { setCustomText(e.target.value); onChange({ mode: 'custom', custom_text: e.target.value }); }} />
              )}
            </div>
          </label>
        </div>
        {!canCustomLegal && <p className="field-hint" style={{ marginTop: 10 }}>Custom mode requires the Compliance role.</p>}
      </div>
    </div>
  );
}
