import type { Metadata } from 'next';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import {
  buildLegacyCatalogRedirectHref,
  buildCatalogCollectionPath,
  catalogEntityOptions,
} from '@/lib/utils/catalog';
import { hasPresentSearchParams, type RouteSearchParams } from '@/lib/utils/searchParams';

const CATALOG_TITLE = `Catalog | ${BRAND_NAME}`;
const CATALOG_DESCRIPTION = 'Browse launch-related data from Launch Library 2 across agencies, astronauts, vehicles, stations, locations, and events.';

type SearchParams = RouteSearchParams;

export function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Metadata {
  return {
    title: CATALOG_TITLE,
    description: CATALOG_DESCRIPTION,
    alternates: { canonical: '/catalog' },
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined
  };
}

export default async function CatalogHubPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const legacyCatalogHref = buildLegacyCatalogRedirectHref({
    entity: searchParams?.entity,
    region: searchParams?.region,
    q: searchParams?.q,
    page: searchParams?.page
  });
  if (legacyCatalogHref) permanentRedirect(legacyCatalogHref);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/catalog`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Info', item: `${siteUrl}/info` },
      { '@type': 'ListItem', position: 3, name: 'Catalog', item: pageUrl }
    ]
  };
  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'Launch Library 2 catalog hub',
    description: CATALOG_DESCRIPTION
  };
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${pageUrl}#collections`,
    numberOfItems: catalogEntityOptions.length,
    itemListElement: catalogEntityOptions.map((option, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${siteUrl}${buildCatalogCollectionPath(option.value)}`,
      name: option.label
    }))
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, itemListJsonLd]} />
      <Breadcrumbs
        className="mb-6"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Info', href: '/info' },
          { label: 'Catalog' }
        ]}
      />

      <header className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">Info Hub</p>
          <h1 className="text-3xl font-semibold text-text1">Launch Library 2 Catalog</h1>
        </div>
        <p className="max-w-4xl text-sm text-text2">
          Browse clean, indexable collection pages for agencies, astronauts, launch vehicles, locations, and other launch-related reference data.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Canonical browse paths</span>
          <span className="rounded-full border border-stroke px-3 py-1">Collection pages</span>
          <span className="rounded-full border border-stroke px-3 py-1">Launch Library 2 dataset</span>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalogEntityOptions.map((option) => (
          <Link
            key={option.value}
            href={buildCatalogCollectionPath(option.value)}
            className="group rounded-3xl border border-stroke bg-surface-1 p-5 transition hover:border-primary"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-text3">Collection</p>
                <h2 className="mt-2 text-xl font-semibold text-text1 group-hover:text-primary">{option.label}</h2>
              </div>
              <span className="rounded-full border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text3">
                Clean URL
              </span>
            </div>
            <p className="mt-3 text-sm text-text2">{option.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
