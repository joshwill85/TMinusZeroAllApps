import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import {
  fetchBlueOriginFlights,
  getBlueOriginMissionLabel
} from '@/lib/server/blueOriginEntities';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/blue-origin/flights';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Blue Origin Flights Index: New Shepard, New Glenn & Notable Missions | ${BRAND_NAME}`;
  const description =
    'Blue Origin flight index with mission-family groupings and links to canonical launch detail pages.';

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

export default async function BlueOriginFlightsPage() {
  const response = await fetchBlueOriginFlights('all');
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/flights`;

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
      { '@type': 'ListItem', position: 3, name: 'Flights', item: pageUrl }
    ]
  };

  const grouped = groupByMission(response.items);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Flight Index
        </p>
        <h1 className="text-3xl font-semibold text-text1">
          Blue Origin Flights
        </h1>
        <p className="max-w-3xl text-sm text-text2">
          High-level flight index grouped by mission family, with canonical
          launch-detail links.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Flights tracked: {response.items.length}
          </span>
        </div>
      </header>

      {grouped.length ? (
        <section className="space-y-4">
          {grouped.map((group) => (
            <section
              key={group.missionKey}
              className="rounded-2xl border border-stroke bg-surface-1 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-text1">
                  {group.missionLabel}
                </h2>
                <BlueOriginRouteTraceLink
                  href={
                    group.missionKey === 'blue-origin-program'
                      ? '/blue-origin'
                      : `/blue-origin/missions/${group.missionKey}`
                  }
                  traceLabel={`${group.missionLabel} mission hub`}
                  className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
                >
                  Mission hub
                </BlueOriginRouteTraceLink>
              </div>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {group.items.map((flight) => {
                  const launchHref = flight.launchId
                    ? buildLaunchHref({
                        id: flight.launchId,
                        name:
                          flight.launchName || flight.flightCode.toUpperCase()
                      })
                    : null;

                  return (
                    <li
                      key={flight.id}
                      className="rounded-xl border border-stroke bg-surface-0 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {launchHref ? (
                            <Link
                              href={launchHref}
                              className="text-sm font-semibold text-text1 hover:text-primary"
                            >
                              {flight.flightCode.toUpperCase()}
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-text1">
                              {flight.flightCode.toUpperCase()}
                            </span>
                          )}
                          <p className="mt-1 text-xs text-text3">
                            {flight.launchName || 'Mission flight record'}
                          </p>
                        </div>
                        <span className="text-xs text-text3">
                          {flight.launchDate
                            ? formatDate(flight.launchDate)
                            : 'Date pending'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text3">
                        <span>{flight.status || 'Status pending'}</span>
                        {flight.officialMissionUrl ? (
                          <a
                            href={flight.officialMissionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:text-primary/80"
                          >
                            Official
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <p className="text-sm text-text3">
            No flight records are available yet.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link
          href="/blue-origin"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Program
        </Link>
        <Link
          href="/blue-origin/travelers"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Crew
        </Link>
        <Link
          href="/blue-origin/vehicles"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Vehicles
        </Link>
        <Link
          href="/blue-origin/engines"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Engines
        </Link>
        <Link
          href="/blue-origin/contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Contracts
        </Link>
      </div>
    </div>
  );
}

function groupByMission(
  items: Awaited<ReturnType<typeof fetchBlueOriginFlights>>['items']
) {
  const byMission = new Map<string, typeof items>();

  for (const item of items) {
    const existing = byMission.get(item.missionKey) || [];
    byMission.set(item.missionKey, [...existing, item]);
  }

  return [...byMission.entries()]
    .map(([missionKey, missionItems]) => ({
      missionKey,
      missionLabel: getBlueOriginMissionLabel(
        missionKey as Parameters<typeof getBlueOriginMissionLabel>[0]
      ),
      items: missionItems.sort((a, b) => {
        const left = Date.parse(a.launchDate || '');
        const right = Date.parse(b.launchDate || '');
        if (!Number.isFinite(left) && !Number.isFinite(right))
          return a.flightCode.localeCompare(b.flightCode);
        if (!Number.isFinite(left)) return 1;
        if (!Number.isFinite(right)) return -1;
        return right - left;
      })
    }))
    .sort((a, b) => a.missionLabel.localeCompare(b.missionLabel));
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
