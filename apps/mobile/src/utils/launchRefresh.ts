export function formatRefreshTimeLabel(timestampMs: number) {
  if (!Number.isFinite(timestampMs)) return 'the next scheduled refresh';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestampMs));
}
