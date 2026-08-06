import { useEffect, useState, useCallback } from 'react';
import { Pane, Text, TextInput, Textarea, Checkbox, Button, Alert, Badge, Table } from 'evergreen-ui';
import { api } from '../lib/api';
import { useRole } from '../lib/RoleContext.jsx';
import { EntitySelect } from '../components/EntitySelect.jsx';
import { Card } from '../components/Card.jsx';

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
    <Pane is="form" onSubmit={submit}>
      <Card title="Publish new version" subtitle="Compliance only. Replaces the current wording going forward.">
        <Pane display="flex" flexDirection="column" gap={14}>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Broker entity</Text>
              <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
            </Pane>
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Country (blank = entity default)</Text>
              <TextInput placeholder="e.g. DE" value={country} onChange={(e) => setCountry(e.target.value)} />
            </Pane>
          </Pane>
          <Pane display="flex" gap={16} flexWrap="wrap">
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Locale</Text>
              <TextInput value={locale} onChange={(e) => setLocale(e.target.value)} />
            </Pane>
            <Pane>
              <Text size={300} display="block" marginBottom={4}>Effective from</Text>
              <TextInput type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Pane>
          </Pane>
          <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} label="Jurisdiction requires a warning" />
          <Pane>
            <Text size={300} display="block" marginBottom={4}>Warning text</Text>
            <Textarea width="100%" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 83% of retail CFD accounts lose money" required />
          </Pane>
          {error && <Alert intent="danger">{error}</Alert>}
          <Pane><Button appearance="primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish version'}</Button></Pane>
        </Pane>
      </Card>
    </Pane>
  );
}

function AddDomainForm({ onSaved }) {
  const [host, setHost] = useState('');
  const [entity, setEntity] = useState('cysec');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.legalTexts.saveDomain({ host: host.trim().toLowerCase(), entity });
      setHost('');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pane is="form" onSubmit={submit} display="flex" gap={16} alignItems="flex-end" flexWrap="wrap" marginTop={12}>
      <Pane>
        <Text size={300} display="block" marginBottom={4}>Domain</Text>
        <TextInput placeholder="e.g. staging.libertex.com" value={host} onChange={(e) => setHost(e.target.value)} required />
      </Pane>
      <Pane>
        <Text size={300} display="block" marginBottom={4}>Entity</Text>
        <EntitySelect value={entity} onChange={(e) => setEntity(e.target.value)} />
      </Pane>
      <Button disabled={busy}>{busy ? 'Saving…' : 'Add mapping'}</Button>
      {error && <Alert intent="danger">{error}</Alert>}
    </Pane>
  );
}

export default function LegalTexts() {
  const { identity } = useRole();
  const isCompliance = identity.role === 'compliance';
  const [data, setData] = useState(null);

  const load = useCallback(() => { api.legalTexts.get().then(setData); }, []);
  useEffect(load, [load]);

  if (!data) return <Text color="muted">Loading…</Text>;

  return (
    <Pane display="flex" flexDirection="column" gap={16}>
      <Card title="Domain → entity map" subtitle="Exact hostname match — no subdomain guessing.">
        <Table>
          <Table.Head>
            <Table.TextHeaderCell>Domain</Table.TextHeaderCell>
            <Table.TextHeaderCell>Entity</Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {Object.entries(data.domains).map(([host, entity]) => (
              <Table.Row key={host}>
                <Table.TextCell><Text fontFamily="mono" size={300}>{host}</Text></Table.TextCell>
                <Table.TextCell>{entity}</Table.TextCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {isCompliance ? (
          <AddDomainForm onSaved={load} />
        ) : (
          <Alert intent="none" marginTop={12}>Read-only for your current role. Switch to Compliance to add a mapping.</Alert>
        )}
      </Card>

      {Object.keys(data.history).map((entity) => (
        <Card title={entity.toUpperCase() + ' — version history'} key={entity} bodyPadding={0}>
          <Table>
            <Table.Head>
              <Table.TextHeaderCell flexBasis={120} flexGrow={0}>v</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={90} flexGrow={0}>Country</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={80} flexGrow={0}>Required</Table.TextHeaderCell>
              <Table.TextHeaderCell>Text</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={220} flexGrow={0}>Effective</Table.TextHeaderCell>
              <Table.TextHeaderCell flexBasis={140} flexGrow={0}>Approved by</Table.TextHeaderCell>
            </Table.Head>
            <Table.Body>
              {data.history[entity].map((row) => {
                const isCurrent = !row.effective_to;
                return (
                  <Table.Row key={row.id} background={isCurrent ? '#F1EEEC' : undefined}>
                    <Table.TextCell flexBasis={120} flexGrow={0}>
                      <Pane display="flex" alignItems="center" gap={6}>
                        <Text size={300}>{row.version}</Text>{isCurrent && <Badge color="green">current</Badge>}
                      </Pane>
                    </Table.TextCell>
                    <Table.TextCell flexBasis={90} flexGrow={0}><Text size={300} color="muted">{row.country || 'default'}</Text></Table.TextCell>
                    <Table.TextCell flexBasis={80} flexGrow={0}>{row.required ? 'yes' : 'no'}</Table.TextCell>
                    <Table.TextCell><Text size={300}>{row.text}</Text></Table.TextCell>
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

      {isCompliance ? (
        <PublishForm onPublished={load} />
      ) : (
        <Alert intent="none">Read-only for your current role. Switch to Compliance to publish a new version.</Alert>
      )}
    </Pane>
  );
}
