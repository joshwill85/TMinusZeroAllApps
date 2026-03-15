import {
  TRAJECTORY_CONTRACT_COLUMNS,
  buildTrajectoryPublicV2Response,
  type TrajectoryContractRow
} from '@tminuszero/domain';
import type { ArTrajectorySummaryV1, TrajectoryPublicV2ResponseV1 } from '@tminuszero/contracts';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
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

async function fetchLaunchTrajectoryPayloadByLaunchId(
  launchId: string
): Promise<{ payload: TrajectoryPublicV2ResponseV1 | null; eligible: boolean }> {
  const nowMs = Date.now();
  const eligibleLaunches = await fetchArEligibleLaunches({ nowMs });
  const isEligible = eligibleLaunches.some((entry) => entry.launchId === launchId);
  if (!isEligible) {
    return { payload: null, eligible: false };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('launch_trajectory_products')
    .select(TRAJECTORY_CONTRACT_COLUMNS)
    .eq('launch_id', launchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = (data ?? null) as TrajectoryContractRow | null;
  const payload = buildTrajectoryPublicV2Response(row);
  return { payload, eligible: true };
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
