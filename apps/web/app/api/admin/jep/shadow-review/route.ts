import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_STATES = ['FL', 'CA', 'TX'] as const;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const PAD_OBSERVER_HASH = 'pad';

type LaunchReviewRow = {
  launch_id: string;
  net: string | null;
  name: string | null;
  provider: string | null;
  pad_state: string | null;
  pad_name: string | null;
  location_name: string | null;
  vehicle: string | null;
  rocket_full_name: string | null;
  rocket_family: string | null;
  ll2_rocket_config_id: number | null;
};

type CandidateRow = {
  launch_id: string;
  observer_location_hash: string | null;
  model_version: string;
  score: number | null;
  raw_score: number | null;
  gate_open: boolean | null;
  baseline_score: number | null;
  score_delta: number | null;
  feature_availability: Record<string, unknown> | null;
  factor_payload: Record<string, unknown> | null;
  explainability: Record<string, unknown> | null;
  feature_refs: Record<string, unknown> | null;
  updated_at: string | null;
};

type BaselineRow = {
  launch_id: string;
  observer_location_hash: string | null;
  score: number | null;
  model_version: string | null;
  updated_at: string | null;
};

type ShadowReviewLaunch = {
  launchId: string;
  net: string | null;
  state: string | null;
  name: string | null;
  provider: string | null;
  padName: string | null;
  locationName: string | null;
  vehicle: string | null;
  rocketFullName: string | null;
  rocketFamily: string | null;
  ll2RocketConfigId: number | null;
  baselineScore: number | null;
  baselineModelVersion: string | null;
  shadowAvailable: boolean;
  shadowScore: number | null;
  shadowRawScore: number | null;
  scoreDelta: number | null;
  gateOpen: boolean | null;
  updatedAt: string | null;
  missionProfile: {
    availability: string | null;
    factor: number | null;
    familyKey: string | null;
    familyLabel: string | null;
    matchMode: string | null;
    analystConfidence: string | null;
    sourceTitle: string | null;
    sourceRevision: string | null;
  } | null;
  pendingFamilies: string[];
  reasonCodes: string[];
};

export async function GET(request: Request) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;
  const { admin } = gate.context;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });

  const url = new URL(request.url);
  const states = parseStateFilter(url.searchParams.get('states'));
  const limit = parseLimit(url.searchParams.get('limit'));
  const minAbsDelta = parseNumber(url.searchParams.get('minAbsDelta'));
  const gateFilter = parseGateFilter(url.searchParams.get('gate'));
  const sort = parseSort(url.searchParams.get('sort'));
  const nowIso = new Date().toISOString();

  const modelVersion = await loadShadowModelVersion(admin).catch((error) => {
    console.warn('jep shadow review model version load failed', error);
    return 'jep_v6';
  });

  const { data: launchesData, error: launchesError } = await admin
    .from('launches_public_cache')
    .select(
      'launch_id, net, name, provider, pad_state, pad_name, location_name, vehicle, rocket_full_name, rocket_family, ll2_rocket_config_id'
    )
    .eq('hidden', false)
    .in('pad_state', states)
    .gte('net', nowIso)
    .order('net', { ascending: true })
    .limit(Math.max(limit * 4, 120));

  if (launchesError) {
    console.error('admin jep shadow review launches error', launchesError);
    return NextResponse.json({ error: 'failed_to_load_launches' }, { status: 500 });
  }

  const launches = (launchesData || []) as LaunchReviewRow[];
  const launchIds = launches.map((row) => row.launch_id).filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (!launchIds.length) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        modelVersion,
        states,
        summary: {
          targetLaunches: 0,
          baselineRows: 0,
          shadowRows: 0,
          gateOpen: 0,
          positiveDelta: 0,
          negativeDelta: 0,
          avgDelta: null,
          maxAbsDelta: null,
          byState: []
        },
        launches: []
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const [candidateLoad, baselineRows] = await Promise.all([
    loadCandidateRows(admin, launchIds, modelVersion),
    loadBaselineRows(admin, launchIds)
  ]);

  const baselineByLaunch = new Map<string, BaselineRow>();
  for (const row of baselineRows) {
    baselineByLaunch.set(row.launch_id, row);
  }

  const candidateByLaunch = new Map<string, CandidateRow>();
  for (const row of candidateLoad.rows) {
    candidateByLaunch.set(row.launch_id, row);
  }

  const reviewRows = launches
    .map((launch): ShadowReviewLaunch => {
      const baseline = baselineByLaunch.get(launch.launch_id) ?? null;
      const candidate = candidateByLaunch.get(launch.launch_id) ?? null;
      const missionProfile = readMissionProfile(candidate);
      const baselineScore = normalizeInteger(candidate?.baseline_score) ?? normalizeInteger(baseline?.score);
      const shadowScore = normalizeInteger(candidate?.score);
      const scoreDelta =
        normalizeInteger(candidate?.score_delta) ??
        (baselineScore != null && shadowScore != null ? shadowScore - baselineScore : null);

      return {
        launchId: launch.launch_id,
        net: launch.net,
        state: normalizeText(launch.pad_state),
        name: normalizeText(launch.name),
        provider: normalizeText(launch.provider),
        padName: normalizeText(launch.pad_name),
        locationName: normalizeText(launch.location_name),
        vehicle: normalizeText(launch.vehicle),
        rocketFullName: normalizeText(launch.rocket_full_name),
        rocketFamily: normalizeText(launch.rocket_family),
        ll2RocketConfigId: normalizeInteger(launch.ll2_rocket_config_id),
        baselineScore,
        baselineModelVersion: normalizeText(baseline?.model_version),
        shadowAvailable: Boolean(candidate),
        shadowScore,
        shadowRawScore: normalizeNumber(candidate?.raw_score),
        scoreDelta,
        gateOpen: typeof candidate?.gate_open === 'boolean' ? candidate.gate_open : null,
        updatedAt: normalizeText(candidate?.updated_at) ?? normalizeText(baseline?.updated_at),
        missionProfile,
        pendingFamilies: readStringArray(candidate?.explainability, 'pendingFamilies'),
        reasonCodes: readStringArray(candidate?.explainability, 'reasonCodes')
      };
    })
    .filter((row) => {
      if (!row.shadowAvailable && gateFilter !== 'all') return false;
      if (gateFilter === 'open' && row.gateOpen !== true) return false;
      if (gateFilter === 'closed' && row.gateOpen !== false) return false;
      if (minAbsDelta != null) {
        const absDelta = row.scoreDelta != null ? Math.abs(row.scoreDelta) : 0;
        if (absDelta < minAbsDelta) return false;
      }
      return true;
    });

  reviewRows.sort((left, right) => compareRows(left, right, sort));
  const trimmedRows = reviewRows.slice(0, limit);
  const summary = buildSummary(trimmedRows);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      modelVersion,
      states,
      shadowReady: candidateLoad.ready,
      minAbsDelta,
      gate: gateFilter,
      sort,
      summary,
      launches: trimmedRows
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

async function loadShadowModelVersion(admin: any) {
  const { data, error } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'jep_v6_model_version')
    .maybeSingle();
  if (error) throw error;
  const rawValue = data?.value;
  return normalizeText(typeof rawValue === 'string' ? rawValue : null) || (typeof rawValue === 'number' ? String(rawValue) : '') || 'jep_v6';
}

async function loadCandidateRows(admin: any, launchIds: string[], modelVersion: string) {
  const rows: CandidateRow[] = [];
  const chunkSize = 200;
  let ready = true;

  for (let index = 0; index < launchIds.length; index += chunkSize) {
    const slice = launchIds.slice(index, index + chunkSize);
    const { data, error } = await admin
      .from('launch_jep_score_candidates')
      .select(
        'launch_id, observer_location_hash, model_version, score, raw_score, gate_open, baseline_score, score_delta, feature_availability, factor_payload, explainability, feature_refs, updated_at'
      )
      .eq('observer_location_hash', PAD_OBSERVER_HASH)
      .eq('model_version', modelVersion)
      .in('launch_id', slice);

    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('launch_jep_score_candidates')) {
        ready = false;
        return { ready, rows };
      }
      throw error;
    }

    rows.push(...((data || []) as CandidateRow[]));
  }

  return { ready, rows };
}

async function loadBaselineRows(admin: any, launchIds: string[]) {
  const rows: BaselineRow[] = [];
  const chunkSize = 200;
  for (let index = 0; index < launchIds.length; index += chunkSize) {
    const slice = launchIds.slice(index, index + chunkSize);
    const { data, error } = await admin
      .from('launch_jep_scores')
      .select('launch_id, observer_location_hash, score, model_version, updated_at')
      .eq('observer_location_hash', PAD_OBSERVER_HASH)
      .in('launch_id', slice);
    if (error) throw error;
    rows.push(...((data || []) as BaselineRow[]));
  }
  return rows;
}

function buildSummary(rows: ShadowReviewLaunch[]) {
  const shadowRows = rows.filter((row) => row.shadowAvailable);
  const deltas = shadowRows.map((row) => row.scoreDelta).filter((value): value is number => typeof value === 'number');
  const byStateMap = new Map<string, { launches: number; withShadow: number; gateOpen: number; avgDeltaValues: number[] }>();

  for (const row of rows) {
    const state = row.state || 'UNKNOWN';
    const bucket = byStateMap.get(state) ?? { launches: 0, withShadow: 0, gateOpen: 0, avgDeltaValues: [] };
    bucket.launches += 1;
    if (row.shadowAvailable) bucket.withShadow += 1;
    if (row.gateOpen) bucket.gateOpen += 1;
    if (typeof row.scoreDelta === 'number') bucket.avgDeltaValues.push(row.scoreDelta);
    byStateMap.set(state, bucket);
  }

  const byState = [...byStateMap.entries()]
    .map(([state, bucket]) => ({
      state,
      launches: bucket.launches,
      withShadow: bucket.withShadow,
      gateOpen: bucket.gateOpen,
      avgDelta: bucket.avgDeltaValues.length ? round(mean(bucket.avgDeltaValues), 2) : null
    }))
    .sort((left, right) => left.state.localeCompare(right.state));

  return {
    targetLaunches: rows.length,
    baselineRows: rows.filter((row) => row.baselineScore != null).length,
    shadowRows: shadowRows.length,
    gateOpen: shadowRows.filter((row) => row.gateOpen).length,
    positiveDelta: deltas.filter((value) => value > 0).length,
    negativeDelta: deltas.filter((value) => value < 0).length,
    avgDelta: deltas.length ? round(mean(deltas), 2) : null,
    maxAbsDelta: deltas.length ? Math.max(...deltas.map((value) => Math.abs(value))) : null,
    byState
  };
}

function readMissionProfile(candidate: CandidateRow | null) {
  const record = candidate?.explainability?.missionProfile;
  if (!record || typeof record !== 'object') return null;
  const payload = record as Record<string, unknown>;
  return {
    availability: normalizeText(payload.availability),
    factor: normalizeNumber(payload.factor),
    familyKey: normalizeText(payload.familyKey),
    familyLabel: normalizeText(payload.familyLabel),
    matchMode: normalizeText(payload.matchMode),
    analystConfidence: normalizeText(payload.analystConfidence),
    sourceTitle: normalizeText(payload.sourceTitle),
    sourceRevision: normalizeText(payload.sourceRevision)
  };
}

function readStringArray(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseStateFilter(value: string | null) {
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .filter((item): item is (typeof DEFAULT_STATES)[number] => DEFAULT_STATES.includes(item as (typeof DEFAULT_STATES)[number]));
  return parsed.length ? [...new Set(parsed)] : [...DEFAULT_STATES];
}

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function parseNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGateFilter(value: string | null) {
  if (value === 'open' || value === 'closed') return value;
  return 'all' as const;
}

function parseSort(value: string | null) {
  if (value === 'net' || value === 'delta_desc' || value === 'delta_asc') return value;
  return 'abs_delta' as const;
}

function compareRows(
  left: ShadowReviewLaunch,
  right: ShadowReviewLaunch,
  sort: 'abs_delta' | 'delta_desc' | 'delta_asc' | 'net'
) {
  if (sort === 'net') {
    return compareNumbers(toMs(left.net), toMs(right.net));
  }

  const leftDelta = left.scoreDelta ?? Number.NEGATIVE_INFINITY;
  const rightDelta = right.scoreDelta ?? Number.NEGATIVE_INFINITY;
  if (sort === 'delta_desc') return compareNumbers(rightDelta, leftDelta) || compareNumbers(toMs(left.net), toMs(right.net));
  if (sort === 'delta_asc') return compareNumbers(leftDelta, rightDelta) || compareNumbers(toMs(left.net), toMs(right.net));
  return compareNumbers(Math.abs(rightDelta), Math.abs(leftDelta)) || compareNumbers(toMs(left.net), toMs(right.net));
}

function toMs(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareNumbers(left: number, right: number) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
