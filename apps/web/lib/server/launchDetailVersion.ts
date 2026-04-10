import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDetailVersionToken } from '@tminuszero/domain';
import { logLaunchRefreshDiagnostic } from '@/lib/server/launchRefreshDiagnostics';
import { loadLaunchRefreshStateSeed } from '@/lib/server/launchRefreshState';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';

const LAUNCH_DETAIL_VERSION_CACHE_REVALIDATE_SECONDS = 3600;

export function maxIsoTimestamp(values: Array<string | null | undefined>) {
  let latestIso: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    const candidateMs = Date.parse(value);
    if (!Number.isFinite(candidateMs)) {
      continue;
    }

    if (candidateMs > latestMs) {
      latestMs = candidateMs;
      latestIso = value;
    }
  }

  return latestIso;
}

export async function loadPayloadManifestUpdatedAt(
  client: ReturnType<typeof createSupabasePublicClient>,
  ll2LaunchId: string | null
) {
  if (!ll2LaunchId) {
    return null;
  }

  const [payloadFlightsResult, spacecraftFlightsResult] = await Promise.all([
    client
      .from('ll2_payload_flights')
      .select('updated_at')
      .eq('ll2_launch_uuid', ll2LaunchId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('ll2_spacecraft_flights')
      .select('updated_at')
      .eq('ll2_launch_uuid', ll2LaunchId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (payloadFlightsResult.error) {
    throw payloadFlightsResult.error;
  }
  if (spacecraftFlightsResult.error) {
    throw spacecraftFlightsResult.error;
  }

  const payloadFlightsUpdatedAt =
    typeof payloadFlightsResult.data?.updated_at === 'string' ? payloadFlightsResult.data.updated_at : null;
  const spacecraftFlightsUpdatedAt =
    typeof spacecraftFlightsResult.data?.updated_at === 'string' ? spacecraftFlightsResult.data.updated_at : null;

  return maxIsoTimestamp([payloadFlightsUpdatedAt, spacecraftFlightsUpdatedAt]);
}

export async function buildLaunchDetailVersionSeed({
  launchId,
  scope,
  launchCoreUpdatedAt,
  ll2LaunchId,
  client
}: {
  launchId: string;
  scope: 'public' | 'live';
  launchCoreUpdatedAt: string | null;
  ll2LaunchId: string | null;
  client?: ReturnType<typeof createSupabasePublicClient>;
}) {
  if (scope !== 'live') {
    return {
      updatedAt: launchCoreUpdatedAt,
      version: buildDetailVersionToken(launchId, scope, launchCoreUpdatedAt),
      moduleUpdatedAt: {
        launchCore: launchCoreUpdatedAt,
        payloadManifest: null
      }
    };
  }

  const payloadManifestUpdatedAt = await loadPayloadManifestUpdatedAt(client ?? createSupabasePublicClient(), ll2LaunchId);

  return {
    updatedAt: maxIsoTimestamp([launchCoreUpdatedAt, payloadManifestUpdatedAt]),
    version: `${buildDetailVersionToken(launchId, scope, launchCoreUpdatedAt)}|payload:${payloadManifestUpdatedAt ?? 'null'}`,
    moduleUpdatedAt: {
      launchCore: launchCoreUpdatedAt,
      payloadManifest: payloadManifestUpdatedAt
    }
  };
}

const loadCachedLaunchDetailVersionSnapshot = unstable_cache(
  async ({
    launchId,
    scope,
    launchCoreUpdatedAt,
    ll2LaunchId,
    refreshRevision,
    refreshUpdatedAt
  }: {
    launchId: string;
    scope: 'public' | 'live';
    launchCoreUpdatedAt: string | null;
    ll2LaunchId: string | null;
    refreshRevision: number;
    refreshUpdatedAt: string | null;
  }) => {
    logLaunchRefreshDiagnostic('cache_fill', {
      layer: 'launch_detail_version',
      launchId,
      scope,
      refreshRevision,
      refreshUpdatedAt
    });
    const detailSeed = await buildLaunchDetailVersionSeed({
      launchId,
      scope,
      launchCoreUpdatedAt,
      ll2LaunchId
    });
    const updatedAt = maxIsoTimestamp([detailSeed.updatedAt, refreshUpdatedAt]);

    return {
      updatedAt,
      version: `${detailSeed.version}|refresh:${refreshRevision}`,
      moduleUpdatedAt: detailSeed.moduleUpdatedAt
    };
  },
  ['launch-detail-version-snapshot-v2'],
  { revalidate: LAUNCH_DETAIL_VERSION_CACHE_REVALIDATE_SECONDS }
);

export async function loadLaunchDetailVersionSnapshot({
  launchId,
  scope,
  launchCoreUpdatedAt,
  ll2LaunchId,
  refreshStateClient
}: {
  launchId: string;
  scope: 'public' | 'live';
  launchCoreUpdatedAt: string | null;
  ll2LaunchId: string | null;
  refreshStateClient?: SupabaseClient<any, any, any>;
}) {
  const refreshSeed = await loadLaunchRefreshStateSeed(
    refreshStateClient ?? createSupabasePublicClient(),
    scope === 'live' ? 'detail_live' : 'detail_public',
    {
      launchId,
      fallbackUpdatedAt: launchCoreUpdatedAt
    }
  );

  return loadCachedLaunchDetailVersionSnapshot({
    launchId,
    scope,
    launchCoreUpdatedAt,
    ll2LaunchId,
    refreshRevision: refreshSeed.revision,
    refreshUpdatedAt: refreshSeed.updatedAt
  });
}
