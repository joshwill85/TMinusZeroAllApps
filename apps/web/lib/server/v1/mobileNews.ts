import { newsArticleDetailSchemaV1, newsStreamSchemaV1 } from '@tminuszero/contracts';
import { fetchNewsStreamPage } from '@/lib/server/newsStream';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchProviders } from '@/lib/server/providers';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

type NewsTypeFilter = 'all' | 'article' | 'blog' | 'report';

type NewsDetailRow = {
  snapi_uid?: string | null;
  item_type?: 'article' | 'blog' | 'report' | null;
  title?: string | null;
  url?: string | null;
  news_site?: string | null;
  summary?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  featured?: boolean | null;
};

type NewsLaunchJoinRow = {
  launch_id?: string | null;
};

type NewsLaunchRow = {
  launch_id?: string | null;
  name?: string | null;
  net?: string | null;
  net_precision?: string | null;
  status_name?: string | null;
  status_abbrev?: string | null;
  provider?: string | null;
};

const NEWS_DETAIL_SELECT =
  'snapi_uid, item_type, title, url, news_site, summary, image_url, published_at, updated_at, authors, featured';

const NEWS_LAUNCH_SELECT = 'launch_id, name, net, net_precision, status_name, status_abbrev, provider';

function parseNewsType(value: string | null): NewsTypeFilter {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'article' || normalized === 'blog' || normalized === 'report') {
    return normalized;
  }
  return 'all';
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function mapAuthors(authors: NewsDetailRow['authors']) {
  if (!Array.isArray(authors)) return [];
  return authors.map((author) => String(author?.name || '').trim()).filter(Boolean);
}

function normalizeNetPrecision(value: unknown) {
  if (value === 'minute' || value === 'hour' || value === 'day' || value === 'month' || value === 'tbd') {
    return value;
  }
  return null;
}

function normalizeLaunchStatus(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'go') return 'go';
  if (normalized === 'hold') return 'hold';
  if (normalized === 'scrubbed' || normalized === 'scrub' || normalized === 'canceled' || normalized === 'cancelled') return 'scrubbed';
  if (normalized === 'tbd') return 'tbd';
  if (normalized === 'unknown') return 'unknown';
  return null;
}

function normalizeSourceLabel(source: string | null | undefined, sourceUrl: string | null | undefined) {
  const normalizedSource = String(source || '').trim();
  if (normalizedSource) return normalizedSource;
  const normalizedUrl = String(sourceUrl || '').trim();
  if (!normalizedUrl) return null;
  try {
    return new URL(normalizedUrl).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function buildLaunchSummary(row: NewsLaunchRow) {
  const launchId = String(row.launch_id || '').trim();
  if (!launchId) return null;
  const launchName = String(row.name || '').trim() || 'Launch';
  return {
    id: launchId,
    name: launchName,
    provider: String(row.provider || '').trim() || null,
    vehicle: null,
    net: String(row.net || '').trim() || null,
    netPrecision: normalizeNetPrecision(row.net_precision),
    status: normalizeLaunchStatus(String(row.status_abbrev || row.status_name || '')),
    statusText: String(row.status_abbrev || row.status_name || '').trim() || null,
    href: buildLaunchHref({
      id: launchId,
      name: launchName,
      slug: undefined
    })
  };
}

type NewsLaunchSummary = NonNullable<ReturnType<typeof buildLaunchSummary>>;

function isNewsLaunchSummary(value: ReturnType<typeof buildLaunchSummary>): value is NewsLaunchSummary {
  return value != null;
}

function sortLaunchRows(rows: NewsLaunchRow[]) {
  return [...rows].sort((left, right) => {
    const leftMs = Date.parse(String(left.net || ''));
    const rightMs = Date.parse(String(right.net || ''));
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
      return leftMs - rightMs;
    }
    if (Number.isFinite(leftMs)) return -1;
    if (Number.isFinite(rightMs)) return 1;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function buildNewsDetailHref(newsId: string) {
  return `/news/${encodeURIComponent(String(newsId || '').trim())}`;
}

async function loadRelatedLaunches(newsId: string): Promise<NewsLaunchSummary[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();
  const joinRes = await supabase.from('snapi_item_launches').select('launch_id').eq('snapi_uid', newsId);
  if (joinRes.error) {
    throw joinRes.error;
  }

  const launchIds = unique((joinRes.data || []).map((row) => String((row as NewsLaunchJoinRow).launch_id || '').trim()).filter(Boolean));
  if (!launchIds.length) return [];

  const launchRes = await supabase.from('launches_public_cache').select(NEWS_LAUNCH_SELECT).in('launch_id', launchIds);
  if (launchRes.error) {
    throw launchRes.error;
  }

  return sortLaunchRows((launchRes.data || []) as NewsLaunchRow[])
    .map((row) => buildLaunchSummary(row))
    .filter(isNewsLaunchSummary)
    .slice(0, 4);
}

function buildRelatedActions(relatedLaunches: NewsLaunchSummary[]) {
  const actions = relatedLaunches.slice(0, 2).map((launch, index) => ({
    label: relatedLaunches.length === 1 ? 'Open launch' : index === 0 ? 'Open primary launch' : `Open ${launch.name}`,
    href: launch.href,
    external: false
  }));

  actions.push({
    label: 'Browse news',
    href: '/news',
    external: false
  });

  return actions;
}

export async function loadNewsStreamPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const providers = await fetchProviders();
  const providerSlug = String(searchParams.get('provider') || '')
    .trim()
    .toLowerCase();
  const activeProvider = providers.find((provider) => provider.slug === providerSlug) ?? null;
  const type = parseNewsType(searchParams.get('type'));
  const cursor = clampInt(searchParams.get('cursor'), 0, 0, 100_000);
  const limit = clampInt(searchParams.get('limit'), 24, 1, 60);
  const result = await fetchNewsStreamPage({
    type,
    providerName: activeProvider?.name ?? null,
    cursor,
    limit
  });

  return newsStreamSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'News Downlink',
    description: 'Native mission coverage stream with launch-linked context and source handoff.',
    type,
    providerSlug: activeProvider?.slug ?? null,
    providers: providers.map((provider) => ({
      slug: provider.slug,
      name: provider.name,
      type: provider.type ?? null,
      countryCode: provider.countryCode ?? null
    })),
    items: result.page.items.map((item) => ({
      id: item.snapi_uid,
      itemType: item.item_type,
      title: item.title,
      summary: item.summary,
      url: item.url,
      detailHref: buildNewsDetailHref(item.snapi_uid),
      newsSite: item.news_site,
      imageUrl: item.image_url,
      publishedAt: item.published_at,
      updatedAt: item.updated_at,
      authors: mapAuthors(item.authors),
      featured: Boolean(item.featured),
      matchedBy: item.launch?.matchedBy ?? 'none',
      relatedLaunchCount: item.launch ? item.launch.extraCount + 1 : 0,
      launch: item.launch
        ? {
            id: item.launch.primary.id,
            name: item.launch.primary.name || 'Launch',
            provider: item.launch.primary.provider,
            vehicle: null,
            net: item.launch.primary.net,
            netPrecision: item.launch.primary.netPrecision,
            status: null,
            statusText: item.launch.primary.statusText,
            href: buildLaunchHref({
              id: item.launch.primary.id,
              name: item.launch.primary.name || 'Launch',
              slug: undefined
            })
          }
        : null
    })),
    nextCursor: result.page.nextCursor,
    hasMore: result.page.hasMore
  });
}

export async function loadNewsArticleDetailPayload(rawId: string) {
  const newsId = String(rawId || '').trim();
  if (!newsId || !isSupabaseConfigured()) {
    return null;
  }

  const supabase = createSupabasePublicClient();
  const articleRes = await supabase.from('snapi_items').select(NEWS_DETAIL_SELECT).eq('snapi_uid', newsId).maybeSingle();
  if (articleRes.error) {
    throw articleRes.error;
  }

  const row = articleRes.data as NewsDetailRow | null;
  if (!row?.snapi_uid || !row?.title || !row?.url || !row?.item_type) {
    return null;
  }

  const relatedLaunches = await loadRelatedLaunches(newsId);

  return newsArticleDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    id: row.snapi_uid,
    itemType: row.item_type,
    title: row.title,
    summary: row.summary ?? null,
    excerpt: row.summary ?? null,
    sourceUrl: row.url,
    sourceLabel: normalizeSourceLabel(row.news_site, row.url),
    imageUrl: row.image_url ?? null,
    publishedAt: row.published_at ?? null,
    updatedAt: row.updated_at ?? null,
    authors: mapAuthors(row.authors),
    featured: Boolean(row.featured),
    relatedLaunches,
    relatedActions: buildRelatedActions(relatedLaunches)
  });
}
