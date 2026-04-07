import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';

const MAX_BOOSTERS_PER_LAUNCH = 12;
const MAX_JOIN_ROWS = 5000;
const NET_QUERY_CHUNK_SIZE = 250;

type LauncherLaunchJoinRow = {
  ll2_launcher_id?: number | null;
  ll2_launch_uuid?: string | null;
  launch_id?: string | null;
};

type LauncherRow = {
  ll2_launcher_id?: number | null;
  serial_number?: string | null;
  flight_proven?: boolean | null;
  status?: string | null;
  details?: string | null;
  image_url?: string | null;
  launcher_config_id?: number | null;
  first_launch_date?: string | null;
  last_launch_date?: string | null;
};

type LaunchNetRow = {
  launch_id?: string | null;
  ll2_launch_uuid?: string | null;
  net?: string | null;
};

type LaunchNetRecord = {
  launchId: string | null;
  ll2LaunchUuid: string | null;
  net: string | null;
};

type BoosterAccumulator = {
  totalMissions: number;
  trackedLaunchIds: Set<string>;
  trackedLl2LaunchUuids: Set<string>;
};

export type LaunchBoosterStats = {
  ll2LauncherId: number;
  serialNumber: string | null;
  status: string | null;
  flightProven: boolean | null;
  details: string | null;
  imageUrl: string | null;
  launcherConfigId: number | null;
  firstLaunchDate: string | null;
  lastLaunchDate: string | null;
  totalMissions: number;
  trackedMissions: number;
  missionsThisYear: number;
  lastMissionNet: string | null;
};

export const fetchLaunchBoosterStats = cache(async (launchId: string, ll2LaunchUuid?: string | null): Promise<LaunchBoosterStats[]> => {
  const normalizedLaunchId = String(launchId || '').trim();
  const normalizedLl2LaunchUuid = normalizeText(ll2LaunchUuid);
  if ((!normalizedLaunchId && !normalizedLl2LaunchUuid) || !isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const launchJoinRows = await fetchLaunchJoinRows({
    supabase,
    launchId: normalizedLaunchId,
    ll2LaunchUuid: normalizedLl2LaunchUuid
  });
  const launcherIds = uniqueNumbers(launchJoinRows.map((row) => toFiniteNumber((row as LauncherLaunchJoinRow).ll2_launcher_id)));
  if (launcherIds.length === 0) return [];

  const [launcherResult, launcherJoinResult] = await Promise.all([
    supabase
      .from('ll2_launchers')
      .select(
        'll2_launcher_id, serial_number, flight_proven, status, details, image_url, launcher_config_id, first_launch_date, last_launch_date'
      )
      .in('ll2_launcher_id', launcherIds),
    supabase
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id, ll2_launch_uuid, launch_id')
      .in('ll2_launcher_id', launcherIds)
      .limit(MAX_JOIN_ROWS)
  ]);

  if (launcherResult.error || launcherJoinResult.error) return [];

  const launchers = Array.isArray(launcherResult.data) ? (launcherResult.data as LauncherRow[]) : [];
  const launcherJoins = Array.isArray(launcherJoinResult.data)
    ? (launcherJoinResult.data as LauncherLaunchJoinRow[])
    : [];
  const launcherSet = new Set(launcherIds);

  const statsByLauncherId = new Map<number, BoosterAccumulator>();
  for (const launcherId of launcherIds) {
    statsByLauncherId.set(launcherId, {
      totalMissions: 0,
      trackedLaunchIds: new Set<string>(),
      trackedLl2LaunchUuids: new Set<string>()
    });
  }

  for (const row of launcherJoins) {
    const launcherId = toFiniteNumber(row.ll2_launcher_id);
    if (launcherId == null || !launcherSet.has(launcherId)) continue;

    const bucket = statsByLauncherId.get(launcherId);
    if (!bucket) continue;

    bucket.totalMissions += 1;
    const trackedLaunchId = normalizeText(row.launch_id);
    if (trackedLaunchId) bucket.trackedLaunchIds.add(trackedLaunchId);
    const trackedLl2LaunchUuid = normalizeText(row.ll2_launch_uuid);
    if (trackedLl2LaunchUuid) bucket.trackedLl2LaunchUuids.add(trackedLl2LaunchUuid);
  }

  const trackedLaunchIds = uniqueStrings(
    launcherIds.flatMap((launcherId) => [...(statsByLauncherId.get(launcherId)?.trackedLaunchIds || [])])
  );
  const trackedLl2LaunchUuids = uniqueStrings(
    launcherIds.flatMap((launcherId) => [...(statsByLauncherId.get(launcherId)?.trackedLl2LaunchUuids || [])])
  );
  const [launchById, launchByLl2Uuid] = await Promise.all([
    fetchLaunchRecordsById(supabase, trackedLaunchIds),
    fetchLaunchRecordsByLl2Uuid(supabase, trackedLl2LaunchUuids)
  ]);

  const currentYear = new Date().getUTCFullYear();
  const yearStartMs = Date.UTC(currentYear, 0, 1);
  const yearEndMs = Date.UTC(currentYear + 1, 0, 1);
  const launcherById = new Map<number, LauncherRow>();

  for (const launcher of launchers) {
    const launcherId = toFiniteNumber(launcher.ll2_launcher_id);
    if (launcherId == null) continue;
    launcherById.set(launcherId, launcher);
  }

  const results: LaunchBoosterStats[] = launcherIds.map((launcherId) => {
    const launcher = launcherById.get(launcherId);
    const bucket = statsByLauncherId.get(launcherId) || {
      totalMissions: 0,
      trackedLaunchIds: new Set<string>(),
      trackedLl2LaunchUuids: new Set<string>()
    };

    let missionsThisYear = 0;
    let lastMissionMs = Number.NaN;
    let lastMissionNet: string | null = null;
    const trackedMissionKeys = new Set<string>();
    const missionNetByKey = new Map<string, string>();

    for (const trackedLaunchId of bucket.trackedLaunchIds) {
      const key = `id:${trackedLaunchId}`;
      trackedMissionKeys.add(key);
      const net = normalizeText(launchById.get(trackedLaunchId)?.net);
      if (net) missionNetByKey.set(key, net);
    }

    for (const trackedLl2LaunchUuid of bucket.trackedLl2LaunchUuids) {
      const launchRecord = launchByLl2Uuid.get(trackedLl2LaunchUuid);
      const mappedLaunchId = normalizeText(launchRecord?.launchId);
      const key = mappedLaunchId ? `id:${mappedLaunchId}` : `ll2:${trackedLl2LaunchUuid}`;
      trackedMissionKeys.add(key);
      if (!missionNetByKey.has(key)) {
        const net = normalizeText(launchRecord?.net);
        if (net) missionNetByKey.set(key, net);
      }
    }

    for (const net of missionNetByKey.values()) {
      const netMs = Date.parse(net);
      if (!Number.isFinite(netMs)) continue;
      if (netMs >= yearStartMs && netMs < yearEndMs) missionsThisYear += 1;
      if (!Number.isFinite(lastMissionMs) || netMs > lastMissionMs) {
        lastMissionMs = netMs;
        lastMissionNet = new Date(netMs).toISOString();
      }
    }

    return {
      ll2LauncherId: launcherId,
      serialNumber: normalizeDisplayText(launcher?.serial_number),
      status: normalizeDisplayText(launcher?.status),
      flightProven: typeof launcher?.flight_proven === 'boolean' ? launcher.flight_proven : null,
      details: normalizeDisplayText(launcher?.details),
      imageUrl: normalizeText(launcher?.image_url) || null,
      launcherConfigId: toFiniteNumber(launcher?.launcher_config_id),
      firstLaunchDate: normalizeDateOnly(launcher?.first_launch_date) || null,
      lastLaunchDate: normalizeDateOnly(launcher?.last_launch_date) || null,
      totalMissions: bucket.totalMissions,
      trackedMissions: trackedMissionKeys.size,
      missionsThisYear,
      lastMissionNet
    } satisfies LaunchBoosterStats;
  });

  results.sort((left, right) => {
    const leftSerial = left.serialNumber || '';
    const rightSerial = right.serialNumber || '';
    const serialDelta = leftSerial.localeCompare(rightSerial);
    if (serialDelta !== 0) return serialDelta;
    return left.ll2LauncherId - right.ll2LauncherId;
  });

  return results;
});

async function fetchLaunchJoinRows({
  supabase,
  launchId,
  ll2LaunchUuid
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  launchId: string;
  ll2LaunchUuid: string;
}) {
  if (!launchId && !ll2LaunchUuid) return [];
  const selects = 'll2_launcher_id,ll2_launch_uuid,launch_id';

  if (launchId) {
    const { data, error } = await supabase
      .from('ll2_launcher_launches')
      .select(selects)
      .eq('launch_id', launchId)
      .limit(MAX_BOOSTERS_PER_LAUNCH);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data as LauncherLaunchJoinRow[];
    }
  }

  if (ll2LaunchUuid) {
    const { data, error } = await supabase
      .from('ll2_launcher_launches')
      .select(selects)
      .eq('ll2_launch_uuid', ll2LaunchUuid)
      .limit(MAX_BOOSTERS_PER_LAUNCH);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data as LauncherLaunchJoinRow[];
    }
  }

  return [];
}

async function fetchLaunchRecordsById(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  launchIds: string[]
) {
  const byId = new Map<string, LaunchNetRecord>();
  if (launchIds.length === 0) return byId;

  for (let index = 0; index < launchIds.length; index += NET_QUERY_CHUNK_SIZE) {
    const chunk = launchIds.slice(index, index + NET_QUERY_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id, ll2_launch_uuid, net')
      .in('launch_id', chunk);
    if (error || !Array.isArray(data)) continue;

    for (const row of data as LaunchNetRow[]) {
      const launchId = normalizeText(row.launch_id);
      if (!launchId) continue;
      byId.set(launchId, {
        launchId,
        ll2LaunchUuid: normalizeText(row.ll2_launch_uuid) || null,
        net: normalizeText(row.net) || null
      });
    }
  }

  return byId;
}

async function fetchLaunchRecordsByLl2Uuid(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  ll2LaunchUuids: string[]
) {
  const byLl2Uuid = new Map<string, LaunchNetRecord>();
  if (ll2LaunchUuids.length === 0) return byLl2Uuid;

  for (let index = 0; index < ll2LaunchUuids.length; index += NET_QUERY_CHUNK_SIZE) {
    const chunk = ll2LaunchUuids.slice(index, index + NET_QUERY_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id, ll2_launch_uuid, net')
      .in('ll2_launch_uuid', chunk);
    if (error || !Array.isArray(data)) continue;

    for (const row of data as LaunchNetRow[]) {
      const ll2LaunchUuid = normalizeText(row.ll2_launch_uuid);
      if (!ll2LaunchUuid) continue;
      byLl2Uuid.set(ll2LaunchUuid, {
        launchId: normalizeText(row.launch_id) || null,
        ll2LaunchUuid,
        net: normalizeText(row.net) || null
      });
    }
  }

  return byLl2Uuid;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDisplayText(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'tbd' || lower === 'n/a' || lower === 'na' || lower === 'none') {
    return null;
  }

  return normalized;
}

function normalizeDateOnly(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function toFiniteNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function uniqueNumbers(values: Array<number | null>) {
  const deduped = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    deduped.add(value);
  }
  return [...deduped];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
