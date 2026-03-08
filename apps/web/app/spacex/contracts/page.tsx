import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildSpaceXContractSlug,
  fetchSpaceXContracts
} from '@/lib/server/spacexProgram';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { hasPresentSearchParams, type RouteSearchParams } from '@/lib/utils/searchParams';
import { resolveShowCount } from '@/lib/utils/showCount';

export const revalidate = 60 * 10;
const SHOW_STEP = 100;

type SearchParams = RouteSearchParams;

export async function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex/contracts';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Contracts & Government Awards | ${BRAND_NAME}`;
  const description = 'SpaceX contracts index with government award context, obligations signals, and mission-linked detail pages.';

  return {
    title,
    description,
    alternates: { canonical },
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined,
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

export default async function SpaceXContractsPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const contracts = await fetchSpaceXContracts('all');
  const visibleCount = resolveShowCount(searchParams?.show, contracts.items.length, SHOW_STEP);
  const visibleContracts = contracts.items.slice(0, visibleCount);
  const hasMore = visibleCount < contracts.items.length;
  const nextVisibleCount = Math.min(contracts.items.length, visibleCount + SHOW_STEP);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/contracts`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Contracts', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Contracts Intelligence</p>
        <h1 className="text-3xl font-semibold text-text1">SpaceX Contracts</h1>
        <p className="max-w-3xl text-sm text-text2">
          Government and partner contract records associated with SpaceX mission families, with detail pages for award profile and obligation context.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Contracts: {contracts.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Showing: {visibleContracts.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Source: USAspending-derived + fallback records</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {contracts.items.length ? (
          <>
            <ul className="space-y-3">
              {visibleContracts.map((contract) => (
                <li key={contract.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/spacex/contracts/${buildSpaceXContractSlug(contract.contractKey)}`}
                        className="text-base font-semibold text-text1 hover:text-primary"
                      >
                        {contract.title}
                      </Link>
                      <p className="mt-1 text-sm text-text2">{contract.description || 'No description available.'}</p>
                    </div>
                    <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                      {contract.missionKey}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
                    <span>Awarded: {contract.awardedOn || 'Date pending'}</span>
                    <span>Agency: {contract.agency || 'N/A'}</span>
                    <span>Customer: {contract.customer || 'N/A'}</span>
                    {typeof contract.amount === 'number' ? <span>Amount: {formatCurrency(contract.amount)}</span> : null}
                    {contract.sourceUrl ? (
                      <a href={contract.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                        Source
                      </a>
                    ) : null}
                    <Link href={`/spacex/contracts/${buildSpaceXContractSlug(contract.contractKey)}`} className="text-primary hover:text-primary/80">
                      Drilldown
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {(hasMore || visibleCount > SHOW_STEP) && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text3">
                {hasMore ? (
                  <Link href={`/spacex/contracts?show=${nextVisibleCount}`} className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show {Math.min(SHOW_STEP, contracts.items.length - visibleCount)} more
                  </Link>
                ) : null}
                {hasMore ? (
                  <Link href={`/spacex/contracts?show=${contracts.items.length}`} className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show all
                  </Link>
                ) : null}
                {visibleCount > SHOW_STEP ? (
                  <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show first {SHOW_STEP}
                  </Link>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-text3">No contract records are currently present.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
        <Link href="/spacex/missions/starship" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Starship
        </Link>
        <Link href="/spacex/missions/dragon" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Dragon
        </Link>
        <Link href="/blue-origin/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Blue Origin Contracts
        </Link>
        <Link href="/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Canonical Contracts
        </Link>
        <Link href="/artemis/awardees" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Awardees
        </Link>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
