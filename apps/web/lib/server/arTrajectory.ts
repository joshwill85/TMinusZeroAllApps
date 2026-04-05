import {
  TRAJECTORY_CONTRACT_COLUMNS,
  buildTrajectoryContract,
  buildTrajectoryPublicV2Response,
  type TrajectoryContract,
  type TrajectoryContractRow
} from '@tminuszero/domain';
import type { ArTrajectorySummaryV1, TrajectoryPublicV2ResponseV1 } from '@tminuszero/contracts';
import { ecefFromLatLon } from '@/lib/ar/ecef';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { parseLaunchParam } from '@/lib/utils/launchParams';

type TrajectoryLoadResult =
  | {
      ok: true;
      launchId: string;
      payload: TrajectoryPublicV2ResponseV1 | null;
      eligible: true;
    }
  | {
      ok: false;
      error: 'invalid_launch_id' | 'not_eligible';
    };

type PadOnlyFallbackLaunchRow = {
  launch_id: string;
  cache_generated_at: string | null;
  net: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  rocket_family: string | null;
  vehicle: string | null;
  pad_name: string | null;
  location_name: string | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildPadOnlyProduct({
  generatedAt,
  lat,
  lon,
  rocketFamily,
  padName,
  locationName
}: {
  generatedAt: string;
  lat: number | null;
  lon: number | null;
  rocketFamily: string | null;
  padName: string | null;
  locationName: string | null;
}) {
  const hasPadCoordinates = isFiniteNumber(lat) && isFiniteNumber(lon);
  const samples = hasPadCoordinates
    ? [
        {
          tPlusSec: 0,
          ecef: ecefFromLatLon(lat, lon, 0),
          latDeg: lat,
          lonDeg: lon,
          altM: 0,
          downrangeM: 0,
          azimuthDeg: 0,
          sigmaDeg: 20,
          covariance: { along_track: 15, cross_track: 20 },
          uncertainty: { sigmaDeg: 20, covariance: { along_track: 15, cross_track: 20 } }
        }
      ]
    : [];

  const padLabel = [padName, locationName].filter((value): value is string => Boolean(value && value.trim())).join(', ');

  return {
    version: 'traj_v1',
    quality: 0,
    qualityLabel: 'pad_only',
    generatedAt,
    assumptions: [
      'Pad-only fallback package synthesized because a published trajectory package is unavailable.',
      padLabel ? `Fallback anchor uses ${padLabel}.` : 'Fallback anchor uses launch pad coordinates.',
      rocketFamily ? `Envelope family hint: ${rocketFamily}.` : 'No ascent model applied.'
    ],
    samples,
    events: [],
    trackSummary: {
      quality: 0,
      qualityLabel: 'pad_only',
      precisionClaim: false,
      downgraded: false
    }
  } satisfies Record<string, unknown>;
}

function buildPadOnlyFallbackRow(row: PadOnlyFallbackLaunchRow | null): TrajectoryContractRow | null {
  if (!row) return null;

  const generatedAt = row.cache_generated_at ?? row.net ?? new Date().toISOString();
  return {
    launch_id: row.launch_id,
    version: 'traj_v1',
    quality: 0,
    generated_at: generatedAt,
    confidence_tier: 'D',
    freshness_state: 'unknown',
    lineage_complete: true,
    source_sufficiency: {
      qualityLabel: 'pad_only',
      sourceSummary: { code: 'pad_only', label: 'Pad-only' },
      signalSummary: {
        hasPad: isFiniteNumber(row.pad_latitude) && isFiniteNumber(row.pad_longitude),
        hasDirectionalConstraint: false,
        hasLandingDirectional: false,
        hasHazardDirectional: false,
        hasMissionNumericOrbit: false,
        hasSupgpConstraint: false,
        hasLicensedTrajectoryFeed: false,
        supgpMode: 'none'
      },
      landingSummary: {
        hasCoordinates: false,
        hasDirectional: false,
        hasDownrangeOnly: false,
        hasTextOnlyHint: false,
        shipAssignmentPresent: false
      },
      sourceFreshness: {
        basis: 'all_constraints',
        basisConstraintTypes: [],
        latestConstraintAt: null,
        latestSourceCheckAt: null,
        latestSignalAt: generatedAt,
        latestSignalAgeHours: null
      }
    },
    product: buildPadOnlyProduct({
      generatedAt,
      lat: row.pad_latitude,
      lon: row.pad_longitude,
      rocketFamily: row.rocket_family,
      padName: row.pad_name,
      locationName: row.location_name
    })
  };
}

async function fetchResolvedTrajectoryRowByLaunchId(
  launchId: string
): Promise<{ row: TrajectoryContractRow | null; eligible: boolean }> {
  const nowMs = Date.now();
  const eligibleLaunches = await fetchArEligibleLaunches({ nowMs });
  const isEligible = eligibleLaunches.some((entry) => entry.launchId === launchId);
  if (!isEligible) {
    return { row: null, eligible: false };
  }

  // These loaders sit behind server-side gating. Use the server read client so
  // bearer-auth mobile requests and summary metadata are not coupled to cookie RLS.
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('launch_trajectory_products')
    .select(TRAJECTORY_CONTRACT_COLUMNS)
    .eq('launch_id', launchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = (data ?? null) as TrajectoryContractRow | null;
  if (row) {
    return { row, eligible: true };
  }

  const { data: launchData, error: launchError } = await supabase
    .from('launches_public_cache')
    .select('launch_id, cache_generated_at, net, pad_latitude, pad_longitude, rocket_family, vehicle, pad_name, location_name')
    .eq('launch_id', launchId)
    .maybeSingle();

  if (launchError) {
    throw launchError;
  }

  return {
    row: buildPadOnlyFallbackRow((launchData ?? null) as PadOnlyFallbackLaunchRow | null),
    eligible: true
  };
}

async function fetchLaunchTrajectoryPayloadByLaunchId(
  launchId: string
): Promise<{ payload: TrajectoryPublicV2ResponseV1 | null; eligible: boolean }> {
  const { row, eligible } = await fetchResolvedTrajectoryRowByLaunchId(launchId);
  if (!eligible) {
    return { payload: null, eligible: false };
  }

  const payload = buildTrajectoryPublicV2Response(row);
  return { payload, eligible: true };
}

export async function loadLaunchTrajectoryContractByLaunchId(launchId: string): Promise<TrajectoryContract | null> {
  const { row, eligible } = await fetchResolvedTrajectoryRowByLaunchId(launchId);
  if (!eligible) return null;
  return buildTrajectoryContract(row);
}

export async function loadLaunchTrajectoryPayload(id: string): Promise<TrajectoryLoadResult> {
  const parsed = parseLaunchParam(id);
  if (!parsed) {
    return { ok: false, error: 'invalid_launch_id' };
  }

  const { payload, eligible } = await fetchLaunchTrajectoryPayloadByLaunchId(parsed.launchId);
  if (!eligible) {
    return { ok: false, error: 'not_eligible' };
  }

  return {
    ok: true,
    launchId: parsed.launchId,
    payload,
    eligible: true
  };
}

export async function loadArTrajectorySummary(launchId: string): Promise<ArTrajectorySummaryV1> {
  const { payload, eligible } = await fetchLaunchTrajectoryPayloadByLaunchId(launchId);
  if (!eligible) {
    return {
      eligible: false,
      hasTrajectory: false,
      availabilityReason: 'not_eligible',
      qualityState: null,
      confidenceBadge: null,
      generatedAt: null,
      publishPolicy: null
    };
  }

  if (!payload) {
    return {
      eligible: true,
      hasTrajectory: false,
      availabilityReason: 'trajectory_missing',
      qualityState: null,
      confidenceBadge: null,
      generatedAt: null,
      publishPolicy: null
    };
  }

  return {
    eligible: true,
    hasTrajectory: true,
    availabilityReason: 'available',
    qualityState: payload.qualityState,
    confidenceBadge: payload.confidenceBadge,
    generatedAt: payload.generatedAt,
    publishPolicy: payload.publishPolicy
  };
}
