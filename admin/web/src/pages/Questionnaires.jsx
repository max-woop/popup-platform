import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

function OptionBar({ option, maxPct }) {
  const width = maxPct > 0 ? Math.max(2, (option.pct / maxPct) * 100) : 0;
  return (
    <div className="row" style={{ gap: 12, marginBottom: 8 }}>
      <div className="small" style={{ width: 120, flex: 'none' }}>{option.label}</div>
      <div style={{ flex: 1, background: 'var(--bg-sunken)', borderRadius: 4, overflow: 'hidden', height: 22 }}>
        <div style={{ width: width + '%', height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
      </div>
      <div className="small muted" style={{ width: 90, flex: 'none', textAlign: 'right' }}>
        {option.count} ({option.pct}%)
      </div>
    </div>
  );
}

function QuestionCard({ question }) {
  const maxPct = Math.max(1, ...question.options.map((o) => o.pct));
  return (
    <div className="card" style={{ boxShadow: 'none' }}>
      <div className="card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong className="small">{question.text}</strong>
          <span className="small muted">{question.total_answers} answer{question.total_answers === 1 ? '' : 's'}</span>
        </div>
        {question.total_answers === 0
          ? <p className="small muted">No answers yet.</p>
          : question.options.map((o) => <OptionBar key={o.value} option={o} maxPct={maxPct} />)}
      </div>
    </div>
  );
}

export default function Questionnaires() {
  const [popups, setPopups] = useState(null);
  const [popupId, setPopupId] = useState('');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.questionnaire.popups().then((list) => {
      setPopups(list);
      if (list.length) setPopupId(list[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(() => {
    if (!popupId) return;
    api.questionnaire.stats(popupId).then(setStats).catch((e) => setError(e.message));
  }, [popupId]);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Questionnaires</h2>
            <p>Answer breakdown per question (§5.4) — every tap is one row in this count, no separate submit step.</p>
          </div>
          {popups && popups.length > 0 && (
            <select value={popupId} onChange={(e) => setPopupId(e.target.value)} style={{ minWidth: 220 }}>
              {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        {error && <div className="alert alert-danger" style={{ margin: 16 }}>{error}</div>}
        {popups && popups.length === 0 && <div className="empty-state">No questionnaire popups yet.</div>}
        {popups && popups.length > 0 && !stats && <div className="empty-state">Loading…</div>}

        {stats && (
          <div className="card-pad stack">
            {stats.questions.map((q) => <QuestionCard key={q.question_id} question={q} />)}
          </div>
        )}
      </div>
    </div>
  );
}
