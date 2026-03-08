import { notFound, redirect } from 'next/navigation';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getViewerTier } from '@/lib/server/viewerTier';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildAuthQuery } from '@/lib/utils/returnTo';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import {
  buildTrajectoryContract,
  TRAJECTORY_CONTRACT_COLUMNS
} from '@/lib/server/trajectoryContract';
import { ArSession } from '@/components/ar/ArSession';

export const dynamic = 'force-dynamic';

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const lat1 = lat1Deg * toRad;
  const lon1 = lon1Deg * toRad;
  const lat2 = lat2Deg * toRad;
  const lon2 = lon2Deg * toRad;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1 - a, 0)));
  return 6371 * c;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default async function LaunchArPage({ params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return notFound();
  if (!isSupabaseConfigured()) return notFound();

  const viewer = await getViewerTier();
  const nextPath = `/launches/${encodeURIComponent(parsed.raw)}/ar`;
  if (!viewer.isAuthed) {
    const authQuery = buildAuthQuery({ returnTo: nextPath, intent: 'upgrade' });
    redirect(`/auth/sign-in${authQuery ? `?${authQuery}` : ''}`);
  }
  if (viewer.tier !== 'premium') {
    redirect(`/upgrade?return_to=${encodeURIComponent(nextPath)}`);
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from('launches_public_cache').select('*').eq('launch_id', parsed.launchId).maybeSingle();
  if (error || !data) return notFound();

  const launch = mapPublicCacheRow(data);
  let resolvedPad: typeof launch.pad & { source: 'public_cache' | 'll2_pad'; canonicalDeltaKm: number | null } = {
    ...launch.pad,
    source: 'public_cache',
    canonicalDeltaKm: null
  };

  if (launch.ll2PadId != null) {
    const { data: canonicalPad, error: canonicalPadError } = await supabase
      .from('ll2_catalog_public_cache')
      .select('name, data')
      .eq('entity_type', 'pads')
      .eq('entity_id', String(launch.ll2PadId))
      .maybeSingle();

    if (canonicalPadError) {
      console.warn('AR pad canonical lookup failed', canonicalPadError.message);
    } else if (canonicalPad) {
      const canonicalData =
        canonicalPad.data && typeof canonicalPad.data === 'object' && !Array.isArray(canonicalPad.data)
          ? (canonicalPad.data as Record<string, unknown>)
          : null;
      const canonicalLat = canonicalData ? parseFiniteNumber(canonicalData.latitude) : null;
      const canonicalLon = canonicalData ? parseFiniteNumber(canonicalData.longitude) : null;
      const canonicalMapUrl = canonicalData && typeof canonicalData.map_url === 'string' ? canonicalData.map_url : null;

      if (canonicalLat != null && canonicalLon != null) {
        const canonicalValid =
          canonicalLat >= -90 && canonicalLat <= 90 && canonicalLon >= -180 && canonicalLon <= 180;
        if (canonicalValid) {
          const cacheLat = isFiniteNumber(launch.pad.latitude) ? launch.pad.latitude : null;
          const cacheLon = isFiniteNumber(launch.pad.longitude) ? launch.pad.longitude : null;
          const cacheHasPadLatLon = cacheLat != null && cacheLon != null;
          const padDeltaKm = cacheHasPadLatLon
            ? haversineKm(cacheLat, cacheLon, canonicalLat, canonicalLon)
            : null;

          // Prefer canonical pad coordinates when available; cache may be stale or inconsistent.
          const shouldPreferCanonical = true;
          resolvedPad = {
            ...resolvedPad,
            name: typeof canonicalPad.name === 'string' && canonicalPad.name.trim().length > 0 ? canonicalPad.name : resolvedPad.name,
            mapUrl:
              canonicalMapUrl && canonicalMapUrl.trim().length > 0
                ? canonicalMapUrl
                : resolvedPad.mapUrl,
            canonicalDeltaKm: padDeltaKm,
            latitude: shouldPreferCanonical ? canonicalLat : resolvedPad.latitude,
            longitude: shouldPreferCanonical ? canonicalLon : resolvedPad.longitude,
            source: shouldPreferCanonical ? 'll2_pad' : 'public_cache'
          };
        }
      }
    }
  }

  const nowMs = Date.now();
  const eligible = await fetchArEligibleLaunches({ nowMs });
  const isEligible = eligible.some((entry) => entry.launchId === launch.id);
  if (!isEligible) return notFound();

  const { data: trajectory } = await supabase
    .from('launch_trajectory_products')
    .select(TRAJECTORY_CONTRACT_COLUMNS)
    .eq('launch_id', launch.id)
    .maybeSingle();
  const trajectoryContract = buildTrajectoryContract(trajectory);

  const backHref = buildLaunchHref(launch);

  return (
    <ArSession
      launchId={launch.id}
      launchName={launch.name}
      pad={resolvedPad}
      net={launch.net}
      backHref={backHref}
      trajectory={trajectoryContract}
    />
  );
}
