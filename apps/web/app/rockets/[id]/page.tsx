import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import { isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref, buildLocationHref, buildProviderHref, buildRocketHref, toProviderSlug } from '@/lib/utils/launchLinks';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { buildSlugId, slugify } from '@/lib/utils/slug';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ImageCreditLine } from '@/components/ImageCreditLine';
import { JsonLd } from '@/components/JsonLd';
import { RocketVolatilitySection } from '@/components/RocketVolatilitySection';

export const revalidate = 60 * 5; // 5 minutes

type RocketHubData = {
  rocketName: string;
  rocketDescription?: string;
  rocketFamily?: string;
  rocketManufacturer?: string;
  rocketInfoUrl?: string;
  rocketWikiUrl?: string;
  rocketImageUrl?: string;
  ll2RocketConfigId?: number | null;
  launchesUpcoming: Launch[];
  launchesRecent: Launch[];
  canonicalId: string;
};

type CatalogCacheRow = {
  entity_type: string;
  entity_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  country_codes?: string[] | null;
  image_url?: string | null;
  data?: Record<string, unknown> | null;
  fetched_at?: string | null;
};

type RocketFleetSummary = {
  totalLaunchers: number;
  activeLaunchers: number;
  flightProvenLaunchers: number;
  maxFlights: number;
  avgFlightsPerLauncher: number;
  topLaunchers: Array<{
    id: number;
    name: string;
    serial?: string | null;
    flights: number;
    status?: string | null;
    firstLaunchDate?: string | null;
    lastLaunchDate?: string | null;
    imageUrl?: string | null;
  }>;
};

type RocketIdentifier =
  | { kind: 'id'; id: number; raw: string; label: string }
  | { kind: 'name'; name: string; raw: string; label: string };

const ROCKET_HUB_LAUNCH_SELECT_COLUMNS = [
  'launch_id',
  'name',
  'slug',
  'cache_generated_at',
  'provider',
  'provider_type',
  'provider_country_code',
  'provider_description',
  'provider_logo_url',
  'provider_image_url',
  'vehicle',
  'll2_pad_id',
  'pad_name',
  'pad_short_code',
  'pad_state_code',
  'pad_timezone',
  'pad_location_name',
  'pad_country_code',
  'll2_rocket_config_id',
  'rocket_full_name',
  'rocket_family',
  'rocket_description',
  'rocket_manufacturer',
  'rocket_manufacturer_logo_url',
  'rocket_manufacturer_image_url',
  'rocket_image_url',
  'rocket_info_url',
  'rocket_wiki_url',
  'net',
  'net_precision',
  'window_start',
  'window_end',
  'status_name',
  'status_abbrev',
  'tier',
  'featured',
  'mission_name',
  'mission_type',
  'mission_description',
  'mission_orbit',
  'programs',
  'crew',
  'payloads',
  'launch_info_urls',
  'launch_vid_urls',
  'flightclub_url',
  'hashtag',
  'probability',
  'weather_concerns',
  'weather_icon_url',
  'mission_patches',
  'image_thumbnail_url',
  'image_url',
  'image_credit',
  'image_license_name',
  'image_license_url',
  'image_single_use'
].join(',');

const fetchRocketHub = cache(async (id: string): Promise<RocketHubData | null> => {
  if (!isSupabaseConfigured()) return null;
  const identifier = parseRocketIdentifier(id);
  if (!identifier) return null;

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();
  const nameHints = identifier.kind === 'id' ? await fetchRocketNameHints(supabase, identifier.id) : [];
  const upcomingLimit = 200;
  const recentLimit = 200;

  let upcomingRes: any = null;
  let recentRes: any = null;

  if (identifier.kind === 'id' && Number.isFinite(identifier.id)) {
    const [upcomingExact, recentExact] = await Promise.all([
      buildRocketExactIdQuery(supabase, identifier.id)
        .gte('net', nowIso)
        .order('net', { ascending: true })
        .limit(upcomingLimit),
      buildRocketExactIdQuery(supabase, identifier.id)
        .lt('net', nowIso)
        .order('net', { ascending: false })
        .limit(recentLimit)
    ]);

    if (!upcomingExact.error && !recentExact.error) {
      const exactCount = (upcomingExact.data?.length ?? 0) + (recentExact.data?.length ?? 0);
      if (exactCount > 0) {
        upcomingRes = upcomingExact;
        recentRes = recentExact;
      }
    }
  }

  if (!upcomingRes || !recentRes) {
    const [upcomingFuzzy, recentFuzzy] = await Promise.all([
      buildRocketQuery(supabase, identifier, nameHints)
        .gte('net', nowIso)
        .order('net', { ascending: true })
        .limit(upcomingLimit),
      buildRocketQuery(supabase, identifier, nameHints)
        .lt('net', nowIso)
        .order('net', { ascending: false })
        .limit(recentLimit)
    ]);
    upcomingRes = upcomingFuzzy;
    recentRes = recentFuzzy;
  }

  if (upcomingRes.error || recentRes.error) return null;

  const upcoming = (upcomingRes.data || []).map(mapPublicCacheRow);
  const recent = (recentRes.data || []).map(mapPublicCacheRow);
  const sample = pickRocketSample({ upcoming, recent, identifier });
  if (!sample) return null;

  const rocketName = sample.rocket?.fullName || sample.vehicle || identifier.label;
  const canonicalId = sample.ll2RocketConfigId != null ? String(sample.ll2RocketConfigId) : identifier.raw;

  return {
    rocketName,
    rocketDescription: sample.rocket?.description,
    rocketFamily: sample.rocket?.family,
    rocketManufacturer: sample.rocket?.manufacturer,
    rocketInfoUrl: sample.rocket?.infoUrl,
    rocketWikiUrl: sample.rocket?.wikiUrl,
    rocketImageUrl: sample.rocket?.imageUrl,
    ll2RocketConfigId: sample.ll2RocketConfigId ?? null,
    launchesUpcoming: upcoming,
    launchesRecent: recent,
    canonicalId
  };
});

async function fetchRocketNameHints(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  rocketConfigId: number
): Promise<string[]> {
  if (!Number.isFinite(rocketConfigId)) return [];
  const { data, error } = await supabase
    .from('ll2_catalog_public_cache')
    .select('name, data')
    .eq('entity_type', 'launcher_configurations')
    .eq('entity_id', String(rocketConfigId))
    .maybeSingle();
  if (error || !data) return [];
  return extractRocketNameHints(data as Pick<CatalogCacheRow, 'name' | 'data'>);
}

function extractRocketNameHints(row: Pick<CatalogCacheRow, 'name' | 'data'> | null): string[] {
  if (!row) return [];
  const hints = new Set<string>();
  const addHint = (value: unknown) => {
    const label = normalizeLabel(value);
    if (label) hints.add(label);
  };

  addHint(row.name);
  const data = row.data as Record<string, unknown> | null;
  if (data) {
    addHint(data.full_name);
    addHint(data.name);
    addHint(data.family);
    addHint(data.alias);
    if (Array.isArray(data.families)) {
      for (const value of data.families) {
        addHint(value);
      }
    }
    if (Array.isArray(data.alias)) {
      for (const value of data.alias) {
        addHint(value);
      }
    }
  }

  return [...hints];
}

function pickRocketSample({
  upcoming,
  recent,
  identifier
}: {
  upcoming: Launch[];
  recent: Launch[];
  identifier: RocketIdentifier;
}) {
  if (identifier.kind === 'id') {
    const upcomingMatch = upcoming.find((launch) => launch.ll2RocketConfigId === identifier.id);
    if (upcomingMatch) return upcomingMatch;
    const recentMatch = recent.find((launch) => launch.ll2RocketConfigId === identifier.id);
    if (recentMatch) return recentMatch;
  }
  return upcoming[0] || recent[0] || null;
}

const fetchCatalogCacheRow = cache(async (entityType: string, entityId: string): Promise<CatalogCacheRow | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('ll2_catalog_public_cache')
    .select('entity_type, entity_id, name, description, image_url, data')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CatalogCacheRow;
});

const fetchRocketConfigCacheRow = cache(async (ll2RocketConfigId: number): Promise<CatalogCacheRow | null> => {
  return fetchCatalogCacheRow('launcher_configurations', String(ll2RocketConfigId));
});

const fetchAgencyCacheRow = cache(async (ll2AgencyId: number): Promise<CatalogCacheRow | null> => {
  return fetchCatalogCacheRow('agencies', String(ll2AgencyId));
});

const fetchRocketFleetSummary = cache(async (ll2RocketConfigId: number): Promise<RocketFleetSummary | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabasePublicClient();

  const { data: launcherRows, error: launcherError } = await supabase
    .from('ll2_catalog_public_cache')
    .select('entity_id, name, description, image_url, data')
    .eq('entity_type', 'launchers')
    .contains('data', { launcher_config: { id: ll2RocketConfigId } })
    .order('name', { ascending: true })
    .limit(1000);

  if (launcherError || !launcherRows || launcherRows.length === 0) return null;

  const launchers = launcherRows as Array<Pick<CatalogCacheRow, 'entity_id' | 'name' | 'data' | 'image_url'>>;
  const launcherIds = launchers
    .map((row) => Number(row.entity_id))
    .filter((value) => Number.isFinite(value)) as number[];
  if (launcherIds.length === 0) return null;

  const flightsByLauncherId = new Map<number, number>();
  const chunkSize = 200;
  for (let i = 0; i < launcherIds.length; i += chunkSize) {
    const chunk = launcherIds.slice(i, i + chunkSize);
    const { data: joins, error: joinError } = await supabase
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id')
      .in('ll2_launcher_id', chunk);
    if (joinError || !joins) continue;
    for (const row of joins as Array<{ ll2_launcher_id: number }>) {
      const id = row.ll2_launcher_id;
      flightsByLauncherId.set(id, (flightsByLauncherId.get(id) ?? 0) + 1);
    }
  }

  const topLaunchers = launchers
    .map((row) => {
      const id = Number(row.entity_id);
      const launcherData = (row.data || {}) as Record<string, unknown>;
      const serial = typeof launcherData.serial_number === 'string' ? launcherData.serial_number : null;
      const statusRaw = launcherData.status;
      const status =
        typeof statusRaw === 'string'
          ? statusRaw
          : statusRaw && typeof statusRaw === 'object' && 'name' in statusRaw && typeof (statusRaw as any).name === 'string'
            ? (statusRaw as any).name
            : null;
      const firstLaunchDate = typeof launcherData.first_launch_date === 'string' ? launcherData.first_launch_date : null;
      const lastLaunchDate = typeof launcherData.last_launch_date === 'string' ? launcherData.last_launch_date : null;
      const flights = Number.isFinite(id) ? flightsByLauncherId.get(id) ?? 0 : 0;
      const imageUrl = normalizeImageUrl(row.image_url || null);
      return {
        id,
        name: row.name,
        serial,
        flights,
        status,
        firstLaunchDate,
        lastLaunchDate,
        imageUrl
      };
    })
    .filter((row) => Number.isFinite(row.id))
    .sort((a, b) => b.flights - a.flights)
    .slice(0, 6);

  const totalFlights = Array.from(flightsByLauncherId.values()).reduce((sum, count) => sum + count, 0);
  const maxFlights = Math.max(0, ...Array.from(flightsByLauncherId.values()));
  const flightProvenLaunchers = launchers.reduce((sum, row) => {
    const proven = Boolean((row.data as any)?.flight_proven);
    return sum + (proven ? 1 : 0);
  }, 0);
  const activeLaunchers = launchers.reduce((sum, row) => {
    const statusRaw = (row.data as any)?.status;
    const status =
      typeof statusRaw === 'string'
        ? statusRaw
        : statusRaw && typeof statusRaw === 'object' && typeof statusRaw.name === 'string'
          ? statusRaw.name
          : '';
    return sum + (String(status).toLowerCase().includes('active') ? 1 : 0);
  }, 0);

  const avgFlightsPerLauncher = launcherIds.length ? totalFlights / launcherIds.length : 0;

  return {
    totalLaunchers: launcherIds.length,
    activeLaunchers,
    flightProvenLaunchers,
    maxFlights,
    avgFlightsPerLauncher,
    topLaunchers
  };
});

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const data = await fetchRocketHub(params.id);
  if (!data) {
    return {
      title: `Rocket not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = buildRocketCanonicalPath(data.rocketName, data.canonicalId);
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${data.rocketName} launch schedule & history | ${SITE_META.siteName}`;
  const description = data.rocketDescription
    ? truncateText(data.rocketDescription, 160)
    : `Upcoming launches, launch schedule, and past missions for ${data.rocketName}.`;

  let image = normalizeImageUrl(data.rocketImageUrl);
  if (!image && data.ll2RocketConfigId != null) {
    const config = await fetchRocketConfigCacheRow(data.ll2RocketConfigId);
    image = normalizeImageUrl(config?.image_url || null);
  }
  const ogImage = image ? (image.startsWith('/') ? `${siteUrl}${image}` : image) : siteMeta.ogImage;
  const images = ogImage
    ? [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${data.rocketName} rocket`,
          type: 'image/jpeg'
        }
      ]
    : undefined;

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
      images
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images
        ? [
            {
              url: images[0].url,
              alt: `${data.rocketName} rocket`
            }
          ]
        : undefined
    }
  };
}

export default async function RocketHubPage({ params }: { params: { id: string } }) {
  const data = await fetchRocketHub(params.id);
  if (!data) return notFound();
  const rawParam = safeDecode(params.id).trim();

  const adminConfigured = isSupabaseAdminConfigured();

  const {
    rocketName,
    rocketDescription,
    rocketFamily,
    rocketManufacturer,
    rocketInfoUrl,
    rocketWikiUrl,
    rocketImageUrl,
    ll2RocketConfigId,
    launchesUpcoming,
    launchesRecent,
    canonicalId
  } = data;

  const canonicalPath = buildRocketCanonicalPath(rocketName, canonicalId);
  const canonicalSegment = canonicalPath.split('/').pop();
  if (canonicalSegment && rawParam && canonicalSegment !== rawParam) {
    permanentRedirect(canonicalPath);
  }

  const rocketConfigPromise = ll2RocketConfigId ? fetchRocketConfigCacheRow(ll2RocketConfigId) : Promise.resolve(null);
  const rocketConfig = await rocketConfigPromise;
  const rocketConfigData = (rocketConfig?.data || null) as Record<string, unknown> | null;
  const manufacturerId =
    rocketConfigData && typeof rocketConfigData.manufacturer_id === 'number' ? rocketConfigData.manufacturer_id : null;
  const manufacturerPromise = manufacturerId ? fetchAgencyCacheRow(manufacturerId) : Promise.resolve(null);
  const fleetPromise = ll2RocketConfigId ? fetchRocketFleetSummary(ll2RocketConfigId) : Promise.resolve(null);

  const [manufacturer, fleet] = await Promise.all([manufacturerPromise, fleetPromise]);

  const resolvedRocketFamily = rocketFamily || normalizeLabel(rocketConfigData?.family) || undefined;
  const resolvedRocketManufacturer =
    rocketManufacturer || normalizeLabel(rocketConfigData?.manufacturer) || (manufacturer?.name ? manufacturer.name : undefined);
  const resolvedRocketDescription =
    rocketDescription ||
    (rocketConfig?.description ? String(rocketConfig.description) : undefined) ||
    (typeof rocketConfigData?.description === 'string' ? rocketConfigData.description : undefined);
  const resolvedRocketInfoUrl =
    rocketInfoUrl || (typeof rocketConfigData?.info_url === 'string' ? rocketConfigData.info_url : undefined);
  const resolvedRocketWikiUrl =
    rocketWikiUrl || (typeof rocketConfigData?.wiki_url === 'string' ? rocketConfigData.wiki_url : undefined);

  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const nextLaunch = launchesUpcoming[0] || null;
  const lastLaunch = launchesRecent[0] || null;
  const primaryProviderName = (nextLaunch?.provider || lastLaunch?.provider || '').trim();
  const providerScheduleHref = (() => {
    if (!primaryProviderName || primaryProviderName.toLowerCase() === 'unknown') return null;
    const slug = toProviderSlug(primaryProviderName);
    if (!slug) return null;
    return `/launch-providers/${encodeURIComponent(slug)}`;
  })();

  const volatilityLookbackDays = 120;
  const volatilityLaunches = launchesUpcoming.slice(0, 20);

  const ll2TotalLaunches = toFiniteNumber(rocketConfigData?.total_launch_count);
  const ll2SuccessfulLaunches = toFiniteNumber(rocketConfigData?.successful_launches);
  const ll2FailedLaunches = toFiniteNumber(rocketConfigData?.failed_launches);
  const ll2PendingLaunches = toFiniteNumber(rocketConfigData?.pending_launches);
  const ll2SuccessStreak = toFiniteNumber(rocketConfigData?.consecutive_successful_launches);
  const ll2AttemptedLandings = toFiniteNumber(rocketConfigData?.attempted_landings);
  const ll2SuccessfulLandings = toFiniteNumber(rocketConfigData?.successful_landings);
  const ll2FailedLandings = toFiniteNumber(rocketConfigData?.failed_landings);
  const ll2LandingStreak = toFiniteNumber(rocketConfigData?.consecutive_successful_landings);

  const inferredTotalLaunches = ll2TotalLaunches ?? launchesRecent.length;
  const inferredSuccessRate = (() => {
    if (ll2SuccessfulLaunches != null && ll2FailedLaunches != null) {
      const denom = ll2SuccessfulLaunches + ll2FailedLaunches;
      return denom > 0 ? ll2SuccessfulLaunches / denom : null;
    }
    const outcomes = launchesRecent.map(inferLaunchOutcome);
    const successes = outcomes.filter((o) => o === 'success').length;
    const failures = outcomes.filter((o) => o === 'failure').length;
    const denom = successes + failures;
    return denom > 0 ? successes / denom : null;
  })();

  const last30Count = countLaunchesSince(launchesRecent, nowMs - 30 * dayMs);
  const last90Count = countLaunchesSince(launchesRecent, nowMs - 90 * dayMs);
  const last365Count = countLaunchesSince(launchesRecent, nowMs - 365 * dayMs);

  const cadenceSample = launchesRecent.slice(0, 25).reverse();
  const avgGapDays = averageGapDays(cadenceSample);
  const longestGapDays = maxGapDays(launchesRecent.slice().reverse());
  const recordMonth = recordMonthCount(launchesRecent);

  const upcomingTbdCount = launchesUpcoming.filter((launch) => isDateOnlyNet(launch.net, launch.netPrecision)).length;
  const upcomingTbdRate = launchesUpcoming.length ? upcomingTbdCount / launchesUpcoming.length : null;

  const mixSample = launchesRecent.slice(0, 60);
  const topOrbits = topCounts(mixSample.map((launch) => resolveOrbitLabel(launch)).filter(Boolean) as string[]);
  const topMissionTypes = topCounts(mixSample.map((launch) => normalizeLabel(launch.mission?.type)).filter(Boolean) as string[]);
  const topPayloadTypes = topCounts(
    mixSample
      .flatMap((launch) => (Array.isArray(launch.payloads) ? launch.payloads : []))
      .map((payload) => normalizeLabel(payload?.type))
      .filter(Boolean) as string[]
  );
  const crewedCount = mixSample.filter((launch) => Array.isArray(launch.crew) && launch.crew.length > 0).length;
  const totalPayloads = mixSample.reduce((sum, launch) => sum + (Array.isArray(launch.payloads) ? launch.payloads.length : 0), 0);

  const topLocations = topCounts(
    mixSample
      .map((launch) => normalizeLabel(launch.pad?.locationName || launch.pad?.name))
      .filter(Boolean) as string[]
  );

  const upcomingWeatherWindow = launchesUpcoming.filter((launch) => {
    const net = Date.parse(launch.net);
    return Number.isFinite(net) && net <= nowMs + 7 * dayMs;
  });
  const weatherProbabilities = upcomingWeatherWindow
    .map((launch) => launch.probability)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgWeatherProbability = weatherProbabilities.length
    ? weatherProbabilities.reduce((sum, value) => sum + value, 0) / weatherProbabilities.length
    : null;
  const topWeatherConcerns = topCounts(
    upcomingWeatherWindow
      .flatMap((launch) => (Array.isArray(launch.weatherConcerns) ? launch.weatherConcerns : []))
      .map((value) => normalizeLabel(value))
      .filter(Boolean) as string[]
  );

  const rocketSpecs = rocketConfigData
    ? {
        maidenFlight: typeof rocketConfigData.maiden_flight === 'string' ? rocketConfigData.maiden_flight : null,
        reusable: typeof rocketConfigData.reusable === 'boolean' ? rocketConfigData.reusable : null,
        heightM: toFiniteNumber(rocketConfigData.length),
        diameterM: toFiniteNumber(rocketConfigData.diameter),
        leoCapacityKg: toFiniteNumber(rocketConfigData.leo_capacity),
        gtoCapacityKg: toFiniteNumber(rocketConfigData.gto_capacity),
        ssoCapacityKg: toFiniteNumber(rocketConfigData.sso_capacity),
        geoCapacityKg: toFiniteNumber(rocketConfigData.geo_capacity),
        minStages: toFiniteNumber(rocketConfigData.min_stage),
        maxStages: toFiniteNumber(rocketConfigData.max_stage),
        launchCost: typeof rocketConfigData.launch_cost === 'string' ? rocketConfigData.launch_cost : null
      }
    : null;

  const nextLaunchWeather = nextLaunch
    ? {
        probability: typeof nextLaunch.probability === 'number' && Number.isFinite(nextLaunch.probability) ? nextLaunch.probability : null,
        concerns:
          Array.isArray(nextLaunch.weatherConcerns) && nextLaunch.weatherConcerns.length
            ? nextLaunch.weatherConcerns.filter((value) => typeof value === 'string' && value.trim()).slice(0, 12)
            : []
      }
    : null;

  const manufacturerData = (manufacturer?.data || null) as Record<string, unknown> | null;
  const manufacturerLogoUrl = normalizeImageUrl(manufacturer?.image_url || null);
  const manufacturerImageUrlRaw = manufacturerData ? (manufacturerData.image_url as unknown) : null;
  const manufacturerImageUrl =
    typeof manufacturerImageUrlRaw === 'string' ? normalizeImageUrl(manufacturerImageUrlRaw) : undefined;
  const manufacturerFounded = normalizeLabel(manufacturerData?.founding_year);
  const manufacturerMeta = [
    normalizeLabel(manufacturerData?.type),
    normalizeLabel(manufacturerData?.country_code),
    manufacturerFounded ? `Founded ${manufacturerFounded}` : null
  ]
    .filter(Boolean)
    .join(' • ');
  const manufacturerSummary = manufacturer?.description ? truncateText(manufacturer.description, 220) : null;

  const rocketConfigImageUrl = normalizeImageUrl(rocketConfig?.image_url || null);
  const rocketConfigDataImageUrlRaw = rocketConfigData ? (rocketConfigData.image_url as unknown) : null;
  const rocketConfigDataImageUrl =
    typeof rocketConfigDataImageUrlRaw === 'string' ? normalizeImageUrl(rocketConfigDataImageUrlRaw) : undefined;
  const rocketHeroImageUrl = normalizeImageUrl(rocketImageUrl) || rocketConfigImageUrl || rocketConfigDataImageUrl;

  const recentLaunchMedia = buildRecentLaunchMedia(launchesRecent, 9);
  const recentMissionPatches = buildRecentMissionPatches(launchesRecent, 18);

  const mostRecentFailure = launchesRecent.find((launch) => inferLaunchOutcome(launch) === 'failure') || null;
  const mostRecentScrub = launchesRecent.find((launch) => inferLaunchOutcome(launch) === 'scrubbed') || null;

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const schemaDescription = (resolvedRocketDescription || '').trim() || `Upcoming launches and past missions for ${rocketName}.`;
  const sameAs = [resolvedRocketInfoUrl, resolvedRocketWikiUrl].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Info', item: `${siteUrl}/info` },
      { '@type': 'ListItem', position: 3, name: 'Launch Vehicles', item: `${siteUrl}/catalog/launcher_configurations` },
      { '@type': 'ListItem', position: 4, name: rocketName, item: pageUrl }
    ]
  };
  const rocketJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${pageUrl}#rocket`,
    name: rocketName,
    url: pageUrl,
    description: schemaDescription,
    category: 'Launch vehicle',
    manufacturer: resolvedRocketManufacturer ? { '@type': 'Organization', name: resolvedRocketManufacturer } : undefined,
    model: resolvedRocketFamily || undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    image: rocketHeroImageUrl || undefined
  };
  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${rocketName} launch schedule & history`,
    description: schemaDescription,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: { '@id': rocketJsonLd['@id'] }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, webPageJsonLd, rocketJsonLd]} />
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Info', href: '/info' },
          { label: 'Launch Vehicles', href: '/catalog/launcher_configurations' },
          { label: rocketName }
        ]}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Rocket launches</p>
          <h1 className="text-3xl font-semibold text-text1">{rocketName}</h1>
          <p className="text-sm text-text2">Launch history and upcoming schedule for {rocketName}.</p>
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

      {(rocketHeroImageUrl ||
        resolvedRocketDescription ||
        resolvedRocketFamily ||
        resolvedRocketManufacturer ||
        resolvedRocketInfoUrl ||
        resolvedRocketWikiUrl) && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-stroke bg-surface-1">
            {rocketHeroImageUrl ? (
              <div className="relative">
                <img
                  src={rocketHeroImageUrl}
                  alt={`${rocketName} rocket`}
                  className="h-56 w-full object-cover md:h-72"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/70">Rocket</div>
                    <div className="truncate text-sm font-semibold text-white">{rocketName}</div>
                  </div>
                  {manufacturerLogoUrl ? (
                    <div className="flex h-10 w-16 items-center justify-center rounded-lg border border-white/10 bg-black/40 px-2">
                      <img
                        src={manufacturerLogoUrl}
                        alt=""
                        className="max-h-full w-full object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="h-56 w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.35),_rgba(0,0,0,0.15)_40%,_transparent_75%)] md:h-72" />
            )}
          </div>

          <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Rocket profile</div>
            {resolvedRocketFamily && <div className="mt-1 text-sm text-text2">Family: {resolvedRocketFamily}</div>}
            {resolvedRocketManufacturer && (
              <div className="text-sm text-text2">Manufacturer: {resolvedRocketManufacturer}</div>
            )}
            {rocketConfig?.name && <div className="text-sm text-text2">LL2 vehicle: {rocketConfig.name}</div>}
            {resolvedRocketDescription && (
              <p className="mt-2 text-sm text-text2">{truncateText(resolvedRocketDescription, 320)}</p>
            )}
            {(resolvedRocketInfoUrl || resolvedRocketWikiUrl) && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {resolvedRocketInfoUrl && (
                  <a className="text-primary" href={resolvedRocketInfoUrl} target="_blank" rel="noreferrer">
                    Vehicle info
                  </a>
                )}
                {resolvedRocketWikiUrl && (
                  <a className="text-primary" href={resolvedRocketWikiUrl} target="_blank" rel="noreferrer">
                    Vehicle wiki
                  </a>
                )}
              </div>
            )}
            {manufacturerImageUrl && (
              <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-black/20">
                <img
                  src={manufacturerImageUrl}
                  alt=""
                  className="h-24 w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {recentLaunchMedia.length ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-text1">Recent launch media</h2>
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              Last {formatNumber(recentLaunchMedia.length)}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentLaunchMedia.map(({ launch, image }) => (
              <Link
                key={launch.id}
                href={buildLaunchHref(launch)}
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
              >
                <div className="relative h-32 w-full overflow-hidden bg-black/30">
                  <img
                    src={image.url}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                  <div className="absolute bottom-2 left-3 right-3">
                    <div className="truncate text-sm font-semibold text-white">{launch.name}</div>
                    <div className="text-xs text-white/75">{formatLaunchDate(launch)}</div>
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-xs text-text3">
                    {launch.provider} • {launch.pad.locationName || launch.pad.name}
                  </div>
                  <ImageCreditLine
                    credit={image.credit}
                    license={image.license}
                    licenseUrl={image.licenseUrl}
                    singleUse={image.singleUse}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recentMissionPatches.length ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-text1">Mission patches</h2>
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              {formatNumber(recentMissionPatches.length)} found
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-9">
            {recentMissionPatches.map((patch) => (
              <Link
                key={patch.url}
                href={buildLaunchHref({ id: patch.launchId, name: patch.label })}
                className="group flex items-center justify-center overflow-hidden rounded-xl border border-stroke bg-surface-0 p-2 transition hover:border-primary"
                title={patch.label}
              >
                <img
                  src={patch.url}
                  alt={patch.label}
                  className="h-14 w-full object-contain transition duration-300 group-hover:scale-[1.03]"
                  loading="lazy"
                  decoding="async"
                />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">At a glance</h2>
          {ll2PendingLaunches != null && (
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              {formatNumber(ll2PendingLaunches)} upcoming tracked
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Total launches"
            value={formatNumber(inferredTotalLaunches)}
            detail={ll2TotalLaunches != null ? 'LL2 total' : 'From cached history'}
          />
          <KpiCard
            label="Success rate"
            value={inferredSuccessRate == null ? '—' : `${formatPercent(inferredSuccessRate, 0)}%`}
            detail={
              ll2SuccessfulLaunches != null && ll2FailedLaunches != null
                ? `${formatNumber(ll2SuccessfulLaunches)} success • ${formatNumber(ll2FailedLaunches)} failure`
                : 'Based on cached outcomes'
            }
          />
          <KpiCard
            label="Next launch"
            value={nextLaunch ? formatLaunchDate(nextLaunch) : '—'}
            detail={
              nextLaunch
                ? `${formatRelativeDays(nowMs, Date.parse(nextLaunch.net))} • ${nextLaunch.pad.locationName || nextLaunch.pad.name}`
                : 'No upcoming launches'
            }
          />
          <KpiCard
            label="Last launch"
            value={lastLaunch ? formatLaunchDate(lastLaunch) : '—'}
            detail={
              lastLaunch
                ? `${formatRelativeDays(Date.parse(lastLaunch.net), nowMs)} • ${formatOutcomeLabel(inferLaunchOutcome(lastLaunch))}`
                : 'No launch history yet'
            }
          />
          <KpiCard
            label="Launch cadence"
            value={avgGapDays == null ? '—' : `${formatDecimal(avgGapDays, 1)} days`}
            detail={avgGapDays == null ? 'Not enough history' : 'Avg gap (last 25 launches)'}
          />
          <KpiCard
            label="Time TBD"
            value={upcomingTbdRate == null ? '—' : `${formatPercent(upcomingTbdRate, 0)}%`}
            detail={launchesUpcoming.length ? `${formatNumber(upcomingTbdCount)} of ${formatNumber(launchesUpcoming.length)} upcoming` : 'No upcoming launches'}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <KpiCard label="Last 30 days" value={formatNumber(last30Count)} detail="Launches" />
          <KpiCard label="Last 90 days" value={formatNumber(last90Count)} detail="Launches" />
          <KpiCard label="Last 365 days" value={formatNumber(last365Count)} detail="Launches" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <KpiCard
            label="Record month"
            value={recordMonth ? formatNumber(recordMonth.count) : '—'}
            detail={recordMonth ? formatMonthKey(recordMonth.label) : 'Not enough history'}
          />
          <KpiCard
            label="Longest gap"
            value={longestGapDays == null ? '—' : `${formatNumber(longestGapDays)} days`}
            detail={longestGapDays == null ? 'Not enough history' : 'Between consecutive launches'}
          />
        </div>

        {upcomingWeatherWindow.length ? (
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Weather outlook</div>
              <div className="text-xs text-text3">Next 7 days • {formatNumber(upcomingWeatherWindow.length)} launch(es)</div>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-sm font-semibold text-text1">
                  {avgWeatherProbability == null ? 'No probability data yet' : `Avg probability: ${formatNumber(Math.round(avgWeatherProbability))}%`}
                </div>
                {topWeatherConcerns.length ? (
                  <div className="mt-1 text-xs text-text3">
                    Top concerns:{' '}
                    {topWeatherConcerns
                      .slice(0, 4)
                      .map((row) => `${row.label} (${row.count})`)
                      .join(' • ')}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-text3">No concerns tagged yet.</div>
                )}
              </div>
              {nextLaunchWeather?.probability != null || nextLaunchWeather?.concerns.length ? (
                <div className="rounded-lg border border-stroke bg-surface-1 p-3">
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Next launch weather</div>
                  <div className="mt-1 text-sm font-semibold text-text1">
                    {nextLaunchWeather?.probability != null
                      ? `${formatNumber(nextLaunchWeather.probability)}% probability`
                      : 'No probability yet'}
                  </div>
                  {nextLaunchWeather?.concerns.length ? (
                    <div className="mt-1 text-xs text-text3">{nextLaunchWeather.concerns.slice(0, 6).join(' • ')}</div>
                  ) : (
                    <div className="mt-1 text-xs text-text3">No concerns tagged yet.</div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-text3">Weather details appear when a forecast is available.</div>
              )}
            </div>
          </div>
        ) : null}

        {mostRecentFailure || mostRecentScrub ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {mostRecentFailure ? (
              <div className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-danger">Last anomaly</div>
                <Link
                  href={buildLaunchHref(mostRecentFailure)}
                  className="mt-1 block text-sm font-semibold text-text1 transition hover:text-primary"
                >
                  {mostRecentFailure.name}
                </Link>
                <div className="mt-1 text-xs text-text3">{formatLaunchDate(mostRecentFailure)}</div>
                {mostRecentFailure.failReason ? (
                  <div className="mt-2 text-xs text-text2">{truncateText(mostRecentFailure.failReason, 160)}</div>
                ) : null}
              </div>
            ) : null}

            {mostRecentScrub ? (
              <div className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-warning">Latest scrub</div>
                <Link
                  href={buildLaunchHref(mostRecentScrub)}
                  className="mt-1 block text-sm font-semibold text-text1 transition hover:text-primary"
                >
                  {mostRecentScrub.name}
                </Link>
                <div className="mt-1 text-xs text-text3">{formatLaunchDate(mostRecentScrub)}</div>
                {mostRecentScrub.holdReason || mostRecentScrub.statusText ? (
                  <div className="mt-2 text-xs text-text2">
                    {truncateText(String(mostRecentScrub.holdReason || mostRecentScrub.statusText), 160)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {(rocketConfig || manufacturer || fleet) && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Rocket KPIs</div>
              {rocketConfig?.name && <div className="text-sm text-text2">LL2: {rocketConfig.name}</div>}
              {manufacturer?.name && (
                <div className="text-sm text-text2">
                  Manufacturer:{' '}
                  <Link
                    href={`/catalog/agencies/${encodeURIComponent(manufacturer.entity_id)}`}
                    className="transition hover:text-primary"
                  >
                    {manufacturer.name}
                  </Link>
                </div>
              )}
              {ll2RocketConfigId != null && (
                <div className="text-xs text-text3">
                  <Link
                    href={`/catalog/launcher_configurations/${encodeURIComponent(String(ll2RocketConfigId))}`}
                    className="transition hover:text-primary"
                  >
                    View full vehicle profile
                  </Link>
                </div>
              )}
            </div>

            {rocketSpecs && (
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-md">
                {rocketSpecs.maidenFlight ? <KpiCard label="Maiden flight" value={rocketSpecs.maidenFlight} /> : null}
                {rocketSpecs.reusable != null ? <KpiCard label="Reusable" value={rocketSpecs.reusable ? 'Yes' : 'No'} /> : null}
                {rocketSpecs.heightM != null ? (
                  <KpiCard label="Height" value={`${formatDecimal(rocketSpecs.heightM, 1)} m`} />
                ) : null}
                {rocketSpecs.diameterM != null ? (
                  <KpiCard label="Diameter" value={`${formatDecimal(rocketSpecs.diameterM, 1)} m`} />
                ) : null}
                {rocketSpecs.leoCapacityKg != null ? (
                  <KpiCard label="LEO payload" value={`${formatNumber(rocketSpecs.leoCapacityKg)} kg`} />
                ) : null}
                {rocketSpecs.gtoCapacityKg != null ? (
                  <KpiCard label="GTO payload" value={`${formatNumber(rocketSpecs.gtoCapacityKg)} kg`} />
                ) : null}
                {rocketSpecs.ssoCapacityKg != null ? (
                  <KpiCard label="SSO payload" value={`${formatNumber(rocketSpecs.ssoCapacityKg)} kg`} />
                ) : null}
                {rocketSpecs.geoCapacityKg != null ? (
                  <KpiCard label="GEO payload" value={`${formatNumber(rocketSpecs.geoCapacityKg)} kg`} />
                ) : null}
                {rocketSpecs.minStages != null || rocketSpecs.maxStages != null ? (
                  <KpiCard
                    label="Stages"
                    value={`${rocketSpecs.minStages != null ? formatNumber(rocketSpecs.minStages) : '—'}-${rocketSpecs.maxStages != null ? formatNumber(rocketSpecs.maxStages) : '—'}`}
                  />
                ) : null}
                {rocketSpecs.launchCost ? <KpiCard label="Cost" value={rocketSpecs.launchCost} /> : null}
                {ll2SuccessStreak != null ? (
                  <KpiCard label="Success streak" value={formatNumber(ll2SuccessStreak)} detail="Consecutive launches" />
                ) : null}
                {ll2AttemptedLandings != null && ll2SuccessfulLandings != null && ll2FailedLandings != null ? (
                  <KpiCard
                    label="Landings"
                    value={`${formatNumber(ll2SuccessfulLandings)}/${formatNumber(ll2AttemptedLandings)}`}
                    detail={`${formatNumber(ll2FailedLandings)} failed`}
                  />
                ) : null}
                {ll2LandingStreak != null ? (
                  <KpiCard label="Landing streak" value={formatNumber(ll2LandingStreak)} detail="Consecutive landings" />
                ) : null}
              </div>
            )}

            {fleet && (
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-md">
                <KpiCard
                  label="Reusable cores"
                  value={formatNumber(fleet.totalLaunchers)}
                  detail={`${formatNumber(fleet.activeLaunchers)} active`}
                />
                <KpiCard
                  label="Flight proven"
                  value={`${formatNumber(fleet.flightProvenLaunchers)}/${formatNumber(fleet.totalLaunchers)}`}
                  detail="Cores marked flight proven"
                />
                <KpiCard label="Max flights" value={formatNumber(fleet.maxFlights)} detail="Most flown core" />
                <KpiCard
                  label="Avg flights/core"
                  value={formatDecimal(fleet.avgFlightsPerLauncher, 1)}
                  detail="Across known cores"
                />
              </div>
            )}
          </div>

          {manufacturer && (manufacturerLogoUrl || manufacturerSummary || manufacturerMeta) ? (
            <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
              <div className="flex items-center gap-3">
                {manufacturerLogoUrl ? (
                  <div className="flex h-10 w-14 items-center justify-center rounded-lg border border-stroke bg-surface-1 px-2">
                    <img
                      src={manufacturerLogoUrl}
                      alt=""
                      className="max-h-full w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text3">Manufacturer</div>
                  <Link
                    href={`/catalog/agencies/${encodeURIComponent(manufacturer.entity_id)}`}
                    className="truncate text-sm font-semibold text-text1 transition hover:text-primary"
                  >
                    {manufacturer.name}
                  </Link>
                  {manufacturerMeta ? <div className="text-xs text-text3">{manufacturerMeta}</div> : null}
                </div>
              </div>
              {manufacturerSummary ? <p className="mt-2 text-xs text-text2">{manufacturerSummary}</p> : null}
            </div>
          ) : null}

	          {fleet?.topLaunchers?.length ? (
	            <div className="mt-4">
	              <div className="text-xs uppercase tracking-[0.1em] text-text3">Reuse leaderboard</div>
	              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
	                {fleet.topLaunchers.map((core) => (
	                  <li key={core.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
	                    <div className="flex items-center justify-between gap-3">
	                      <div className="flex min-w-0 items-center gap-3">
	                        {core.imageUrl ? (
	                          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-stroke bg-black/20">
	                            <img
	                              src={core.imageUrl}
	                              alt=""
	                              className="h-full w-full object-cover"
	                              loading="lazy"
	                              decoding="async"
	                            />
	                          </div>
	                        ) : null}
	                        <div className="min-w-0">
	                        <div className="truncate text-sm font-semibold text-text1">
	                          {core.serial || core.name || `Launcher ${core.id}`}
	                        </div>
	                        {core.status && <div className="text-xs text-text3">{core.status}</div>}
	                        </div>
	                      </div>
	                      <div className="text-right">
	                        <div className="text-sm font-semibold text-text1">{formatNumber(core.flights)}</div>
	                        <div className="text-[11px] text-text3">flights</div>
	                      </div>
	                    </div>
                    {(core.firstLaunchDate || core.lastLaunchDate) && (
                      <div className="mt-2 text-xs text-text3">
                        {core.firstLaunchDate ? `First: ${core.firstLaunchDate}` : ''}
                        {core.firstLaunchDate && core.lastLaunchDate ? ' • ' : ''}
                        {core.lastLaunchDate ? `Last: ${core.lastLaunchDate}` : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Mission mix</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            Last {formatNumber(mixSample.length)}
          </span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div>
            <div className="grid gap-3">
              <MetricList title="Top orbits" rows={topOrbits} emptyLabel="No orbit data yet." />
              <MetricList title="Top mission types" rows={topMissionTypes} emptyLabel="No mission type data yet." />
              <MetricList title="Top payload types" rows={topPayloadTypes} emptyLabel="No payload type data yet." />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <KpiCard label="Crewed launches" value={formatNumber(crewedCount)} />
              <KpiCard label="Payloads" value={formatNumber(totalPayloads)} detail="Across the sample window" />
            </div>
          </div>
          <div className="rounded-xl border border-stroke bg-surface-0 p-3">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Where it flies</div>
            <div className="mt-2">
              <MetricList title="Top launch sites" rows={topLocations} emptyLabel="No location data yet." />
            </div>
          </div>
        </div>
      </section>

      <RocketVolatilitySection
        rocketName={rocketName}
        lookbackDays={volatilityLookbackDays}
        adminConfigured={adminConfigured}
        launches={volatilityLaunches.map((launch) => ({ id: launch.id, name: launch.name }))}
      />

      <LaunchList
        title="Upcoming launches"
        launches={launchesUpcoming}
        emptyLabel={`No upcoming ${rocketName} launches scheduled.`}
        detailLabel="Launch pad"
        maxVisible={6}
        getDetail={(launch) => ({
          href: buildLocationHref(launch),
          label: launch.pad.locationName || launch.pad.name
        })}
      />

      <LaunchList
        title="Launch history"
        launches={launchesRecent}
        emptyLabel={`No ${rocketName} launch history available yet.`}
        detailLabel="Launch pad"
        maxVisible={6}
        getDetail={(launch) => ({
          href: buildLocationHref(launch),
          label: launch.pad.locationName || launch.pad.name
        })}
      />
    </div>
  );
}

function KpiCard({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-text3">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text1">{value}</div>
      {detail ? <div className="text-xs text-text3">{detail}</div> : null}
    </div>
  );
}

function MetricList({
  title,
  rows,
  emptyLabel
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-text3">{title}</div>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-xs text-text2">
          {rows.slice(0, 6).map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="text-text3">{formatNumber(row.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs text-text3">{emptyLabel}</div>
      )}
    </div>
  );
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDecimal(value: number, digits: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function formatPercent(value: number, digits: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: digits }).format(value).replace('%', '');
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'tbd') return null;
  return trimmed;
}

function topCounts(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6);
}

function inferLaunchOutcome(launch: Launch): 'success' | 'failure' | 'scrubbed' | 'unknown' {
  const statusCombined = `${launch.status ?? ''} ${launch.statusText ?? ''}`.toLowerCase();
  if (statusCombined.includes('scrub')) return 'scrubbed';
  if (statusCombined.includes('success') || statusCombined.includes('successful')) return 'success';
  if (statusCombined.includes('fail') || statusCombined.includes('anomaly') || statusCombined.includes('partial')) return 'failure';
  return 'unknown';
}

function formatOutcomeLabel(outcome: ReturnType<typeof inferLaunchOutcome>) {
  if (outcome === 'success') return 'Success';
  if (outcome === 'failure') return 'Failure';
  if (outcome === 'scrubbed') return 'Scrubbed';
  return 'Unknown';
}

function countLaunchesSince(launches: Launch[], sinceMs: number) {
  return launches.filter((launch) => {
    const net = Date.parse(launch.net);
    return Number.isFinite(net) && net >= sinceMs;
  }).length;
}

function averageGapDays(chronological: Launch[]) {
  if (chronological.length < 2) return null as number | null;
  const gaps: number[] = [];
  for (let i = 1; i < chronological.length; i += 1) {
    const prev = Date.parse(chronological[i - 1]!.net);
    const next = Date.parse(chronological[i]!.net);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) continue;
    gaps.push((next - prev) / (24 * 60 * 60 * 1000));
  }
  if (!gaps.length) return null;
  const sum = gaps.reduce((a, b) => a + b, 0);
  return sum / gaps.length;
}

function maxGapDays(chronological: Launch[]) {
  if (chronological.length < 2) return null as number | null;
  let max = 0;
  for (let i = 1; i < chronological.length; i += 1) {
    const prev = Date.parse(chronological[i - 1]!.net);
    const next = Date.parse(chronological[i]!.net);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) continue;
    max = Math.max(max, (next - prev) / (24 * 60 * 60 * 1000));
  }
  return max > 0 ? Math.round(max) : null;
}

function recordMonthCount(launches: Launch[]) {
  const counts = new Map<string, number>();
  for (const launch of launches) {
    const ms = Date.parse(launch.net);
    if (!Number.isFinite(ms)) continue;
    const date = new Date(ms);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return null as { label: string; count: number } | null;
  const top = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || b.label.localeCompare(a.label))[0];
  return top ?? null;
}

function formatMonthKey(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return value;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function truncateText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

const DEFAULT_PLACEHOLDER_IMAGE = 'https://images2.imgbox.com/00/00/default.png';

function resolveLaunchMediaImage(launch: Launch) {
  const url = normalizeImageUrl(launch.image?.full) || normalizeImageUrl(launch.image?.thumbnail);
  if (!url || url === DEFAULT_PLACEHOLDER_IMAGE) return null;
  const credit = typeof launch.image?.credit === 'string' ? launch.image.credit.trim() : '';
  const license = typeof launch.image?.license === 'string' ? launch.image.license.trim() : '';
  const licenseUrl = typeof launch.image?.licenseUrl === 'string' ? launch.image.licenseUrl.trim() : '';
  return {
    url,
    credit: credit || undefined,
    license: license || undefined,
    licenseUrl: licenseUrl || undefined,
    singleUse: launch.image?.singleUse ?? undefined
  };
}

function buildRecentLaunchMedia(launches: Launch[], max: number) {
  const seen = new Set<string>();
  const rows: Array<{ launch: Launch; image: NonNullable<ReturnType<typeof resolveLaunchMediaImage>> }> = [];
  for (const launch of launches) {
    const image = resolveLaunchMediaImage(launch);
    if (!image) continue;
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    rows.push({ launch, image });
    if (rows.length >= max) break;
  }
  return rows;
}

function buildRecentMissionPatches(launches: Launch[], max: number) {
  const seen = new Set<string>();
  const patches: Array<{ url: string; launchId: string; label: string }> = [];

  for (const launch of launches) {
    const list = Array.isArray(launch.missionPatches) ? launch.missionPatches : [];
    for (const patch of list) {
      const url = normalizeImageUrl(patch?.image_url) || normalizeImageUrl((patch as any)?.imageUrl) || undefined;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const label = typeof patch?.name === 'string' && patch.name.trim() ? patch.name.trim() : launch.name;
      patches.push({ url, launchId: launch.id, label });
      if (patches.length >= max) return patches;
    }
  }

  return patches;
}

function resolveOrbitLabel(launch: Launch) {
  const orbit = normalizeLabel(launch.mission?.orbit);
  if (orbit) return orbit;
  const payloadOrbit = normalizeLabel(launch.payloads?.find((p) => p?.orbit)?.orbit);
  if (payloadOrbit) return payloadOrbit;
  const fallback = normalizeLabel(launch.mission?.type);
  return fallback;
}

function formatRelativeDays(fromMs: number, toMs: number) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return '—';
  const delta = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
  if (delta === 0) return 'Today';
  if (delta > 0) return `In ${formatNumber(delta)} day${delta === 1 ? '' : 's'}`;
  const abs = Math.abs(delta);
  return `${formatNumber(abs)} day${abs === 1 ? '' : 's'} ago`;
}

function LaunchList({
  title,
  launches,
  emptyLabel,
  detailLabel,
  getDetail,
  maxVisible
}: {
  title: string;
  launches: Launch[];
  emptyLabel: string;
  detailLabel: string;
  getDetail: (launch: Launch) => { href: string; label: string };
  maxVisible?: number;
}) {
  const visibleCount =
    typeof maxVisible === 'number' && Number.isFinite(maxVisible) && maxVisible > 0
      ? Math.min(maxVisible, launches.length)
      : launches.length;
  const visibleLaunches = launches.slice(0, visibleCount);
  const remainingLaunches = launches.slice(visibleCount);
  const remainingLabel =
    remainingLaunches.length === 1
      ? 'Show 1 more launch'
      : `Show ${formatNumber(remainingLaunches.length)} more launches`;

  const renderLaunch = (launch: Launch) => {
    const detail = getDetail(launch);
    const netLabel = formatLaunchDate(launch);
    const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
    const providerHref = buildProviderHref(launch.provider);
    const rocketHref = buildRocketHref(launch, launch.rocket?.fullName || launch.vehicle);
    const rocketLabel = launch.rocket?.fullName || launch.vehicle;
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
              -{' '}
              <Link href={rocketHref} className="transition hover:text-primary">
                {rocketLabel}
              </Link>
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
          {launch.pad.state && launch.pad.state !== 'NA' ? ` (${launch.pad.state})` : ''}
        </div>
      </li>
    );
  };

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
        <>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">{visibleLaunches.map(renderLaunch)}</ul>
          {remainingLaunches.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-text2 transition hover:text-text1">
                {remainingLabel}
              </summary>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">{remainingLaunches.map(renderLaunch)}</ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function parseRocketIdentifier(id: string): RocketIdentifier | null {
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

function buildRocketCanonicalPath(rocketName: string, canonicalId: string) {
  if (!/^\d+$/.test(canonicalId)) {
    const slug = slugify(rocketName || canonicalId);
    return `/rockets/${encodeURIComponent(slug || canonicalId)}`;
  }
  const slugId = buildSlugId(rocketName, canonicalId);
  return `/rockets/${encodeURIComponent(slugId)}`;
}

function buildRocketExactIdQuery(supabase: ReturnType<typeof createSupabasePublicClient>, rocketConfigId: number) {
  return supabase
    .from('launches_public_cache')
    .select(ROCKET_HUB_LAUNCH_SELECT_COLUMNS)
    .eq('ll2_rocket_config_id', rocketConfigId);
}

function buildRocketQuery(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  identifier: RocketIdentifier,
  nameHints: string[] = []
) {
  const query = supabase.from('launches_public_cache').select(ROCKET_HUB_LAUNCH_SELECT_COLUMNS);
  const clauses = buildRocketMatchClauses(identifier, nameHints);
  if (!clauses.length) return query;
  return query.or(clauses.join(','));
}

function escapeOrValue(value: string) {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildRocketMatchClauses(identifier: RocketIdentifier, nameHints: string[] = []) {
  const clauses = new Set<string>();
  const nameSources = new Set<string>();

  const primaryName = identifier.kind === 'name' ? identifier.name : identifier.label;
  const primary = normalizeRocketSearchTerm(primaryName);
  if (primary && /[a-z]/i.test(primary)) {
    nameSources.add(primary);
  }

  for (const hint of nameHints) {
    const normalizedHint = normalizeRocketSearchTerm(hint);
    if (normalizedHint && /[a-z]/i.test(normalizedHint)) {
      nameSources.add(normalizedHint);
    }
  }

  if (!nameSources.size) return [];

  for (const source of [...nameSources].slice(0, 4)) {
    const patterns = buildNamePatterns(source);
    for (const pattern of patterns) {
      const like = toIlikePattern(pattern);
      if (!like) continue;
      const escaped = escapeOrValue(like);
      clauses.add('rocket_full_name.ilike.' + escaped);
      clauses.add('rocket_family.ilike.' + escaped);
      clauses.add('vehicle.ilike.' + escaped);
    }
  }

  return [...clauses];
}

function normalizeRocketSearchTerm(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length >= 3 ? normalized : '';
}

function buildNamePatterns(value: string) {
  const raw = normalizeRocketSearchTerm(value);
  if (!raw) return [];
  const patterns = new Set<string>();
  patterns.add(raw);

  const tokens = raw
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length > 1) {
    patterns.add(tokens.join('%'));
  }

  return [...patterns].slice(0, 2);
}

function toIlikePattern(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return `%${trimmed}%`;
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
