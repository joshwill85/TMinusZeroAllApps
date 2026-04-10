import crypto from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { getGoogleMapsStaticApiKey, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { buildGoogleMapsStaticSatelliteUrl } from '@/lib/utils/googleMaps';
import { consumeGoogleMapsBudget } from '@/lib/server/mapBudget';

const PAD_PREVIEW_PROVIDER = 'google_static_maps';
const PAD_PREVIEW_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;
const PAD_PREVIEW_CACHE_STALE_SECONDS = 7 * 24 * 60 * 60;
const PAD_PREVIEW_HARD_EXPIRY_DAYS = 30;
const PAD_PREVIEW_SOFT_REFRESH_MIN_DAYS = 21;
const PAD_PREVIEW_SOFT_REFRESH_SPREAD_DAYS = 8;

type PadCoordinateRow = {
  ll2_pad_id?: number | null;
  pad_latitude?: number | null;
  pad_longitude?: number | null;
};

type PadPreviewTarget = {
  launchId: string | null;
  ll2PadId: number | null;
  latitude: number;
  longitude: number;
};

type PadPreviewCacheRow = {
  pad_key: string;
  ll2_pad_id?: number | null;
  launch_id?: string | null;
  content_type: string;
  image_base64: string;
  byte_size: number;
  content_sha256: string;
  fetched_at: string;
  soft_refresh_at: string;
  hard_expire_at: string;
  last_accessed_at?: string | null;
};

function normalizeCoordinate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildPadCacheKey(target: { launchId?: string | null; ll2PadId?: number | null; latitude: number; longitude: number }) {
  if (typeof target.ll2PadId === 'number' && Number.isInteger(target.ll2PadId) && target.ll2PadId > 0) {
    return `ll2:${target.ll2PadId}`;
  }

  const latitude = target.latitude.toFixed(5);
  const longitude = target.longitude.toFixed(5);
  return target.launchId ? `coord:${latitude}:${longitude}` : `coord:${latitude}:${longitude}`;
}

function computeRefreshWindows(padKey: string, fetchedAt = new Date()) {
  const digest = crypto.createHash('sha256').update(padKey).digest();
  const offsetDays = digest[0] % PAD_PREVIEW_SOFT_REFRESH_SPREAD_DAYS;
  const softRefreshAt = new Date(fetchedAt.getTime() + (PAD_PREVIEW_SOFT_REFRESH_MIN_DAYS + offsetDays) * 24 * 60 * 60 * 1000);
  const hardExpireAt = new Date(fetchedAt.getTime() + PAD_PREVIEW_HARD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return {
    softRefreshAt,
    hardExpireAt
  };
}

function buildImageHeaders(row: PadPreviewCacheRow, now = Date.now()) {
  const hardExpireAtMs = Date.parse(row.hard_expire_at);
  const secondsUntilHardExpiry = Number.isFinite(hardExpireAtMs)
    ? Math.max(60, Math.min(PAD_PREVIEW_CACHE_MAX_AGE_SECONDS, Math.floor((hardExpireAtMs - now) / 1000)))
    : PAD_PREVIEW_CACHE_MAX_AGE_SECONDS;
  const headers = new Headers();
  headers.set('Content-Type', row.content_type);
  headers.set('Content-Length', String(row.byte_size));
  headers.set('Cache-Control', `public, max-age=${secondsUntilHardExpiry}, stale-while-revalidate=${PAD_PREVIEW_CACHE_STALE_SECONDS}`);
  headers.set('X-Robots-Tag', 'noindex, noimageindex');
  return headers;
}

function notFound() {
  return new Response(null, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

function unavailable(status = 503) {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

async function readUpstreamErrorDetail(response: Response) {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 240) || null;
  } catch {
    return null;
  }
}

async function loadPadPreviewTargetByLaunchId(launchId: string): Promise<PadPreviewTarget | null> {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data: cachedRow } = await admin
    .from('launches_public_cache')
    .select('ll2_pad_id,pad_latitude,pad_longitude')
    .eq('launch_id', launchId)
    .maybeSingle();

  const targetFromCached = normalizePadPreviewTarget(cachedRow, launchId);
  if (targetFromCached) {
    return targetFromCached;
  }

  const { data: liveRow } = await admin
    .from('launches')
    .select('ll2_pad_id,pad_latitude,pad_longitude')
    .eq('id', launchId)
    .eq('hidden', false)
    .maybeSingle();

  return normalizePadPreviewTarget(liveRow, launchId);
}

async function loadPadPreviewTargetByLl2PadId(ll2PadId: number): Promise<PadPreviewTarget | null> {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('ll2_pads')
    .select('ll2_pad_id,latitude,longitude')
    .eq('ll2_pad_id', ll2PadId)
    .maybeSingle();

  const latitude = normalizeCoordinate(data?.latitude ?? null);
  const longitude = normalizeCoordinate(data?.longitude ?? null);
  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    launchId: null,
    ll2PadId,
    latitude,
    longitude
  };
}

function normalizePadPreviewTarget(row: PadCoordinateRow | null | undefined, launchId: string | null) {
  const latitude = normalizeCoordinate(row?.pad_latitude ?? null);
  const longitude = normalizeCoordinate(row?.pad_longitude ?? null);
  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    launchId,
    ll2PadId: typeof row?.ll2_pad_id === 'number' && Number.isInteger(row.ll2_pad_id) ? row.ll2_pad_id : null,
    latitude,
    longitude
  } satisfies PadPreviewTarget;
}

async function loadCachedPadPreview(padKey: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('launch_pad_preview_cache')
    .select('pad_key,ll2_pad_id,launch_id,content_type,image_base64,byte_size,content_sha256,fetched_at,soft_refresh_at,hard_expire_at,last_accessed_at')
    .eq('pad_key', padKey)
    .maybeSingle();

  if (error) {
    console.error('pad preview cache lookup failed', { padKey, error });
    return null;
  }

  return (data as PadPreviewCacheRow | null) ?? null;
}

async function writeCachedPadPreview(target: PadPreviewTarget, row: PadPreviewCacheRow) {
  const admin = createSupabaseAdminClient();
  const payload = {
    pad_key: row.pad_key,
    ll2_pad_id: target.ll2PadId,
    launch_id: target.launchId,
    provider: PAD_PREVIEW_PROVIDER,
    source_latitude: target.latitude,
    source_longitude: target.longitude,
    content_type: row.content_type,
    image_base64: row.image_base64,
    byte_size: row.byte_size,
    content_sha256: row.content_sha256,
    fetched_at: row.fetched_at,
    soft_refresh_at: row.soft_refresh_at,
    hard_expire_at: row.hard_expire_at,
    last_accessed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { error } = await admin.from('launch_pad_preview_cache').upsert(payload, { onConflict: 'pad_key' });
  if (error) {
    console.error('pad preview cache write failed', { padKey: row.pad_key, error });
  }
}

async function touchCachedPadPreview(padKey: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('launch_pad_preview_cache')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('pad_key', padKey);

  if (error) {
    console.error('pad preview cache touch failed', { padKey, error });
  }
}

async function fetchAndCachePadPreview(target: PadPreviewTarget, padKey: string, reason: 'cold' | 'refresh' | 'expired') {
  const googleMapsStaticApiKey = getGoogleMapsStaticApiKey();
  if (!googleMapsStaticApiKey) {
    return null;
  }

  const targetUrl = buildGoogleMapsStaticSatelliteUrl(
    {
      latitude: target.latitude,
      longitude: target.longitude
    },
    googleMapsStaticApiKey,
    {
      zoom: 18,
      width: 640,
      height: 360,
      scale: 2
    }
  );

  if (!targetUrl) {
    return null;
  }

  const budgetAllowed = await consumeGoogleMapsBudget('google_static_maps');
  if (!budgetAllowed) {
    console.info('pad satellite preview budget denied', { padKey, reason });
    return null;
  }

  const upstream = await fetch(targetUrl, {
    headers: {
      Accept: 'image/*'
    }
  });

  if (!upstream.ok || !upstream.body) {
    const detail = upstream.ok ? null : await readUpstreamErrorDetail(upstream);
    console.warn('pad satellite preview upstream failed', {
      padKey,
      reason,
      status: upstream.status,
      hasBody: Boolean(upstream.body),
      detail
    });
    return null;
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const fetchedAt = new Date();
  const { softRefreshAt, hardExpireAt } = computeRefreshWindows(padKey, fetchedAt);
  const row: PadPreviewCacheRow = {
    pad_key: padKey,
    ll2_pad_id: target.ll2PadId,
    launch_id: target.launchId,
    content_type: (upstream.headers.get('content-type') || 'image/jpeg').split(';')[0].trim(),
    image_base64: bytes.toString('base64'),
    byte_size: bytes.byteLength,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    fetched_at: fetchedAt.toISOString(),
    soft_refresh_at: softRefreshAt.toISOString(),
    hard_expire_at: hardExpireAt.toISOString(),
    last_accessed_at: fetchedAt.toISOString()
  };

  await writeCachedPadPreview(target, row);
  console.info('pad satellite preview upstream fetched', { padKey, reason, byteSize: row.byte_size });
  return row;
}

function buildImageResponse(row: PadPreviewCacheRow) {
  return new Response(Buffer.from(row.image_base64, 'base64'), {
    status: 200,
    headers: buildImageHeaders(row)
  });
}

export async function respondWithPadSatellitePreviewByLaunchId(launchId: string) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return unavailable();
  }

  const target = await loadPadPreviewTargetByLaunchId(launchId);
  if (!target) {
    return notFound();
  }

  return respondWithPadSatellitePreviewTarget(target);
}

export async function respondWithPadSatellitePreviewByLl2PadId(ll2PadId: number) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return unavailable();
  }

  const target = await loadPadPreviewTargetByLl2PadId(ll2PadId);
  if (!target) {
    return notFound();
  }

  return respondWithPadSatellitePreviewTarget(target);
}

async function respondWithPadSatellitePreviewTarget(target: PadPreviewTarget) {
  const padKey = buildPadCacheKey(target);
  const cached = await loadCachedPadPreview(padKey);
  const nowMs = Date.now();

  if (cached) {
    void touchCachedPadPreview(padKey);

    const hardExpireAtMs = Date.parse(cached.hard_expire_at);
    const softRefreshAtMs = Date.parse(cached.soft_refresh_at);
    const hardExpired = Number.isFinite(hardExpireAtMs) ? hardExpireAtMs <= nowMs : true;
    const shouldRefresh = !hardExpired && Number.isFinite(softRefreshAtMs) && softRefreshAtMs <= nowMs;

    if (!hardExpired && !shouldRefresh) {
      console.info('pad satellite preview cache hit', { padKey, status: 'fresh' });
      return buildImageResponse(cached);
    }

    if (shouldRefresh) {
      const refreshed = await fetchAndCachePadPreview(target, padKey, 'refresh');
      if (refreshed) {
        return buildImageResponse(refreshed);
      }

      console.info('pad satellite preview cache hit', { padKey, status: 'stale_within_window' });
      return buildImageResponse(cached);
    }
  }

  const fetched = await fetchAndCachePadPreview(target, padKey, cached ? 'expired' : 'cold');
  if (!fetched) {
    return cached ? unavailable() : unavailable();
  }

  return buildImageResponse(fetched);
}
