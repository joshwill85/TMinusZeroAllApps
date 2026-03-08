import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyBlueOriginMission,
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  updateCheckpoint
} from '../_shared/blueOriginIngest.ts';

type LaunchPayloadRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  net: string | null;
  provider: string | null;
  payloads: Array<{ name?: string | null; type?: string | null; orbit?: string | null; agency?: string | null }> | null;
};

type Ll2PayloadFlightRow = {
  ll2_payload_flight_id: number;
  ll2_launch_uuid: string;
  ll2_payload_id: number | null;
  destination: string | null;
  amount: number | null;
  active: boolean;
};

type Ll2PayloadRow = {
  ll2_payload_id: number;
  name: string;
  payload_type_id: number | null;
  operator_id: number | null;
  manufacturer_id: number | null;
};

type Ll2PayloadTypeRow = {
  ll2_payload_type_id: number;
  name: string;
};

type Ll2AgencyRow = {
  ll2_agency_id: number;
  name: string;
};

type PayloadUpsert = Record<string, unknown> & {
  launch_id: string | null;
  name: string;
  confidence: 'high' | 'medium' | 'low';
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_payloads_ingest');

  const stats: Record<string, unknown> = {
    launchesScanned: 0,
    ll2PayloadFlightsScanned: 0,
    ll2PayloadProfilesScanned: 0,
    payloadsFromLl2: 0,
    payloadsFromCache: 0,
    payloadsUpserted: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_payloads_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'blue_origin_payloads', {
      sourceType: 'll2-cache',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null
    });

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,ll2_launch_uuid,name,mission_name,mission_orbit,net,provider,payloads')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%')
      .order('net', { ascending: false })
      .limit(800);
    if (launchError) throw launchError;

    const launches = (launchRows || []) as LaunchPayloadRow[];
    stats.launchesScanned = launches.length;

    const launchesByUuid = new Map<string, LaunchPayloadRow>();
    const ll2LaunchUuids = [] as string[];
    for (const launch of launches) {
      const uuid = (launch.ll2_launch_uuid || '').trim();
      if (!uuid) continue;
      launchesByUuid.set(uuid, launch);
      ll2LaunchUuids.push(uuid);
    }

    const ll2PayloadFlights = [] as Ll2PayloadFlightRow[];
    for (const chunk of chunkArray([...new Set(ll2LaunchUuids)], 200)) {
      const { data, error } = await supabase
        .from('ll2_payload_flights')
        .select('ll2_payload_flight_id,ll2_launch_uuid,ll2_payload_id,destination,amount,active')
        .eq('active', true)
        .in('ll2_launch_uuid', chunk)
        .limit(5_000);
      if (error) throw error;
      ll2PayloadFlights.push(...((data || []) as Ll2PayloadFlightRow[]));
    }
    stats.ll2PayloadFlightsScanned = ll2PayloadFlights.length;

    const payloadIds = [...new Set(ll2PayloadFlights.map((row) => row.ll2_payload_id).filter((id): id is number => typeof id === 'number'))];
    const ll2Payloads = [] as Ll2PayloadRow[];
    for (const chunk of chunkArray(payloadIds, 200)) {
      const { data, error } = await supabase
        .from('ll2_payloads')
        .select('ll2_payload_id,name,payload_type_id,operator_id,manufacturer_id')
        .in('ll2_payload_id', chunk)
        .limit(5_000);
      if (error) throw error;
      ll2Payloads.push(...((data || []) as Ll2PayloadRow[]));
    }
    stats.ll2PayloadProfilesScanned = ll2Payloads.length;

    const ll2PayloadById = new Map(ll2Payloads.map((row) => [row.ll2_payload_id, row]));
    const payloadTypeIds = [...new Set(ll2Payloads.map((row) => row.payload_type_id).filter((id): id is number => typeof id === 'number'))];
    const agencyIds = [
      ...new Set(
        ll2Payloads
          .map((row) => row.operator_id || row.manufacturer_id)
          .filter((id): id is number => typeof id === 'number')
      )
    ];

    const payloadTypes = [] as Ll2PayloadTypeRow[];
    for (const chunk of chunkArray(payloadTypeIds, 200)) {
      const { data, error } = await supabase
        .from('ll2_payload_types')
        .select('ll2_payload_type_id,name')
        .in('ll2_payload_type_id', chunk)
        .limit(2_000);
      if (error) throw error;
      payloadTypes.push(...((data || []) as Ll2PayloadTypeRow[]));
    }
    const payloadTypeById = new Map(payloadTypes.map((row) => [row.ll2_payload_type_id, row]));

    const agencies = [] as Ll2AgencyRow[];
    for (const chunk of chunkArray(agencyIds, 200)) {
      const { data, error } = await supabase
        .from('ll2_agencies')
        .select('ll2_agency_id,name')
        .in('ll2_agency_id', chunk)
        .limit(2_000);
      if (error) throw error;
      agencies.push(...((data || []) as Ll2AgencyRow[]));
    }
    const agencyById = new Map(agencies.map((row) => [row.ll2_agency_id, row]));

    const candidateMap = new Map<string, PayloadUpsert>();

    for (const flight of ll2PayloadFlights) {
      const launch = launchesByUuid.get(flight.ll2_launch_uuid);
      if (!launch) continue;

      const payload = flight.ll2_payload_id ? ll2PayloadById.get(flight.ll2_payload_id) : null;
      const payloadName = (payload?.name || '').trim();
      if (!payloadName) continue;

      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);
      const payloadType = payload?.payload_type_id ? payloadTypeById.get(payload.payload_type_id)?.name || null : null;
      const agency =
        payload?.operator_id && agencyById.get(payload.operator_id)?.name
          ? agencyById.get(payload.operator_id)?.name || null
          : payload?.manufacturer_id
            ? agencyById.get(payload.manufacturer_id)?.name || null
            : null;

      const candidate: PayloadUpsert = {
        mission_key: missionKey,
        flight_code: flightCode,
        flight_slug: flightCode || null,
        name: payloadName,
        payload_type: payloadType,
        orbit: (launch.mission_orbit || '').trim() || (flight.destination || '').trim() || null,
        agency,
        launch_id: launch.launch_id,
        launch_name: launch.name,
        launch_date: launch.net,
        source: 'll2_payload_manifest',
        confidence: 'high',
        metadata: {
          ll2LaunchUuid: flight.ll2_launch_uuid,
          ll2PayloadFlightId: flight.ll2_payload_flight_id,
          ll2PayloadId: flight.ll2_payload_id,
          amount: flight.amount,
          destination: flight.destination || null,
          missionName: launch.mission_name || null,
          provider: launch.provider || null
        },
        updated_at: new Date().toISOString()
      };

      const key = buildPayloadKey(candidate.launch_id, payloadName);
      mergePayloadCandidate(candidateMap, key, candidate);
      stats.payloadsFromLl2 = Number(stats.payloadsFromLl2 || 0) + 1;
    }

    for (const launch of launches) {
      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);

      for (const payload of launch.payloads || []) {
        const payloadName = (payload?.name || '').trim();
        if (!payloadName) continue;

        const candidate: PayloadUpsert = {
          mission_key: missionKey,
          flight_code: flightCode,
          flight_slug: flightCode || null,
          name: payloadName,
          payload_type: (payload?.type || '').trim() || null,
          orbit: (payload?.orbit || '').trim() || (launch.mission_orbit || '').trim() || null,
          agency: (payload?.agency || '').trim() || null,
          launch_id: launch.launch_id,
          launch_name: launch.name,
          launch_date: launch.net,
          source: 'launches_public_cache.payloads',
          confidence: 'medium',
          metadata: {
            missionName: launch.mission_name || null,
            provider: launch.provider || null
          },
          updated_at: new Date().toISOString()
        };

        const key = buildPayloadKey(candidate.launch_id, payloadName);
        mergePayloadCandidate(candidateMap, key, candidate);
        stats.payloadsFromCache = Number(stats.payloadsFromCache || 0) + 1;
      }
    }

    const upserts = [...candidateMap.values()];
    if (upserts.length > 0) {
      const { error: upsertError } = await supabase
        .from('blue_origin_payloads')
        .upsert(upserts, { onConflict: 'launch_id,name_normalized' });
      if (upsertError) throw upsertError;
    }
    stats.payloadsUpserted = upserts.length;

    await updateCheckpoint(supabase, 'blue_origin_payloads', {
      sourceType: 'll2-cache',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.payloadsUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        launchesScanned: stats.launchesScanned,
        ll2PayloadFlightsScanned: stats.ll2PayloadFlightsScanned,
        ll2PayloadProfilesScanned: stats.ll2PayloadProfilesScanned,
        payloadsFromLl2: stats.payloadsFromLl2,
        payloadsFromCache: stats.payloadsFromCache
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_payloads', {
      sourceType: 'll2-cache',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function extractFlightCode(text: string) {
  const normalized = text.toLowerCase();
  const ns = normalized.match(/\bns\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ns?.[1]) return `ns-${Number(ns[1])}`;
  const ng = normalized.match(/\bng\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ng?.[1]) return `ng-${Number(ng[1])}`;
  return null;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const out = [] as T[][];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildPayloadKey(launchId: unknown, name: string) {
  return `${String(launchId || 'na')}:${name.toLowerCase().trim()}`;
}

function mergePayloadCandidate(
  map: Map<string, PayloadUpsert>,
  key: string,
  next: PayloadUpsert
) {
  const current = map.get(key);
  if (!current) {
    map.set(key, next);
    return;
  }

  const currentRank = confidenceRank(String(current.confidence || 'medium'));
  const nextRank = confidenceRank(String(next.confidence || 'medium'));
  if (nextRank >= currentRank) map.set(key, next);
}

function confidenceRank(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  return 1;
}
