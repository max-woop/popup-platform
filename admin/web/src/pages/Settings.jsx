import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';

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
