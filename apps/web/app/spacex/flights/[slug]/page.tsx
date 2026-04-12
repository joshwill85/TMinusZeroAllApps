import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { TimeDisplay } from '@/components/TimeDisplay';
import { BRAND_NAME } from '@/lib/brand';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchLaunchBoosterStats } from '@/lib/server/launchBoosterStats';
import {
  buildSpaceXContractSlug,
  fetchSpaceXContractPreview,
  fetchSpaceXFlightBySlug,
  fetchSpaceXPassengers,
  fetchSpaceXPayloads
} from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { parseSpaceXFlightSlug } from '@/lib/utils/spacexProgram';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = parseSpaceXFlightSlug(params.slug);
  if (!slug) return { title: `SpaceX Flight | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const flight = await fetchSpaceXFlightBySlug(slug);
  if (!flight) return { title: `SpaceX Flight | ${BRAND_NAME}`, robots: { index: false, follow: false } };

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/spacex/flights/${flight.flightSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${flight.launch.name} Mission Tracker | ${BRAND_NAME}`;
  const description = `${flight.launch.name} launch detail with passenger, payload, drone-ship recovery target, and contracts-linked context.`;

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

export default async function SpaceXFlightPage({ params }: { params: Params }) {
  const parsed = parseSpaceXFlightSlug(params.slug);
  if (!parsed) notFound();
  if (params.slug !== parsed) permanentRedirect(`/spacex/flights/${parsed}`);

  const flight = await fetchSpaceXFlightBySlug(parsed);
  if (!flight) notFound();

  const [passengers, payloads, contractPreview, boosterStats] = await Promise.all([
    fetchSpaceXPassengers(flight.missionKey),
    fetchSpaceXPayloads(flight.missionKey),
    fetchSpaceXContractPreview(8, flight.missionKey),
    fetchLaunchBoosterStats(flight.launch.id, flight.launch.ll2Id)
  ]);

  const launch = flight.launch;
  const launchPassengers = passengers.items.filter((entry) => entry.launchId === launch.id);
  const launchPayloads = payloads.items.filter((entry) => entry.launchId === launch.id);
  const currentYear = new Date().getUTCFullYear();

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/flights/${flight.flightSlug}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Flights', item: `${siteUrl}/spacex/flights` },
      { '@type': 'ListItem', position: 4, name: launch.name, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Flight Hub</p>
        <h1 className="text-3xl font-semibold text-text1">{launch.name}</h1>
        <p className="max-w-3xl text-sm text-text2">
          Flight-level coverage with launch timing, traveler and payload context, drone-ship recovery targeting, and related contract records.
        </p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
        <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                {launch.name}
              </Link>
              <p className="mt-1 text-xs text-text3">
                {launch.provider} • {launch.vehicle} • {launch.pad?.shortCode || 'Pad TBD'}
              </p>
            </div>
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              Status: {launch.statusText}
            </span>
          </div>
          {!isDateOnlyNet(launch.net, launch.netPrecision) ? (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
              <Countdown net={launch.net} />
            </div>
          ) : null}
          <TimeDisplay net={launch.net} netPrecision={launch.netPrecision} fallbackTimeZone={launch.pad.timezone} />
          <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-xs text-text3">
            <p className="uppercase tracking-[0.12em] text-text3">First-stage landing target</p>
            {flight.droneShipSlug ? (
              <p className="mt-1">
                <Link href={`/spacex/drone-ships/${flight.droneShipSlug}`} className="font-semibold text-text1 hover:text-primary">
                  {flight.droneShipName || flight.droneShipAbbrev || flight.droneShipSlug.toUpperCase()}
                </Link>
                {' '}• landing status: {formatLandingResultLabel(flight.droneShipLandingResult)}
              </p>
            ) : (
              <p className="mt-1">No drone-ship assignment is currently available for this flight.</p>
            )}
          </div>
        </div>
      </section>

      {boosterStats.length > 0 ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-text1">First-stage boosters</h2>
              <p className="text-sm text-text2">Core serials and mission stats for this flight.</p>
            </div>
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              {boosterStats.length} core{boosterStats.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {boosterStats.map((booster) => {
              const serialLabel = booster.serialNumber || `Core ${booster.ll2LauncherId}`;
              const statusLabel = booster.status || 'Status unknown';
              const firstFlightLabel = formatDateOnlyLabel(booster.firstLaunchDate);
              const lastMissionLabel = booster.lastMissionNet ? formatDateTimeLabel(booster.lastMissionNet) : formatDateOnlyLabel(booster.lastLaunchDate);
              const provenLabel =
                booster.flightProven === true
                  ? 'Flight proven'
                  : booster.flightProven === false
                    ? 'Not flight proven'
                    : 'Provenance unknown';

              return (
                <div key={booster.ll2LauncherId} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/catalog/launchers/${encodeURIComponent(String(booster.ll2LauncherId))}`}
                        className="text-sm font-semibold text-text1 hover:text-primary"
                      >
                        {serialLabel}
                      </Link>
                      <p className="text-xs text-text3">{statusLabel}</p>
                    </div>
                    <span className="rounded-full border border-stroke px-2 py-1 text-[11px] text-text2">{provenLabel}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                      <div className="text-[10px] uppercase tracking-[0.08em] text-text3">Total missions</div>
                      <div className="text-sm font-semibold text-text1">{formatCount(booster.totalMissions)}</div>
                    </div>
                    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                      <div className="text-[10px] uppercase tracking-[0.08em] text-text3">Tracked missions</div>
                      <div className="text-sm font-semibold text-text1">{formatCount(booster.trackedMissions)}</div>
                    </div>
                    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                      <div className="text-[10px] uppercase tracking-[0.08em] text-text3">{currentYear} missions</div>
                      <div className="text-sm font-semibold text-text1">{formatCount(booster.missionsThisYear)}</div>
                    </div>
                    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1">
                      <div className="text-[10px] uppercase tracking-[0.08em] text-text3">First flight</div>
                      <div className="text-sm font-semibold text-text1">{firstFlightLabel}</div>
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] text-text3">Last mission: {lastMissionLabel}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Travelers</h2>
          {launchPassengers.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {launchPassengers.map((person) => (
                <li key={person.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <p className="font-semibold text-text1">{person.name}</p>
                  <p className="text-xs text-text3">{person.role || 'Passenger'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No traveler records for this flight.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Payloads</h2>
          {launchPayloads.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {launchPayloads.map((payload) => (
                <li key={payload.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <p className="font-semibold text-text1">{payload.name}</p>
                  <p className="text-xs text-text3">{payload.payloadType || 'Payload'} • {payload.orbit || 'Orbit TBD'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No payload records for this flight.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Related contracts</h2>
        {contractPreview.total ? (
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {contractPreview.items.map((contract) => (
              <li key={contract.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <Link
                  href={`/spacex/contracts/${buildSpaceXContractSlug(contract.contractKey)}`}
                  className="font-semibold text-text1 hover:text-primary"
                >
                  {contract.title}
                </Link>
                <p className="mt-1">{contract.description}</p>
                <p className="mt-1 text-xs text-text3">{contract.awardedOn || 'Date pending'} • {contract.agency || contract.customer || 'Public record'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No related contract records for this mission family yet.</p>
        )}
      </section>
    </div>
  );
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return value.toLocaleString('en-US');
}

function formatDateOnlyLabel(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return '--';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

function formatDateTimeLabel(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return '--';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(parsed);
}

function formatLandingResultLabel(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'success') return 'successful';
  if (normalized === 'failure') return 'failed';
  if (normalized === 'no_attempt') return 'no attempt';
  return 'unknown';
}
