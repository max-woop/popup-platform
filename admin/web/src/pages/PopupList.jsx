import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useRole } from '../lib/RoleContext.jsx';

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

export default function PopupList() {
  const { identity } = useRole();
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Popups</h2>
            <p>Content comes from the source system — this list is targeting, schedule, and the off switch.</p>
          </div>
        </div>

        {popups && popups.length > 0 && (
          <div className="search-row" style={{ padding: '0 24px 16px' }}>
            <input
              className="search-input"
              type="text"
              placeholder="Search by name or template…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
        )}

        {error && <div className="alert alert-danger" style={{ margin: 16 }}>{error}</div>}
        {!popups && !error && <div className="empty-state">Loading…</div>}
        {popups && popups.length > 0 && filtered.length === 0 && (
          <div className="empty-state">No popups match your search.</div>
        )}

        {popups && filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Template</th><th>Status</th><th>Schedule</th>
                <th>Trigger</th><th>Priority</th><th>Legal</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td><Link to={'/popups/' + p.id}>{p.name}</Link></td>
                  <td className="mono small">{p.template}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="small">{formatSchedule(p)}</td>
                  <td className="small">{triggerLabel(p.trigger)}</td>
                  <td className="num">{p.priority}</td>
                  <td className="small">{p.legal_mode}</td>
                  <td>
                    <div className="row">
                      <Link className="btn btn-sm" to={'/popups/' + p.id}>Settings</Link>
                      {canOperate && p.status !== 'archived' && (
                        <button
                          className="btn btn-sm"
                          disabled={busyId === p.id}
                          onClick={() => togglePause(p.id)}
                        >
                          {p.status === 'live' ? 'Pause' : 'Resume'}
                        </button>
                      )}
                      {canOperate && p.status !== 'archived' && (
                        <button className="btn btn-sm btn-danger" disabled={busyId === p.id} onClick={() => archive(p.id)}>
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
