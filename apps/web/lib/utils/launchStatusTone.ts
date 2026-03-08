export type LaunchStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

const FAILURE_MARKERS = ['fail', 'failure', 'anomaly', 'partial', 'scrub', 'abort'];
const SUCCESS_MARKERS = ['success', 'successful'];

export function getLaunchStatusTone(status?: string | null, statusText?: string | null): LaunchStatusTone {
  const combined = `${status ?? ''} ${statusText ?? ''}`.toLowerCase();

  if (FAILURE_MARKERS.some((marker) => combined.includes(marker))) return 'danger';
  if (combined.includes('hold')) return 'warning';
  if (SUCCESS_MARKERS.some((marker) => combined.includes(marker))) return 'success';
  if (combined.includes('go')) return 'success';

  return 'neutral';
}
