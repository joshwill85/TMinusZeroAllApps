import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ChronoHelixTimeline, type TimelineNode } from '@/components/ChronoHelixTimeline';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXFlights, fetchSpaceXVehicleDetail, parseSpaceXVehicleSlug } from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseSpaceXVehicleSlug(params.slug);
  if (!slug) {
    return { title: `SpaceX Vehicle | ${BRAND_NAME}`, robots: { index: false, follow: false } };
  }
  const detail = await fetchSpaceXVehicleDetail(slug);
  if (!detail) return { title: `SpaceX Vehicle | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/spacex/vehicles/${detail.vehicle.vehicleSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.vehicle.displayName} Vehicle Profile | ${BRAND_NAME}`;
  const description =
    detail.vehicle.description || `${detail.vehicle.displayName} profile with linked engines and mission flight context.`;

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

export default async function SpaceXVehicleDetailPage({ params }: { params: Params }) {
  const slug = parseSpaceXVehicleSlug(params.slug);
  if (!slug) notFound();
  if (slug !== params.slug) permanentRedirect(`/spacex/vehicles/${slug}`);

  const detail = await fetchSpaceXVehicleDetail(slug);
  if (!detail) notFound();

  const flights = await fetchSpaceXFlights(detail.vehicle.missionKey);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/vehicles/${detail.vehicle.vehicleSlug}`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Vehicles', item: `${siteUrl}/spacex/vehicles` },
      { '@type': 'ListItem', position: 4, name: detail.vehicle.displayName, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Vehicle Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{detail.vehicle.displayName}</h1>
        <p className="max-w-3xl text-sm text-text2">{detail.vehicle.description}</p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Linked engines</h2>
        {detail.engines.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {detail.engines.map((binding) => (
              <li key={`${binding.vehicleSlug}:${binding.engineSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <Link href={`/spacex/engines/${binding.engineSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                  {binding.engine?.displayName || binding.engineSlug}
                </Link>
                <p className="mt-1 text-xs text-text3">{binding.role || 'Role not specified'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No linked engines available.</p>
        )}
      </section>

      <ChronoHelixTimeline
        nodes={buildSpaceXVehicleTimelineNodes(flights.items, detail.vehicle.displayName)}
        initialLaunchId="vehicle-focus"
        vehicleLabel={detail.vehicle.displayName}
      />
    </div>
  );
}

function buildSpaceXVehicleTimelineNodes(flights: Awaited<ReturnType<typeof fetchSpaceXFlights>>['items'], vehicleLabel: string): TimelineNode[] {
  return flights.map((flight) => ({
    id: flight.id,
    date: flight.launch.net || '',
    status: inferTimelineStatus(flight.launch.statusText, flight.launch.net),
    vehicleName: vehicleLabel || flight.launch.vehicle || 'SpaceX vehicle',
    missionName: flight.launch.name || flight.flightSlug,
    isCurrent: false,
    statusLabel: flight.launch.statusText || undefined,
    href: `/spacex/flights/${encodeURIComponent(flight.flightSlug)}`
  }));
}

function inferTimelineStatus(statusLabel?: string | null, netIso?: string | null): TimelineNode['status'] {
  const label = String(statusLabel || '').toLowerCase();
  if (label.includes('success')) return 'success';
  if (label.includes('failure') || label.includes('fail') || label.includes('scrub') || label.includes('abort')) {
    return 'failure';
  }
  if (label.includes('hold') || label.includes('tbd') || label.includes('go')) return 'upcoming';
  if (netIso) {
    const timestamp = Date.parse(netIso);
    if (Number.isFinite(timestamp) && timestamp > Date.now()) return 'upcoming';
  }
  return 'failure';
}
