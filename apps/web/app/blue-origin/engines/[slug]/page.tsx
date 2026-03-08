import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import {
  fetchBlueOriginEngineDetail,
  fetchBlueOriginFlights,
  getBlueOriginMissionLabel,
  parseBlueOriginEngineSlug
} from '@/lib/server/blueOriginEntities';
import { fetchBlueOriginContracts } from '@/lib/server/blueOriginContracts';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseBlueOriginEngineSlug(params.slug);
  if (!slug) {
    return {
      title: `Blue Origin Engine | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const detail = await fetchBlueOriginEngineDetail(slug);
  if (!detail) {
    return {
      title: `Blue Origin Engine | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/blue-origin/engines/${detail.engine.engineSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.engine.displayName} Engine Profile, Vehicle Links & Mission Context | ${BRAND_NAME}`;
  const description =
    detail.engine.description ||
    `${detail.engine.displayName} engine page with linked vehicles, mission routes, and related flight/contract context.`;

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

export default async function BlueOriginEngineDetailPage({ params }: { params: Params }) {
  const slug = parseBlueOriginEngineSlug(params.slug);
  if (!slug) notFound();
  if (slug !== params.slug) permanentRedirect(`/blue-origin/engines/${slug}`);

  const detail = await fetchBlueOriginEngineDetail(slug);
  if (!detail) notFound();

  const { engine, vehicles } = detail;
  const [flights, contracts] = await Promise.all([
    fetchBlueOriginFlights(engine.missionKey),
    fetchBlueOriginContracts(engine.missionKey)
  ]);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/engines/${engine.engineSlug}`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blue Origin', item: `${siteUrl}/blue-origin` },
      { '@type': 'ListItem', position: 3, name: 'Engines', item: `${siteUrl}/blue-origin/engines` },
      { '@type': 'ListItem', position: 4, name: engine.displayName, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Engine Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{engine.displayName}</h1>
        <p className="max-w-3xl text-sm text-text2">
          {engine.description || `${engine.displayName} engine profile with linked vehicles and mission context.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Mission: {getBlueOriginMissionLabel(engine.missionKey)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Status: {engine.status || 'TBD'}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Propellants: {engine.propellants || 'N/A'}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Flights tracked: {flights.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Contracts tracked: {contracts.items.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission route</h2>
        <p className="mt-2 text-sm text-text2">
          This engine maps to the {getBlueOriginMissionLabel(engine.missionKey)} mission route.
        </p>
        <div className="mt-3">
          <BlueOriginRouteTraceLink
            href={engine.missionKey === 'blue-origin-program' ? '/blue-origin' : `/blue-origin/missions/${engine.missionKey}`}
            traceLabel={`${engine.displayName} mission hub`}
            className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
          >
            Open mission hub
          </BlueOriginRouteTraceLink>
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Linked vehicles</h2>
        {vehicles.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {vehicles.map((binding) => (
              <li key={`${binding.vehicleSlug}:${binding.engineSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/blue-origin/vehicles/${binding.vehicleSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                      {binding.vehicle?.displayName || binding.vehicleSlug}
                    </Link>
                    <p className="mt-1 text-xs text-text3">{binding.role || 'Role not specified'}</p>
                  </div>
                  <span className="text-xs text-text3">{binding.vehicle?.status || 'Status TBD'}</span>
                </div>
                {binding.notes ? <p className="mt-2 text-xs text-text3">{binding.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No linked vehicles are available yet.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Recent mission flights</h2>
        {flights.items.length ? (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {flights.items.slice(0, 16).map((flight) => {
              const launchHref = flight.launchId
                ? buildLaunchHref({ id: flight.launchId, name: flight.launchName || flight.flightCode.toUpperCase() })
                : null;

              return (
                <li key={flight.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    {launchHref ? (
                      <Link href={launchHref} className="text-sm font-semibold text-text1 hover:text-primary">
                        {flight.flightCode.toUpperCase()}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold text-text1">{flight.flightCode.toUpperCase()}</span>
                    )}
                    <span className="text-xs text-text3">{flight.launchDate ? formatDate(flight.launchDate) : 'Date pending'}</span>
                  </div>
                  <p className="mt-1 text-xs text-text3">{flight.launchName || 'Mission flight record'}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No mission flights are currently mapped.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/blue-origin/engines" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Engines
        </Link>
        <Link href="/blue-origin/vehicles" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Vehicles
        </Link>
        <Link href="/blue-origin/flights" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Flights
        </Link>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(parsed));
}
