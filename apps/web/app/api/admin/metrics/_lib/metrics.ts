export type MetricSampleRow = {
  sampled_at: string;
  metric_key: string;
  labels: Record<string, unknown> | null;
  value: number;
  source?: string | null;
};

export const DEFAULT_METRIC_KEYS = [
  'node_disk_read_bytes_total',
  'node_disk_written_bytes_total',
  'node_disk_io_time_seconds_total',
  'node_cpu_seconds_total',
  'node_filesystem_size_bytes',
  'node_filesystem_avail_bytes',
  'pg_stat_bgwriter_checkpoint_write_time_total',
  'pg_stat_database_deadlocks_total',
  'pg_database_size_mb',
  'pg_up'
] as const;

export function clampWindowHours(value: string | null, fallback = 24) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24 * 30, Math.max(1, Math.floor(parsed)));
}

export function resolveResolution(value: string | null): '1m' | '5m' {
  if (String(value || '').trim().toLowerCase() === '5m') return '5m';
  return '1m';
}

export function normalizeMetricRows(value: unknown): MetricSampleRow[] {
  if (!Array.isArray(value)) return [];
  const normalized: MetricSampleRow[] = [];

  for (const row of value) {
    if (!row || typeof row !== 'object') continue;

    const record = row as Record<string, unknown>;
    const sampledAt = typeof record.sampled_at === 'string' ? record.sampled_at : '';
    const metricKey = typeof record.metric_key === 'string' ? record.metric_key : '';
    const numeric = Number(record.value);
    if (!sampledAt || !metricKey || !Number.isFinite(numeric)) continue;

    const labels =
      record.labels && typeof record.labels === 'object' && !Array.isArray(record.labels)
        ? (record.labels as Record<string, unknown>)
        : {};

    normalized.push({
      sampled_at: sampledAt,
      metric_key: metricKey,
      labels,
      value: numeric,
      source: typeof record.source === 'string' ? record.source : null
    });
  }

  return normalized;
}

function labelsKey(labels: Record<string, unknown> | null | undefined) {
  const record = labels && typeof labels === 'object' ? labels : {};
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function parseMs(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

export function latestSampleAt(rows: MetricSampleRow[]) {
  let latestMs = -Infinity;
  let latestIso: string | null = null;
  for (const row of rows) {
    const ms = parseMs(row.sampled_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = row.sampled_at;
    }
  }
  return latestIso;
}

export function computeCounterRate(
  rows: MetricSampleRow[],
  metricKey: string,
  filter?: (labels: Record<string, unknown>) => boolean
) {
  const grouped = new Map<string, MetricSampleRow[]>();
  for (const row of rows) {
    if (row.metric_key !== metricKey) continue;
    const labels = row.labels ?? {};
    if (filter && !filter(labels)) continue;
    const key = labelsKey(labels);
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }

  let totalRate = 0;
  for (const samples of grouped.values()) {
    const sorted = samples.slice().sort((a, b) => parseMs(a.sampled_at) - parseMs(b.sampled_at));
    if (sorted.length < 2) continue;
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const start = parseMs(first.sampled_at);
    const end = parseMs(last.sampled_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const delta = last.value - first.value;
    if (!Number.isFinite(delta) || delta < 0) continue;
    totalRate += delta / ((end - start) / 1000);
  }

  return Number.isFinite(totalRate) ? totalRate : null;
}

export function latestGaugeValue(
  rows: MetricSampleRow[],
  metricKey: string,
  {
    strategy = 'max',
    filter
  }: {
    strategy?: 'max' | 'sum';
    filter?: (labels: Record<string, unknown>) => boolean;
  } = {}
) {
  const candidates = rows.filter((row) => {
    if (row.metric_key !== metricKey) return false;
    if (!filter) return true;
    return filter(row.labels ?? {});
  });
  if (!candidates.length) return null;

  const latestIso = latestSampleAt(candidates);
  if (!latestIso) return null;

  const latestRows = candidates.filter((row) => row.sampled_at === latestIso);
  if (!latestRows.length) return null;

  if (strategy === 'sum') return latestRows.reduce((sum, row) => sum + row.value, 0);
  return latestRows.reduce((max, row) => (row.value > max ? row.value : max), -Infinity);
}

export function buildAggregatedSeries(
  rows: MetricSampleRow[],
  metricKeys: readonly string[]
): Array<{ metricKey: string; points: Array<{ sampledAt: string; value: number }> }> {
  const byMetric = new Map<string, Map<string, number>>();

  for (const key of metricKeys) byMetric.set(key, new Map());

  for (const row of rows) {
    if (!byMetric.has(row.metric_key)) continue;
    const bucket = byMetric.get(row.metric_key)!;
    bucket.set(row.sampled_at, (bucket.get(row.sampled_at) || 0) + row.value);
  }

  return metricKeys.map((metricKey) => {
    const points = Array.from(byMetric.get(metricKey)?.entries() || [])
      .sort(([a], [b]) => parseMs(a) - parseMs(b))
      .map(([sampledAt, value]) => ({ sampledAt, value }));
    return { metricKey, points };
  });
}

export function buildCounterRateSeries(
  rows: MetricSampleRow[],
  metricKey: string,
  filter?: (labels: Record<string, unknown>) => boolean
) {
  const grouped = new Map<string, MetricSampleRow[]>();
  for (const row of rows) {
    if (row.metric_key !== metricKey) continue;
    const labels = row.labels ?? {};
    if (filter && !filter(labels)) continue;
    const key = labelsKey(labels);
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }

  const bySampleAt = new Map<string, number>();

  for (const samples of grouped.values()) {
    const sorted = samples.slice().sort((a, b) => parseMs(a.sampled_at) - parseMs(b.sampled_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevMs = parseMs(prev.sampled_at);
      const currMs = parseMs(curr.sampled_at);
      if (!Number.isFinite(prevMs) || !Number.isFinite(currMs) || currMs <= prevMs) continue;
      const delta = curr.value - prev.value;
      if (!Number.isFinite(delta) || delta < 0) continue;
      const rate = delta / ((currMs - prevMs) / 1000);
      bySampleAt.set(curr.sampled_at, (bySampleAt.get(curr.sampled_at) || 0) + rate);
    }
  }

  return Array.from(bySampleAt.entries())
    .sort(([a], [b]) => parseMs(a) - parseMs(b))
    .map(([sampledAt, value]) => ({ sampledAt, value }));
}
