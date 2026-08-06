import { Badge } from 'evergreen-ui';

const LABELS = {
  live: 'Live', paused: 'Paused', archived: 'Archived', draft: 'Draft',
  forwarded: 'Forwarded', pending: 'Pending', dead: 'Dead'
};

const COLORS = {
  live: 'green', paused: 'orange', archived: 'neutral', draft: 'neutral',
  forwarded: 'blue', pending: 'yellow', dead: 'red'
};

export function StatusBadge({ status }) {
  return <Badge color={COLORS[status] || 'neutral'}>{LABELS[status] || status}</Badge>;
}
