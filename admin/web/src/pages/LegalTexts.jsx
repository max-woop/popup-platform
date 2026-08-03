import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';
import { EntitySelect } from '../components/EntitySelect.jsx';

function toLocalInput(iso) { return iso ? new Date(iso).toISOString().slice(0, 16) : ''; }

function PublishForm({ onPublished }) {
  const [entity, setEntity] = useState('cysec');
  const [country, setCountry] = useState('');
  const [locale, setLocale] = useState('en');
  const [required, setRequired] = useState(true);
  const [text, setText] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(toLocalInput(new Date().toISOString()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.legalTexts.publish({
        entity, country: country || null, locale, required, text,
        effective_from: new Date(effectiveFrom).toISOString()
      });
      setText('');
      onPublished?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-header"><div><h2>Publish new version</h2><p>Compliance only. Replaces the current wording going forward.</p></div></div>
      <div className="card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Broker entity</label>
            <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
          </div>
          <div className="field">
            <label>Country (blank = entity default)</label>
            <input type="text" placeholder="e.g. DE" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Locale</label>
            <input type="text" value={locale} onChange={(e) => setLocale(e.target.value)} />
          </div>
          <div className="field">
            <label>Effective from</label>
            <input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="required" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <label htmlFor="required" style={{ fontWeight: 400 }}>Jurisdiction requires a warning</label>
        </div>
        <div className="field">
          <label>Warning text</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 83% of retail CFD accounts lose money" required />
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <div><button className="btn btn-accent" disabled={busy}>{busy ? 'Publishing…' : 'Publish version'}</button></div>
      </div>
    </form>
  );
}

export default function LegalTexts() {
  const { identity } = useRole();
  const isCompliance = identity.role === 'compliance';
  const [data, setData] = useState(null);

  const load = useCallback(() => { api.legalTexts.get().then(setData); }, []);
  useEffect(load, [load]);

  if (!data) return <div className="empty-state">Loading…</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header"><div><h2>Domain → entity map</h2><p>Exact hostname match — no subdomain guessing.</p></div></div>
        <table>
          <thead><tr><th>Domain</th><th>Entity</th></tr></thead>
          <tbody>
            {Object.entries(data.domains).map(([host, entity]) => (
              <tr key={host}><td className="mono small">{host}</td><td>{entity}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(data.history).map((entity) => (
        <div className="card" key={entity}>
          <div className="card-header"><h2>{entity.toUpperCase()} — version history</h2></div>
          <table>
            <thead><tr><th>v</th><th>Country</th><th>Required</th><th>Text</th><th>Effective</th><th>Approved by</th></tr></thead>
            <tbody>
              {data.history[entity].map((row) => {
                const isCurrent = !row.effective_to;
                return (
                  <tr key={row.id} style={isCurrent ? { background: 'var(--bg-sunken)' } : undefined}>
                    <td>{row.version}{isCurrent && <span className="badge badge-live" style={{ marginLeft: 6 }}>current</span>}</td>
                    <td className="small muted">{row.country || 'default'}</td>
                    <td className="small">{row.required ? 'yes' : 'no'}</td>
                    <td className="small" style={{ maxWidth: 320 }}>{row.text}</td>
                    <td className="small muted">{new Date(row.effective_from).toLocaleDateString()} → {row.effective_to ? new Date(row.effective_to).toLocaleDateString() : '—'}</td>
                    <td className="small muted">{row.approved_by}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {isCompliance ? (
        <PublishForm onPublished={load} />
      ) : (
        <div className="alert alert-info">Read-only for your current role. Switch to Compliance to publish a new version.</div>
      )}
    </div>
  );
}
