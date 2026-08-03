const LABELS = {
  live: 'Live', paused: 'Paused', archived: 'Archived', draft: 'Draft',
  forwarded: 'Forwarded', pending: 'Pending', dead: 'Dead'
};

export function StatusBadge({ status }) {
  return <span className={'badge badge-' + status}>{LABELS[status] || status}</span>;
}
