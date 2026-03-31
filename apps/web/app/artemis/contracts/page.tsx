import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { buildArtemisContractHref, fetchArtemisContracts } from '@/lib/server/artemisContracts';
import { getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { ARTEMIS_MISSION_HUB_KEYS, type ArtemisMissionHubKey } from '@/lib/types/artemis';
import type { ArtemisContractSummary } from '@/lib/server/artemisContracts';
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
  const canonical = '/artemis/contracts';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis Contracts & Awards | ${BRAND_NAME}`;
  const description = 'Artemis contract pages with action history, notices, and linked source records.';

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

export default async function ArtemisContractsPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const contracts = await fetchArtemisContracts({ limit: 500 });
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/artemis/contracts`;
  const byPiid = dedupeContractsByPiid(contracts);
  const visibleCount = resolveShowCount(searchParams?.show, byPiid.length, SHOW_STEP);
  const visibleContracts = byPiid.slice(0, visibleCount);
  const hasMore = visibleCount < byPiid.length;
  const nextVisibleCount = Math.min(byPiid.length, visibleCount + SHOW_STEP);
  const totalRows = contracts.length;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Contracts', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Contracts</p>
        <h1 className="text-3xl font-semibold text-text1">Artemis Contracts</h1>
        <p className="max-w-3xl text-sm text-text2">
          Internal contract pages built from Artemis award and notice records.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Contracts: {totalRows}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Contract pages: {byPiid.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Showing: {visibleContracts.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {byPiid.length ? (
          <>
            <ul className="space-y-3">
              {visibleContracts.map((contract) => {
                const missionLabel = resolveMissionLabel(contract.missionKey);
                return (
                  <li key={contract.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link href={buildArtemisContractHref(contract.piid)} className="text-base font-semibold text-text1 hover:text-primary">
                          {contract.contractKey}
                        </Link>
                        <p className="mt-1 text-sm text-text2">
                          {contract.description || 'No description available.'}
                        </p>
                      </div>
                      <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                        {missionLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
                      <span>PIID: {contract.piid}</span>
                      <span>Awardee: {contract.awardeeName || 'Unknown'}</span>
                      <span>Base award: {formatDateLabel(contract.baseAwardDate)}</span>
                      {contract.contractType ? <span>Type: {contract.contractType}</span> : null}
                      <Link href={buildArtemisContractHref(contract.piid)} className="text-primary hover:text-primary/80">
                        Open contract page
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            {(hasMore || visibleCount > SHOW_STEP) && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text3">
                {hasMore ? (
                  <Link href={`/artemis/contracts?show=${nextVisibleCount}`} className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show {Math.min(SHOW_STEP, byPiid.length - visibleCount)} more
                  </Link>
                ) : null}
                {hasMore ? (
                  <Link href={`/artemis/contracts?show=${byPiid.length}`} className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show all
                  </Link>
                ) : null}
                {visibleCount > SHOW_STEP ? (
                  <Link href="/artemis/contracts" className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
                    Show first {SHOW_STEP}
                  </Link>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-text3">No Artemis contract records are currently present.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Program
        </Link>
        <Link href="/artemis/awardees" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Awardees
        </Link>
        <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Contracts
        </Link>
        <Link href="/blue-origin/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Blue Origin Contracts
        </Link>
        <Link href="/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          All Contracts
        </Link>
      </div>
    </div>
  );
}

function resolveMissionLabel(missionKey: string | null) {
  if (!missionKey) return 'Artemis Program';
  const isArtemisMission = (value: string | null): value is ArtemisMissionHubKey => {
    return value !== null && (ARTEMIS_MISSION_HUB_KEYS as readonly string[]).includes(value);
  };
  const mission = isArtemisMission(missionKey)
    ? getArtemisMissionProfileDefault(missionKey).shortLabel
    : missionKey;
  return mission || 'Artemis Program';
}

function dedupeContractsByPiid(contracts: ArtemisContractSummary[]) {
  const rowsByPiid = new Map<string, typeof contracts[number]>();
  for (const row of contracts) {
    const current = rowsByPiid.get(row.piid);
    if (!current || (row.updatedAt || '') > (current.updatedAt || '')) {
      rowsByPiid.set(row.piid, row);
    }
  }
  return [...rowsByPiid.values()].sort((a, b) => {
    const aDate = Date.parse(a.baseAwardDate || '');
    const bDate = Date.parse(b.baseAwardDate || '');
    return bDate - aDate || (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

function formatDateLabel(value: string | null) {
  if (!value) return 'n/a';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(parsed));
}
