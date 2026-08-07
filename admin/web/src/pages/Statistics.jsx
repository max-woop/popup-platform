import { useEffect, useState, useCallback, useRef } from 'react';
import { Pane, Text, Select, Alert, Table } from 'evergreen-ui';
import { api } from '../lib/api';
import { Card } from '../components/Card.jsx';
import { PillToggle } from '../components/PillToggle.jsx';

const ACCENT = '#FF4C0B';
const RANGES = [7, 30, 90];
const DEVICES = ['all', 'desktop', 'tablet', 'mobile'];
const CHART_W = 600;
const CHART_H = 160;
const CHART_PAD_TOP = 12;

function StatCard({ label, value, sub }) {
  return (
    <Pane padding="16px 20px" border="1px solid #E7E2DF" borderRadius={14} background="white">
      <Text size={300} fontWeight={600} color="muted" display="block">{label}</Text>
      <Text fontSize={26} fontWeight={700} letterSpacing="-.01em" display="block" marginTop={4}>{value}</Text>
      {sub && <Text size={300} color="muted" display="block" marginTop={2}>{sub}</Text>}
    </Pane>
  );
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* Real inline line chart over stat.timeseries — the only metric the API
   returns a full daily series for, so this is the one chart backed by real
   per-day numbers rather than a single aggregate. No Evergreen equivalent
   (the library ships no charting component), so this stays hand-built SVG,
   just re-themed to plain hex instead of the old CSS custom properties. */
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
    <Pane position="relative" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 160, overflow: 'visible' }}>
        <path d={areaPath} fill="rgba(255,76,11,0.14)" stroke="none" />
        <path d={linePath} fill="none" stroke={ACCENT} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hoverPoint && (
          <>
            <line x1={hoverPoint[0]} y1="0" x2={hoverPoint[0]} y2={CHART_H} stroke="#E7E2DF" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="4" fill={ACCENT} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hover != null && (
        <Pane position="absolute" top={0} left={(points[hover][0] / CHART_W) * 100 + '%'}
          transform="translate(-50%, -100%)" marginTop={-8}
          background="#0A0A0A" color="white" paddingX={10} paddingY={6} borderRadius={4}
          fontSize={11.5} whiteSpace="nowrap" pointerEvents="none">
          <Text size={300} color="rgba(255,255,255,0.6)" display="block">{formatShortDate(timeseries[hover].date)}</Text>
          <Text size={300} color="white">{timeseries[hover].impressions.toLocaleString()} impressions</Text>
        </Pane>
      )}
      {n > 0 && (
        <Pane display="flex" justifyContent="space-between" marginTop={6}>
          <Text size={300} color="muted">{formatShortDate(timeseries[0].date)}</Text>
          <Text size={300} color="muted">{formatShortDate(timeseries[n - 1].date)}</Text>
        </Pane>
      )}
    </Pane>
  );
}

// Region names from a 2-letter ISO code, no extra dependency — every
// evergreen browser (and Node 18+) ships Intl.DisplayNames.
const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
function countryLabel(code) {
  if (!code || code === '(unknown)') return 'Unknown';
  try { return regionNames ? regionNames.of(code) : code; } catch (e) { return code; }
}

function BreakdownTable({ title, icon, rows, labelFor }) {
  return (
    <Card title={title} bodyPadding={0}>
      {(!rows || rows.length === 0) ? (
        <Pane padding={20}><Text size={300} color="muted">No data yet for this range.</Text></Pane>
      ) : (
        <>
          <Table>
            <Table.Head>
              <Table.TextHeaderCell> </Table.TextHeaderCell>
              <Table.TextHeaderCell>Views</Table.TextHeaderCell>
              <Table.TextHeaderCell>Interaction</Table.TextHeaderCell>
              <Table.TextHeaderCell>Conv. Rate</Table.TextHeaderCell>
            </Table.Head>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.label}>
                  <Table.TextCell>
                    <Pane display="flex" alignItems="center" gap={8}>
                      <span aria-hidden="true">{icon}</span>{labelFor ? labelFor(r.label) : r.label}
                    </Pane>
                  </Table.TextCell>
                  <Table.TextCell>{r.views.toLocaleString()}</Table.TextCell>
                  <Table.TextCell>{r.interactions.toLocaleString()}</Table.TextCell>
                  <Table.TextCell>{(r.conv_rate * 100).toFixed(1)}%</Table.TextCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Text size={300} color="muted" display="block" padding={16}>
            Top {rows.length}{rows.length === 20 ? ' (more exist)' : ''}
          </Text>
        </>
      )}
    </Card>
  );
}

function Overview() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);

  useEffect(() => { api.statsOverview({ range }).then(setData); }, [range]);

  return (
    <Card title="Overview" subtitle="Every popup, site-wide — visitor geography, referrers, and pages."
      right={<PillToggle options={RANGES} value={range} onChange={setRange} labelFor={(r) => r + 'd'} />}>
      {!data && <Text color="muted">Loading…</Text>}

      {data && (
        <Pane display="flex" flexDirection="column" gap={16}>
          {data.summary.views === 0 && (
            <Alert intent="none">No events collected yet in this range (§14).</Alert>
          )}
          <Pane display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={16}>
            <StatCard label="Popup Views" value={data.summary.views.toLocaleString()} />
            <StatCard label="Leads" value={data.summary.leads.toLocaleString()} sub="form submissions" />
            <StatCard label="Interaction" value={data.summary.interactions.toLocaleString()} />
            <StatCard label="Conversion Rate" value={(data.summary.conv_rate * 100).toFixed(1) + '%'} sub="interactions / views" />
          </Pane>

          <BreakdownTable title="Geographical Area" icon="🌐" rows={data.countries} labelFor={countryLabel} />
          <BreakdownTable title="Referrer" icon="🔗" rows={data.referrers} labelFor={(l) => (l === '(direct)' ? 'Direct / no referrer' : l)} />
          <BreakdownTable title="Pages Users Visit" icon="📄" rows={data.pages} />
        </Pane>
      )}
    </Card>
  );
}

// Rolls up by content.offer / content.broker (§11.3.7) rather than by
// individual popup — "which offer converts best, and does that hold
// across brokers" is a cut across popups the per-popup Statistics card
// below can't answer on its own. Reuses BreakdownTable as-is: the
// {label, views, interactions, conv_rate} shape lines up exactly with
// what it already renders for countries/referrers/pages above.
function Leaderboard() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);

  useEffect(() => { api.statsLeaderboard({ range }).then(setData); }, [range]);

  return (
    <Card title="Offer / broker leaderboard" subtitle="Every live popup rolled up by its declared offer and broker — same views/interactions/conv. rate definitions as the rest of this page."
      right={<PillToggle options={RANGES} value={range} onChange={setRange} labelFor={(r) => r + 'd'} />}>
      {!data && <Text color="muted">Loading…</Text>}
      {data && (
        <Pane display="flex" flexDirection="column" gap={16}>
          <BreakdownTable title="By offer" icon="🏷️" rows={data.by_offer} />
          <BreakdownTable title="By broker" icon="🏦" rows={data.by_broker} />
        </Pane>
      )}
    </Card>
  );
}

function DeviceBars({ byDevice }) {
  const entries = Object.entries(byDevice);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Pane display="flex" flexDirection="column" gap={8}>
      {entries.map(([device, v]) => (
        <Pane display="flex" alignItems="center" gap={10} key={device}>
          <Text size={300} width={84} flexShrink={0} textTransform="capitalize">{device}</Text>
          <Pane flex={1} height={8} borderRadius={999} background="#F1EEEC" overflow="hidden">
            <Pane height="100%" borderRadius={999} background={ACCENT} width={(v / max) * 100 + '%'} />
          </Pane>
          <Text size={300} width={56} flexShrink={0} textAlign="right" color="muted">{v.toLocaleString()}</Text>
        </Pane>
      ))}
    </Pane>
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
    <Pane display="flex" flexDirection="column" gap={16}>
      <Overview />
      <Leaderboard />

      <Card title="Statistics" subtitle="Per-popup metrics by date range and device."
        right={
          <Pane display="flex" alignItems="center" gap={10}>
            <Select value={popupId} onChange={(e) => setPopupId(e.target.value)} width={200}>
              {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <PillToggle options={RANGES} value={range} onChange={setRange} labelFor={(r) => r + 'd'} />
            <Select value={device} onChange={(e) => setDevice(e.target.value)} width={110}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Pane>
        }>
        {!stat && <Text color="muted">Loading…</Text>}

        {stat && (
          <Pane display="flex" flexDirection="column" gap={16}>
            {stat.summary.impressions === 0 ? (
              <Alert intent="none">No events collected yet for this popup (§14) — numbers below will update once real traffic comes in.</Alert>
            ) : (
              <Alert intent="none">Live data from collected events (§14).</Alert>
            )}
            <Pane display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={16}>
              <StatCard label="Impressions" value={stat.summary.impressions.toLocaleString()} />
              <StatCard label="Views (≥50% / 1s)" value={stat.summary.views.toLocaleString()} />
              <StatCard label="Clicks" value={stat.summary.clicks.toLocaleString()} sub={'CTR ' + (stat.summary.ctr * 100).toFixed(1) + '%'} />
              <StatCard label="Closes" value={stat.summary.closes.toLocaleString()} sub={'close rate ' + (stat.summary.close_rate * 100).toFixed(1) + '%'} />
            </Pane>

            {stat.summary.form_conversion != null && (
              <Pane display="grid" gridTemplateColumns="repeat(3, 1fr)" gap={16}>
                <StatCard label="Form starts" value={stat.summary.form_starts.toLocaleString()} />
                <StatCard label="Form submits" value={stat.summary.form_submits.toLocaleString()} />
                <StatCard label="Form conversion" value={(stat.summary.form_conversion * 100).toFixed(1) + '%'} />
              </Pane>
            )}

            <Pane border="1px solid #E7E2DF" borderRadius={14} padding={16}>
              <Text size={300} color="muted" display="block" marginBottom={8}>Impressions over time</Text>
              <ImpressionsChart timeseries={stat.timeseries} />
            </Pane>

            <Pane border="1px solid #E7E2DF" borderRadius={14} padding={16}>
              <Text size={300} color="muted" display="block" marginBottom={12}>By device</Text>
              <DeviceBars byDevice={stat.by_device} />
            </Pane>
          </Pane>
        )}
      </Card>
    </Pane>
  );
}
