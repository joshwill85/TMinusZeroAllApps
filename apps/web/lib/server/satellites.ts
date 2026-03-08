import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';

export type SatelliteSitemapItem = {
  noradCatId: number;
  satcatUpdatedAt: string | null;
};

export type SatelliteOwnerIndexItem = {
  owner: string;
  satelliteCount: number;
  lastSatcatUpdatedAt: string | null;
};

export type SatellitePreviewItem = {
  noradCatId: number;
  intlDes: string | null;
  name: string | null;
  objectType: string | null;
  owner: string | null;
  satcatUpdatedAt: string | null;
};

export type SatelliteOwnerProfileSatellite = {
  noradCatId: number;
  intlDes: string | null;
  name: string | null;
  objectType: string | null;
  satcatUpdatedAt: string | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
};

export type SatelliteOwnerProfileLaunch = {
  launchId: string;
  launchName: string | null;
  launchSlug: string | null;
  launchNet: string | null;
  launchProvider: string | null;
  launchVehicle: string | null;
};

export type SatelliteOwnerProfile = {
  owner: string;
  ownerSatelliteCount: number;
  lastSatcatUpdatedAt: string | null;
  typeCounts: {
    PAY: number;
    RB: number;
    DEB: number;
    UNK: number;
  };
  satellites: SatelliteOwnerProfileSatellite[];
  relatedLaunches: SatelliteOwnerProfileLaunch[];
};

type SatelliteSitemapRpcRow = {
  norad_cat_id?: number | null;
  satcat_updated_at?: string | null;
};

type SatelliteOwnerIndexRpcRow = {
  owner?: string | null;
  satellite_count?: number | null;
  last_satcat_updated_at?: string | null;
};

type SatellitePreviewRpcRow = {
  norad_cat_id?: number | null;
  intl_des?: string | null;
  object_name?: string | null;
  object_type?: string | null;
  owner?: string | null;
  satcat_updated_at?: string | null;
};

type SatelliteOwnerProfileRpc = {
  owner?: string | null;
  owner_satellite_count?: number | null;
  last_satcat_updated_at?: string | null;
  type_counts?: {
    PAY?: number | null;
    RB?: number | null;
    DEB?: number | null;
    UNK?: number | null;
  } | null;
  satellites?: Array<{
    norad_cat_id?: number | null;
    intl_des?: string | null;
    name?: string | null;
    object_type?: string | null;
    satcat_updated_at?: string | null;
    apogee_km?: number | null;
    perigee_km?: number | null;
    inclination_deg?: number | null;
  }> | null;
  related_launches?: Array<{
    launch_id?: string | null;
    launch_name?: string | null;
    launch_slug?: string | null;
    launch_net?: string | null;
    launch_provider?: string | null;
    launch_vehicle?: string | null;
  }> | null;
};

export const fetchSatelliteSitemapBatch = cache(async (limit: number, offset: number): Promise<SatelliteSitemapItem[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc('get_satellite_sitemap_batch_v1', {
    limit_in: limit,
    offset_in: offset
  });
  if (error || data == null) return [];
  const rows = parseRpcArray<SatelliteSitemapRpcRow>(data);
  return rows
    .map((row) => {
      const norad = typeof row.norad_cat_id === 'number' ? row.norad_cat_id : Number.NaN;
      if (!Number.isFinite(norad) || norad <= 0) return null;
      return {
        noradCatId: Math.trunc(norad),
        satcatUpdatedAt: typeof row.satcat_updated_at === 'string' ? row.satcat_updated_at : null
      } satisfies SatelliteSitemapItem;
    })
    .filter((item): item is SatelliteSitemapItem => item != null);
});

export const fetchSatelliteOwnerIndexBatch = cache(async (limit: number, offset: number): Promise<SatelliteOwnerIndexItem[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc('get_satellite_owner_index_v1', {
    limit_in: limit,
    offset_in: offset
  });
  if (error || data == null) return [];
  const rows = parseRpcArray<SatelliteOwnerIndexRpcRow>(data);
  return rows
    .map((row) => {
      const owner = typeof row.owner === 'string' ? row.owner.trim().toUpperCase() : '';
      if (!owner) return null;
      return {
        owner,
        satelliteCount: typeof row.satellite_count === 'number' ? Math.max(0, Math.trunc(row.satellite_count)) : 0,
        lastSatcatUpdatedAt: typeof row.last_satcat_updated_at === 'string' ? row.last_satcat_updated_at : null
      } satisfies SatelliteOwnerIndexItem;
    })
    .filter((item): item is SatelliteOwnerIndexItem => item != null);
});

export const fetchSatellitePreviewBatch = cache(async (limit: number, offset: number): Promise<SatellitePreviewItem[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc('get_satellite_preview_batch_v1', {
    limit_in: limit,
    offset_in: offset
  });
  if (error || data == null) return [];
  const rows = parseRpcArray<SatellitePreviewRpcRow>(data);
  return rows
    .map((row) => {
      const norad = typeof row.norad_cat_id === 'number' ? row.norad_cat_id : Number.NaN;
      if (!Number.isFinite(norad) || norad <= 0) return null;
      return {
        noradCatId: Math.trunc(norad),
        intlDes: typeof row.intl_des === 'string' ? row.intl_des : null,
        name: typeof row.object_name === 'string' ? row.object_name : null,
        objectType: typeof row.object_type === 'string' ? row.object_type : null,
        owner: typeof row.owner === 'string' ? row.owner : null,
        satcatUpdatedAt: typeof row.satcat_updated_at === 'string' ? row.satcat_updated_at : null
      } satisfies SatellitePreviewItem;
    })
    .filter((item): item is SatellitePreviewItem => item != null);
});

export const fetchAllSatelliteOwners = cache(async (): Promise<SatelliteOwnerIndexItem[]> => {
  const pageSize = 500;
  const output: SatelliteOwnerIndexItem[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const batch = await fetchSatelliteOwnerIndexBatch(pageSize, offset);
    if (batch.length === 0) break;
    output.push(...batch);
    if (batch.length < pageSize) break;
  }
  return output;
});

export const fetchSatelliteOwnerProfile = cache(
  async (
    ownerCode: string,
    options?: {
      satellitesLimit?: number;
      satellitesOffset?: number;
      launchesLimit?: number;
    }
  ): Promise<SatelliteOwnerProfile | null> => {
    if (!isSupabaseConfigured()) return null;
    const supabase = createSupabasePublicClient();
    const satellitesLimit = clampInt(options?.satellitesLimit, 1, 200, 30);
    const satellitesOffset = clampInt(options?.satellitesOffset, 0, 20000, 0);
    const launchesLimit = clampInt(options?.launchesLimit, 1, 60, 20);

    const { data, error } = await supabase.rpc('get_satellite_owner_profile_v1', {
      owner_in: ownerCode,
      satellites_limit: satellitesLimit,
      satellites_offset: satellitesOffset,
      launches_limit: launchesLimit
    });
    if (error || data == null) return null;
    const payload = parseRpcObject<SatelliteOwnerProfileRpc>(data);
    if (!payload) return null;

    const owner = typeof payload.owner === 'string' ? payload.owner.trim().toUpperCase() : '';
    if (!owner) return null;

    const satellites = Array.isArray(payload.satellites)
      ? payload.satellites
          .map((entry) => {
            const norad = typeof entry?.norad_cat_id === 'number' ? entry.norad_cat_id : Number.NaN;
            if (!Number.isFinite(norad) || norad <= 0) return null;
            return {
              noradCatId: Math.trunc(norad),
              intlDes: typeof entry?.intl_des === 'string' ? entry.intl_des : null,
              name: typeof entry?.name === 'string' ? entry.name : null,
              objectType: typeof entry?.object_type === 'string' ? entry.object_type : null,
              satcatUpdatedAt: typeof entry?.satcat_updated_at === 'string' ? entry.satcat_updated_at : null,
              apogeeKm: typeof entry?.apogee_km === 'number' ? entry.apogee_km : null,
              perigeeKm: typeof entry?.perigee_km === 'number' ? entry.perigee_km : null,
              inclinationDeg: typeof entry?.inclination_deg === 'number' ? entry.inclination_deg : null
            } satisfies SatelliteOwnerProfileSatellite;
          })
          .filter((item): item is SatelliteOwnerProfileSatellite => item != null)
      : [];

    const relatedLaunches = Array.isArray(payload.related_launches)
      ? payload.related_launches
          .map((entry) => {
            const launchId = typeof entry?.launch_id === 'string' ? entry.launch_id : '';
            if (!launchId) return null;
            return {
              launchId,
              launchName: typeof entry?.launch_name === 'string' ? entry.launch_name : null,
              launchSlug: typeof entry?.launch_slug === 'string' ? entry.launch_slug : null,
              launchNet: typeof entry?.launch_net === 'string' ? entry.launch_net : null,
              launchProvider: typeof entry?.launch_provider === 'string' ? entry.launch_provider : null,
              launchVehicle: typeof entry?.launch_vehicle === 'string' ? entry.launch_vehicle : null
            } satisfies SatelliteOwnerProfileLaunch;
          })
          .filter((item): item is SatelliteOwnerProfileLaunch => item != null)
      : [];

    return {
      owner,
      ownerSatelliteCount:
        typeof payload.owner_satellite_count === 'number' ? Math.max(0, Math.trunc(payload.owner_satellite_count)) : satellites.length,
      lastSatcatUpdatedAt: typeof payload.last_satcat_updated_at === 'string' ? payload.last_satcat_updated_at : null,
      typeCounts: {
        PAY: numberOrZero(payload.type_counts?.PAY),
        RB: numberOrZero(payload.type_counts?.RB),
        DEB: numberOrZero(payload.type_counts?.DEB),
        UNK: numberOrZero(payload.type_counts?.UNK)
      },
      satellites,
      relatedLaunches
    } satisfies SatelliteOwnerProfile;
  }
);

export const fetchLaunchByDesignator = cache(
  async (
    launchDesignator: string
  ): Promise<{
    launchId: string;
    name: string;
    slug: string | null;
    net: string | null;
    provider: string | null;
    vehicle: string | null;
  } | null> => {
    if (!launchDesignator) return null;
    if (!isSupabaseConfigured()) return null;
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,slug,net,provider,vehicle')
      .eq('launch_designator', launchDesignator)
      .maybeSingle();
    if (error || !data || !data.launch_id) return null;
    return {
      launchId: String(data.launch_id),
      name: typeof data.name === 'string' ? data.name : 'Launch',
      slug: typeof data.slug === 'string' ? data.slug : null,
      net: typeof data.net === 'string' ? data.net : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
      vehicle: typeof data.vehicle === 'string' ? data.vehicle : null
    };
  }
);

export function intlDesToLaunchDesignator(value: string | null | undefined) {
  const intlDes = String(value || '').trim().toUpperCase();
  if (!intlDes) return null;
  const designator = intlDes.replace(/[A-Z]+$/g, '');
  return /^\d{4}-\d{3}$/.test(designator) ? designator : null;
}

function parseRpcArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseRpcObject<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as T;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function numberOrZero(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clampInt(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
