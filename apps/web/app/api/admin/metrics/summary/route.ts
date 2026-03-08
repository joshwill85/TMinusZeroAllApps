import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';
import {
  DEFAULT_METRIC_KEYS,
  clampWindowHours,
  computeCounterRate,
  latestGaugeValue,
  latestSampleAt,
  normalizeMetricRows,
  resolveResolution
} from '../_lib/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAdminRequest({ requireServiceRole: true });
  if (!auth.ok) return auth.response;
  const supabase = auth.context.admin!;

  const url = new URL(request.url);
  const windowHours = clampWindowHours(url.searchParams.get('windowHours'), 24);
  const resolution = resolveResolution(url.searchParams.get('resolution'));

  const { data, error } = await supabase.rpc('admin_get_ops_metrics_series', {
    window_hours: windowHours,
    resolution,
    metric_keys: [...DEFAULT_METRIC_KEYS]
  });

  if (error) {
    console.error('admin metrics summary rpc error', error.message);
    return NextResponse.json({ error: 'failed_to_load_metrics_summary' }, { status: 500 });
  }

  const rows = normalizeMetricRows(data);
  const latest = latestSampleAt(rows);
  const staleMinutes = latest ? (Date.now() - Date.parse(latest)) / (1000 * 60) : null;
  const stale = staleMinutes == null ? true : staleMinutes > 3;

  const diskReadBps = computeCounterRate(rows, 'node_disk_read_bytes_total');
  const diskWriteBps = computeCounterRate(rows, 'node_disk_written_bytes_total');

  const ioWaitRate = computeCounterRate(rows, 'node_cpu_seconds_total', (labels) => String(labels.mode || '') === 'iowait');
  const totalCpuRate = computeCounterRate(rows, 'node_cpu_seconds_total');
  const ioWaitPct = ioWaitRate != null && totalCpuRate != null && totalCpuRate > 0 ? (ioWaitRate / totalCpuRate) * 100 : null;

  const deadlocksRate = computeCounterRate(rows, 'pg_stat_database_deadlocks_total');
  const deadlocksPerMin = deadlocksRate == null ? null : deadlocksRate * 60;

  const checkpointWriteMsPerSec = computeCounterRate(rows, 'pg_stat_bgwriter_checkpoint_write_time_total');
  const dbSizeMb = latestGaugeValue(rows, 'pg_database_size_mb', { strategy: 'max' });
  const fsSizeBytes = latestGaugeValue(rows, 'node_filesystem_size_bytes', { strategy: 'max' });
  const fsAvailBytes = latestGaugeValue(rows, 'node_filesystem_avail_bytes', { strategy: 'max' });
  const fsUsedBytes =
    fsSizeBytes != null && fsAvailBytes != null && Number.isFinite(fsSizeBytes - fsAvailBytes) ? fsSizeBytes - fsAvailBytes : null;

  const notes: string[] = [];
  if (!rows.length) notes.push('No metrics sampled yet. Confirm ops_metrics_collection_enabled and collector job status.');
  if (stale) notes.push('Metrics are stale. Check ops_metrics_collect ingestion run and scheduler state.');

  return NextResponse.json(
    {
      mode: 'db',
      collectedAt: new Date().toISOString(),
      latestSampleAt: latest,
      stale,
      staleMinutes: staleMinutes != null && Number.isFinite(staleMinutes) ? staleMinutes : null,
      windowHours,
      resolution,
      cards: {
        diskReadBps,
        diskWriteBps,
        ioWaitPct,
        deadlocksPerMin,
        checkpointWriteMsPerSec,
        dbSizeMb,
        fsSizeBytes,
        fsAvailBytes,
        fsUsedBytes
      },
      notes
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
