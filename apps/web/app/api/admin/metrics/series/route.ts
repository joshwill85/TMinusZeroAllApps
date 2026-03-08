import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';
import {
  DEFAULT_METRIC_KEYS,
  buildAggregatedSeries,
  buildCounterRateSeries,
  clampWindowHours,
  latestSampleAt,
  normalizeMetricRows,
  resolveResolution
} from '../_lib/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_CHART_KEYS = [
  'node_disk_read_bytes_total',
  'node_disk_written_bytes_total',
  'node_cpu_seconds_total',
  'pg_stat_database_deadlocks_total',
  'pg_database_size_mb'
] as const;

export async function GET(request: Request) {
  const auth = await requireAdminRequest({ requireServiceRole: true });
  if (!auth.ok) return auth.response;
  const supabase = auth.context.admin!;

  const url = new URL(request.url);
  const windowHours = clampWindowHours(url.searchParams.get('windowHours'), 24);
  const resolution = resolveResolution(url.searchParams.get('resolution'));

  const requestedMetricsRaw = String(url.searchParams.get('metrics') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const requestedMetrics = requestedMetricsRaw.length ? requestedMetricsRaw : [...DEFAULT_CHART_KEYS];

  const knownMetricKeys = new Set<string>([...DEFAULT_METRIC_KEYS, ...requestedMetrics]);

  const { data, error } = await supabase.rpc('admin_get_ops_metrics_series', {
    window_hours: windowHours,
    resolution,
    metric_keys: [...knownMetricKeys]
  });

  if (error) {
    console.error('admin metrics series rpc error', error.message);
    return NextResponse.json({ error: 'failed_to_load_metrics_series' }, { status: 500 });
  }

  const rows = normalizeMetricRows(data);
  const latest = latestSampleAt(rows);

  const derivedSeries = [
    {
      metricKey: 'disk_read_bps',
      points: buildCounterRateSeries(rows, 'node_disk_read_bytes_total')
    },
    {
      metricKey: 'disk_write_bps',
      points: buildCounterRateSeries(rows, 'node_disk_written_bytes_total')
    },
    {
      metricKey: 'deadlocks_per_min',
      points: buildCounterRateSeries(rows, 'pg_stat_database_deadlocks_total').map((point) => ({
        sampledAt: point.sampledAt,
        value: point.value * 60
      }))
    },
    {
      metricKey: 'checkpoint_write_ms_per_sec',
      points: buildCounterRateSeries(rows, 'pg_stat_bgwriter_checkpoint_write_time_total')
    },
    {
      metricKey: 'io_wait_seconds_per_sec',
      points: buildCounterRateSeries(rows, 'node_cpu_seconds_total', (labels) => String(labels.mode || '') === 'iowait')
    }
  ];

  const rawSeries = buildAggregatedSeries(rows, requestedMetrics);

  return NextResponse.json(
    {
      mode: 'db',
      collectedAt: new Date().toISOString(),
      latestSampleAt: latest,
      resolution,
      windowHours,
      series: [...derivedSeries, ...rawSeries]
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
