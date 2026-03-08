import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXFlights, fetchSpaceXTrackedFlightCount } from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { getSpaceXMissionLabel } from '@/lib/utils/spacexProgram';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex/flights';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Flight Index | ${BRAND_NAME}`;
  const description = 'SpaceX flight index grouped by mission family with mission records and drone-ship recovery links.';

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
      images: [{ url: siteMeta.ogImage, width: 1200, height: 630, alt: SITE_META.ogImageAlt, type: 'image/jpeg' }]
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }] }
  };
}

export default async function SpaceXFlightsPage() {
  const [response, trackedFlightsCount] = await Promise.all([fetchSpaceXFlights('all'), fetchSpaceXTrackedFlightCount()]);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/flights`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Flights', item: pageUrl }
    ]
  };

  const grouped = groupByMission(response.items);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Flight Index</p>
        <h1 className="text-3xl font-semibold text-text1">SpaceX Flights</h1>
        <p className="max-w-3xl text-sm text-text2">High-level flight index grouped by mission family with mapped drone-ship recovery links.</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Tracked flights: {trackedFlightsCount}</span>
          {trackedFlightsCount > response.items.length ? (
            <span className="rounded-full border border-stroke px-3 py-1">Showing latest: {response.items.length}</span>
          ) : null}
        </div>
      </header>

      {grouped.length ? (
        <section className="space-y-4">
          {grouped.map((group) => (
            <section key={group.missionKey} className="rounded-2xl border border-stroke bg-surface-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-text1">{group.missionLabel}</h2>
                <Link
                  href={group.missionKey === 'spacex-program' ? '/spacex' : `/spacex/missions/${group.missionKey}`}
                  className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
                >
                  Mission hub
                </Link>
              </div>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {group.items.map((flight) => (
                  <li key={flight.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/spacex/flights/${flight.flightSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                          {flight.launch.name}
                        </Link>
                        <p className="mt-1 text-xs text-text3">
                          {flight.launch.provider} • {flight.launch.vehicle}
                          {flight.droneShipSlug ? (
                            <>
                              {' '}
                              •{' '}
                              <Link href={`/spacex/drone-ships/${flight.droneShipSlug}`} className="hover:text-text1">
                                {flight.droneShipName || flight.droneShipAbbrev || flight.droneShipSlug.toUpperCase()}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span className="text-xs text-text3">{formatDate(flight.launch.net)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <p className="text-sm text-text3">No flight records are available yet.</p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Program
        </Link>
        <Link href="/spacex/vehicles" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Vehicles
        </Link>
        <Link href="/spacex/engines" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Engines
        </Link>
        <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Contracts
        </Link>
        <Link href="/spacex/drone-ships" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Drone ships
        </Link>
      </div>
    </div>
  );
}

function groupByMission(items: Awaited<ReturnType<typeof fetchSpaceXFlights>>['items']) {
  const byMission = new Map<string, typeof items>();
  for (const item of items) {
    const existing = byMission.get(item.missionKey) || [];
    byMission.set(item.missionKey, [...existing, item]);
  }

  return [...byMission.entries()]
    .map(([missionKey, missionItems]) => ({
      missionKey,
      missionLabel: getSpaceXMissionLabel(missionKey as Parameters<typeof getSpaceXMissionLabel>[0]),
      items: missionItems.sort((a, b) => Date.parse(b.launch.net) - Date.parse(a.launch.net))
    }))
    .sort((a, b) => a.missionLabel.localeCompare(b.missionLabel));
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(parsed));
}
