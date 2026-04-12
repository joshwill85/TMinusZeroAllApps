import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { fetchBlueOriginTravelerIndex } from '@/lib/server/blueOriginTravelers';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/blue-origin/travelers';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Blue Origin Crew Profiles | ${BRAND_NAME}`;
  const description =
    'Blue Origin crew directory with New Shepard flight references, mission links, launch dates, and flight history.';

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [
        {
          url: siteMeta.ogImage,
          width: 1200,
          height: 630,
          alt: SITE_META.ogImageAlt,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function BlueOriginTravelersIndexPage() {
  const response = await fetchBlueOriginTravelerIndex();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/travelers`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blue Origin',
        item: `${siteUrl}/blue-origin`
      },
      { '@type': 'ListItem', position: 3, name: 'Crew', item: pageUrl }
    ]
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Blue Origin Crew',
    itemListElement: response.items.slice(0, 128).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${siteUrl}/blue-origin/travelers/${item.travelerSlug}`,
      name: item.name
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, itemListJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Crew Directory
        </p>
        <h1 className="text-3xl font-semibold text-text1">Blue Origin Crew</h1>
        <p className="max-w-3xl text-sm text-text2">
          Canonical directory of Blue Origin crew profiles, with New Shepard
          flight references and mission-linked profile pages.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Crew tracked: {response.items.length}
          </span>
        </div>
      </header>

      {response.items.length ? (
        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {response.items.map((item) => (
            <article
              key={item.travelerSlug}
              className="rounded-xl border border-stroke bg-surface-1 p-3"
            >
              <div className="flex items-start gap-3">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-12 w-12 rounded-md border border-stroke object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span
                    className="h-12 w-12 rounded-md border border-stroke bg-surface-2/40"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <Link
                    href={`/blue-origin/travelers/${item.travelerSlug}`}
                    className="text-sm font-semibold text-text1 hover:text-primary"
                  >
                    {item.name}
                  </Link>
                  <p className="mt-1 text-xs text-text3">
                    {[item.roles[0] || null, item.nationalities[0] || null]
                      .filter(Boolean)
                      .join(' • ') || 'Crew'}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-text3">
                <span className="rounded-full border border-stroke px-2 py-0.5">
                  Flights: {item.flightCount}
                </span>
                <span className="rounded-full border border-stroke px-2 py-0.5">
                  Launches: {item.launchCount}
                </span>
                <span className="rounded-full border border-stroke px-2 py-0.5">
                  Confidence: {item.confidence}
                </span>
              </div>

              <div className="mt-3 text-xs text-text3">
                <p>
                  Latest flight:{' '}
                  {item.latestFlightCode
                    ? item.latestFlightCode.toUpperCase()
                    : 'Pending'}
                  {item.latestLaunchDate
                    ? ` • ${formatDate(item.latestLaunchDate)}`
                    : ''}
                </p>
                {item.latestLaunchHref ? (
                  <Link
                    href={item.latestLaunchHref}
                    className="mt-1 inline-block text-primary hover:text-primary/80"
                  >
                    Open latest mission
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <p className="text-sm text-text3">
            No crew profiles are currently available.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <BlueOriginRouteTraceLink
          href="/blue-origin"
          traceLabel="Blue Origin Program"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Program
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/missions/new-shepard"
          traceLabel="New Shepard Mission Hub"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          New Shepard
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/flights"
          traceLabel="Blue Origin Flights Index"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Flights
        </BlueOriginRouteTraceLink>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(parsed));
}
