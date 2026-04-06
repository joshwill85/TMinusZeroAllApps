import type { JobStatus } from './types';

const ALERT_KEY_TO_JOB_ID: Record<string, string> = {
  trajectory_products_missing_for_eligible: 'trajectory_products_generate',
  trajectory_products_precision_stale: 'trajectory_products_generate',
  trajectory_source_orbit_stale: 'trajectory_orbit_ingest',
  trajectory_source_landing_stale: 'trajectory_constraints_ingest',
  trajectory_source_hazard_stale: 'navcen_bnm_ingest',
  ws45_forecasts_unmatched_upcoming: 'ws45_forecasts_ingest',
  ws45_source_fetch_failed: 'ws45_forecasts_ingest',
  ws45_source_empty: 'ws45_forecasts_ingest',
  ws45_shape_unknown_detected: 'ws45_forecasts_ingest',
  ws45_parse_missing_issued: 'ws45_forecasts_ingest',
  ws45_parse_missing_valid_window: 'ws45_forecasts_ingest',
  ws45_parse_required_fields_missing: 'ws45_forecasts_ingest',
  ws45_match_unmatched_upcoming: 'ws45_forecasts_ingest',
  ws45_match_ambiguous_upcoming: 'ws45_forecasts_ingest',
  ws45_florida_launch_coverage_gap: 'ws45_forecasts_ingest',
  ws45_success_rate_degraded: 'ws45_forecasts_ingest'
};

export function formatJobStatusLabel(status: JobStatus['status']) {
  if (status === 'operational') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  if (status === 'down') return 'Down';
  if (status === 'paused') return 'Paused';
  if (status === 'running') return 'Running';
  return 'Unknown';
}

export function formatJobCategory(category: JobStatus['category']) {
  if (category === 'scheduled') return 'Scheduled';
  if (category === 'manual') return 'Manual';
  return 'Internal';
}

export function jobStatusBadgeClass(status: JobStatus['status']) {
  if (status === 'operational') return 'border-success/40 text-success bg-success/10';
  if (status === 'degraded') return 'border-warning/40 text-warning bg-warning/10';
  if (status === 'down') return 'border-danger/40 text-danger bg-[rgba(251,113,133,0.08)]';
  if (status === 'paused') return 'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]';
  if (status === 'running') return 'border-primary/40 text-primary bg-primary/10';
  return 'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]';
}

export function jobStatusDotClass(status: JobStatus['status']) {
  if (status === 'operational') return 'bg-success';
  if (status === 'degraded') return 'bg-warning';
  if (status === 'down') return 'bg-danger';
  if (status === 'paused') return 'bg-text3';
  if (status === 'running') return 'bg-primary';
  return 'bg-text3';
}

export function relatedJobIdFromAlertKey(key: string): string | null {
  const trimmed = String(key || '').trim();
  if (!trimmed) return null;
  const direct = ALERT_KEY_TO_JOB_ID[trimmed];
  if (direct) return direct;
  if (trimmed.endsWith('_cron_enabled_mismatch')) return trimmed.slice(0, -'_cron_enabled_mismatch'.length);
  if (trimmed.endsWith('_stale')) return trimmed.slice(0, -'_stale'.length);
  if (trimmed.endsWith('_failed')) return trimmed.slice(0, -'_failed'.length);
  return null;
}
