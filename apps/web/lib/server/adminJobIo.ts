export type IngestionRunJobIoRow = {
  id?: number;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  success: boolean | null;
  error: string | null;
  stats: unknown;
};

export type MovementResult = {
  moved: number;
  source: 'explicit' | 'generic';
  keys: string[];
};

export type JobIoSummary = {
  job: string;
  runs: number;
  successRatePct: number;
  avgMovedPerRun: number;
  p50MovedPerRun: number;
  p95MovedPerRun: number;
  zeroMoveRuns: number;
  zeroMoveRatePct: number;
  last5Moved: number[];
  movementSource: 'explicit' | 'generic';
  sampleKeys: string[];
};

export const DEFAULT_TOP_IO_JOBS = [
  'll2_incremental_burst',
  'trajectory_constraints_ingest',
  'trajectory_orbit_ingest',
  'trajectory_products_generate',
  'ingestion_cycle',
  'launch_social_refresh',
  'social_posts_dispatch',
  'spacex_x_post_snapshot',
  'nws_refresh',
  'll2_catalog'
] as const;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickNumbers(stats: Record<string, unknown>, keys: string[]) {
  const picked: Array<{ key: string; value: number }> = [];
  for (const key of keys) {
    const n = toNumber(stats[key]);
    if (n != null) picked.push({ key, value: n });
  }
  return picked;
}

function flattenNumericLeaves(value: unknown, prefix = ''): Array<{ key: string; value: number }> {
  if (value == null) return [];

  const direct = toNumber(value);
  if (direct != null) return [{ key: prefix || '$', value: direct }];

  if (Array.isArray(value)) {
    const out: Array<{ key: string; value: number }> = [];
    for (let i = 0; i < value.length; i += 1) {
      const nextPrefix = prefix ? `${prefix}[${i}]` : `[${i}]`;
      out.push(...flattenNumericLeaves(value[i], nextPrefix));
    }
    return out;
  }

  if (typeof value === 'object') {
    const out: Array<{ key: string; value: number }> = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nextPrefix = prefix ? `${prefix}.${k}` : k;
      out.push(...flattenNumericLeaves(v, nextPrefix));
    }
    return out;
  }

  return [];
}

function genericMovement(stats: Record<string, unknown>): MovementResult {
  const include =
    /(upsert|insert|update|delete|removed|patched|refreshed|written|queued|sent|posted|matched|processed|changed|launchesUpdated|rowsUpserted)/i;
  const exclude =
    /(limit|lookahead|horizon|hours|minutes|seconds|rate|enabled|elapsed|skip|error|fetched|considered|calls|pages|cursor|offset|ttl|version|threshold|cooldown)/i;

  const leaves = flattenNumericLeaves(stats);
  const selected = leaves.filter((leaf) => include.test(leaf.key) && !exclude.test(leaf.key));
  const moved = selected.reduce((sum, item) => sum + Math.max(0, item.value), 0);

  return {
    moved,
    source: 'generic',
    keys: selected.map((item) => item.key)
  };
}

function explicitMovement(job: string, rawStats: unknown): MovementResult | null {
  const stats = asRecord(rawStats);

  if (job === 'trajectory_constraints_ingest') {
    const picked = pickNumbers(stats, ['rowsUpserted']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'trajectory_orbit_ingest') {
    const picked = pickNumbers(stats, ['constraintsUpserted', 'docsInserted']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'trajectory_products_generate') {
    const picked = pickNumbers(stats, ['upserted', 'lineageRowsInserted', 'sourceContractsInserted']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'launch_social_refresh') {
    const picked = pickNumbers(stats, ['candidatesUpserted', 'matched', 'updated', 'staleCleared']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'social_posts_dispatch') {
    const picked = pickNumbers(stats, [
      'queued',
      'updated',
      'posted',
      'sent',
      'updatesQueued',
      'updatesSent',
      'missionRepliesQueued',
      'missionRepliesSent'
    ]);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'spacex_x_post_snapshot') {
    const picked = pickNumbers(stats, ['updated', 'matched', 'cleared']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'nws_refresh') {
    const picked = pickNumbers(stats, ['launchesUpdated', 'pointsUpserted']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'll2_incremental_burst') {
    const picked = pickNumbers(stats, ['upsertedTotal']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  if (job === 'ingestion_cycle') {
    const results = asRecord(stats.results);
    const parts = [
      toNumber(asRecord(results.ll2Incremental).upserted),
      toNumber(asRecord(results.ll2EventIngest).upserted),
      toNumber(asRecord(results.snapiIngest).upserted),
      toNumber(asRecord(results.publicCache).refreshed),
      toNumber(asRecord(results.publicCache).removed)
    ].filter((n): n is number => n != null);
    return { moved: parts.reduce((s, n) => s + Math.max(0, n), 0), source: 'explicit', keys: ['results.*'] };
  }

  if (job === 'll2_catalog') {
    const picked = pickNumbers(stats, ['upserted', 'rowsUpserted', 'changed']);
    return { moved: picked.reduce((s, p) => s + Math.max(0, p.value), 0), source: 'explicit', keys: picked.map((p) => p.key) };
  }

  return null;
}

export function computeMovement(job: string, rawStats: unknown): MovementResult {
  const explicit = explicitMovement(job, rawStats);
  if (explicit && explicit.keys.length > 0) return explicit;
  return genericMovement(asRecord(rawStats));
}

export function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const w = idx - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

export function summarizeJobIo(rows: IngestionRunJobIoRow[]): JobIoSummary {
  const job = rows[0]?.job_name || 'unknown';
  const movements = rows.map((row) => ({
    success: row.success,
    movement: computeMovement(job, row.stats)
  }));
  const movedValues = movements.map((m) => m.movement.moved).sort((a, b) => a - b);
  const zeroMoveRuns = movedValues.filter((v) => v <= 0).length;
  const successRuns = movements.filter((m) => m.success === true).length;

  return {
    job,
    runs: movements.length,
    successRatePct: movements.length ? (successRuns / movements.length) * 100 : 0,
    avgMovedPerRun: movedValues.length ? movedValues.reduce((s, v) => s + v, 0) / movedValues.length : 0,
    p50MovedPerRun: percentile(movedValues, 0.5),
    p95MovedPerRun: percentile(movedValues, 0.95),
    zeroMoveRuns,
    zeroMoveRatePct: movements.length ? (zeroMoveRuns / movements.length) * 100 : 0,
    last5Moved: movements.slice(0, 5).map((m) => m.movement.moved),
    movementSource: movements[0]?.movement.source || 'explicit',
    sampleKeys: movements[0]?.movement.keys.slice(0, 6) || []
  };
}
