import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Pane, Heading, Paragraph, Text, TextInput, Textarea, Select, Button, Alert, Radio
} from 'evergreen-ui';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { Card } from '../components/Card.jsx';
import { Chip } from '../components/Chip.jsx';
import { useRole } from '../lib/RoleContext.jsx';

const ACCENT = '#FF4C0B';
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    return <Pane is="pre" fontFamily="mono" fontSize={12} whiteSpace="pre-wrap" margin={0}>{JSON.stringify(value, null, 2)}</Pane>;
  }
  return String(value);
}

// Two-column key/value row used by the read-only Content card below.
function KvRow({ label, children }) {
  return (
    <Pane display="flex" paddingY={8} borderBottom="1px solid #F1F3F8">
      <Text width={130} flexShrink={0} color="muted" size={300}>{label}</Text>
      <Pane flex={1} minWidth={0}><Text size={300}>{children}</Text></Pane>
    </Pane>
  );
}

function toLocalInput(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

// Evergreen has no "selectable card" primitive — this is a real <button>
// (via Pane's polymorphic `is`) styled to match Evergreen's spacing/radius
// language, since a grid of icon+title+description choices like this
// doesn't map onto Radio/Select without losing the at-a-glance layout.
function ChoiceCard({ selected, disabled, onClick, icon, title, desc }) {
  return (
    <Pane
      is="button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      textAlign="left"
      display="flex"
      flexDirection="column"
      gap={6}
      padding={14}
      borderRadius={8}
      border={selected ? '2px solid ' + ACCENT : '1px solid #D8DAE5'}
      background={selected ? '#FFF4EE' : 'white'}
      cursor={disabled ? 'not-allowed' : 'pointer'}
      opacity={disabled ? 0.6 : 1}
      position="relative"
    >
      {selected && (
        <Pane position="absolute" top={10} right={10} color={ACCENT} fontWeight={700} fontSize={13}>✓</Pane>
      )}
      <Pane color={selected ? ACCENT : '#696F8C'}>{icon}</Pane>
      <Text fontWeight={600} size={300}>{title}</Text>
      <Text size={300} color="muted">{desc}</Text>
    </Pane>
  );
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

  if (error) return <Alert intent="danger">{error}</Alert>;
  if (!popup) return <Pane padding={40} textAlign="center"><Text color="muted">Loading…</Text></Pane>;

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
    <Pane display="flex" flexDirection="column" gap={16}>
      <Pane display="flex" justifyContent="space-between" alignItems="flex-start">
        <Pane>
          <Link to="/popups"><Text size={300} color="muted">← All popups</Text></Link>
          <Heading size={700} marginTop={6}>{popup.name}</Heading>
        </Pane>
        <Pane display="flex" alignItems="center" gap={10}>
          <StatusBadge status={popup.status} />
          <Text fontFamily="mono" size={300} color="muted">{popup.template}</Text>
        </Pane>
      </Pane>

      <Pane display="grid" gridTemplateColumns="1.3fr 1fr" gap={16}>
        <Pane display="flex" flexDirection="column" gap={16}>
          <Card title="Schedule & priority" subtitle="Highest priority wins among matches.">
            <Pane display="flex" gap={16} marginBottom={16} flexWrap="wrap">
              <Pane>
                <Text size={300} display="block" marginBottom={4}>Starts at</Text>
                <TextInput type="datetime-local" disabled={!canOperate}
                  value={toLocalInput(popup.starts_at)}
                  onChange={(e) => setField('starts_at', fromLocalInput(e.target.value))} />
              </Pane>
              <Pane>
                <Text size={300} display="block" marginBottom={4}>Ends at</Text>
                <TextInput type="datetime-local" disabled={!canOperate}
                  value={toLocalInput(popup.ends_at)}
                  onChange={(e) => setField('ends_at', fromLocalInput(e.target.value))} />
              </Pane>
            </Pane>
            <Pane maxWidth={160}>
              <Text size={300} display="block" marginBottom={4}>Priority</Text>
              <TextInput type="number" disabled={!canOperate} value={popup.priority}
                onChange={(e) => setField('priority', parseInt(e.target.value, 10) || 0)} />
            </Pane>
          </Card>

          <Card title="User behavior" subtitle="When would you like the popup to show up?">
            <Text size={300} display="block" marginBottom={8}>Trigger type</Text>
            <Pane display="grid" gridTemplateColumns="repeat(auto-fill, minmax(150px, 1fr))" gap={10}>
              {TRIGGER_OPTIONS.map((opt) => {
                const selected = (popup.trigger?.type || 'immediate') === opt.value;
                return (
                  <ChoiceCard key={opt.value} selected={selected} disabled={!canOperate}
                    onClick={() => setField('trigger', { type: opt.value, value: popup.trigger?.value, selector: popup.trigger?.selector })}
                    icon={<TriggerIcon type={opt.value} />} title={opt.label} desc={opt.desc} />
                );
              })}
            </Pane>
            {['delay', 'scroll', 'inactivity'].includes(popup.trigger?.type) && (
              <Pane maxWidth={200} marginTop={16}>
                <Text size={300} display="block" marginBottom={4}>
                  {popup.trigger.type === 'delay' ? 'Delay (ms)'
                    : popup.trigger.type === 'scroll' ? 'Scroll depth (%)'
                    : 'Inactivity (seconds)'}
                </Text>
                <TextInput type="number" disabled={!canOperate} value={popup.trigger.value || 0}
                  onChange={(e) => setField('trigger.value', parseInt(e.target.value, 10) || 0)} />
              </Pane>
            )}
            {popup.trigger?.type === 'element_click' && (
              <Pane maxWidth={340} marginTop={16}>
                <Text size={300} display="block" marginBottom={4}>CSS selector</Text>
                <TextInput width="100%" disabled={!canOperate} placeholder="e.g. #open-account-btn"
                  value={popup.trigger.selector || ''}
                  onChange={(e) => setField('trigger.selector', e.target.value)} />
                <Text size={300} color="muted" display="block" marginTop={6}>
                  Fires when the visitor clicks any element matching this selector.
                </Text>
              </Pane>
            )}
          </Card>

          <Card title="Frequency" subtitle="How often can this popup show, and when should it stop?">
            <Pane marginBottom={18}>
              <Text size={300} display="block" marginBottom={6}>Display frequency</Text>
              <Pane display="flex" gap={8} alignItems="center" flexWrap="wrap">
                <Text size={300} color="muted">Show up to</Text>
                <TextInput type="number" width={70} disabled={!canOperate}
                  value={popup.frequency?.max_impressions ?? ''} placeholder="∞"
                  onChange={(e) => setField('frequency.max_impressions', e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0))} />
                <Text size={300} color="muted">times per</Text>
                <Select disabled={!canOperate} value={popup.frequency?.per || 'session'}
                  onChange={(e) => setField('frequency.per', e.target.value)} width={130}>
                  {FREQ_PER.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Pane>
              {popup.frequency?.max_impressions == null && (
                <Text size={300} color="muted" display="block" marginTop={6}>
                  No per-popup cap — blank means display on every page view (still subject to the platform cap below).
                </Text>
              )}
            </Pane>
            <Pane marginBottom={12}>
              <Text size={300} display="block" marginBottom={6}>Stop displaying after user action</Text>
              <Pane display="flex" gap={8} alignItems="center" flexWrap="wrap">
                <Text size={300} color="muted">Don't show again for</Text>
                <TextInput type="number" width={70} disabled={!canOperate}
                  value={popup.frequency?.dismiss_ttl_days ?? 0}
                  onChange={(e) => setField('frequency.dismiss_ttl_days', parseInt(e.target.value, 10) || 0)} />
                <Text size={300} color="muted">days after it's dismissed</Text>
              </Pane>
              {!popup.frequency?.dismiss_ttl_days && (
                <Text size={300} color="muted" display="block" marginTop={6}>
                  Never stop displaying the popup after a dismissal (0 days).
                </Text>
              )}
            </Pane>
            <Text size={300} color="muted">Platform cap still applies on top: 1 per page view, 2 per session.</Text>
          </Card>

          <Card title="Devices">
            <Pane display="flex" gap={8}>
              {DEVICES.map((d) => (
                <Chip key={d} selected={(popup.devices || []).includes(d)} disabled={!canOperate} onClick={() => toggleDevice(d)}>
                  {d}
                </Chip>
              ))}
            </Pane>
          </Card>

          <LegalCard legal={legal} canOperate={canOperate} canCustomLegal={canCustomLegal}
            onChange={(next) => setField('content.legal', next)} />

          {canOperate && (
            <Pane display="flex" alignItems="center" gap={12}>
              <Button appearance="primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {savedAt && <Text size={300} color="muted">Saved {savedAt.toLocaleTimeString()}</Text>}
              {error && <Text size={300} color="danger">{error}</Text>}
            </Pane>
          )}
          {!canOperate && <Text size={300} color="muted">Viewer role — read only. Switch to Operator to edit.</Text>}
        </Pane>

        <Pane>
          <Card title="Content" subtitle="Read-only — authored by the source system.">
            <KvRow label="Heading">{popup.content.heading}</KvRow>
            {popup.content.cta_label && (
              <KvRow label="CTA">{popup.content.cta_label} → {popup.content.cta_url}</KvRow>
            )}

            {Object.keys(popup.content)
              .filter((k) => !CONTENT_FIELDS_HANDLED_SEPARATELY.has(k) && popup.content[k] != null && popup.content[k] !== '')
              .map((k) => (
                <KvRow key={k} label={humanizeContentKey(k)}>
                  <ContentValue value={popup.content[k]} />
                </KvRow>
              ))}

            {popup.content.overrides && Object.keys(popup.content.overrides).length > 0 && (
              <KvRow label="Overrides">
                <Pane fontFamily="mono" fontSize={12}>
                  {Object.entries(popup.content.overrides).map(([device, ov]) => (
                    <Pane key={device}>{device}: {Object.keys(ov).join(', ') || '(empty)'}</Pane>
                  ))}
                </Pane>
              </KvRow>
            )}
          </Card>
        </Pane>
      </Pane>
    </Pane>
  );
}

function LegalCard({ legal, canOperate, canCustomLegal, onChange }) {
  const [offReason, setOffReason] = useState(legal.off_reason || '');
  const [customText, setCustomText] = useState(legal.custom_text || '');

  return (
    <Card title="Legal / risk warning" subtitle="Cannot be device-overridden or hidden.">
      <Pane display="flex" flexDirection="column" gap={4}>
        <Radio name="legal-mode" disabled={!canOperate} checked={legal.mode === 'auto'}
          onChange={() => onChange({ mode: 'auto' })}
          label={
            <Pane>
              <Text fontWeight={600} size={300}>Auto <Text color="muted" size={300}>(default)</Text></Text>
              <Text size={300} color="muted" display="block">Resolved automatically from the registry by broker and country.</Text>
            </Pane>
          } />

        <Radio name="legal-mode" disabled={!canOperate} checked={legal.mode === 'off'}
          onChange={() => onChange({ mode: 'off', off_reason: offReason })}
          label={
            <Pane>
              <Text fontWeight={600} size={300}>Off <Text color="danger" size={300}>⚠ requires reason</Text></Text>
              <Text size={300} color="muted" display="block">No legal text shown. Audit-logged.</Text>
              {legal.mode === 'off' && (
                <TextInput marginTop={8} width="100%" placeholder="Reason (required)" disabled={!canOperate}
                  value={offReason}
                  onChange={(e) => { setOffReason(e.target.value); onChange({ mode: 'off', off_reason: e.target.value }); }} />
              )}
            </Pane>
          } />

        <Radio name="legal-mode" disabled={!canOperate || !canCustomLegal} checked={legal.mode === 'custom'}
          onChange={() => onChange({ mode: 'custom', custom_text: customText })}
          label={
            <Pane>
              <Text fontWeight={600} size={300}>Custom <Text color="muted" size={300}>(restricted — Compliance only)</Text></Text>
              <Text size={300} color="muted" display="block">Text supplied directly. No one from Compliance reviewed it unless entered here.</Text>
              {legal.mode === 'custom' && (
                <Textarea marginTop={8} width="100%" placeholder="Custom legal text" disabled={!canOperate || !canCustomLegal}
                  value={customText}
                  onChange={(e) => { setCustomText(e.target.value); onChange({ mode: 'custom', custom_text: e.target.value }); }} />
              )}
            </Pane>
          } />
      </Pane>
      {!canCustomLegal && <Text size={300} color="muted" display="block" marginTop={10}>Custom mode requires the Compliance role.</Text>}
    </Card>
  );
}
