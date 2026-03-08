import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXEngineDetail, fetchSpaceXFlights, parseSpaceXEngineSlug } from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseSpaceXEngineSlug(params.slug);
  if (!slug) return { title: `SpaceX Engine | ${BRAND_NAME}`, robots: { index: false, follow: false } };
  const detail = await fetchSpaceXEngineDetail(slug);
  if (!detail) return { title: `SpaceX Engine | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/spacex/engines/${detail.engine.engineSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.engine.displayName} Engine Profile | ${BRAND_NAME}`;
  const description = detail.engine.description || `${detail.engine.displayName} profile with linked vehicle and mission context.`;

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

export default async function SpaceXEngineDetailPage({ params }: { params: Params }) {
  const slug = parseSpaceXEngineSlug(params.slug);
  if (!slug) notFound();
  if (slug !== params.slug) permanentRedirect(`/spacex/engines/${slug}`);

  const detail = await fetchSpaceXEngineDetail(slug);
  if (!detail) notFound();

  const flights = await fetchSpaceXFlights(detail.engine.missionKey);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/engines/${detail.engine.engineSlug}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Engines', item: `${siteUrl}/spacex/engines` },
      { '@type': 'ListItem', position: 4, name: detail.engine.displayName, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Engine Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{detail.engine.displayName}</h1>
        <p className="max-w-3xl text-sm text-text2">{detail.engine.description}</p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Linked vehicles</h2>
        {detail.vehicles.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {detail.vehicles.map((binding) => (
              <li key={`${binding.vehicleSlug}:${binding.engineSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <Link href={`/spacex/vehicles/${binding.vehicleSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                  {binding.vehicle?.displayName || binding.vehicleSlug}
                </Link>
                <p className="mt-1 text-xs text-text3">{binding.role || 'Role not specified'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No linked vehicles available.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission flights</h2>
        {flights.items.length ? (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {flights.items.slice(0, 16).map((flight) => (
              <li key={flight.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                <Link href={`/spacex/flights/${flight.flightSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                  {flight.launch.name}
                </Link>
                <p className="mt-1 text-xs text-text3">{formatDate(flight.launch.net)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No mission flights currently mapped.</p>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(parsed));
}
