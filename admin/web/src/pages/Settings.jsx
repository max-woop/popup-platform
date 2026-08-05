import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';

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
    <div className="card">
      <div className="card-header">
        <div><h2>Website installation</h2><p>Paste once, before <code>&lt;/body&gt;</code>, on any page that should show popups.</p></div>
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</button>
      </div>
      <div className="card-pad">
        <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{snippet}</pre>
        <div className="alert alert-warn" style={{ marginTop: 12 }}>
          <strong>One extra step for a real site:</strong> the popups will render fine, but
          every event (impressions, clicks, leads — everything Statistics shows) gets silently
          rejected until that site's origin is added to <code>COLLECTOR_ALLOWED_ORIGINS</code>.
          Popups working but Statistics staying empty is the symptom. This is an environment
          variable on the server, not something set from this screen.
        </div>
        <p className="field-hint" style={{ marginTop: 12 }}>
          Loads the real SDK from this deployment (<code>{SDK_ORIGIN}</code>). Which popups
          show, to whom, and when is controlled entirely from <strong>Popups</strong> and{' '}
          <strong>Targeting</strong> — nothing about that is in this snippet, so it never needs
          to be re-pasted when content or targeting changes. Already rolling out through
          Tealium? Use <code>tealium-tag.html</code> at the repo root instead — it adds the
          load-rule and consent-gating guidance this direct embed doesn't.
        </p>
      </div>
    </div>
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

  if (!settings) return <div className="empty-state">Loading…</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div><h2>Platform controls</h2><p>Kill switch and global frequency caps.</p></div>
        </div>
        <div className="card-pad row-between">
          <div>
            <strong>{settings.kill_switch ? 'ALL popups are currently disabled' : 'Popups are live as normal'}</strong>
            <div className="small muted">Instant, no deploy needed.</div>
          </div>
          {canOperate && (
            <button className={'btn ' + (settings.kill_switch ? 'btn-primary' : 'btn-danger')} disabled={busy} onClick={toggleKillSwitch}>
              {settings.kill_switch ? 'Turn popups back on' : 'Kill all popups'}
            </button>
          )}
        </div>
        <div className="legend-line" style={{ margin: '0 24px' }} />
        <div className="card-pad field-row">
          <div className="field">
            <label>Max per page view</label>
            <input type="number" disabled={!canOperate} value={settings.global_caps.max_per_pageview}
              onChange={(e) => updateCaps('max_per_pageview', parseInt(e.target.value, 10) || 1)} />
          </div>
          <div className="field">
            <label>Max per session</label>
            <input type="number" disabled={!canOperate} value={settings.global_caps.max_per_session}
              onChange={(e) => updateCaps('max_per_session', parseInt(e.target.value, 10) || 1)} />
          </div>
        </div>
      </div>

      <InstallCard />

      <div className="card">
        <div className="card-header"><div><h2>API keys</h2><p>For the source system's ingestion API.</p></div></div>
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {settings.api_keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono small">{k.prefix}…</td>
                <td className="small muted">{new Date(k.created_at).toLocaleDateString()}</td>
                <td className="small muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
                <td>{canOperate && <button className="btn btn-sm btn-danger" onClick={() => revokeKey(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canOperate && (
          <form className="card-pad row" onSubmit={issueKey}>
            <input type="text" placeholder="Key name (e.g. Source system — EU region)" value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid var(--border)' }} />
            <button className="btn btn-primary" disabled={busy}>Issue new key</button>
          </form>
        )}
        {issuedSecret && (
          <div className="alert alert-warn" style={{ margin: '0 24px 20px' }}>
            Full secret (shown once, copy it now): <span className="mono">{issuedSecret}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><h2>Audit log</h2></div>
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>
            {(audit || []).map((a) => (
              <tr key={a.id}>
                <td className="small muted">{new Date(a.timestamp).toLocaleString()}</td>
                <td className="small">{a.actor} <span className="muted">({a.role})</span></td>
                <td className="mono small">{a.action}</td>
                <td className="small muted">{a.entity_type}:{a.entity_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
