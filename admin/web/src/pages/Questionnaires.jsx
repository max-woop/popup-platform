import { useEffect, useState, useCallback } from 'react';
import { Pane, Text, Select, Alert } from 'evergreen-ui';
import { api } from '../lib/api';
import { Card } from '../components/Card.jsx';

const ACCENT = '#FF4C0B';

function OptionBar({ option, maxPct }) {
  const width = maxPct > 0 ? Math.max(2, (option.pct / maxPct) * 100) : 0;
  return (
    <Pane display="flex" alignItems="center" gap={12} marginBottom={8}>
      <Text size={300} width={120} flexShrink={0}>{option.label}</Text>
      <Pane flex={1} background="#F1EEEC" borderRadius={4} overflow="hidden" height={22}>
        <Pane width={width + '%'} height="100%" background={ACCENT} borderRadius={4} />
      </Pane>
      <Text size={300} color="muted" width={90} flexShrink={0} textAlign="right">
        {option.count} ({option.pct}%)
      </Text>
    </Pane>
  );
}

function QuestionCard({ question }) {
  const maxPct = Math.max(1, ...question.options.map((o) => o.pct));
  return (
    <Pane border="1px solid #E7E2DF" borderRadius={14} padding={16}>
      <Pane display="flex" justifyContent="space-between" alignItems="center" marginBottom={12}>
        <Text size={300} fontWeight={600}>{question.text}</Text>
        <Text size={300} color="muted">{question.total_answers} answer{question.total_answers === 1 ? '' : 's'}</Text>
      </Pane>
      {question.total_answers === 0
        ? <Text size={300} color="muted">No answers yet.</Text>
        : question.options.map((o) => <OptionBar key={o.value} option={o} maxPct={maxPct} />)}
    </Pane>
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
    <Card title="Questionnaires" subtitle="Answer breakdown per question (§5.4) — every tap is one row in this count, no separate submit step."
      right={popups && popups.length > 0 && (
        <Select value={popupId} onChange={(e) => setPopupId(e.target.value)} width={230}>
          {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}>
      {error && <Alert intent="danger" marginBottom={16}>{error}</Alert>}
      {popups && popups.length === 0 && <Text color="muted">No questionnaire popups yet.</Text>}
      {popups && popups.length > 0 && !stats && <Text color="muted">Loading…</Text>}

      {stats && (
        <Pane display="flex" flexDirection="column" gap={16}>
          {stats.questions.map((q) => <QuestionCard key={q.question_id} question={q} />)}
        </Pane>
      )}
    </Card>
  );
}
