import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Pane, Text, TextInput, Select, Button, Alert, Table, Checkbox,
  Popover, Menu, IconButton, MoreIcon
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

// Less-frequent per-row actions behind a "⋯" menu rather than more inline
// buttons — Preview/Settings stay direct since those are what someone
// reaches for on every row; cramming Duplicate/Pause/Archive in alongside
// them wrapped onto a second line and overlapped the row below it (Table.Row
// has a fixed height, it doesn't grow for wrapped content).
function RowActionsMenu({ popup, busy, onDuplicate, onTogglePause, onArchive }) {
  return (
    <Popover
      content={({ close }) => (
        <Menu>
          <Menu.Group>
            <Menu.Item onSelect={() => { close(); onDuplicate(); }}>Duplicate</Menu.Item>
            {popup.status !== 'archived' && (
              <Menu.Item onSelect={() => { close(); onTogglePause(); }}>
                {popup.status === 'live' ? 'Pause' : 'Resume'}
              </Menu.Item>
            )}
          </Menu.Group>
          {popup.status !== 'archived' && (
            <Menu.Group>
              <Menu.Item intent="danger" onSelect={() => { close(); onArchive(); }}>Archive</Menu.Item>
            </Menu.Group>
          )}
        </Menu>
      )}
    >
      <IconButton icon={MoreIcon} size="small" disabled={busy} aria-label="More actions" />
    </Popover>
  );
}

export default function PopupList() {
  const { identity } = useRole();
  const navigate = useNavigate();
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  async function duplicate(id) {
    setBusyId(id);
    try {
      const copy = await api.popups.duplicate(id);
      // Straight to Settings on the new copy — "duplicated, now go rename
      // it and decide what changes" is the whole point, not a list row
      // someone has to go find themselves.
      navigate('/popups/' + copy.id);
    }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible(ids) {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }

  // pause() toggles, which is right for one popup but wrong for a batch —
  // "pause selected" on a mixed live/paused batch must not flip the
  // already-paused ones back to live. Filtering to the popups actually in
  // the target state first, then calling the same single-item endpoint
  // per popup (not a bulk-only route), keeps this consistent with the
  // single-popup action above and keeps one audit-log entry per popup
  // (§11.3.5) rather than one opaque "bulk" entry hiding which popups
  // were actually touched.
  async function bulkSetLive(targetLive) {
    const ids = filtered
      .filter((p) => selected.has(p.id) && (p.status === 'live') !== targetLive && p.status !== 'archived')
      .map((p) => p.id);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => api.popups.pause(id)));
      load();
      setSelected(new Set());
    } catch (e) { alert(e.message); }
    finally { setBulkBusy(false); }
  }

  async function bulkArchive() {
    const ids = filtered.filter((p) => selected.has(p.id) && p.status !== 'archived').map((p) => p.id);
    if (!ids.length) return;
    if (!confirm('Archive ' + ids.length + ' popup' + (ids.length === 1 ? '' : 's') + '? They stop showing on the next publish.')) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => api.popups.archive(id)));
      load();
      setSelected(new Set());
    } catch (e) { alert(e.message); }
    finally { setBulkBusy(false); }
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

      {canOperate && selected.size > 0 && (
        <Pane display="flex" alignItems="center" gap={10} paddingX={20} paddingBottom={16}>
          <Text size={300}>{selected.size} selected</Text>
          <Button size="small" disabled={bulkBusy} onClick={() => bulkSetLive(false)}>Pause selected</Button>
          <Button size="small" disabled={bulkBusy} onClick={() => bulkSetLive(true)}>Resume selected</Button>
          <Button size="small" intent="danger" disabled={bulkBusy} onClick={bulkArchive}>Archive selected</Button>
          <Button size="small" appearance="minimal" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Clear</Button>
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
            {canOperate && (
              <Table.HeaderCell flexBasis={40} flexGrow={0}>
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))}
                  indeterminate={selected.size > 0 && !filtered.every((p) => selected.has(p.id))}
                  onChange={() => toggleSelectAllVisible(filtered.map((p) => p.id))}
                  marginBottom={0}
                />
              </Table.HeaderCell>
            )}
            <Table.TextHeaderCell>Name</Table.TextHeaderCell>
            <Table.TextHeaderCell>Template</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={130} flexGrow={0}>Offer</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={110} flexGrow={0}>Broker</Table.TextHeaderCell>
            <Table.TextHeaderCell>Status</Table.TextHeaderCell>
            <Table.TextHeaderCell>Schedule</Table.TextHeaderCell>
            <Table.TextHeaderCell>Trigger</Table.TextHeaderCell>
            <Table.TextHeaderCell maxWidth={80}>Priority</Table.TextHeaderCell>
            <Table.TextHeaderCell>Legal</Table.TextHeaderCell>
            <Table.TextHeaderCell flexBasis={210} flexShrink={0} flexGrow={0}> </Table.TextHeaderCell>
          </Table.Head>
          <Table.Body>
            {filtered.map((p) => (
              <Fragment key={p.id}>
                <Table.Row>
                  {canOperate && (
                    <Table.Cell flexBasis={40} flexGrow={0}>
                      <Checkbox checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} marginBottom={0} />
                    </Table.Cell>
                  )}
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
                  <Table.Cell flexBasis={210} flexShrink={0} flexGrow={0}>
                    <Pane display="flex" gap={6}>
                      <Button size="small" onClick={() => togglePreview(p.id)}>
                        {expanded.has(p.id) ? 'Hide preview' : 'Preview'}
                      </Button>
                      <Button is={Link} to={'/popups/' + p.id} size="small">Settings</Button>
                      {canOperate && (
                        <RowActionsMenu
                          popup={p}
                          busy={busyId === p.id}
                          onDuplicate={() => duplicate(p.id)}
                          onTogglePause={() => togglePause(p.id)}
                          onArchive={() => archive(p.id)}
                        />
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
