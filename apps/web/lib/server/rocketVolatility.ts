import type { RocketVolatilityLaunch, RocketVolatilitySummary } from '@/lib/types/rocketVolatility';

export type RocketVolatilityUpdateRow = {
  id: number;
  launch_id: string;
  changed_fields: string[] | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  detected_at?: string | null;
};

const VOLATILITY_TIMING_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const VOLATILITY_STATUS_FIELDS = new Set(['status_abbrev', 'status_name', 'status_id']);

export function computeRocketVolatility({
  lookbackDays,
  launches,
  updates
}: {
  lookbackDays: number;
  launches: RocketVolatilityLaunch[];
  updates: RocketVolatilityUpdateRow[];
}): RocketVolatilitySummary {
  const updatesByLaunchId = new Map<string, RocketVolatilityUpdateRow[]>();
  const netSlipAbsHours: number[] = [];
  let timingUpdates = 0;
  let statusUpdates = 0;
  let lastDetectedAt: string | null = null;

  for (const update of updates) {
    const launchId = String(update.launch_id || '');
    if (!launchId) continue;
    const list = updatesByLaunchId.get(launchId) || [];
    list.push(update);
    updatesByLaunchId.set(launchId, list);

    if (update.detected_at && (!lastDetectedAt || update.detected_at > lastDetectedAt)) {
      lastDetectedAt = update.detected_at;
    }

    const fields = normalizeChangedFields(update.changed_fields);
    if (hasAnyChangedField(fields, VOLATILITY_TIMING_FIELDS)) timingUpdates += 1;
    if (hasAnyChangedField(fields, VOLATILITY_STATUS_FIELDS)) statusUpdates += 1;

    if (fields.has('net')) {
      const deltaHours = diffHours(update.old_values?.net, update.new_values?.net);
      if (deltaHours != null) netSlipAbsHours.push(Math.abs(deltaHours));
    }
  }

  const perLaunch: RocketVolatilitySummary['perLaunch'] = launches.map((launch) => {
    const rows = updatesByLaunchId.get(launch.id) || [];
    let launchTiming = 0;
    let launchStatus = 0;
    let last = null as string | null;

    for (const row of rows) {
      const fields = normalizeChangedFields(row.changed_fields);
      if (hasAnyChangedField(fields, VOLATILITY_TIMING_FIELDS)) launchTiming += 1;
      if (hasAnyChangedField(fields, VOLATILITY_STATUS_FIELDS)) launchStatus += 1;
      if (row.detected_at && (!last || row.detected_at > last)) last = row.detected_at;
    }

    return {
      launchId: launch.id,
      name: launch.name,
      timingUpdates: launchTiming,
      statusUpdates: launchStatus,
      totalUpdates: rows.length,
      lastDetectedAt: last
    };
  });

  perLaunch.sort((a, b) => b.timingUpdates - a.timingUpdates || b.totalUpdates - a.totalUpdates || a.name.localeCompare(b.name));

  const mostVolatile =
    perLaunch.length && perLaunch[0] && perLaunch[0].timingUpdates > 0
      ? { launchId: perLaunch[0].launchId, name: perLaunch[0].name, timingUpdates: perLaunch[0].timingUpdates }
      : null;

  const medianNetSlipHours = median(netSlipAbsHours);
  const avgTimingUpdatesPerLaunch = launches.length ? timingUpdates / launches.length : 0;

  return {
    lookbackDays,
    launchesAnalyzed: launches.length,
    totalUpdates: updates.length,
    timingUpdates,
    statusUpdates,
    medianNetSlipHours,
    avgTimingUpdatesPerLaunch,
    lastDetectedAt,
    mostVolatile,
    perLaunch
  };
}

function normalizeChangedFields(fields: unknown): Set<string> {
  if (!Array.isArray(fields)) return new Set();
  const out = new Set<string>();
  for (const field of fields) {
    if (typeof field !== 'string') continue;
    const key = field.trim().toLowerCase();
    if (key) out.add(key);
  }
  return out;
}

function hasAnyChangedField(fields: Set<string>, candidates: Set<string>) {
  for (const candidate of candidates) {
    if (fields.has(candidate)) return true;
  }
  return false;
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function diffHours(oldValue: unknown, newValue: unknown): number | null {
  const oldMs = parseIsoMs(oldValue);
  const newMs = parseIsoMs(newValue);
  if (oldMs == null || newMs == null) return null;
  return (newMs - oldMs) / (60 * 60 * 1000);
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null as number | null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower == null || upper == null) return null;
  return (lower + upper) / 2;
}

