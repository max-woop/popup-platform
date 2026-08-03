import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';
import { EntitySelect } from '../components/EntitySelect.jsx';

function DomainForm({ onSaved }) {
  const [host, setHost] = useState('');
  const [entity, setEntity] = useState('cysec');
  const [scriptSrc, setScriptSrc] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [fields, setFields] = useState(['email', 'password']);
  const [pageBroker, setPageBroker] = useState('');
  const [pageLanguage, setPageLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggleField(f) {
    setFields((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.registration.saveDomain({
        host, entity, script_src: scriptSrc, api_key: apiKey, fields,
        tealium: { page_broker: pageBroker || entity, page_language: pageLanguage, page_system: 'promo' }
      });
      setHost(''); setScriptSrc(''); setApiKey('');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-header"><div><h2>Add / update domain</h2><p>Compliance only. Exact-hostname match.</p></div></div>
      <div className="card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Host</label>
            <input type="text" placeholder="e.g. promo.libertex.com" value={host} onChange={(e) => setHost(e.target.value)} required />
          </div>
          <div className="field">
            <label>Broker entity</label>
            <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Widget script URL</label>
          <input type="text" placeholder="https://lib.libertex.com/landing/js/landing-api.min.X.js" value={scriptSrc} onChange={(e) => setScriptSrc(e.target.value)} required />
        </div>
        <div className="field">
          <label>API key</label>
          <input type="text" className="mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          <p className="field-hint">Not treated as secret — this key is already embedded in the production page's client-side JS.</p>
        </div>
        <div className="field">
          <label>Fields the widget collects</label>
          <div className="chip-select">
            {['email', 'password', 'phone'].map((f) => (
              <button key={f} type="button" className={'chip' + (fields.includes(f) ? ' selected' : '')} onClick={() => toggleField(f)}>{f}</button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Tealium page_broker</label>
            <input type="text" placeholder={entity} value={pageBroker} onChange={(e) => setPageBroker(e.target.value)} />
          </div>
          <div className="field">
            <label>Tealium page_language</label>
            <input type="text" value={pageLanguage} onChange={(e) => setPageLanguage(e.target.value)} />
          </div>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <div><button className="btn btn-accent" disabled={busy}>{busy ? 'Saving…' : 'Save domain'}</button></div>
      </div>
    </form>
  );
}

function ConsentForm({ onPublished }) {
  const [entity, setEntity] = useState('cysec');
  const [locale, setLocale] = useState('en');
  const [textTemplate, setTextTemplate] = useState('');
  const [privacyLabel, setPrivacyLabel] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [termsLabel, setTermsLabel] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.registration.publishConsent({
        entity, locale, text_template: textTemplate,
        links: {
          privacy: { label: privacyLabel, url: privacyUrl },
          terms: { label: termsLabel, url: termsUrl }
        },
        effective_from: new Date().toISOString()
      });
      setTextTemplate('');
      onPublished?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-header"><div><h2>Publish consent wording</h2><p>Compliance only. Replaces the current wording going forward.</p></div></div>
      <div className="card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Broker entity</label>
            <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
          </div>
          <div className="field">
            <label>Locale</label>
            <input type="text" value={locale} onChange={(e) => setLocale(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Text template</label>
          <textarea
            value={textTemplate}
            onChange={(e) => setTextTemplate(e.target.value)}
            placeholder="e.g. By registering an account I agree to the {privacy} and the {terms}."
            required
          />
          <p className="field-hint"><code>{'{privacy}'}</code> and <code>{'{terms}'}</code> are replaced with real links — never raw markup (§10.2).</p>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Privacy link label</label>
            <input type="text" value={privacyLabel} onChange={(e) => setPrivacyLabel(e.target.value)} required />
          </div>
          <div className="field">
            <label>Privacy link URL</label>
            <input type="text" value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} required />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Terms link label</label>
            <input type="text" value={termsLabel} onChange={(e) => setTermsLabel(e.target.value)} required />
          </div>
          <div className="field">
            <label>Terms link URL</label>
            <input type="text" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} required />
          </div>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <div><button className="btn btn-accent" disabled={busy}>{busy ? 'Publishing…' : 'Publish version'}</button></div>
      </div>
    </form>
  );
}

export default function Registration() {
  const { identity } = useRole();
  const isCompliance = identity.role === 'compliance';
  const [domains, setDomains] = useState(null);
  const [consent, setConsent] = useState(null);

  const load = useCallback(() => {
    api.registration.domains().then(setDomains);
    api.registration.consentTexts().then(setConsent);
  }, []);
  useEffect(load, [load]);

  if (!domains || !consent) return <div className="empty-state">Loading…</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div><h2>Registration domains</h2><p>This platform embeds the existing widget — it never captures or forwards leads itself.</p></div>
        </div>
        <table>
          <thead><tr><th>Host</th><th>Entity</th><th>Widget script</th><th>Fields</th><th>Tealium broker</th></tr></thead>
          <tbody>
            {Object.entries(domains).map(([host, cfg]) => (
              <tr key={host}>
                <td className="mono small">{host}</td>
                <td>{cfg.entity}</td>
                <td className="small mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cfg.script_src}</td>
                <td className="small">{(cfg.fields || []).join(', ')}</td>
                <td className="small muted">{cfg.tealium?.page_broker}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(consent.history).map((entity) => (
        <div className="card" key={entity}>
          <div className="card-header"><h2>{entity.toUpperCase()} — consent text history</h2></div>
          <table>
            <thead><tr><th>v</th><th>Locale</th><th>Template</th><th>Links</th><th>Effective</th><th>Approved by</th></tr></thead>
            <tbody>
              {consent.history[entity].map((row) => {
                const isCurrent = !row.effective_to;
                return (
                  <tr key={row.id} style={isCurrent ? { background: 'var(--bg-sunken)' } : undefined}>
                    <td>{row.version}{isCurrent && <span className="badge badge-live" style={{ marginLeft: 6 }}>current</span>}</td>
                    <td className="small muted">{row.locale}</td>
                    <td className="small" style={{ maxWidth: 340 }}>{row.text_template}</td>
                    <td className="small muted">{Object.keys(row.links || {}).join(', ')}</td>
                    <td className="small muted">{new Date(row.effective_from).toLocaleDateString()} → {row.effective_to ? new Date(row.effective_to).toLocaleDateString() : '—'}</td>
                    <td className="small muted">{row.approved_by}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {Object.keys(consent.history).length === 0 && (
        <div className="alert alert-suppressed">No consent text published yet for any entity — a modal_form popup on an unmapped entity/locale is suppressed, same fail-safe as the legal registry (§9.4, §11.3.3).</div>
      )}

      {isCompliance ? (
        <>
          <DomainForm onSaved={load} />
          <ConsentForm onPublished={load} />
        </>
      ) : (
        <div className="alert alert-info">Read-only for your current role. Switch to Compliance to edit.</div>
      )}
    </div>
  );
}
