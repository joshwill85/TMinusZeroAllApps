import {
  satelliteDetailSchemaV1,
  satelliteOwnerProfileSchemaV1,
  satelliteOwnersResponseSchemaV1,
  satellitesResponseSchemaV1
} from '@tminuszero/contracts';
import { fetchLaunchByDesignator, fetchSatelliteOwnerIndexBatch, fetchSatelliteOwnerProfile, fetchSatellitePreviewBatch, intlDesToLaunchDesignator } from '@/lib/server/satellites';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildSatelliteHref, buildSatelliteOwnerHref, formatSatelliteOwnerLabel, normalizeSatelliteOwnerCode, parseSatelliteOwnerParam } from '@/lib/utils/satelliteLinks';

type SatelliteDetailRpc = {
  norad_cat_id?: number | null;
  intl_des?: string | null;
  name?: string | null;
  object_type?: string | null;
  ops_status_code?: string | null;
  owner?: string | null;
  launch_date?: string | null;
  launch_site?: string | null;
  decay_date?: string | null;
  period_min?: number | null;
  inclination_deg?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  rcs_m2?: number | null;
  satcat_updated_at?: string | null;
  groups?: string[] | null;
  orbit?: {
    source?: string | null;
    epoch?: string | null;
    inclination_deg?: number | null;
    raan_deg?: number | null;
    eccentricity?: number | null;
    arg_perigee_deg?: number | null;
    mean_anomaly_deg?: number | null;
    mean_motion_rev_per_day?: number | null;
    bstar?: number | null;
    fetched_at?: string | null;
  } | null;
};

export function normalizeSatelliteNoradParam(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!/^[0-9]{1,9}$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

export async function loadSatellitesPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), 60, 1, 200);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);
  const topOwnerLimit = clampInt(searchParams.get('top_owner_limit'), 24, 1, 120);

  const [items, owners] = await Promise.all([
    fetchSatellitePreviewBatch(limit, offset),
    fetchSatelliteOwnerIndexBatch(topOwnerLimit, 0)
  ]);

  return satellitesResponseSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Satellite Catalog',
    description: 'Browse NORAD satellite records, owner hubs, and launch associations.',
    items: items.map((satellite) => {
      const ownerCode = normalizeSatelliteOwnerCode(satellite.owner);
      return {
        noradCatId: satellite.noradCatId,
        intlDes: satellite.intlDes,
        name: satellite.name,
        objectType: satellite.objectType,
        ownerCode,
        ownerLabel: formatSatelliteOwnerLabel(ownerCode),
        ownerHref: ownerCode ? buildSatelliteOwnerHref(ownerCode) : null,
        satcatUpdatedAt: satellite.satcatUpdatedAt,
        href: buildSatelliteHref(satellite.noradCatId)
      };
    }),
    topOwners: owners.map((owner) => {
      const normalized = normalizeSatelliteOwnerCode(owner.owner);
      return {
        ownerCode: normalized || owner.owner,
        ownerLabel: formatSatelliteOwnerLabel(normalized) || owner.owner,
        href: normalized ? buildSatelliteOwnerHref(normalized) || `/satellites/owners/${encodeURIComponent(normalized.toLowerCase())}` : `/satellites/owners`,
        satelliteCount: owner.satelliteCount,
        lastSatcatUpdatedAt: owner.lastSatcatUpdatedAt
      };
    })
  });
}

export async function loadSatelliteOwnersPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), 60, 1, 500);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);
  const owners = await fetchSatelliteOwnerIndexBatch(limit, offset);
  return satelliteOwnersResponseSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Satellite Owners',
    description: 'Owner-code index for NORAD satellite objects and related launch associations.',
    items: owners.map((owner) => {
      const normalized = normalizeSatelliteOwnerCode(owner.owner);
      return {
        ownerCode: normalized || owner.owner,
        ownerLabel: formatSatelliteOwnerLabel(normalized) || owner.owner,
        href: normalized ? buildSatelliteOwnerHref(normalized) || `/satellites/owners/${encodeURIComponent(normalized.toLowerCase())}` : `/satellites/owners`,
        satelliteCount: owner.satelliteCount,
        lastSatcatUpdatedAt: owner.lastSatcatUpdatedAt
      };
    })
  });
}

export async function loadSatelliteDetailPayload(noradCatId: number) {
  const sat = await fetchSatelliteDetail(noradCatId);
  if (!sat) return null;

  const ownerCode = normalizeSatelliteOwnerCode(sat.owner);
  const launchDesignator = intlDesToLaunchDesignator(sat.intl_des);
  const relatedLaunch = launchDesignator ? await fetchLaunchByDesignator(launchDesignator) : null;

  return satelliteDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: sat.name || `NORAD ${noradCatId}`,
    description: buildSatelliteDescription(sat, relatedLaunch?.name ?? null),
    satellite: {
      noradCatId: sat.norad_cat_id ?? noradCatId,
      intlDes: sat.intl_des ?? null,
      name: sat.name ?? null,
      objectType: sat.object_type ?? null,
      opsStatusCode: sat.ops_status_code ?? null,
      ownerCode,
      ownerLabel: formatSatelliteOwnerLabel(ownerCode),
      ownerHref: ownerCode ? buildSatelliteOwnerHref(ownerCode) : null,
      launchDate: sat.launch_date ?? null,
      launchSite: sat.launch_site ?? null,
      decayDate: sat.decay_date ?? null,
      periodMinutes: sat.period_min ?? null,
      inclinationDeg: sat.inclination_deg ?? null,
      apogeeKm: sat.apogee_km ?? null,
      perigeeKm: sat.perigee_km ?? null,
      rcsM2: sat.rcs_m2 ?? null,
      satcatUpdatedAt: sat.satcat_updated_at ?? null,
      groups: Array.isArray(sat.groups) ? sat.groups.filter((group): group is string => typeof group === 'string') : [],
      orbit: sat.orbit
        ? {
            source: sat.orbit.source ?? null,
            epoch: sat.orbit.epoch ?? null,
            inclinationDeg: sat.orbit.inclination_deg ?? null,
            raanDeg: sat.orbit.raan_deg ?? null,
            eccentricity: sat.orbit.eccentricity ?? null,
            argPerigeeDeg: sat.orbit.arg_perigee_deg ?? null,
            meanAnomalyDeg: sat.orbit.mean_anomaly_deg ?? null,
            meanMotionRevPerDay: sat.orbit.mean_motion_rev_per_day ?? null,
            bstar: sat.orbit.bstar ?? null,
            fetchedAt: sat.orbit.fetched_at ?? null
          }
        : null
    },
    relatedLaunch: relatedLaunch
      ? {
          id: relatedLaunch.launchId,
          name: relatedLaunch.name,
          provider: relatedLaunch.provider,
          vehicle: relatedLaunch.vehicle,
          net: relatedLaunch.net,
          netPrecision: null,
          status: null,
          statusText: null,
          href: buildLaunchHref({
            id: relatedLaunch.launchId,
            name: relatedLaunch.name,
            slug: relatedLaunch.slug || undefined
          })
        }
      : null
  });
}

export async function loadSatelliteOwnerPayload(ownerParam: string) {
  const owner = parseSatelliteOwnerParam(ownerParam);
  if (!owner) return null;

  const profile = await fetchSatelliteOwnerProfile(owner, {
    satellitesLimit: 120,
    satellitesOffset: 0,
    launchesLimit: 40
  });
  if (!profile) return null;

  return satelliteOwnerProfileSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: formatSatelliteOwnerLabel(profile.owner) || profile.owner,
    description: `${formatSatelliteOwnerLabel(profile.owner) || profile.owner} satellite profile with ${profile.ownerSatelliteCount} catalog object${profile.ownerSatelliteCount === 1 ? '' : 's'}.`,
    profile: {
      ownerCode: profile.owner,
      ownerLabel: formatSatelliteOwnerLabel(profile.owner) || profile.owner,
      ownerHref: buildSatelliteOwnerHref(profile.owner) || `/satellites/owners/${encodeURIComponent(profile.owner.toLowerCase())}`,
      ownerSatelliteCount: profile.ownerSatelliteCount,
      lastSatcatUpdatedAt: profile.lastSatcatUpdatedAt,
      typeCounts: profile.typeCounts
    },
    relatedLaunches: profile.relatedLaunches.map((launch) => ({
      id: launch.launchId,
      name: launch.launchName || 'Launch',
      provider: launch.launchProvider,
      vehicle: launch.launchVehicle,
      net: launch.launchNet,
      netPrecision: null,
      status: null,
      statusText: null,
      href: buildLaunchHref({
        id: launch.launchId,
        name: launch.launchName || 'Launch',
        slug: launch.launchSlug || undefined
      })
    })),
    satellites: profile.satellites.map((satellite) => {
      const ownerCode = normalizeSatelliteOwnerCode(profile.owner);
      return {
        noradCatId: satellite.noradCatId,
        intlDes: satellite.intlDes,
        name: satellite.name,
        objectType: satellite.objectType,
        ownerCode,
        ownerLabel: formatSatelliteOwnerLabel(ownerCode),
        ownerHref: ownerCode ? buildSatelliteOwnerHref(ownerCode) : null,
        satcatUpdatedAt: satellite.satcatUpdatedAt,
        href: buildSatelliteHref(satellite.noradCatId),
        apogeeKm: satellite.apogeeKm,
        perigeeKm: satellite.perigeeKm,
        inclinationDeg: satellite.inclinationDeg
      };
    })
  });
}

async function fetchSatelliteDetail(noradCatId: number): Promise<SatelliteDetailRpc | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_satellite_detail', { norad_cat_id_in: noradCatId });
  if (error || data == null) return null;

  const payload = parseRpcObject<SatelliteDetailRpc>(data);
  if (!payload || payload.norad_cat_id == null) return null;
  return payload;
}

function buildSatelliteDescription(sat: SatelliteDetailRpc, launchName: string | null) {
  const parts = [
    sat.intl_des ? `International designator ${sat.intl_des}.` : null,
    sat.owner ? `Owner ${sat.owner}.` : null,
    sat.object_type ? `Object type ${sat.object_type}.` : null,
    launchName ? `Associated launch ${launchName}.` : null
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Satellite catalog entry.';
}

function parseRpcObject<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as T;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
