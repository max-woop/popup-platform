import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';

const RANGES = [7, 30, 90];
const DEVICES = ['all', 'desktop', 'tablet', 'mobile'];
const CHART_W = 600;
const CHART_H = 160;
const CHART_PAD_TOP = 12;

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* Real inline line chart over stat.timeseries — the only metric the API
   returns a full daily series for, so this is the one chart backed by real
   per-day numbers rather than a single aggregate. */
function ImpressionsChart({ timeseries }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const values = timeseries.map((d) => d.impressions);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const n = timeseries.length;

  function xFor(i) { return n > 1 ? (i / (n - 1)) * CHART_W : CHART_W / 2; }
  function yFor(v) {
    const usable = CHART_H - CHART_PAD_TOP;
    return CHART_H - (max === min ? usable / 2 : ((v - min) / (max - min)) * usable);
  }

  const points = timeseries.map((d, i) => [xFor(i), yFor(d.impressions)]);
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L ${CHART_W} ${CHART_H} L 0 ${CHART_H} Z`;

  function onMove(e) {
    if (!wrapRef.current || n === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  }

  const hoverPoint = hover != null ? points[hover] : null;

  return (
    <div className="line-chart" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
        <path d={areaPath} fill="color-mix(in srgb, var(--accent) 14%, transparent)" stroke="none" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hoverPoint && (
          <>
            <line x1={hoverPoint[0]} y1="0" x2={hoverPoint[0]} y2={CHART_H} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="4" fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hover != null && (
        <div className="line-chart-tooltip" style={{ left: (points[hover][0] / CHART_W) * 100 + '%' }}>
          <div className="lct-date">{formatShortDate(timeseries[hover].date)}</div>
          <div>{timeseries[hover].impressions.toLocaleString()} impressions</div>
        </div>
      )}
      {n > 0 && (
        <div className="line-chart-axis">
          <span>{formatShortDate(timeseries[0].date)}</span>
          <span>{formatShortDate(timeseries[n - 1].date)}</span>
        </div>
      )}
    </div>
  );
}

function DeviceBars({ byDevice }) {
  const entries = Object.entries(byDevice);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div>
      {entries.map(([device, v]) => (
        <div className="table-bar-row" key={device}>
          <div className="table-bar-label">{device}</div>
          <div className="table-bar-track"><div className="table-bar-fill" style={{ width: (v / max) * 100 + '%' }} /></div>
          <div className="table-bar-value">{v.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export default function Statistics() {
  const [popups, setPopups] = useState([]);
  const [popupId, setPopupId] = useState('');
  const [range, setRange] = useState(30);
  const [device, setDevice] = useState('all');
  const [stat, setStat] = useState(null);

  useEffect(() => { api.popups.list().then((list) => { setPopups(list); if (!popupId && list.length) setPopupId(list[0].id); }); }, []);

  const load = useCallback(() => {
    if (!popupId) return;
    api.stats({ popup_id: popupId, range, device }).then((r) => setStat(r[0] || null));
  }, [popupId, range, device]);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div><h2>Statistics</h2><p>Per-popup metrics by date range and device.</p></div>
          <div className="row">
            <select value={popupId} onChange={(e) => setPopupId(e.target.value)} style={{ minWidth: 200 }}>
              {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="pill-toggle">
              {RANGES.map((r) => (
                <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}d</button>
              ))}
            </div>
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {!stat && <div className="empty-state">Loading…</div>}

        {stat && (
          <div className="card-pad stack">
            {stat.source === 'synthetic' ? (
              <div className="alert alert-suppressed">No real events collected yet for this popup — showing synthetic demo data instead.</div>
            ) : (
              <div className="alert alert-info">Live data from collected events (§14).</div>
            )}
            <div className="stat-grid">
              <StatCard label="Impressions" value={stat.summary.impressions.toLocaleString()} />
              <StatCard label="Views (≥50% / 1s)" value={stat.summary.views.toLocaleString()} />
              <StatCard label="Clicks" value={stat.summary.clicks.toLocaleString()} sub={'CTR ' + (stat.summary.ctr * 100).toFixed(1) + '%'} />
              <StatCard label="Closes" value={stat.summary.closes.toLocaleString()} sub={'close rate ' + (stat.summary.close_rate * 100).toFixed(1) + '%'} />
            </div>

            {stat.summary.form_conversion != null && (
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <StatCard label="Form starts" value={stat.summary.form_starts.toLocaleString()} />
                <StatCard label="Form submits" value={stat.summary.form_submits.toLocaleString()} />
                <StatCard label="Form conversion" value={(stat.summary.form_conversion * 100).toFixed(1) + '%'} />
              </div>
            )}

            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-pad">
                <div className="small muted" style={{ marginBottom: 8 }}>Impressions over time</div>
                <ImpressionsChart timeseries={stat.timeseries} />
              </div>
            </div>

            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-pad">
                <div className="small muted" style={{ marginBottom: 12 }}>By device</div>
                <DeviceBars byDevice={stat.by_device} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
