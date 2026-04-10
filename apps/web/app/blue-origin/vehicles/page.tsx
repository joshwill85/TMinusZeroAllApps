import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchBlueOriginVehicles, getBlueOriginMissionLabel } from '@/lib/server/blueOriginEntities';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const dynamic = 'force-dynamic';
export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/blue-origin/vehicles';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Blue Origin Vehicles: New Shepard, New Glenn, Blue Moon, Blue Ring | ${BRAND_NAME}`;
  const description =
    'Blue Origin vehicle catalog with deep-link pages for New Shepard, New Glenn, Blue Moon, and Blue Ring.';

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

export default async function BlueOriginVehiclesPage() {
  const response = await fetchBlueOriginVehicles('all');
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/vehicles`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blue Origin', item: `${siteUrl}/blue-origin` },
      { '@type': 'ListItem', position: 3, name: 'Vehicles', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Vehicle Catalog</p>
        <h1 className="text-3xl font-semibold text-text1">Blue Origin Vehicles</h1>
        <p className="max-w-3xl text-sm text-text2">
          Program-level index of Blue Origin vehicles with dedicated pages, mission routing, and linked engine coverage.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Vehicles tracked: {response.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Refresh cadence: Weekly chain</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {response.items.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {response.items.map((vehicle) => (
              <li key={vehicle.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/blue-origin/vehicles/${vehicle.vehicleSlug}`} className="text-base font-semibold text-text1 hover:text-primary">
                      {vehicle.displayName}
                    </Link>
                    <p className="mt-1 text-xs text-text3">{getBlueOriginMissionLabel(vehicle.missionKey)}</p>
                  </div>
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                    {vehicle.status || 'Status TBD'}
                  </span>
                </div>
                {vehicle.description ? <p className="mt-2 text-sm text-text2">{vehicle.description}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
                  <span>Class: {vehicle.vehicleClass || 'N/A'}</span>
                  <span>First flight: {vehicle.firstFlight || 'TBD'}</span>
                  {vehicle.officialUrl ? (
                    <a href={vehicle.officialUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                      Official
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text3">No vehicle records are available yet.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/blue-origin" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Program
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
