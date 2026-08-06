import { useEffect, useState, useCallback } from 'react';
import { Pane, Text, TextInput, Button, Alert, Table } from 'evergreen-ui';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';
import { Card } from '../components/Card.jsx';

// Vite's dev server (:5173) only proxies /api (see admin/web/vite.config.js)
// — /dist and /v1 are only reachable on admin/server itself, :8787 locally.
// In production, admin/server serves this admin UI too, so the two origins
// collapse into one and window.location.origin is simply correct.
const SDK_ORIGIN = import.meta.env.PROD ? window.location.origin : 'http://localhost:8787';

// Mirrors tealium-tag.html's shape (double-fire guard, fail-silent load,
// same config keys) but as a direct embed for sites not using Tealium,
// pointed at this deployment's own /dist instead of a real CDN. Genuinely
// works if pasted as-is — SRI is deliberately left out, the way
// tealium-tag.html also ships without a real hash: a stale hash baked into
// a snippet already pasted onto an external site breaks the embed outright
// (browsers refuse to run a script whose hash doesn't match) the next time
// this deployment rebuilds sdk.js, which is worse than no SRI at all.
function embedSnippet(origin) {
  return [
    '<script>',
    '(function () {',
    '  if (window.__lxPopupLoaded) return;',
    '  window.__lxPopupLoaded = true;',
    '',
    '  window.LxPopup = window.LxPopup || {};',
    '  window.LxPopup.config = {',
    '    configUrl:  \'' + origin + '/dist/config.json\',',
    '    collectUrl: \'' + origin + '/v1/events\',',
    '    dataLayer:  window.utag_data || {},',
    '    env: \'production\'',
    '  };',
    '',
    '  var s = document.createElement(\'script\');',
    '  s.src = \'' + origin + '/dist/sdk.js\';',
    '  s.async = true;',
    '  s.onerror = function () { if (window.console) console.debug(\'[lx-popup] sdk failed to load\'); };',
    '  document.head.appendChild(s);',
    '})();',
    '</script>'
  ].join('\n');
}

function InstallCard() {
  const [copied, setCopied] = useState(false);
  const snippet = embedSnippet(SDK_ORIGIN);

  function copy() {
    navigator.clipboard.writeText(snippet).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => alert('Could not copy automatically — select the code below and copy it manually.')
    );
  }

  return (
    <Card title="Website installation" subtitle={<>Paste once, before <Text is="code" size={300}>&lt;/body&gt;</Text>, on any page that should show popups.</>}
      right={<Button onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</Button>}>
      <Pane is="pre" fontFamily="mono" fontSize={12.5} margin={0} whiteSpace="pre-wrap" overflowX="auto"
        background="#F7F8FA" border="1px solid #E7E2DF" borderRadius={8} padding={14}>
        {snippet}
      </Pane>
      <Alert intent="warning" marginTop={12}>
        <strong>One extra step for a real site:</strong> the popups will render fine, but
        every event (impressions, clicks, leads — everything Statistics shows) gets silently
        rejected until that site's origin is added to <Text is="code" size={300}>COLLECTOR_ALLOWED_ORIGINS</Text>.
        Popups working but Statistics staying empty is the symptom. This is an environment
        variable on the server, not something set from this screen.
      </Alert>
      <Text size={300} color="muted" display="block" marginTop={12}>
        Loads the real SDK from this deployment (<Text is="code" size={300}>{SDK_ORIGIN}</Text>). Which popups
        show, to whom, and when is controlled entirely from <strong>Popups</strong> and{' '}
        <strong>Targeting</strong> — nothing about that is in this snippet, so it never needs
        to be re-pasted when content or targeting changes. Already rolling out through
        Tealium? Use <Text is="code" size={300}>tealium-tag.html</Text> at the repo root instead — it adds the
        load-rule and consent-gating guidance this direct embed doesn't.
      </Text>
    </Card>
  );
}

export default function Settings() {
  const { identity } = useRole();
  const canOperate = identity.role === 'operator' || identity.role === 'compliance';
  const [settings, setSettings] = useState(null);
  const [audit, setAudit] = useState(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedSecret, setIssuedSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.settings.get().then(setSettings);
    api.auditLog().then(setAudit);
  }, []);
  useEffect(load, [load]);

  async function toggleKillSwitch() {
    setBusy(true);
    try {
      const next = await api.settings.update({ kill_switch: !settings.kill_switch });
      setSettings(next);
      load();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function updateCaps(field, value) {
    const next = await api.settings.update({ global_caps: { ...settings.global_caps, [field]: value } });
    setSettings(next);
  }

  async function issueKey(e) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setBusy(true);
    try {
      const res = await api.settings.createApiKey(newKeyName.trim());
      setIssuedSecret(res.secret);
      setNewKeyName('');
      load();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function revokeKey(id) {
    if (!confirm('Revoke this API key? The source system will get 401s immediately.')) return;
    await api.settings.revokeApiKey(id);
    load();
  }

  if (!settings) return <Text color="muted">Loading…</Text>;

  return (
    <Pane display="flex" flexDirection="column" gap={16}>
      <Card title="Platform controls" subtitle="Kill switch and global frequency caps.">
        <Pane display="flex" justifyContent="space-between" alignItems="center" marginBottom={16}>
          <Pane>
            <Text fontWeight={600} display="block">
              {settings.kill_switch ? 'ALL popups are currently disabled' : 'Popups are live as normal'}
            </Text>
            <Text size={300} color="muted">Instant, no deploy needed.</Text>
          </Pane>
          {canOperate && (
            <Button appearance="primary" intent={settings.kill_switch ? 'none' : 'danger'}
              disabled={busy} onClick={toggleKillSwitch}>
              {settings.kill_switch ? 'Turn popups back on' : 'Kill all popups'}
            </Button>
          )}
        </Pane>
        <Pane borderTop="1px solid #E7E2DF" paddingTop={16} display="flex" gap={16} flexWrap="wrap">
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Max per page view</Text>
            <TextInput type="number" disabled={!canOperate} value={settings.global_caps.max_per_pageview}
              onChange={(e) => updateCaps('max_per_pageview', parseInt(e.target.value, 10) || 1)} />
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Max per session</Text>
            <TextInput type="number" disabled={!canOperate} value={settings.global_caps.max_per_session}
              onChange={(e) => updateCaps('max_per_session', parseInt(e.target.value, 10) || 1)} />
          </Pane>
        </Pane>
      </Card>

      <InstallCard />

      <Card title="API keys" subtitle="For the source system's ingestion API." bodyPadding={0}>
        <Table>
          <Table.Head>
            <Table.TextHeaderCell>Name</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={140} flexGrow={0}>Prefix</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={110} flexGrow={0}>Created</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={160} flexGrow={0}>Last used</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={90} flexGrow={0}> </Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {settings.api_keys.map((k) => (
              <Table.Row key={k.id}>
                <Table.TextCell>{k.name}</Table.TextCell>
                <Table.TextCell flexBasis={140} flexGrow={0}><Text fontFamily="mono" size={300}>{k.prefix}…</Text></Table.TextCell>
                <Table.TextCell flexBasis={110} flexGrow={0}><Text size={300} color="muted">{new Date(k.created_at).toLocaleDateString()}</Text></Table.TextCell>
                <Table.TextCell flexBasis={160} flexGrow={0}>
                  <Text size={300} color="muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</Text>
                </Table.TextCell>
                <Table.Cell flexBasis={90} flexGrow={0}>
                  {canOperate && <Button size="small" intent="danger" onClick={() => revokeKey(k.id)}>Revoke</Button>}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {canOperate && (
          <Pane is="form" display="flex" gap={10} padding={16} onSubmit={issueKey}>
            <TextInput flex={1} placeholder="Key name (e.g. Source system — EU region)" value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)} />
            <Button appearance="primary" disabled={busy}>Issue new key</Button>
          </Pane>
        )}
        {issuedSecret && (
          <Alert intent="warning" margin={16} marginTop={0}>
            Full secret (shown once, copy it now): <Text is="code" size={300}>{issuedSecret}</Text>
          </Alert>
        )}
      </Card>

      <Card title="Audit log" bodyPadding={0}>
        <Table>
          <Table.Head>
            <Table.TextHeaderCell flexBasis={170} flexGrow={0}>When</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={200} flexGrow={0}>Actor</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={180} flexGrow={0}>Action</Table.TextHeaderCell>
            <Table.TextHeaderCell>Entity</Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {(audit || []).map((a) => (
              <Table.Row key={a.id}>
                <Table.TextCell flexBasis={170} flexGrow={0}><Text size={300} color="muted">{new Date(a.timestamp).toLocaleString()}</Text></Table.TextCell>
                <Table.TextCell flexBasis={200} flexGrow={0}>
                  <Text size={300}>{a.actor} <Text size={300} color="muted">({a.role})</Text></Text>
                </Table.TextCell>
                <Table.TextCell flexBasis={180} flexGrow={0}><Text fontFamily="mono" size={300}>{a.action}</Text></Table.TextCell>
                <Table.TextCell><Text size={300} color="muted">{a.entity_type}:{a.entity_id}</Text></Table.TextCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Card>
    </Pane>
  );
}
