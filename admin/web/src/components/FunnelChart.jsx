import { Pane, Text } from 'evergreen-ui';

const ACCENT = '#FF4C0B';

// Shared between Questionnaires.jsx and PopupSettings.jsx's gamification
// card — same {label, count, pct_of_views, pct_of_prev} step shape from
// both /questionnaire-stats and /gamification-funnel (routes/stats.js),
// deliberately, so one component covers both rather than two near-copies.
export function FunnelChart({ steps }) {
  if (!steps || !steps.length) return null;
  const maxCount = Math.max(1, ...steps.map((s) => s.count));
  return (
    <Pane display="flex" flexDirection="column" gap={10}>
      {steps.map((step, i) => {
        const width = maxCount > 0 ? Math.max(step.count > 0 ? 2 : 0, (step.count / maxCount) * 100) : 0;
        return (
          <Pane key={step.label + i}>
            <Pane display="flex" justifyContent="space-between" alignItems="baseline" marginBottom={4}>
              <Text size={300} fontWeight={600}>{step.label}</Text>
              <Text size={300} color="muted">
                {step.count}
                {' · '}{step.pct_of_views}% of views
                {step.pct_of_prev != null && <> {'· '}{step.pct_of_prev}% of previous step</>}
              </Text>
            </Pane>
            <Pane background="#F1EEEC" borderRadius={4} overflow="hidden" height={20}>
              <Pane width={width + '%'} height="100%" background={ACCENT} borderRadius={4} />
            </Pane>
          </Pane>
        );
      })}
    </Pane>
  );
}
