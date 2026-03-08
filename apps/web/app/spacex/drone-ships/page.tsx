import type { Metadata } from 'next';
import Link from 'next/link';
import { ImageCreditLine } from '@/components/ImageCreditLine';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXDroneShipsIndex } from '@/lib/server/spacexDroneShips';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex/drone-ships';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Drone Ships: OCISLY, ASOG, JRTI Recovery Tracker | ${BRAND_NAME}`;
  const description =
    'Dedicated SpaceX drone-ship dashboard covering OCISLY, A Shortfall of Gravitas, and Just Read the Instructions with recovery KPIs and linked launch records.';

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

export default async function SpaceXDroneShipsPage() {
  const response = await fetchSpaceXDroneShipsIndex();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/drone-ships`;
  const coverage = response.coverage;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Drone Ships', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'SpaceX Drone Ships',
    description: 'Index of SpaceX drone-ship profiles with recovery coverage and linked launch intelligence.',
    dateModified: coverage.lastVerifiedAt || response.generatedAt
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Recovery Fleet</p>
        <h1 className="text-3xl font-semibold text-text1">SpaceX Drone Ships</h1>
        <p className="max-w-4xl text-sm text-text2">
          Dedicated recovery intelligence for OCISLY, ASOG, and JRTI with linked launches, flight records, and assignment coverage KPIs.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Ships tracked: {response.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Known assignments: {coverage.knownLandingAssignments.toLocaleString('en-US')}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Coverage: {coverage.coveragePercent.toFixed(1)}%
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Upcoming known recoveries: {coverage.upcomingKnownAssignments.toLocaleString('en-US')}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Fleet roster</h2>
          <Link href="/api/public/spacex/drone-ships" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            Public API
          </Link>
        </div>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {response.items.map((ship) => (
            <li key={ship.slug} className="rounded-xl border border-stroke bg-surface-0 p-4">
              {ship.imageUrl ? (
                <div className="mb-3 overflow-hidden rounded-lg border border-stroke bg-surface-1">
                  <img
                    src={ship.imageUrl}
                    alt={ship.imageAlt || `${ship.name} drone ship`}
                    className="h-40 w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="px-2 pb-2">
                    <ImageCreditLine credit={ship.imageCredit || undefined} license={ship.imageLicense || undefined} licenseUrl={ship.imageLicenseUrl || undefined} />
                  </div>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/spacex/drone-ships/${ship.slug}`} className="text-base font-semibold text-text1 hover:text-primary">
                    {ship.name}
                  </Link>
                  <p className="mt-1 text-xs text-text3">{ship.abbrev || ship.slug.toUpperCase()} • {ship.status}</p>
                </div>
                <span className="rounded-full border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text3">
                  {ship.kpis.assignmentsKnown} known
                </span>
              </div>
              <p className="mt-2 text-sm text-text2">{ship.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                {ship.yearBuilt ? <span className="rounded-full border border-stroke px-2 py-1">Built {ship.yearBuilt}</span> : null}
                {ship.lengthM != null ? (
                  <span className="rounded-full border border-stroke px-2 py-1">Length {formatLengthMeters(ship.lengthM)}</span>
                ) : null}
                {ship.homePort ? <span className="rounded-full border border-stroke px-2 py-1">{ship.homePort}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                {ship.wikipediaUrl ? (
                  <a href={ship.wikipediaUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    Wikipedia
                  </a>
                ) : null}
                {ship.wikiSourceUrl ? (
                  <a href={ship.wikiSourceUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    Wikidata
                  </a>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                  <dt className="text-text3">Upcoming</dt>
                  <dd className="font-semibold text-text1">{ship.kpis.upcomingAssignments}</dd>
                </div>
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                  <dt className="text-text3">Past year</dt>
                  <dd className="font-semibold text-text1">{ship.kpis.assignmentsPastYear}</dd>
                </div>
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                  <dt className="text-text3">Boosters</dt>
                  <dd className="font-semibold text-text1">{ship.kpis.distinctBoostersRecovered}</dd>
                </div>
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                  <dt className="text-text3">Sites</dt>
                  <dd className="font-semibold text-text1">{ship.kpis.distinctLaunchSitesServed}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Upcoming first-stage recoveries</h2>
        {response.upcomingAssignments.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {response.upcomingAssignments.map((entry) => (
              <li key={`${entry.launchId}:${entry.shipSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/spacex/flights/${entry.flightSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                      {entry.launchName}
                    </Link>
                    <p className="mt-1 text-xs text-text3">
                      {entry.shipName} • {entry.missionLabel}
                    </p>
                  </div>
                  <span className="text-xs text-text3">{formatDateTime(entry.launchNet)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  <Link href={`/spacex/drone-ships/${entry.shipSlug}`} className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    {entry.shipAbbrev || entry.shipSlug.toUpperCase()}
                  </Link>
                  <Link href={entry.launchHref} className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    Launch page
                  </Link>
                  <span className="rounded-full border border-stroke px-2 py-1">Landing: {entry.landingResult}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No upcoming recovery assignments are currently mapped.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Coverage and ingestion status</h2>
        <p className="mt-2 text-sm text-text2">
          Known drone-ship assignments currently cover {coverage.knownLandingAssignments.toLocaleString('en-US')} of{' '}
          {coverage.totalSpaceXLaunches.toLocaleString('en-US')} SpaceX launches in cache (
          {coverage.coveragePercent.toFixed(1)}%).
        </p>
        <p className="mt-2 text-sm text-text2">
          Last verified assignment refresh: {formatDateTime(coverage.lastVerifiedAt)}. Unknown recoveries remain visible as coverage gaps until landing metadata is available.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
        <Link href="/spacex/flights" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Flights
        </Link>
        <Link href="/spacex/missions" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Mission hubs
        </Link>
      </div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return 'Date pending';
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function formatLengthMeters(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 'n/a';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
}
