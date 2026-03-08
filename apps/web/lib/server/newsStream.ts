import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import type { NewsStreamItem, NewsStreamLaunch, NewsStreamPage, NewsType } from '@/lib/types/news';

export const NEWS_STREAM_PAGE_SIZE = 24;

const SNAPI_SELECT =
  'snapi_uid, item_type, title, url, news_site, summary, image_url, published_at, updated_at, authors, featured';

const LAUNCH_SELECT =
  'launch_id, name, net, net_precision, status_name, status_abbrev, provider';

const CHUNK_SIZE = 200;
const PROVIDER_SCAN_CHUNK = 96;
const PROVIDER_SCAN_MAX_PAGES = 8;

type SnapiRow = {
  snapi_uid: string;
  item_type: NewsType;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  authors: Array<{ name?: string | null }> | null;
  featured: boolean | null;
};

type LaunchRow = {
  launch_id: string;
  name: string | null;
  net: string | null;
  net_precision: string | null;
  status_name: string | null;
  status_abbrev: string | null;
  provider: string | null;
};

export type FetchNewsStreamResult = {
  page: NewsStreamPage;
  errorMessage: string | null;
};

export async function fetchNewsStreamPage({
  type,
  providerName,
  cursor = 0,
  limit = NEWS_STREAM_PAGE_SIZE
}: {
  type: NewsType | 'all';
  providerName?: string | null;
  cursor?: number;
  limit?: number;
}): Promise<FetchNewsStreamResult> {
  if (!isSupabaseConfigured()) {
    return { page: { items: [], nextCursor: 0, hasMore: false }, errorMessage: 'supabase_not_configured' };
  }

  const supabase = createSupabaseServerClient();
  try {
    const page = providerName
      ? await fetchNewsForProvider(supabase, providerName, type, cursor, limit)
      : await fetchNewsAll(supabase, type, cursor, limit);
    return { page, errorMessage: null };
  } catch (err: any) {
    return {
      page: { items: [], nextCursor: cursor, hasMore: false },
      errorMessage: err?.message || 'news_fetch_failed'
    };
  }
}

async function fetchNewsAll(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  type: NewsType | 'all',
  cursor: number,
  limit: number
): Promise<NewsStreamPage> {
  const { rows, hasMore } = await fetchSnapiRows(supabase, type, cursor, limit);
  const slice = rows.slice(0, limit);
  const hydrated = await hydrateLaunchContext(supabase, slice);
  return {
    items: hydrated,
    nextCursor: cursor + slice.length,
    hasMore
  };
}

async function fetchNewsForProvider(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  providerName: string,
  type: NewsType | 'all',
  cursor: number,
  limit: number
): Promise<NewsStreamPage> {
  const normalizedProvider = normalizeProviderName(providerName);
  const items: NewsStreamItem[] = [];
  let scanCursor = cursor;
  let hitEnd = false;

  for (let i = 0; i < PROVIDER_SCAN_MAX_PAGES && items.length < limit && !hitEnd; i += 1) {
    const { rows } = await fetchSnapiRows(supabase, type, scanCursor, PROVIDER_SCAN_CHUNK, { includeOverflow: false });
    if (!rows.length) {
      hitEnd = true;
      break;
    }

    scanCursor += rows.length;
    if (rows.length < PROVIDER_SCAN_CHUNK) hitEnd = true;

    const { launchIdsByItem, launchById } = await fetchLaunchLinks(supabase, rows.map((row) => row.snapi_uid));

    for (const row of rows) {
      if (items.length >= limit) break;
      const launchIds = unique(launchIdsByItem.get(row.snapi_uid) || []);
      if (!launchIds.length) continue;

      const launches = launchIds.map((id) => mapLaunchRow(launchById.get(id))).filter(Boolean) as NewsStreamLaunch[];
      const providerMatches = launches.some((launch) => normalizeProviderName(launch.provider) === normalizedProvider);
      if (!providerMatches) continue;

      const candidateLaunches = launches.filter((launch) => normalizeProviderName(launch.provider) === normalizedProvider);
      const primary = pickPrimaryLaunch(candidateLaunches.length ? candidateLaunches : launches);

      items.push(mapSnapiRow(row, {
        primary,
        extraCount: Math.max(0, launchIds.length - 1),
        matchedBy: 'join'
      }));
    }
  }

  return {
    items,
    nextCursor: scanCursor,
    hasMore: !hitEnd
  };
}

async function fetchSnapiRows(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  type: NewsType | 'all',
  cursor: number,
  limit: number,
  options: { includeOverflow: boolean } = { includeOverflow: true }
): Promise<{ rows: SnapiRow[]; hasMore: boolean }> {
  const start = Math.max(0, cursor);
  const end = Math.max(start, start + (options.includeOverflow ? limit : limit - 1));

  let query = supabase
    .from('snapi_items')
    .select(SNAPI_SELECT)
    .order('published_at', { ascending: false })
    .order('snapi_uid', { ascending: false })
    .range(start, end);

  if (type !== 'all') {
    query = query.eq('item_type', type);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data || []) as SnapiRow[]).filter((row) => row?.snapi_uid && row?.title && row?.url);
  const hasMore = options.includeOverflow ? rows.length > limit : rows.length === limit;

  return { rows, hasMore };
}

async function hydrateLaunchContext(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  rows: SnapiRow[]
): Promise<NewsStreamItem[]> {
  if (!rows.length) return [];

  const { launchIdsByItem, launchById } = await fetchLaunchLinks(supabase, rows.map((row) => row.snapi_uid));
  const mentionCache = new Map<string, NewsStreamLaunch | null>();
  const nowIso = new Date().toISOString();

  const hydrated: NewsStreamItem[] = [];
  for (const row of rows) {
    const launchIds = unique(launchIdsByItem.get(row.snapi_uid) || []);
    if (!launchIds.length) {
      const mention = extractLaunchMention(row.title, row.summary);
      if (!mention) {
        hydrated.push(mapSnapiRow(row, null));
        continue;
      }

      if (!mentionCache.has(mention)) {
        mentionCache.set(mention, await resolveLaunchByMention(supabase, mention, nowIso));
      }
      const primary = mentionCache.get(mention);
      if (!primary) {
        hydrated.push(mapSnapiRow(row, null));
        continue;
      }

      hydrated.push(
        mapSnapiRow(row, {
          primary,
          extraCount: 0,
          matchedBy: 'mention'
        })
      );
      continue;
    }

    const launches = launchIds.map((id) => mapLaunchRow(launchById.get(id))).filter(Boolean) as NewsStreamLaunch[];
    const primary = pickPrimaryLaunch(launches.length ? launches : [fallbackLaunch(launchIds[0])]);

    hydrated.push(
      mapSnapiRow(row, {
      primary,
      extraCount: Math.max(0, launchIds.length - 1),
      matchedBy: 'join'
      })
    );
  }

  return hydrated;
}

async function fetchLaunchLinks(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  snapiUids: string[]
): Promise<{
  launchIdsByItem: Map<string, string[]>;
  launchById: Map<string, LaunchRow>;
}> {
  const launchIdsByItem = new Map<string, string[]>();
  const launchById = new Map<string, LaunchRow>();
  if (!snapiUids.length) return { launchIdsByItem, launchById };

  const { data: joinRows, error: joinError } = await supabase
    .from('snapi_item_launches')
    .select('snapi_uid, launch_id')
    .in('snapi_uid', snapiUids);

  if (joinError) throw joinError;

  const launchIds: string[] = [];
  (joinRows || []).forEach((row) => {
    if (!row?.snapi_uid || !row?.launch_id) return;
    if (!launchIdsByItem.has(row.snapi_uid)) launchIdsByItem.set(row.snapi_uid, []);
    launchIdsByItem.get(row.snapi_uid)?.push(row.launch_id);
    launchIds.push(row.launch_id);
  });

  const uniqueLaunchIds = unique(launchIds);
  for (const chunk of chunkArray(uniqueLaunchIds, CHUNK_SIZE)) {
    const { data, error } = await supabase.from('launches_public_cache').select(LAUNCH_SELECT).in('launch_id', chunk);
    if (error) throw error;
    (data || []).forEach((row) => {
      if (!row?.launch_id) return;
      launchById.set(row.launch_id, row as LaunchRow);
    });
  }

  return { launchIdsByItem, launchById };
}

function mapSnapiRow(
  row: SnapiRow,
  launch: NewsStreamItem['launch']
): NewsStreamItem {
  return {
    snapi_uid: row.snapi_uid,
    item_type: row.item_type,
    title: row.title,
    url: row.url,
    news_site: row.news_site ?? null,
    summary: row.summary ?? null,
    image_url: row.image_url ?? null,
    published_at: row.published_at ?? null,
    updated_at: row.updated_at ?? null,
    authors: row.authors ?? null,
    featured: row.featured ?? null,
    launch
  };
}

function mapLaunchRow(row?: LaunchRow): NewsStreamLaunch | null {
  if (!row?.launch_id) return null;
  return {
    id: row.launch_id,
    name: row.name ?? null,
    net: row.net ?? null,
    netPrecision: normalizeNetPrecision(row.net_precision),
    statusName: row.status_name ?? null,
    statusText: row.status_abbrev || row.status_name || null,
    provider: row.provider ?? null
  };
}

function fallbackLaunch(id: string): NewsStreamLaunch {
  return {
    id,
    name: null,
    net: null,
    netPrecision: null,
    statusName: null,
    statusText: null,
    provider: null
  };
}

function pickPrimaryLaunch(launches: NewsStreamLaunch[]): NewsStreamLaunch {
  if (!launches.length) return fallbackLaunch('unknown');
  if (launches.length === 1) return launches[0]!;

  const nowMs = Date.now();
  let upcoming: { launch: NewsStreamLaunch; netMs: number } | null = null;
  let recentPast: { launch: NewsStreamLaunch; netMs: number } | null = null;

  for (const launch of launches) {
    const netMs = Date.parse(launch.net || '');
    if (!Number.isFinite(netMs)) continue;
    if (netMs >= nowMs) {
      if (!upcoming || netMs < upcoming.netMs) upcoming = { launch, netMs };
    } else {
      if (!recentPast || netMs > recentPast.netMs) recentPast = { launch, netMs };
    }
  }

  return upcoming?.launch ?? recentPast?.launch ?? launches[0]!;
}

function normalizeNetPrecision(value: unknown): NewsStreamLaunch['netPrecision'] {
  if (value === 'minute' || value === 'hour' || value === 'day' || value === 'month' || value === 'tbd') return value;
  return null;
}

function normalizeProviderName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractLaunchMention(title: string, summary: string | null) {
  const blob = `${title || ''}\n${summary || ''}`.trim();
  if (!blob) return null;

  const starshipFlight = blob.match(/\bstarship\s*flight\s*(\d{1,3})\b/i);
  if (starshipFlight?.[1]) return `Starship Flight ${starshipFlight[1]}`;

  const ift = blob.match(/\bift[-\s]?(\d{1,3})\b/i);
  if (ift?.[1]) return `Starship Flight ${ift[1]}`;

  const artemis = blob.match(/\bartemis\s*(\d{1,2}|i{1,3}|iv|v|vi{0,3}|ix|x)\b/i);
  if (artemis?.[1]) return `Artemis ${artemis[1].toUpperCase()}`;

  return null;
}

async function resolveLaunchByMention(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  mention: string,
  nowIso: string
): Promise<NewsStreamLaunch | null> {
  const pattern = `%${mention}%`;

  const upcomingRes = await supabase
    .from('launches_public_cache')
    .select(LAUNCH_SELECT)
    .ilike('name', pattern)
    .gte('net', nowIso)
    .order('net', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (upcomingRes.data) {
    return mapLaunchRow(upcomingRes.data as LaunchRow);
  }

  const pastRes = await supabase
    .from('launches_public_cache')
    .select(LAUNCH_SELECT)
    .ilike('name', pattern)
    .lt('net', nowIso)
    .order('net', { ascending: false })
    .limit(1)
    .maybeSingle();

  return pastRes.data ? mapLaunchRow(pastRes.data as LaunchRow) : null;
}
