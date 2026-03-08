import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ImageCreditLine } from '@/components/ImageCreditLine';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXDroneShipDetail, parseSpaceXDroneShipSlug } from '@/lib/server/spacexDroneShips';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseSpaceXDroneShipSlug(params.slug);
  if (!slug) return { title: `SpaceX Drone Ship | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const detail = await fetchSpaceXDroneShipDetail(slug);
  if (!detail) return { title: `SpaceX Drone Ship | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/spacex/drone-ships/${detail.ship.slug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.ship.name} Drone-Ship Profile | ${BRAND_NAME}`;
  const description = `${detail.ship.name} recovery profile with launch assignments, booster reuse links, launch-site coverage, and mission mix.`;
  const ogImage = detail.ship.imageUrl || siteMeta.ogImage;
  const ogImageAlt = detail.ship.imageAlt || SITE_META.ogImageAlt;

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
      images: [{ url: ogImage, alt: ogImageAlt }]
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: ogImage, alt: ogImageAlt }] }
  };
}

export default async function SpaceXDroneShipDetailPage({ params }: { params: Params }) {
  const slug = parseSpaceXDroneShipSlug(params.slug);
  if (!slug) notFound();
  if (params.slug !== slug) permanentRedirect(`/spacex/drone-ships/${slug}`);

  const detail = await fetchSpaceXDroneShipDetail(slug);
  if (!detail) notFound();

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/drone-ships/${detail.ship.slug}`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Drone Ships', item: `${siteUrl}/spacex/drone-ships` },
      { '@type': 'ListItem', position: 4, name: detail.ship.name, item: pageUrl }
    ]
  };

  const profileJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': pageUrl,
    url: pageUrl,
    name: detail.ship.name,
    description: detail.ship.description,
    dateModified: detail.coverage.lastVerifiedAt || detail.generatedAt,
    image: detail.ship.imageUrl || undefined,
    sameAs: [detail.ship.wikipediaUrl, detail.ship.wikiSourceUrl].filter(Boolean)
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, profileJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Drone-Ship Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{detail.ship.name}</h1>
        <p className="max-w-4xl text-sm text-text2">{detail.ship.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Abbrev: {detail.ship.abbrev || detail.ship.slug.toUpperCase()}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Status: {detail.ship.status}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Known assignments: {detail.ship.kpis.assignmentsKnown}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Upcoming: {detail.ship.kpis.upcomingAssignments}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Distinct boosters: {detail.ship.kpis.distinctBoostersRecovered}</span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Coverage vs SpaceX launch cache: {detail.ship.kpis.coveragePercent.toFixed(1)}%
          </span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Ship image</h2>
          {detail.ship.imageUrl ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-stroke bg-surface-0">
              <img
                src={detail.ship.imageUrl}
                alt={detail.ship.imageAlt || `${detail.ship.name} drone ship`}
                className="h-64 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="px-2 pb-2">
                <ImageCreditLine
                  credit={detail.ship.imageCredit || undefined}
                  license={detail.ship.imageLicense || undefined}
                  licenseUrl={detail.ship.imageLicenseUrl || undefined}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-text3">No ship photo is currently available from the configured Wiki sources.</p>
          )}
          {detail.ship.imageSourceUrl ? (
            <a href={detail.ship.imageSourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs text-primary hover:text-primary/80">
              Source file
            </a>
          ) : null}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Static vessel facts</h2>
          <dl className="mt-3 space-y-2 text-sm text-text2">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Built</dt>
              <dd>{detail.ship.yearBuilt || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Length</dt>
              <dd>{formatLengthMeters(detail.ship.lengthM)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Home port</dt>
              <dd>{detail.ship.homePort || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Owner</dt>
              <dd>{detail.ship.ownerName || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Operator</dt>
              <dd>{detail.ship.operatorName || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <dt className="text-text3">Country</dt>
              <dd>{detail.ship.countryName || 'Unknown'}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text3">
            {detail.ship.wikipediaUrl ? (
              <a href={detail.ship.wikipediaUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                Wikipedia
              </a>
            ) : null}
            {detail.ship.wikiSourceUrl ? (
              <a href={detail.ship.wikiSourceUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                Wikidata
              </a>
            ) : null}
            {detail.ship.wikimediaCommonsCategory ? (
              <a
                href={`https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(
                  detail.ship.wikimediaCommonsCategory.replace(/\s+/g, '_')
                )}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-stroke px-2 py-1 hover:text-text1"
              >
                Commons
              </a>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-text3">Wiki metadata last synced: {formatDateTime(detail.ship.wikiLastSyncedAt)}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Launch site coverage</h2>
          {detail.launchSites.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {detail.launchSites.map((site) => (
                <li key={site.name} className="flex items-center justify-between rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <span className="min-w-0 truncate">{site.name}</span>
                  <span className="text-xs text-text3">{site.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No launch-site assignments are currently mapped.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Mission mix</h2>
          {detail.missionMix.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {detail.missionMix.map((mission) => (
                <li key={mission.missionKey} className="flex items-center justify-between rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <span>{mission.missionLabel}</span>
                  <span className="text-xs text-text3">{mission.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No mission mix data available yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Upcoming recoveries</h2>
        {detail.upcomingAssignments.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {detail.upcomingAssignments.map((entry) => (
              <li key={`${entry.launchId}:${entry.shipSlug}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/spacex/flights/${entry.flightSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                      {entry.launchName}
                    </Link>
                    <p className="mt-1 text-xs text-text3">
                      {entry.missionLabel} • {entry.padShortCode || entry.padName || 'Pad TBD'}
                    </p>
                  </div>
                  <span className="text-xs text-text3">{formatDateTime(entry.launchNet)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  <Link href={entry.launchHref} className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    Launch page
                  </Link>
                  <span className="rounded-full border border-stroke px-2 py-1">Landing: {entry.landingResult}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No upcoming recoveries are currently mapped to this drone ship.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Recent recovery assignments</h2>
        {detail.recentAssignments.length ? (
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {detail.recentAssignments.slice(0, 80).map((entry) => (
              <li key={`${entry.launchId}:${entry.shipSlug}:${entry.sourceLandingId || 'na'}`} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/spacex/flights/${entry.flightSlug}`} className="font-semibold text-text1 hover:text-primary">
                      {entry.launchName}
                    </Link>
                    <p className="mt-1 text-xs text-text3">
                      {entry.missionLabel} • {entry.vehicle || 'Vehicle TBD'} • {entry.padShortCode || entry.padName || 'Pad TBD'}
                    </p>
                  </div>
                  <span className="text-xs text-text3">{formatDateTime(entry.launchNet)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  <span className="rounded-full border border-stroke px-2 py-1">Landing: {entry.landingResult}</span>
                  <Link href={entry.launchHref} className="rounded-full border border-stroke px-2 py-1 hover:text-text1">
                    Launch page
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No recent assignments are currently mapped.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Booster cores recovered by this ship</h2>
        {detail.boosters.length ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-sm text-text2">
            {detail.boosters.map((booster) => (
              <li key={booster.ll2LauncherId} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                <Link
                  href={`/catalog/launchers/${encodeURIComponent(String(booster.ll2LauncherId))}`}
                  className="font-semibold text-text1 hover:text-primary"
                >
                  {booster.serialNumber || `Core ${booster.ll2LauncherId}`}
                </Link>
                <p className="mt-1 text-xs text-text3">{booster.missions} tracked mission{booster.missions === 1 ? '' : 's'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No booster-link records are currently available for this ship.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Coverage context</h2>
        <p className="mt-2 text-sm text-text2">
          This ship currently has {detail.ship.kpis.assignmentsKnown} known assignments. Global drone-ship coverage across SpaceX cache is{' '}
          {detail.coverage.coveragePercent.toFixed(1)}% ({detail.coverage.knownLandingAssignments} / {detail.coverage.totalSpaceXLaunches}).
        </p>
        <p className="mt-2 text-sm text-text2">Last assignment refresh: {formatDateTime(detail.coverage.lastVerifiedAt)}.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/spacex/drone-ships" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Drone ships index
        </Link>
        <Link href="/spacex/flights" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Flights
        </Link>
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
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

function formatLengthMeters(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Unknown';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
}
