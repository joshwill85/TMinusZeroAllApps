import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import { isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref, buildProviderHref, buildRocketHref, toProviderSlug } from '@/lib/utils/launchLinks';
import { buildSlugId, slugify } from '@/lib/utils/slug';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';

export const revalidate = 60 * 5; // 5 minutes

type LocationHubData = {
  locationName: string;
  locationState?: string;
  locationCountry?: string;
  launchesUpcoming: Launch[];
  launchesRecent: Launch[];
  canonicalId: string;
};

type LocationIdentifier =
  | { kind: 'id'; id: number; raw: string; label: string }
  | { kind: 'name'; name: string; raw: string; label: string };

const SELECT_COLUMNS = [
  'launch_id',
  'name',
  'slug',
  'provider',
  'vehicle',
  'net',
  'net_precision',
  'status_name',
  'status_abbrev',
  'tier',
  'featured',
  'pad_name',
  'pad_short_code',
  'pad_state_code',
  'pad_timezone',
  'pad_location_name',
  'pad_country_code',
  'll2_pad_id',
  'll2_rocket_config_id',
  'rocket_full_name',
  'image_thumbnail_url'
].join(',');

const fetchLocationHub = cache(async (id: string): Promise<LocationHubData | null> => {
  if (!isSupabaseConfigured()) return null;
  const identifier = parseLocationIdentifier(id);
  if (!identifier) return null;

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();
  const upcomingLimit = 200;
  const recentLimit = 200;

  const [upcomingRes, recentRes] = await Promise.all([
    buildLocationQuery(supabase, identifier)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(upcomingLimit),
    buildLocationQuery(supabase, identifier)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(recentLimit)
  ]);

  if (upcomingRes.error || recentRes.error) return null;

  const upcoming = (upcomingRes.data || []).map(mapPublicCacheRow);
  const recent = (recentRes.data || []).map(mapPublicCacheRow);
  const sample = upcoming[0] || recent[0];
  if (!sample) return null;

  const locationName = sample.pad.locationName || sample.pad.name || identifier.label;
  const canonicalId = sample.ll2PadId != null ? String(sample.ll2PadId) : identifier.raw;

  return {
    locationName,
    locationState: sample.pad.state,
    locationCountry: sample.pad.countryCode,
    launchesUpcoming: upcoming,
    launchesRecent: recent,
    canonicalId
  };
});

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const data = await fetchLocationHub(params.id);
  if (!data) {
    return {
      title: `Location not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = buildLocationCanonicalPath(data.locationName, data.canonicalId);
  const pageUrl = `${siteUrl}${canonical}`;
  const isUsLocation = isUsCountryCode(data.locationCountry);
  const title = `${data.locationName} launch schedule${isUsLocation ? ' (US)' : ''} | ${SITE_META.siteName}`;
  const description = `Upcoming launches and recent history from ${data.locationName}${isUsLocation ? ' in the United States' : ''}.`;

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
          alt: `${data.locationName} launch schedule`,
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
          alt: `${data.locationName} launch schedule`
        }
      ]
    }
  };
}

export default async function LocationHubPage({ params }: { params: { id: string } }) {
  const data = await fetchLocationHub(params.id);
  if (!data) return notFound();
  const rawParam = safeDecode(params.id).trim();

  const { locationName, locationState, locationCountry, launchesUpcoming, launchesRecent, canonicalId } = data;
  const locationMeta = [locationState, locationCountry]
    .filter((value) => value && value !== 'NA')
    .join(' - ');
  const primaryProviderName = (launchesUpcoming[0]?.provider || launchesRecent[0]?.provider || '').trim();
  const providerScheduleHref = (() => {
    if (!primaryProviderName || primaryProviderName.toLowerCase() === 'unknown') return null;
    const slug = toProviderSlug(primaryProviderName);
    if (!slug) return null;
    return `/launch-providers/${encodeURIComponent(slug)}`;
  })();

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonicalPath = buildLocationCanonicalPath(locationName, canonicalId);
  const canonicalSegment = canonicalPath.split('/').pop();
  if (canonicalSegment && rawParam && canonicalSegment !== rawParam) {
    permanentRedirect(canonicalPath);
  }
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const schemaDescription = `Upcoming launches and recent history from ${locationName}.`;
  const addressRegion = locationState && locationState !== 'NA' ? locationState : undefined;
  const addressCountry = locationCountry && locationCountry !== 'NA' ? locationCountry : undefined;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Info', item: `${siteUrl}/info` },
      { '@type': 'ListItem', position: 3, name: 'Locations', item: `${siteUrl}/catalog/locations` },
      { '@type': 'ListItem', position: 4, name: locationName, item: pageUrl }
    ]
  };
  const placeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': `${pageUrl}#place`,
    name: locationName,
    url: pageUrl,
    address:
      addressRegion || addressCountry
        ? {
            '@type': 'PostalAddress',
            addressRegion,
            addressCountry
          }
        : undefined
  };
  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${locationName} launch schedule${isUsCountryCode(locationCountry) ? ' (US)' : ''}`,
    description: schemaDescription,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: { '@id': placeJsonLd['@id'] }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, webPageJsonLd, placeJsonLd]} />
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Info', href: '/info' },
          { label: 'Locations', href: '/catalog/locations' },
          { label: locationName }
        ]}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Launch location</p>
          <h1 className="text-3xl font-semibold text-text1">{locationName}</h1>
          <p className="text-sm text-text2">
            Launch schedule and recent missions{locationMeta ? ` - ${locationMeta}` : ''}.
          </p>
        </div>
        <Link href="/#schedule" className="btn-secondary w-fit rounded-lg px-3 py-2 text-sm">
          Back to feed
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
        <Link href="/" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          US launch schedule
        </Link>
        {providerScheduleHref && (
          <Link
            href={providerScheduleHref}
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
          >
            {primaryProviderName} schedule
          </Link>
        )}
        <Link
          href="/launch-providers"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          All providers
        </Link>
      </div>

      <LaunchList
        title="Upcoming launches"
        launches={launchesUpcoming}
        emptyLabel={`No upcoming launches scheduled for ${locationName}.`}
        detailLabel="Vehicle"
        getDetail={(launch) => ({
          href: buildRocketHref(launch, launch.rocket?.fullName || launch.vehicle),
          label: launch.rocket?.fullName || launch.vehicle
        })}
      />

      <LaunchList
        title="Launch history"
        launches={launchesRecent}
        emptyLabel={`No launch history available for ${locationName}.`}
        detailLabel="Vehicle"
        getDetail={(launch) => ({
          href: buildRocketHref(launch, launch.rocket?.fullName || launch.vehicle),
          label: launch.rocket?.fullName || launch.vehicle
        })}
      />
    </div>
  );
}

function LaunchList({
  title,
  launches,
  emptyLabel,
  detailLabel,
  getDetail
}: {
  title: string;
  launches: Launch[];
  emptyLabel: string;
  detailLabel: string;
  getDetail: (launch: Launch) => { href: string; label: string };
}) {
  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">{title}</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {launches.length} items
        </span>
      </div>
      {launches.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {launches.map((launch) => {
            const detail = getDetail(launch);
            const netLabel = formatLaunchDate(launch);
            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
            const providerHref = buildProviderHref(launch.provider);
            return (
              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                      {launch.name}
                    </Link>
                    <div className="mt-1 text-xs text-text3">
                      {providerHref ? (
                        <Link href={providerHref} className="transition hover:text-text1">
                          {launch.provider}
                        </Link>
                      ) : (
                        launch.provider
                      )}{' '}
                      - {launch.pad.shortCode}
                    </div>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{netLabel}</div>
                    {dateOnly && (
                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                        Time TBD
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-text3">
                  {detailLabel}:{' '}
                  <Link href={detail.href} className="transition hover:text-primary">
                    {detail.label}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function parseLocationIdentifier(id: string): LocationIdentifier | null {
  const raw = safeDecode(id).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return { kind: 'id', id: Number(raw), raw, label: raw };
  }
  const slugMatch = raw.match(/^(.+)-(\d+)$/);
  if (slugMatch) {
    return { kind: 'id', id: Number(slugMatch[2]), raw, label: slugMatch[1] };
  }
  return { kind: 'name', name: raw, raw, label: raw };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildLocationCanonicalPath(locationName: string, canonicalId: string) {
  if (!/^\d+$/.test(canonicalId)) {
    const slug = slugify(locationName || canonicalId);
    return `/locations/${encodeURIComponent(slug || canonicalId)}`;
  }
  const slugId = buildSlugId(locationName, canonicalId);
  return `/locations/${encodeURIComponent(slugId)}`;
}

function buildLocationQuery(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  identifier: LocationIdentifier
) {
  const query = supabase.from('launches_public_cache').select(SELECT_COLUMNS);
  if (identifier.kind === 'id') {
    return query.eq('ll2_pad_id', identifier.id);
  }
  const patterns = buildNamePatterns(identifier.name);
  const clauses = patterns.flatMap((pattern) => {
    const escaped = escapeOrValue(pattern);
    return [`pad_location_name.ilike.${escaped}`, `pad_name.ilike.${escaped}`, `pad_short_code.ilike.${escaped}`];
  });
  return query.or(clauses.join(','));
}

function escapeOrValue(value: string) {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildNamePatterns(value: string) {
  const raw = value.trim();
  if (!raw) return [];
  const patterns = new Set<string>();
  patterns.add(raw);
  if (raw.includes('-') && !raw.includes(' ')) {
    patterns.add(raw.replace(/-/g, ' '));
    const tokenPattern = raw.split('-').filter(Boolean).join('%');
    if (tokenPattern) patterns.add(tokenPattern);
  }
  return [...patterns];
}

function isUsCountryCode(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'US' || normalized === 'USA';
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
    : {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}
