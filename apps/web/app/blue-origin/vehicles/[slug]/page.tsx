import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ChronoHelixTimeline, type TimelineNode } from '@/components/ChronoHelixTimeline';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import {
  fetchBlueOriginFlights,
  fetchBlueOriginVehicleDetail,
  getBlueOriginMissionLabel,
  parseBlueOriginVehicleSlug
} from '@/lib/server/blueOriginEntities';
import { fetchBlueOriginPassengers, fetchBlueOriginPayloads } from '@/lib/server/blueOriginPeoplePayloads';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseBlueOriginVehicleSlug(params.slug);
  if (!slug) {
    return {
      title: `Blue Origin Vehicle | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const detail = await fetchBlueOriginVehicleDetail(slug);
  if (!detail) {
    return {
      title: `Blue Origin Vehicle | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/blue-origin/vehicles/${detail.vehicle.vehicleSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.vehicle.displayName} Vehicle Profile, Flights, Travelers & Engines | ${BRAND_NAME}`;
  const description =
    detail.vehicle.description ||
    `${detail.vehicle.displayName} vehicle profile with engine bindings, mission routes, and flight-linked passenger/payload context.`;

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
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function BlueOriginVehicleDetailPage({ params }: { params: Params }) {
  const slug = parseBlueOriginVehicleSlug(params.slug);
  if (!slug) notFound();
  if (slug !== params.slug) permanentRedirect(`/blue-origin/vehicles/${slug}`);

  const detail = await fetchBlueOriginVehicleDetail(slug);
  if (!detail) notFound();

  const { vehicle, engines } = detail;
  const [flights, passengers, payloads] = await Promise.all([
    fetchBlueOriginFlights(vehicle.missionKey),
    fetchBlueOriginPassengers(vehicle.missionKey),
    fetchBlueOriginPayloads(vehicle.missionKey)
  ]);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/vehicles/${vehicle.vehicleSlug}`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blue Origin', item: `${siteUrl}/blue-origin` },
      { '@type': 'ListItem', position: 3, name: 'Vehicles', item: `${siteUrl}/blue-origin/vehicles` },
      { '@type': 'ListItem', position: 4, name: vehicle.displayName, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Vehicle Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{vehicle.displayName}</h1>
        <p className="max-w-3xl text-sm text-text2">
          {vehicle.description || `${vehicle.displayName} mission profile, linked engines, and mission-specific flight records.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Mission: {getBlueOriginMissionLabel(vehicle.missionKey)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Status: {vehicle.status || 'TBD'}</span>
          <span className="rounded-full border border-stroke px-3 py-1">First flight: {vehicle.firstFlight || 'TBD'}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Flights tracked: {flights.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Passengers: {passengers.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Payloads: {payloads.items.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission route</h2>
        <p className="mt-2 text-sm text-text2">
          This vehicle maps to the {getBlueOriginMissionLabel(vehicle.missionKey)} mission route.
        </p>
        <div className="mt-3">
          <BlueOriginRouteTraceLink
            href={vehicle.missionKey === 'blue-origin-program' ? '/blue-origin' : `/blue-origin/missions/${vehicle.missionKey}`}
            traceLabel={`${vehicle.displayName} mission hub`}
            className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
          >
            Open mission hub
          </BlueOriginRouteTraceLink>
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Linked engines</h2>
        {engines.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {engines.map((binding) => (
              <li key={`${binding.vehicleSlug}:${binding.engineSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/blue-origin/engines/${binding.engineSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                      {binding.engine?.displayName || binding.engineSlug.toUpperCase()}
                    </Link>
                    <p className="mt-1 text-xs text-text3">{binding.role || 'Role not specified'}</p>
                  </div>
                  <span className="text-xs text-text3">{binding.engine?.status || 'Status TBD'}</span>
                </div>
                {binding.notes ? <p className="mt-2 text-xs text-text3">{binding.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No engine links are available yet.</p>
        )}
      </section>

      <ChronoHelixTimeline
        nodes={buildBlueOriginVehicleTimelineNodes(flights.items, vehicle.displayName)}
        initialLaunchId="vehicle-focus"
        vehicleLabel={vehicle.displayName}
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/blue-origin/vehicles" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Vehicles
        </Link>
        <Link href="/blue-origin/engines" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Engines
        </Link>
        <Link href="/blue-origin/flights" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Flights
        </Link>
      </div>
    </div>
  );
}

function buildBlueOriginVehicleTimelineNodes(
  flights: Awaited<ReturnType<typeof fetchBlueOriginFlights>>['items'],
  vehicleLabel: string
): TimelineNode[] {
  return flights.map((flight) => ({
    id: flight.id,
    date: flight.launchDate || '',
    status: inferTimelineStatus(flight.status, flight.launchDate),
    vehicleName: vehicleLabel || getBlueOriginMissionLabel(flight.missionKey),
    missionName: flight.launchName || flight.flightCode.toUpperCase(),
    isCurrent: false,
    statusLabel: flight.status || undefined,
    href: `/blue-origin/flights/${encodeURIComponent(flight.flightSlug)}`
  }));
}

function inferTimelineStatus(statusLabel?: string | null, netIso?: string | null): TimelineNode['status'] {
  const label = String(statusLabel || '').toLowerCase();
  if (label.includes('success')) return 'success';
  if (label.includes('failure') || label.includes('fail') || label.includes('scrub') || label.includes('abort')) {
    return 'failure';
  }
  if (label.includes('hold') || label.includes('tbd') || label.includes('go') || label.includes('pending')) return 'upcoming';
  if (netIso) {
    const timestamp = Date.parse(netIso);
    if (Number.isFinite(timestamp) && timestamp > Date.now()) return 'upcoming';
  }
  return 'failure';
}
