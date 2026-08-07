import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Pane, Text, TextInput, Select, Button, Alert, Table
} from 'evergreen-ui';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { Card } from '../components/Card.jsx';
import { useRole } from '../lib/RoleContext.jsx';
import { loadSdk } from '../lib/sdkLoader';

function formatSchedule(p) {
  if (!p.starts_at && !p.ends_at) return 'Always on';
  const from = p.starts_at ? new Date(p.starts_at).toLocaleDateString() : '—';
  const to = p.ends_at ? new Date(p.ends_at).toLocaleDateString() : '—';
  return from + ' → ' + to;
}

function triggerLabel(t) {
  if (!t) return '—';
  if (t.type === 'delay') return 'Delay ' + t.value + 'ms';
  if (t.type === 'scroll') return 'Scroll ' + t.value + '%';
  return t.type;
}

const STATUS_FILTERS = ['all', 'live', 'paused', 'draft', 'archived'];

// Renders through the real SDK's renderInline() — the same preview API the
// templates gallery uses — instead of a hand-built mock, so what's shown
// here is guaranteed to match what a visitor actually gets (theme, legal
// text, image handling, everything).
function PopupPreview({ popupId }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([loadSdk(), api.popups.get(popupId)])
      .then(([sdk, detail]) => {
        if (cancelled || !containerRef.current) return;
        sdk.renderInline(detail, containerRef.current);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [popupId]);

  return (
    <Pane padding={16} background="tint1">
      {error && <Alert intent="danger" marginBottom={12}>Preview failed: {error}</Alert>}
      <div ref={containerRef} />
    </Pane>
  );
}

export default function PopupList() {
  const { identity } = useRole();
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());

  function togglePreview(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const load = useCallback(() => {
    api.popups.list().then(setPopups).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const canOperate = identity.role === 'operator' || identity.role === 'compliance';

  const filtered = (popups || []).filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (query && !p.name.toLowerCase().includes(query.toLowerCase()) && !p.template.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  async function togglePause(id) {
    setBusyId(id);
    try { await api.popups.pause(id); load(); }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  }

  async function archive(id) {
    if (!confirm('Archive this popup? It stops showing on the next publish.')) return;
    setBusyId(id);
    try { await api.popups.archive(id); load(); }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  }

  return (
    <Card title="Popups" subtitle="Content comes from the source system — this list is targeting, schedule, and the off switch." bodyPadding={0}>
      {popups && popups.length > 0 && (
        <Pane display="flex" gap={12} paddingX={20} paddingBottom={16}>
          <TextInput
            placeholder="Search by name or template…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            flex={1}
          />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} width={170}>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </Select>
        </Pane>
      )}

      {error && <Alert intent="danger" marginX={20} marginBottom={16}>{error}</Alert>}
      {!popups && !error && <Pane padding={40} textAlign="center"><Text color="muted">Loading…</Text></Pane>}
      {popups && popups.length > 0 && filtered.length === 0 && (
        <Pane padding={40} textAlign="center"><Text color="muted">No popups match your search.</Text></Pane>
      )}

      {popups && filtered.length > 0 && (
        <Table>
          <Table.Head>
            <Table.TextHeaderCell>Name</Table.TextHeaderCell>
            <Table.TextHeaderCell>Template</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={130} flexGrow={0}>Offer</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={110} flexGrow={0}>Broker</Table.TextHeaderCell>
            <Table.TextHeaderCell>Status</Table.TextHeaderCell>
            <Table.TextHeaderCell>Schedule</Table.TextHeaderCell>
            <Table.TextHeaderCell>Trigger</Table.TextHeaderCell>
            <Table.TextHeaderCell maxWidth={80}>Priority</Table.TextHeaderCell>
            <Table.TextHeaderCell>Legal</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={280} flexShrink={0} flexGrow={0}> </Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {filtered.map((p) => (
              <Fragment key={p.id}>
                <Table.Row>
                  <Table.TextCell><Link to={'/popups/' + p.id}>{p.name}</Link></Table.TextCell>
                  <Table.TextCell><Text fontFamily="mono" size={300}>{p.template}</Text></Table.TextCell>
                  <Table.TextCell flexBasis={130} flexGrow={0}>
                    <Text size={300} color={p.offer ? undefined : 'muted'}>{p.offer || '—'}</Text>
                  </Table.TextCell>
                  <Table.TextCell flexBasis={110} flexGrow={0}>
                    <Text size={300} color={p.broker ? undefined : 'muted'}>{p.broker || '—'}</Text>
                  </Table.TextCell>
                  <Table.Cell><StatusBadge status={p.status} /></Table.Cell>
                  <Table.TextCell>{formatSchedule(p)}</Table.TextCell>
                  <Table.TextCell>{triggerLabel(p.trigger)}</Table.TextCell>
                  <Table.TextCell maxWidth={80}>{p.priority}</Table.TextCell>
                  <Table.TextCell>{p.legal_mode}</Table.TextCell>
                  <Table.Cell flexBasis={280} flexShrink={0} flexGrow={0}>
                    <Pane display="flex" gap={6} flexWrap="wrap">
                      <Button size="small" onClick={() => togglePreview(p.id)}>
                        {expanded.has(p.id) ? 'Hide preview' : 'Preview'}
                      </Button>
                      <Button is={Link} to={'/popups/' + p.id} size="small">Settings</Button>
                      {canOperate && p.status !== 'archived' && (
                        <Button size="small" disabled={busyId === p.id} onClick={() => togglePause(p.id)}>
                          {p.status === 'live' ? 'Pause' : 'Resume'}
                        </Button>
                      )}
                      {canOperate && p.status !== 'archived' && (
                        <Button size="small" intent="danger" disabled={busyId === p.id} onClick={() => archive(p.id)}>
                          Archive
                        </Button>
                      )}
                    </Pane>
                  </Table.Cell>
                </Table.Row>
                {expanded.has(p.id) && <PopupPreview popupId={p.id} />}
              </Fragment>
            ))}
          </Table.Body>
        </Table>
      )}
    </Card>
  );
}
