import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import {
  fetchProviderBySlug,
  type ProviderSummary
} from '@/lib/server/providers';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { SITE_META } from '@/lib/server/siteMeta';
import {
  buildBreadcrumbJsonLd,
  buildCanonicalUrl,
  buildCollectionPageJsonLd,
  buildPageMetadata
} from '@/lib/server/seo';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const PAGE_SIZE = 36;
const LAUNCH_PAGE_SIZE = 1000;
const CHUNK_SIZE = 200;

type NewsItem = {
  snapi_uid: string;
  item_type: 'article' | 'blog' | 'report';
  title: string;
  url: string;
  news_site?: string | null;
  summary?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  featured?: boolean | null;
};

type LaunchSummary = {
  launch_id: string;
  name: string | null;
  net?: string | null;
};

type ProviderNewsData = {
  items: NewsItem[];
  totalItems: number;
  launchesByItem: Record<string, string[]>;
  launchById: Record<string, LaunchSummary>;
};

export async function generateMetadata({
  params
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const provider = await fetchProviderBySlug(params.slug);
  if (!provider) {
    return {
      title: `Provider not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/providers/${provider.slug}`;
  const title = `${provider.name} Launch News & Mission Coverage | ${SITE_META.siteName}`;
  const description = `Latest launch news, mission coverage, and linked articles for ${provider.name}.`;

  return buildPageMetadata({
    title,
    description,
    canonical
  });
}

export default async function ProviderNewsPage({
  params
}: {
  params: { slug: string };
}) {
  const provider = await fetchProviderBySlug(params.slug);
  if (!provider) return notFound();

  const supabaseReady = isSupabaseConfigured();
  const data = supabaseReady
    ? await fetchProviderNews(provider.name)
    : emptyProviderNews();
  const providerLogo = normalizeImageUrl(
    provider.logoUrl || provider.imageUrl || null
  );
  const providerMeta = [provider.type, provider.countryCode]
    .filter(Boolean)
    .join(' - ');
  const items = data.items;
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `/providers/${provider.slug}`;
  const absolutePageUrl = buildCanonicalUrl(pageUrl);
  const itemListJsonLd = items.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': `${absolutePageUrl}#coverage-list`,
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type':
              item.item_type === 'article'
                ? 'NewsArticle'
                : item.item_type === 'blog'
                  ? 'BlogPosting'
                  : 'Report',
            headline: item.title,
            url: item.url
          }
        }))
      }
    : null;
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'News', item: '/news' },
      { name: provider.name, item: pageUrl }
    ]),
    buildCollectionPageJsonLd({
      canonical: pageUrl,
      name: `${provider.name} launch news`,
      description: `Latest launch news, mission coverage, and linked articles for ${provider.name}.`,
      mainEntityId: itemListJsonLd ? itemListJsonLd['@id'] : undefined
    }),
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${absolutePageUrl}#provider`,
      name: provider.name,
      url: absolutePageUrl
    },
    ...(itemListJsonLd ? [itemListJsonLd] : [])
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <JsonLd data={jsonLd} />
      <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-text3">
              Provider
            </p>
            <h1 className="text-3xl font-semibold text-text1">
              {provider.name}
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-text2">
            Latest coverage tied to {provider.name} launches from Spaceflight
            News API.
          </p>
          {providerMeta && (
            <div className="text-xs uppercase tracking-[0.14em] text-text3">
              {providerMeta}
            </div>
          )}
          {provider.description && (
            <p className="max-w-2xl text-sm text-text2">
              {provider.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
            <Link
              href="/news"
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
            >
              All coverage
            </Link>
            <Link
              href={`/launch-providers/${encodeURIComponent(provider.slug)}`}
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
            >
              Provider schedule
            </Link>
            <Link
              href="/#schedule"
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
            >
              Launch feed
            </Link>
          </div>
        </div>
        {providerLogo && (
          <div className="flex h-24 w-48 items-center justify-center rounded-2xl border border-stroke bg-[rgba(7,9,19,0.6)] px-4 py-3 shadow-glow">
            <img
              src={providerLogo}
              alt={`${provider.name} logo`}
              className="max-h-full w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}
      </header>

      <section className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-text3">
              Coverage
            </div>
            <h2 className="text-xl font-semibold text-text1">
              Latest articles
            </h2>
          </div>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {data.totalItems} items
          </span>
        </div>

        {!supabaseReady && (
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-4 text-sm text-text2">
            Configure Supabase env vars to load SNAPI coverage.
          </div>
        )}

        {supabaseReady && items.length === 0 && (
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-4 text-sm text-text2">
            No coverage found yet for {provider.name}.
          </div>
        )}

        {items.length > 0 && (
          <>
            {data.totalItems > items.length && (
              <div className="mt-3 text-xs text-text3">
                Showing {items.length} most recent items.
              </div>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const title = item.title?.trim() || 'Untitled';
                const summary = item.summary
                  ? truncateText(item.summary, 160)
                  : null;
                const published = formatNewsDate(
                  item.published_at ?? item.updated_at
                );
                const authors = formatAuthors(item.authors);
                const badge = formatNewsType(item.item_type);
                const site = item.news_site || 'Spaceflight News';
                const launchLink = buildLaunchLink(
                  data.launchesByItem[item.snapi_uid] || [],
                  data.launchById
                );
                const imageUrl = normalizeImageUrl(item.image_url);

                return (
                  <article
                    key={item.snapi_uid}
                    className="flex h-full flex-col overflow-hidden rounded-2xl border border-stroke bg-surface-0"
                  >
                    <div className="relative h-36 w-full overflow-hidden">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt=""
                          className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),_transparent_60%)]" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                        {badge}
                      </span>
                      {item.featured && (
                        <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                          Featured
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                        <span className="uppercase tracking-[0.08em]">
                          {site}
                        </span>
                        {published && <span>{published}</span>}
                      </div>
                      <div className="text-sm font-semibold text-text1">
                        {title}
                      </div>
                      {summary && (
                        <p className="text-xs text-text2">{summary}</p>
                      )}
                      {authors && (
                        <div className="text-[11px] text-text3">
                          By {authors}
                        </div>
                      )}

                      <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] text-text3">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                        >
                          Read coverage
                          <ExternalIcon className="h-3.5 w-3.5" />
                        </a>
                        {launchLink && (
                          <>
                            <span className="text-text4">-</span>
                            <Link
                              href={buildLaunchHref({
                                id: launchLink.id,
                                name: launchLink.name || 'Launch'
                              })}
                              className="hover:text-text1"
                            >
                              {launchLink.name}
                            </Link>
                            {launchLink.dateLabel && (
                              <span className="text-text4">
                                ({launchLink.dateLabel})
                              </span>
                            )}
                            {launchLink.extraCount > 0 && (
                              <span className="text-text4">
                                +{launchLink.extraCount} more
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const fetchProviderNews = cache(
  async (providerName: string): Promise<ProviderNewsData> => {
    const supabase = createSupabaseServerClient();
    const launchIds: string[] = [];
    const launchById: Record<string, LaunchSummary> = {};
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from('launches_public_cache')
        .select('launch_id, name, net')
        .eq('provider', providerName)
        .order('net', { ascending: false })
        .range(offset, offset + LAUNCH_PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;

      for (const row of data) {
        if (!row.launch_id) continue;
        launchIds.push(row.launch_id);
        if (!launchById[row.launch_id]) {
          launchById[row.launch_id] = {
            launch_id: row.launch_id,
            name: row.name ?? null,
            net: row.net ?? null
          };
        }
      }

      if (data.length < LAUNCH_PAGE_SIZE) break;
      offset += data.length;
    }

    if (!launchIds.length) {
      return { items: [], totalItems: 0, launchesByItem: {}, launchById };
    }

    const launchesByItem: Record<string, string[]> = {};
    const snapiUids = new Set<string>();

    for (const chunk of chunkArray(launchIds, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('snapi_item_launches')
        .select('snapi_uid, launch_id')
        .in('launch_id', chunk);

      if (error || !data) continue;
      for (const row of data) {
        if (!row.snapi_uid || !row.launch_id) continue;
        if (!launchesByItem[row.snapi_uid]) launchesByItem[row.snapi_uid] = [];
        launchesByItem[row.snapi_uid].push(row.launch_id);
        snapiUids.add(row.snapi_uid);
      }
    }

    if (!snapiUids.size) {
      return { items: [], totalItems: 0, launchesByItem, launchById };
    }

    const itemsById = new Map<string, NewsItem>();
    for (const chunk of chunkArray([...snapiUids], CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('snapi_items')
        .select(
          'snapi_uid, item_type, title, url, news_site, summary, image_url, published_at, updated_at, authors, featured'
        )
        .in('snapi_uid', chunk);
      if (error || !data) continue;
      for (const row of data) {
        if (!row.snapi_uid || !row.title || !row.url) continue;
        itemsById.set(row.snapi_uid, row as NewsItem);
      }
    }

    const sorted = Array.from(itemsById.values()).sort(
      (a, b) => getNewsSortMs(b) - getNewsSortMs(a)
    );
    return {
      items: sorted.slice(0, PAGE_SIZE),
      totalItems: sorted.length,
      launchesByItem,
      launchById
    };
  }
);

function getNewsSortMs(item: NewsItem) {
  const published = Date.parse(item.published_at || '');
  if (Number.isFinite(published)) return published;
  const updated = Date.parse(item.updated_at || '');
  return Number.isFinite(updated) ? updated : 0;
}

function buildLaunchLink(
  launchIds: string[],
  launchById: Record<string, LaunchSummary>
) {
  const unique = Array.from(new Set(launchIds));
  if (!unique.length) return null;
  const primaryId = unique[0];
  const primary = launchById[primaryId];
  const name = primary?.name?.trim() || 'Launch';
  return {
    id: primaryId,
    name,
    dateLabel: formatLaunchDate(primary?.net ?? null),
    extraCount: Math.max(0, unique.length - 1)
  };
}

function formatNewsDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(date);
}

function formatLaunchDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(date);
}

function formatNewsType(type: NewsItem['item_type']) {
  switch (type) {
    case 'blog':
      return 'Blog';
    case 'report':
      return 'Report';
    default:
      return 'Article';
  }
}

function formatAuthors(authors: NewsItem['authors']) {
  if (!Array.isArray(authors)) return null;
  const names = authors.map((a) => a?.name?.trim()).filter(Boolean) as string[];
  if (!names.length) return null;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function truncateText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3).trim()}...`;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function emptyProviderNews(): ProviderNewsData {
  return { items: [], totalItems: 0, launchesByItem: {}, launchById: {} };
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M14 5h5v5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14 19 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M19 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 17.5v-10A1.5 1.5 0 0 1 7.5 6h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
