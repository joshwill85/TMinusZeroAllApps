import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchAllSatelliteOwners } from '@/lib/server/satellites';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildSatelliteOwnerHref, formatSatelliteOwnerLabel } from '@/lib/utils/satelliteLinks';

export const revalidate = 60 * 10; // 10 minutes
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = '/satellites/owners';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Satellite Owners | ${BRAND_NAME}`;
  const description = 'Find satellites grouped by owner code and explore associated launches and catalog objects.';

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

export default async function SatelliteOwnersPage() {
  const owners = await fetchAllSatelliteOwners();
  const rows = owners
    .map((row) => ({
      ...row,
      href: buildSatelliteOwnerHref(row.owner),
      label: formatSatelliteOwnerLabel(row.owner) || row.owner
    }))
    .filter((row) => row.href != null);

  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const pageUrl = `${siteUrl}/satellites/owners`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Satellites', item: `${siteUrl}/satellites` },
        { '@type': 'ListItem', position: 3, name: 'Owners', item: pageUrl }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': pageUrl,
      url: pageUrl,
      name: 'Satellite Owners',
      description: 'Owner-level index for satellites in the catalog.'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${pageUrl}#owners`,
      numberOfItems: rows.length,
      itemListElement: rows.slice(0, 200).map((row, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Thing',
          name: row.label,
          url: `${siteUrl}${row.href}`
        }
      }))
    }
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={jsonLd as any} />

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-[0.14em] text-text3">Satellite Index</div>
        <h1 className="text-3xl font-semibold text-text1">Satellite Owners</h1>
        <p className="max-w-3xl text-sm text-text2">
          Search-engine friendly owner hubs with satellite counts, launch links, and object-level context from SATCAT data.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/satellites" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] text-text3 hover:text-text1">
            All satellites
          </Link>
          <Link href="/" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] text-text3 hover:text-text1">
            Back to launch list
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Owner hubs</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {rows.length} owners
          </span>
        </div>
        {rows.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
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
