import { createApiClient } from '@tminuszero/api-client';
import {
  entitlementSchemaV1,
  filterPresetsSchemaV1,
  launchDetailSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  notificationPreferencesSchemaV1,
  profileSchemaV1,
  pushDeviceRegistrationSchemaV1,
  searchResponseSchemaV1,
  viewerSessionSchemaV1,
  watchlistsSchemaV1
} from '@tminuszero/contracts';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import { fetchLaunchFaaAirspace } from '@/lib/server/faaAirspace';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { fetchLaunchDetailEnrichment } from '@/lib/server/launchDetailEnrichment';
import { parseSiteSearchInput, parseSiteSearchTypesParam, type SearchResultType } from '@/lib/search/shared';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabasePublicClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';

type PrivilegedClient =
  | ReturnType<typeof createSupabaseAccessTokenClient>
  | ReturnType<typeof createSupabaseAdminClient>
  | ReturnType<typeof createSupabaseServerClient>;

type SearchRpcRow = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  subtitle?: unknown;
  summary?: unknown;
  url?: unknown;
  image_url?: unknown;
  published_at?: unknown;
  badge?: unknown;
};

type RelatedNewsRow = {
  snapi_uid?: string | null;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  news_site?: string | null;
  image_url?: string | null;
  published_at?: string | null;
};

type RelatedEventRow = {
  ll2_event_id?: number | null;
  name?: string | null;
  description?: string | null;
  type_name?: string | null;
  date?: string | null;
  location_name?: string | null;
  url?: string | null;
  image_url?: string | null;
};

const DEFAULT_FEED_FRESHNESS = 'public-cache-db';
const DEFAULT_FEED_INTERVAL_MINUTES = 15;

const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: false,
  emailEnabled: true,
  smsEnabled: false,
  launchDayEmailEnabled: false,
  quietHoursEnabled: false,
  quietStartLocal: null,
  quietEndLocal: null,
  smsVerified: false,
  smsPhone: null
};

const DEFAULT_LAUNCH_NOTIFICATION_PREFERENCE = {
  enabled: false,
  preference: {
    launchId: '',
    channel: 'push' as const,
    mode: 't_minus' as const,
    timezone: 'UTC',
    tMinusMinutes: [],
    localTimes: [],
    notifyStatusChange: false,
    notifyNetChange: false
  }
};

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function sortByPublishedAtDesc<T extends { publishedAt: string | null }>(items: T[]) {
  return items.sort((left, right) => {
    const leftMs = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
    const rightMs = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
    return rightMs - leftMs;
  });
}

function mapLaunchCardPayload(launch: ReturnType<typeof mapPublicCacheRow>) {
  return {
    id: launch.id,
    slug: launch.slug ?? null,
    name: launch.name,
    net: launch.net ?? null,
    status: launch.statusText ?? null,
    provider: launch.provider ?? null,
    imageUrl: launch.image.full || launch.image.thumbnail || null
  };
}

function buildWeatherSummary(launch: ReturnType<typeof mapPublicCacheRow>) {
  if (!Array.isArray(launch.weatherConcerns) || launch.weatherConcerns.length === 0) {
    return null;
  }
  return launch.weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean).join(' • ') || null;
}

function getPrivilegedClient(session: ResolvedViewerSession): PrivilegedClient | null {
  if (isSupabaseAdminConfigured()) {
    return createSupabaseAdminClient();
  }

  if (session.authMode === 'bearer' && session.accessToken) {
    return createSupabaseAccessTokenClient(session.accessToken);
  }

  if (session.authMode === 'cookie') {
    return createSupabaseServerClient();
  }

  return null;
}

async function loadRelatedLaunchResults(launchId: string) {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const [newsJoinRes, eventJoinRes] = await Promise.all([
    supabase.from('snapi_item_launches').select('snapi_uid').eq('launch_id', launchId),
    supabase.from('ll2_event_launches').select('ll2_event_id').eq('launch_id', launchId)
  ]);

  if (newsJoinRes.error) throw newsJoinRes.error;
  if (eventJoinRes.error) throw eventJoinRes.error;

  const newsIds = Array.from(new Set((newsJoinRes.data || []).map((row: any) => normalizeText(row.snapi_uid)).filter(Boolean)));
  const eventIds = Array.from(new Set((eventJoinRes.data || []).map((row: any) => row.ll2_event_id).filter((value) => Number.isFinite(value))));

  const [newsRes, eventRes] = await Promise.all([
    newsIds.length
      ? supabase
          .from('snapi_items')
          .select('snapi_uid, title, summary, url, news_site, image_url, published_at')
          .in('snapi_uid', newsIds)
          .order('published_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? supabase
          .from('ll2_events')
          .select('ll2_event_id, name, description, type_name, date, location_name, url, image_url')
          .in('ll2_event_id', eventIds)
          .limit(8)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (newsRes.error) throw newsRes.error;
  if (eventRes.error) throw eventRes.error;

  const newsResults = ((newsRes.data || []) as RelatedNewsRow[]).map((row) => ({
    id: String(row.snapi_uid || ''),
    type: 'news',
    title: String(row.title || 'Untitled article'),
    subtitle: normalizeText(row.news_site),
    summary: normalizeText(row.summary),
    href: String(row.url || '/news'),
    imageUrl: normalizeText(row.image_url),
    badge: 'News',
    publishedAt: normalizeText(row.published_at)
  }));

  const eventResults = ((eventRes.data || []) as RelatedEventRow[]).map((row) => ({
    id: String(row.ll2_event_id || ''),
    type: 'page',
    title: String(row.name || 'Related event'),
    subtitle: [normalizeText(row.type_name), normalizeText(row.location_name)].filter(Boolean).join(' • ') || null,
    summary: normalizeText(row.description),
    href: String(row.url || '/'),
    imageUrl: normalizeText(row.image_url),
    badge: 'Event',
    publishedAt: normalizeText(row.date)
  }));

  return sortByPublishedAtDesc([...newsResults, ...eventResults]).slice(0, 10);
}

export async function buildViewerSessionPayload(session: ResolvedViewerSession) {
  return viewerSessionSchemaV1.parse({
    viewerId: session.userId,
    email: session.email,
    role: session.role,
    accessToken: session.authMode === 'bearer' ? session.accessToken : null,
    expiresAt: session.expiresAt,
    authMode: session.authMode
  });
}

export async function buildViewerEntitlementPayload(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  return entitlementSchemaV1.parse({
    tier: entitlement.tier,
    status: entitlement.status,
    source: entitlement.source,
    isPaid: entitlement.isPaid,
    isAdmin: entitlement.isAdmin,
    isAuthed: entitlement.isAuthed,
    mode: entitlement.mode,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    stripePriceId: entitlement.stripePriceId,
    reconciled: entitlement.reconciled,
    reconcileThrottled: entitlement.reconcileThrottled
  });
}

export async function loadLaunchFeedPayload(request: Request) {
  if (!isSupabaseConfigured()) {
    return launchFeedSchemaV1.parse({
      launches: [],
      nextCursor: null,
      hasMore: false,
      freshness: DEFAULT_FEED_FRESHNESS,
      intervalMinutes: DEFAULT_FEED_INTERVAL_MINUTES
    });
  }

  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), 20, 1, 50);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 10_000);
  const region = parseLaunchRegion(searchParams.get('region'));
  const provider = searchParams.get('provider');
  const status = parseLaunchStatusFilter(searchParams.get('status'));
  const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  let query = createSupabasePublicClient()
    .from('launches_public_cache')
    .select('*')
    .gte('net', from)
    .order('net', { ascending: true })
    .range(offset, offset + limit);

  if (region === 'us') {
    query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  } else if (region === 'non-us') {
    query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  }

  if (provider) {
    query = query.eq('provider', provider);
  }

  if (status) {
    const clause = buildStatusFilterOrClause(status);
    if (clause) {
      query = query.or(clause);
    }
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const launches = rows.slice(0, limit).map(mapPublicCacheRow).map(mapLaunchCardPayload);

  return launchFeedSchemaV1.parse({
    launches,
    nextCursor: rows.length > limit ? String(offset + limit) : null,
    hasMore: rows.length > limit,
    freshness: DEFAULT_FEED_FRESHNESS,
    intervalMinutes: DEFAULT_FEED_INTERVAL_MINUTES
  });
}

export async function loadLaunchDetailPayload(id: string, session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(id);
  if (!parsedLaunch) {
    return null;
  }

  const { data, error } = await createSupabasePublicClient()
    .from('launches_public_cache')
    .select('*')
    .eq('launch_id', parsedLaunch.launchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const launch = mapPublicCacheRow(data);
  const [entitlements, related, enrichment, jepScore, faaAirspace] = await Promise.all([
    buildViewerEntitlementPayload(session),
    loadRelatedLaunchResults(launch.id),
    fetchLaunchDetailEnrichment(launch.id, launch.ll2Id),
    fetchLaunchJepScore(launch.id, { viewerIsAdmin: session.role === 'admin' }),
    fetchLaunchFaaAirspace({ launchId: launch.id, limit: 4 })
  ]);

  return launchDetailSchemaV1.parse({
    launch: {
      ...mapLaunchCardPayload(launch),
      mission: launch.mission?.description ?? launch.mission?.name ?? null,
      padName: launch.pad?.name ?? null,
      padLocation: launch.pad?.locationName ?? null,
      windowStart: launch.windowStart ?? null,
      windowEnd: launch.windowEnd ?? null,
      weatherSummary: buildWeatherSummary(launch),
      launchStatusDescription: launch.statusText ?? null,
      rocketName: launch.rocket?.fullName ?? launch.vehicle ?? null
    },
    entitlements,
    related,
    enrichment: {
      firstStageCount: enrichment.firstStages.length,
      recoveryCount: enrichment.recovery.length,
      externalContentCount: enrichment.externalContent.length,
      hasJepScore: Boolean(jepScore),
      faaAdvisoryCount: faaAirspace?.advisories.length ?? 0
    }
  });
}

export async function searchPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = clampInt(searchParams.get('limit'), 8, 1, 25);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000);

  if (!isSupabaseConfigured()) {
    return searchResponseSchemaV1.parse({
      query: String(query || ''),
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const parsed = parseSiteSearchInput(query);
  const requestedTypes = parseSiteSearchTypesParam(searchParams.get('types'));
  const types = [...new Set<SearchResultType>([...parsed.types, ...requestedTypes])];

  if (!parsed.query || !parsed.hasPositiveTerms) {
    return searchResponseSchemaV1.parse({
      query: parsed.query || '',
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const startedAt = Date.now();
  const { data, error } = await createSupabasePublicClient().rpc('search_public_documents', {
    q_in: parsed.query,
    limit_n: limit + 1,
    offset_n: offset,
    types_in: types.length ? types : null
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as SearchRpcRow[]) : [];
  const results = rows.slice(0, limit).map((row) => ({
    id: String(row.id || ''),
    type: String(row.type || 'page'),
    title: String(row.title || ''),
    subtitle: normalizeText(row.subtitle),
    summary: normalizeText(row.summary),
    href: String(row.url || '/search'),
    imageUrl: normalizeText(row.image_url),
    badge: normalizeText(row.badge),
    publishedAt: normalizeText(row.published_at)
  }));

  return searchResponseSchemaV1.parse({
    query: parsed.query,
    results,
    tookMs: Math.max(0, Date.now() - startedAt),
    limit,
    offset,
    hasMore: rows.length > limit
  });
}

export async function loadProfilePayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('user_id, email, role, first_name, last_name, timezone')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const metadata = (session.user?.user_metadata || {}) as Record<string, unknown>;

  return profileSchemaV1.parse({
    viewerId: session.userId,
    email: String(data?.email || session.email || ''),
    role: data?.role ?? null,
    firstName: data?.first_name ?? normalizeText(metadata.first_name),
    lastName: data?.last_name ?? normalizeText(metadata.last_name),
    timezone: data?.timezone ?? null,
    emailConfirmedAt: normalizeText((session.user as any)?.email_confirmed_at)
  });
}

export async function loadWatchlistsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('watchlists')
    .select('id, name, created_at, watchlist_rules(id)')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return watchlistsSchemaV1.parse({
    watchlists: (data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.name || 'Untitled'),
      ruleCount: Array.isArray(row.watchlist_rules) ? row.watchlist_rules.length : 0,
      createdAt: normalizeText(row.created_at)
    }))
  });
}

export async function loadFilterPresetsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('launch_filter_presets')
    .select('id, name, filters, is_default, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return filterPresetsSchemaV1.parse({
    presets: (data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.name || 'Untitled'),
      filters: (row.filters as Record<string, unknown>) || {},
      isDefault: row.is_default === true,
      createdAt: normalizeText(row.created_at),
      updatedAt: normalizeText(row.updated_at)
    }))
  });
}

export async function loadNotificationPreferencesPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('notification_preferences')
    .select(
      'push_enabled, email_enabled, sms_enabled, launch_day_email_enabled, quiet_hours_enabled, quiet_start_local, quiet_end_local, sms_verified, sms_phone_e164'
    )
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return notificationPreferencesSchemaV1.parse({
    pushEnabled: data?.push_enabled === true,
    emailEnabled: data?.email_enabled !== false,
    smsEnabled: data?.sms_enabled === true,
    launchDayEmailEnabled: data?.launch_day_email_enabled === true,
    quietHoursEnabled: data?.quiet_hours_enabled === true,
    quietStartLocal: normalizeText(data?.quiet_start_local),
    quietEndLocal: normalizeText(data?.quiet_end_local),
    smsVerified: data?.sms_verified === true,
    smsPhone: normalizeText(data?.sms_phone_e164)
  });
}

export async function loadLaunchNotificationPreferencePayload(
  session: ResolvedViewerSession,
  launchId: string,
  channel: 'sms' | 'push'
) {
  if (!session.userId) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(launchId);
  if (!parsedLaunch) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('launch_notification_preferences')
    .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .eq('user_id', session.userId)
    .eq('launch_id', parsedLaunch.launchId)
    .eq('channel', channel)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return launchNotificationPreferenceEnvelopeSchemaV1.parse({
    enabled: Boolean(data),
    preference: {
      launchId: parsedLaunch.launchId,
      channel,
      mode: data?.mode === 'local_time' ? 'local_time' : 't_minus',
      timezone: String(data?.timezone || 'UTC'),
      tMinusMinutes: Array.isArray(data?.t_minus_minutes) ? data.t_minus_minutes : [],
      localTimes: Array.isArray(data?.local_times) ? data.local_times : [],
      notifyStatusChange: data?.notify_status_change === true,
      notifyNetChange: data?.notify_net_change === true
    }
  });
}

export async function registerPushDevicePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = pushDeviceRegistrationSchemaV1.parse(await request.json().catch(() => undefined));
  const registeredAt = new Date().toISOString();
  const pushProvider = parsedBody.platform === 'web' ? 'webpush' : 'expo';

  const { data, error } = await client
    .from('notification_push_devices')
    .upsert(
      {
        user_id: session.userId,
        platform: parsedBody.platform,
        token: parsedBody.token,
        push_provider: pushProvider,
        app_version: parsedBody.appVersion,
        device_name: parsedBody.deviceName,
        updated_at: registeredAt
      },
      { onConflict: 'user_id,platform,token' }
    )
    .select('platform, token, push_provider, app_version, device_name, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return pushDeviceRegistrationSchemaV1.parse({
    platform: data?.platform ?? parsedBody.platform,
    token: data?.token ?? parsedBody.token,
    appVersion: data?.app_version ?? parsedBody.appVersion ?? null,
    deviceName: data?.device_name ?? parsedBody.deviceName ?? null,
    pushProvider: data?.push_provider ?? pushProvider,
    registeredAt: normalizeText(data?.updated_at) ?? registeredAt
  });
}

// Keep the typed client import live so shared transport stays wired into the monorepo task graph.
export const sharedApiClient = createApiClient;
