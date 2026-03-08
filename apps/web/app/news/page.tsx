import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { fetchProviders, type ProviderSummary } from '@/lib/server/providers';
import { fetchNewsStreamPage } from '@/lib/server/newsStream';
import type { NewsType } from '@/lib/types/news';
import { CommLinkStream } from '@/components/news/CommLinkStream';
import { JsonLd } from '@/components/JsonLd';

const NEWS_TITLE = `News | ${BRAND_NAME}`;
const NEWS_DESCRIPTION = `Incoming telemetry from Spaceflight News API, fused with mission status in ${BRAND_NAME}.`;

type NewsSearchParams = Record<string, string | string[] | undefined>;

function hasSearchParams(searchParams?: NewsSearchParams) {
  return Object.values(searchParams ?? {}).some((value) => {
    if (Array.isArray(value)) {
      return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function generateMetadata({
  searchParams
}: {
  searchParams?: NewsSearchParams;
}): Metadata {
  const hasParams = hasSearchParams(searchParams);

  return {
    title: NEWS_TITLE,
    description: NEWS_DESCRIPTION,
    alternates: { canonical: '/news' },
    robots: hasParams ? { index: false, follow: true } : undefined
  };
}

const TYPE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Articles', value: 'article' },
  { label: 'Blogs', value: 'blog' },
  { label: 'Reports', value: 'report' }
] as const;

type NewsTypeFilter = NewsType | 'all';

export default async function NewsPage({
  searchParams
}: {
  searchParams?: NewsSearchParams;
}) {
  const initialNowMs = Date.now();
  const activeType = resolveTypeFilter(searchParams?.type);
  const providers = await fetchProviders();
  const rawProvider = resolveProviderParam(searchParams?.provider);
  const activeProvider = resolveProviderFilter(rawProvider, providers);
  const providerParam = activeProvider?.slug ?? null;
  const providerMissing = Boolean(rawProvider) && !activeProvider;
  const supabaseReady = isSupabaseConfigured();
  const newsResult = supabaseReady
    ? await fetchNewsStreamPage({ type: activeType, providerName: activeProvider?.name ?? null, cursor: 0 })
    : null;
  const { page, errorMessage } = newsResult ?? { page: { items: [], nextCursor: 0, hasMore: false }, errorMessage: null };
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/news`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const itemListElement = page.items.map((item, index) => {
    const itemType = item.item_type === 'article' ? 'NewsArticle' : item.item_type === 'blog' ? 'BlogPosting' : 'Report';
    const author = (item.authors || [])
      .map((entry) => entry?.name?.trim())
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ '@type': 'Person', name }));

    return {
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': itemType,
        headline: item.title,
        url: item.url,
        description: item.summary?.trim() || undefined,
        image: item.image_url ? [item.image_url] : undefined,
        datePublished: item.published_at || undefined,
        dateModified: item.updated_at || undefined,
        author: author.length ? author : undefined,
        publisher: item.news_site ? { '@type': 'Organization', name: item.news_site } : undefined
      }
    };
  });
  const itemListJsonLd = itemListElement.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': `${pageUrl}#itemlist`,
        numberOfItems: itemListElement.length,
        itemListElement
      }
    : null;
  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `News | ${BRAND_NAME}`,
    description: `Incoming telemetry from Spaceflight News API, fused with mission status in ${BRAND_NAME}.`,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: itemListJsonLd ? { '@id': itemListJsonLd['@id'] } : undefined
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <JsonLd data={[collectionPageJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />
      <header className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">News Downlink</p>
          <h1 className="text-3xl font-semibold text-text1">The CommLink Stream</h1>
        </div>
        <p className="max-w-3xl text-sm text-text2">
          Incoming coverage packets pulled from Spaceflight News API and fused with mission context when missions are detected.
        </p>
        <div className="rounded-3xl border border-stroke bg-surface-1/60 p-4 backdrop-blur-xl md:p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text4">Stream Controls</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {TYPE_OPTIONS.map((option) => {
              const isActive = option.value === activeType;
              const href = buildNewsHref({ type: option.value, provider: providerParam });
              return (
                <Link
                  key={option.value}
                  href={href}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition',
                    isActive
                      ? 'border-primary bg-primary/10 text-text1'
                      : 'border-stroke bg-[rgba(255,255,255,0.03)] text-text3 hover:text-text1'
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>

          <form
            className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text3"
            method="get"
          >
            <label htmlFor="provider" className="text-[10px] text-text4">
              Provider
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={providerParam ?? 'all'}
              disabled={!providers.length}
              className="rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text2"
            >
              <option value="all">All providers</option>
              {providers.map((provider) => (
                <option key={provider.slug} value={provider.slug}>
                  {provider.name}
                </option>
              ))}
            </select>
            {activeType !== 'all' && <input type="hidden" name="type" value={activeType} />}
            <button type="submit" className="btn-secondary rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
              Apply
            </button>
            {providerParam && (
              <Link
                href={buildNewsHref({ type: activeType })}
                className="rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text3 hover:text-text1"
              >
                Clear
              </Link>
            )}
            {activeProvider && (
              <Link
                href={`/providers/${activeProvider.slug}`}
                className="rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text3 hover:text-text1"
              >
                Provider page
              </Link>
            )}
          </form>

          {providerMissing && (
            <div className="mt-3 text-xs text-warning">
              Unknown provider filter.{' '}
              <Link href={buildNewsHref({ type: activeType })} className="underline">
                Clear
              </Link>
            </div>
          )}
        </div>
      </header>

      <section className="mt-8 space-y-4">
        {!supabaseReady && (
          <div className="rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
            Configure Supabase env vars to load SNAPI coverage.
          </div>
        )}

        {supabaseReady && errorMessage && (
          <div className="rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
            Unable to load SNAPI coverage right now. ({errorMessage})
          </div>
        )}

        {supabaseReady && !errorMessage && (
          <CommLinkStream
            key={`${activeType}:${activeProvider?.name ?? 'all'}`}
            initialPage={page}
            type={activeType}
            providerName={activeProvider?.name ?? null}
            initialNowMs={initialNowMs}
          />
        )}
      </section>
    </div>
  );
}

function resolveTypeFilter(raw?: string | string[]): NewsTypeFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim().toLowerCase() || '';
  if (!normalized) return 'all';
  if (normalized === 'article' || normalized === 'blog' || normalized === 'report') return normalized;
  if (normalized === 'articles') return 'article';
  if (normalized === 'blogs') return 'blog';
  if (normalized === 'reports') return 'report';
  return 'all';
}

function resolveProviderParam(raw?: string | string[]) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'all') return null;
  return normalized;
}

function resolveProviderFilter(raw: string | null, providers: ProviderSummary[]) {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  const slugMatch = providers.find((provider) => provider.slug === normalized);
  if (slugMatch) return slugMatch;
  const nameMatch = providers.find((provider) => provider.name.toLowerCase() === normalized);
  return nameMatch ?? null;
}

function buildNewsHref({ type, provider }: { type?: string | null; provider?: string | null }) {
  const params = new URLSearchParams();
  if (type && type !== 'all') params.set('type', type);
  if (provider) params.set('provider', provider);
  const qs = params.toString();
  return qs ? `/news?${qs}` : '/news';
}
