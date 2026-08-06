import { useEffect, useState, useCallback } from 'react';
import { Pane, Text, TextInput, Textarea, Button, Alert, Badge, Table, Code } from 'evergreen-ui';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';
import { EntitySelect } from '../components/EntitySelect.jsx';
import { Card } from '../components/Card.jsx';
import { Chip } from '../components/Chip.jsx';

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
    <Pane is="form" onSubmit={submit}>
      <Card title="Add / update domain" subtitle="Compliance only. Exact-hostname match.">
        <Pane display="flex" flexDirection="column" gap={14}>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane flex={1} minWidth={220}>
              <Text size={300} display="block" marginBottom={4}>Host</Text>
              <TextInput width="100%" placeholder="e.g. promo.libertex.com" value={host} onChange={(e) => setHost(e.target.value)} required />
            </Pane>
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Broker entity</Text>
              <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
            </Pane>
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Widget script URL</Text>
            <TextInput width="100%" placeholder="https://lib.libertex.com/landing/js/landing-api.min.X.js" value={scriptSrc} onChange={(e) => setScriptSrc(e.target.value)} required />
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>API key</Text>
            <TextInput width="100%" fontFamily="mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
            <Text size={300} color="muted" display="block" marginTop={6}>
              Not treated as secret — this key is already embedded in the production page's client-side JS.
            </Text>
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={6}>Fields the widget collects</Text>
            <Pane display="flex" gap={8}>
              {['email', 'password', 'phone'].map((f) => (
                <Chip key={f} selected={fields.includes(f)} onClick={() => toggleField(f)}>{f}</Chip>
              ))}
            </Pane>
          </Pane>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Tealium page_broker</Text>
              <TextInput placeholder={entity} value={pageBroker} onChange={(e) => setPageBroker(e.target.value)} />
            </Pane>
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Tealium page_language</Text>
              <TextInput value={pageLanguage} onChange={(e) => setPageLanguage(e.target.value)} />
            </Pane>
          </Pane>
          {error && <Alert intent="danger">{error}</Alert>}
          <Pane><Button appearance="primary" disabled={busy}>{busy ? 'Saving…' : 'Save domain'}</Button></Pane>
        </Pane>
      </Card>
    </Pane>
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
    <Pane is="form" onSubmit={submit}>
      <Card title="Publish consent wording" subtitle="Compliance only. Replaces the current wording going forward.">
        <Pane display="flex" flexDirection="column" gap={14}>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Broker entity</Text>
              <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
            </Pane>
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Locale</Text>
              <TextInput value={locale} onChange={(e) => setLocale(e.target.value)} />
            </Pane>
          </Pane>
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Text template</Text>
            <Textarea
              width="100%"
              value={textTemplate}
              onChange={(e) => setTextTemplate(e.target.value)}
              placeholder="e.g. By registering an account I agree to the {privacy} and the {terms}."
              required
            />
            <Text size={300} color="muted" display="block" marginTop={6}>
              <Code>{'{privacy}'}</Code> and <Code>{'{terms}'}</Code> are replaced with real links — never raw markup (§10.2).
            </Text>
          </Pane>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane flex={1} minWidth={200}>
              <Text size={300} display="block" marginBottom={4}>Privacy link label</Text>
              <TextInput width="100%" value={privacyLabel} onChange={(e) => setPrivacyLabel(e.target.value)} required />
            </Pane>
            <Pane flex={1} minWidth={200}>
              <Text size={300} display="block" marginBottom={4}>Privacy link URL</Text>
              <TextInput width="100%" value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} required />
            </Pane>
          </Pane>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane flex={1} minWidth={200}>
              <Text size={300} display="block" marginBottom={4}>Terms link label</Text>
              <TextInput width="100%" value={termsLabel} onChange={(e) => setTermsLabel(e.target.value)} required />
            </Pane>
            <Pane flex={1} minWidth={200}>
              <Text size={300} display="block" marginBottom={4}>Terms link URL</Text>
              <TextInput width="100%" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} required />
            </Pane>
          </Pane>
          {error && <Alert intent="danger">{error}</Alert>}
          <Pane><Button appearance="primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish version'}</Button></Pane>
        </Pane>
      </Card>
    </Pane>
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

  if (!domains || !consent) return <Text color="muted">Loading…</Text>;

  return (
    <Pane display="flex" flexDirection="column" gap={16}>
      <Card title="Registration domains" subtitle="This platform embeds the existing widget — it never captures or forwards leads itself." bodyPadding={0}>
        <Table>
          <Table.Head>
            <Table.TextHeaderCell>Host</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={80} flexGrow={0}>Entity</Table.TextHeaderCell>
            <Table.TextHeaderCell>Widget script</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={160} flexGrow={0}>Fields</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={140} flexGrow={0}>Tealium broker</Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {Object.entries(domains).map(([host, cfg]) => (
              <Table.Row key={host}>
                <Table.TextCell><Text fontFamily="mono" size={300}>{host}</Text></Table.TextCell>
                <Table.TextCell flexBasis={80} flexGrow={0}>{cfg.entity}</Table.TextCell>
                <Table.TextCell>
                  <Text fontFamily="mono" size={300} display="block" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {cfg.script_src}
                  </Text>
                </Table.TextCell>
                <Table.TextCell flexBasis={160} flexGrow={0}>{(cfg.fields || []).join(', ')}</Table.TextCell>
                <Table.TextCell flexBasis={140} flexGrow={0}><Text size={300} color="muted">{cfg.tealium?.page_broker}</Text></Table.TextCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Card>

      {Object.keys(consent.history).map((entity) => (
        <Card title={entity.toUpperCase() + ' — consent text history'} key={entity} bodyPadding={0}>
          <Table>
            <Table.Head>
              <Table.TextHeaderCell flexBasis={120} flexGrow={0}>v</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={80} flexGrow={0}>Locale</Table.TextHeaderCell>
              <Table.TextHeaderCell>Template</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={140} flexGrow={0}>Links</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={220} flexGrow={0}>Effective</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={140} flexGrow={0}>Approved by</Table.TextHeaderCell>
            </Table.Head>
            <Table.Body>
              {consent.history[entity].map((row) => {
                const isCurrent = !row.effective_to;
                return (
                  <Table.Row key={row.id} background={isCurrent ? '#F1EEEC' : undefined}>
                    <Table.TextCell flexBasis={120} flexGrow={0}>
                      <Pane display="flex" alignItems="center" gap={6}>
                        <Text size={300}>{row.version}</Text>{isCurrent && <Badge color="green">current</Badge>}
                      </Pane>
                    </Table.TextCell>
                    <Table.TextCell flexBasis={80} flexGrow={0}><Text size={300} color="muted">{row.locale}</Text></Table.TextCell>
                    <Table.TextCell><Text size={300}>{row.text_template}</Text></Table.TextCell>
                    <Table.TextCell flexBasis={140} flexGrow={0}><Text size={300} color="muted">{Object.keys(row.links || {}).join(', ')}</Text></Table.TextCell>
                    <Table.TextCell flexBasis={220} flexGrow={0}>
                      <Text size={300} color="muted">
                        {new Date(row.effective_from).toLocaleDateString()} → {row.effective_to ? new Date(row.effective_to).toLocaleDateString() : '—'}
                      </Text>
                    </Table.TextCell>
                    <Table.TextCell flexBasis={140} flexGrow={0}><Text size={300} color="muted">{row.approved_by}</Text></Table.TextCell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </Card>
      ))}
      {Object.keys(consent.history).length === 0 && (
        <Alert intent="warning">No consent text published yet for any entity — a modal_form popup on an unmapped entity/locale is suppressed, same fail-safe as the legal registry (§9.4, §11.3.3).</Alert>
      )}

      {isCompliance ? (
        <>
          <DomainForm onSaved={load} />
          <ConsentForm onPublished={load} />
        </>
      ) : (
        <Alert intent="none">Read-only for your current role. Switch to Compliance to edit.</Alert>
      )}
    </Pane>
  );
}
