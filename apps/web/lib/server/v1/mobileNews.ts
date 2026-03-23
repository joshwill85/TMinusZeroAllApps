import { newsStreamSchemaV1 } from '@tminuszero/contracts';
import { fetchNewsStreamPage } from '@/lib/server/newsStream';
import { fetchProviders } from '@/lib/server/providers';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

type NewsTypeFilter = 'all' | 'article' | 'blog' | 'report';

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
    description: 'Native news stream backed by SNAPI coverage and joined launch context.',
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
      newsSite: item.news_site,
      imageUrl: item.image_url,
      publishedAt: item.published_at,
      updatedAt: item.updated_at,
      authors: (item.authors ?? [])
        .map((author) => String(author?.name || '').trim())
        .filter(Boolean),
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
