import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthReturnRedirect } from '@/components/AuthReturnRedirect';
import { JsonLd } from '@/components/JsonLd';
import { LaunchFeed } from '@/components/LaunchFeed';
import { ProgramHubDock } from '@/components/ProgramHubDock';
import { SkeletonLaunchCard } from '@/components/SkeletonLaunchCard';
import { LAUNCH_FEED_PAGE_SIZE } from '@/lib/constants/launchFeed';
import type { Launch } from '@/lib/types/launch';
import { buildSiteMeta } from '@/lib/server/siteMeta';
import { getSiteUrl } from '@/lib/server/env';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

type SearchParams = Record<string, string | string[] | undefined>;

function parsePageParam(raw: SearchParams['page']) {
  if (typeof raw !== 'string') return 1;
  const trimmed = raw.trim();
  if (!trimmed) return 1;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(10_000, Math.max(1, Math.trunc(parsed)));
}

function presentSearchParamKeys(searchParams?: SearchParams) {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      if (value.some((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
        keys.push(key);
      }
      continue;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      keys.push(key);
    }
  }
  return keys;
}

export async function generateMetadata({
  searchParams
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const rawQuery = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const page = parsePageParam(searchParams.page);
  const presentKeys = presentSearchParamKeys(searchParams);
  const isOnlyPageParam = presentKeys.length === 1 && presentKeys[0] === 'page';
  const shouldNoIndex = presentKeys.length > 0 && !(isOnlyPageParam && page > 1);

  const canonical = rawQuery ? '/' : page > 1 ? `/?page=${page}` : '/';
  const pageUrl = `${siteMeta.siteUrl}${canonical}`;
  const titleBase = `US Rocket Launch Schedule & Countdown | ${siteMeta.siteName}`;
  const title = page > 1 ? `US Rocket Launch Schedule (Page ${page}) | ${siteMeta.siteName}` : titleBase;

  return {
    title,
    description: siteMeta.description,
    alternates: { canonical },
    robots: shouldNoIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: siteMeta.ogTitle,
      description: siteMeta.ogDescription,
      url: pageUrl,
      siteName: siteMeta.siteName,
      type: 'website',
      images: [
        {
          url: siteMeta.ogImage,
          width: 1200,
          height: 630,
          alt: siteMeta.ogImageAlt,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: siteMeta.ogTitle,
      description: siteMeta.ogDescription,
      images: [
        {
          url: siteMeta.ogImage,
          alt: siteMeta.ogImageAlt
        }
      ]
    }
  };
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const page = parsePageParam(searchParams.page);
  const nowMs = Date.now();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const { launches, offset, hasMore } = await fetchHomepageLaunchFeed({ page, siteUrl });
  const rawQuery = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const canonical = rawQuery ? '/' : page > 1 ? `/?page=${page}` : '/';

  const pageUrl = `${siteUrl}${canonical}`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const scheduleId = `${pageUrl}#launch-schedule`;
  const upcomingLaunches = launches
    .filter((launch) => {
      const netMs = Date.parse(launch.net);
      return Number.isFinite(netMs) && netMs >= nowMs;
    })
    .slice(0, 25);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Launch schedule', item: `${pageUrl}#schedule` }
    ]
  };
  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': scheduleId,
    url: pageUrl,
    name: 'US rocket launch schedule',
    description: 'Upcoming US rocket launches with countdowns, launch windows, and live coverage links.',
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: upcomingLaunches.length ? { '@id': `${pageUrl}#upcoming-launches` } : undefined
  };
  const itemListJsonLd =
    upcomingLaunches.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-launches`,
          numberOfItems: upcomingLaunches.length,
          itemListElement: upcomingLaunches.map((launch, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'Event',
              name: launch.name,
              url: `${siteUrl}${buildLaunchHref(launch)}`,
              startDate: launch.net
            }
          }))
        }
      : null;
  return (
    <div className="flex min-h-screen flex-col">
      <AuthReturnRedirect />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-12 pt-6 md:px-8 md:pt-6">
        <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />
        <header className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-text3">Launch schedule</p>
            <h1 className="text-3xl font-semibold text-text1">US Rocket Launch Schedule &amp; Countdown</h1>
          </div>
          <p className="max-w-3xl text-sm text-text2">
            Track upcoming US rocket launches with NET windows, countdowns, and coverage links.
          </p>
        </header>
        <ProgramHubDock />
        <div id="schedule" className="scroll-mt-16">
          <Suspense
            fallback={
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonLaunchCard key={i} />
                ))}
              </div>
            }
          >
            <LaunchFeed
              initialLaunches={launches}
              initialOffset={offset}
              initialHasMore={hasMore}
              initialNowMs={nowMs}
              initialViewerTier="anon"
              initialIsPaid={false}
              initialAuthStatus="guest"
              initialBlockThirdPartyEmbeds={false}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function fetchHomepageLaunchFeed({
  page,
  siteUrl
}: {
  page: number;
  siteUrl: string;
}): Promise<{ launches: Launch[]; offset: number; hasMore: boolean }> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const offset = (safePage - 1) * LAUNCH_FEED_PAGE_SIZE;

  const qs = new URLSearchParams();
  qs.set('range', 'year');
  qs.set('sort', 'soonest');
  qs.set('region', 'us');
  qs.set('limit', String(LAUNCH_FEED_PAGE_SIZE));
  qs.set('offset', String(offset));

  try {
    const res = await fetch(`${siteUrl}/api/public/launches?${qs.toString()}`, {
      next: { revalidate: 60 }
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('homepage launch feed error', res.status, json);
      return { launches: [], offset, hasMore: false };
    }
    const launches = Array.isArray(json?.launches) ? (json.launches as Launch[]) : [];
    const hasMore = typeof json?.hasMore === 'boolean' ? json.hasMore : launches.length === LAUNCH_FEED_PAGE_SIZE;
    return { launches, offset, hasMore };
  } catch (error) {
    console.error('homepage launch feed error', error);
    return { launches: [], offset, hasMore: false };
  }
}
