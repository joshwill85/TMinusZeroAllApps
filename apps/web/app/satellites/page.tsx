import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSatelliteOwnerIndexBatch, fetchSatellitePreviewBatch } from '@/lib/server/satellites';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildSatelliteHref, buildSatelliteOwnerHref, formatSatelliteOwnerLabel } from '@/lib/utils/satelliteLinks';

export const revalidate = 60 * 10; // 10 minutes
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = '/satellites';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Satellite Catalog | ${BRAND_NAME}`;
  const description = 'Browse searchable NORAD satellite records, owner hubs, and launch associations.';

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
      images: [
        {
          url: siteMeta.ogImage,
          alt: SITE_META.ogImageAlt
        }
      ]
    }
  };
}

export default async function SatellitesIndexPage() {
  const [satellites, ownerRows] = await Promise.all([fetchSatellitePreviewBatch(60, 0), fetchSatelliteOwnerIndexBatch(24, 0)]);
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const pageUrl = `${siteUrl}/satellites`;

  const topOwnerRows = ownerRows
    .map((row) => ({
      ...row,
      href: buildSatelliteOwnerHref(row.owner),
      label: formatSatelliteOwnerLabel(row.owner) || row.owner
    }))
    .filter((row) => row.href != null);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Satellites', item: pageUrl }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': pageUrl,
      url: pageUrl,
      name: 'Satellite Catalog',
      description: 'Browse searchable NORAD satellite records, owner hubs, and launch associations.'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${pageUrl}#satellites`,
      numberOfItems: satellites.length,
      itemListElement: satellites.slice(0, 100).map((sat, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Thing',
          name: sat.name || `NORAD ${sat.noradCatId}`,
          url: `${siteUrl}${buildSatelliteHref(sat.noradCatId)}`
        }
      }))
    }
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={jsonLd as any} />

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-[0.14em] text-text3">Catalog</div>
        <h1 className="text-3xl font-semibold text-text1">Satellites</h1>
        <p className="max-w-3xl text-sm text-text2">
          Browse recently updated NORAD catalog objects and jump into owner-level indexes for satellites tied to specific operators or countries.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/satellites/owners" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] text-text3 hover:text-text1">
            Browse owners
          </Link>
          <Link href="/" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] text-text3 hover:text-text1">
            Back to launch list
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Recently Updated Satellites</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {satellites.length} shown
          </span>
        </div>
        {satellites.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {satellites.map((sat) => {
              const href = buildSatelliteHref(sat.noradCatId);
              const ownerHref = sat.owner ? buildSatelliteOwnerHref(sat.owner) : null;
              const ownerLabel = sat.owner ? formatSatelliteOwnerLabel(sat.owner) || sat.owner : null;
              return (
                <li key={sat.noradCatId} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <Link href={href} className="text-sm font-semibold text-text1 hover:text-primary">
                    {sat.name || `NORAD ${sat.noradCatId}`}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text3">
                    <span>NORAD {sat.noradCatId}</span>
                    {sat.intlDes ? <span>{sat.intlDes}</span> : null}
                    {sat.objectType ? <span>{sat.objectType}</span> : null}
                    {ownerLabel ? (
                      <span>
                        {ownerHref ? (
                          <Link href={ownerHref} className="text-primary hover:underline">
                            {ownerLabel}
                          </Link>
                        ) : (
                          ownerLabel
                        )}
                      </span>
                    ) : null}
                  </div>
                  {sat.satcatUpdatedAt ? <div className="mt-2 text-[11px] text-text3">Updated: {sat.satcatUpdatedAt}</div> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">Satellite preview data is not available yet.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Top Owner Hubs</h2>
          <Link href="/satellites/owners" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            View all owners
          </Link>
        </div>
        {topOwnerRows.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topOwnerRows.map((row) => (
              <li key={row.owner} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <Link href={row.href || '/satellites/owners'} className="text-sm font-semibold text-text1 hover:text-primary">
                  {row.label}
                </Link>
                <div className="mt-1 text-xs text-text3">
                  {row.satelliteCount} satellite{row.satelliteCount === 1 ? '' : 's'}
                </div>
                {row.lastSatcatUpdatedAt ? <div className="mt-1 text-[11px] text-text3">Latest update: {row.lastSatcatUpdatedAt}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">Owner index data is not available yet.</p>
        )}
      </section>
    </div>
  );
}
