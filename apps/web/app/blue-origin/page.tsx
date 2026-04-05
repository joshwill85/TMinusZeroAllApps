import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { JsonLd } from '@/components/JsonLd';
import { BlueOriginJumpRail } from '@/app/blue-origin/_components/BlueOriginJumpRail';
import { BlueOriginLocalTime } from '@/app/blue-origin/_components/BlueOriginLocalTime';
import { BlueOriginManifestCarousel } from '@/app/blue-origin/_components/BlueOriginManifestCarousel';
import { BlueOriginHardwareCatalog } from '@/app/blue-origin/_components/BlueOriginHardwareCatalog';
import {
  BlueOriginHubDiagnostics,
  type BlueOriginHubDiagnosticsPayload
} from '@/app/blue-origin/_components/BlueOriginHubDiagnostics';
import {
  BlueOriginProcurementLedger,
  type ProcurementEntry
} from '@/app/blue-origin/_components/BlueOriginProcurementLedger';
import {
  BlueOriginSignalLog,
  type SignalEntry
} from '@/app/blue-origin/_components/BlueOriginSignalLog';
import { BlueOriginMediaArchive } from '@/app/blue-origin/_components/BlueOriginMediaArchive';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { fetchBlueOriginProgramSnapshot } from '@/lib/server/blueOrigin';
import { fetchBlueOriginTimelineViewModel } from '@/lib/server/blueOriginUi';
import {
  buildBlueOriginContractSlug,
  fetchBlueOriginContracts
} from '@/lib/server/blueOriginContracts';
import { fetchBlueOriginAuditTrailPage } from '@/lib/server/blueOriginAuditTrail';
import { fetchProgramContractDiscoveryPage } from '@/lib/server/programContractDiscovery';
import {
  fetchBlueOriginPassengersDatabaseOnly,
  fetchBlueOriginPayloads
} from '@/lib/server/blueOriginPeoplePayloads';
import {
  fetchBlueOriginEngines,
  fetchBlueOriginVehicles
} from '@/lib/server/blueOriginEntities';
import {
  fetchBlueOriginMediaImages,
  fetchBlueOriginSocialPosts,
  fetchBlueOriginYouTubeVideos
} from '@/lib/server/blueOriginProgramMedia';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import type { BlueOriginPassenger, BlueOriginPayload } from '@/lib/types/blueOrigin';
import {
  buildManifestSeats,
  sortByDateAsc,
  sortByDateDesc
} from '@/lib/utils/blueOriginDossier';
import { getLaunchStatusTone } from '@/lib/utils/launchStatusTone';
import {
  extractBlueOriginFlightCode,
  extractBlueOriginFlightCodeFromText,
  extractBlueOriginFlightCodeFromUrl,
  buildBlueOriginTravelerIdentityKey,
  buildBlueOriginFlightSlug,
  buildBlueOriginTravelerSlug,
  getBlueOriginMissionKeyFromLaunch,
  isBlueOriginNonHumanCrewEntry,
  resolveBlueOriginTravelerCanonicalName,
  normalizeBlueOriginTravelerRole
} from '@/lib/utils/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { resolveXPostId } from '@/lib/utils/xSocial';
import { formatPercent } from '@/lib/utils/formatters';
import { ProgramContractDiscoveryList } from '@/components/contracts/ProgramContractDiscoveryList';
import { ProgramHubHero } from '@/components/program-hubs/ProgramHubHero';

export const revalidate = 60 * 10; // 10 minutes

const BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY = 'mission_summary';
const BLUE_ORIGIN_FAILURE_REASON_FACT_KEY = 'failure_reason';
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_LAUNCH_BATCH_SIZE = 200;
const BLUE_ORIGIN_LAUNCH_PAYLOAD_BATCH_SIZE = 200;
const BLUE_ORIGIN_LAUNCH_SPACECRAFT_FLIGHT_BATCH_SIZE = 200;
const BLUE_ORIGIN_MANIFEST_SEAT_COUNT = 6;
const BLUE_ORIGIN_TIMELINE_INITIAL_LIMIT = 20;
const BLUE_ORIGIN_PROCUREMENT_INITIAL_LIMIT = 250;
const BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_PHRASE_PATTERN =
  /\b(?:share on|follow us|subscribe|watch on|press release|media kit)\b/i;
const BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_TOKEN_PATTERN =
  /\b(?:share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|payload|experiment|installation|device|deorbit|program|mission|patch|media|news|timeline|update|updates|gallery|video|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i;
const BLUE_ORIGIN_MANIFEST_PAYLOAD_NOISE_TOKEN_PATTERN =
  /\b(?:share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|watch|subscribe|follow|mission|launch|flight|crew|passenger|traveler|news|timeline|status|update|updates|media|gallery)\b/i;
const BLUE_ORIGIN_MANIFEST_EXCLUDED_SOURCE_PATTERN =
  /\b(?:launches_public_cache\.(?:crew|payloads))\b/i;
const NEW_SHEPARD_OFFICIAL_HUMAN_COUNT = 98;
const NEW_SHEPARD_OFFICIAL_UNIQUE_HUMAN_COUNT = 92;
const NEW_SHEPARD_STATUS_SUMMARY =
  'Flights are paused for no less than two years while Blue Origin prioritizes orbital operations.';
const NEW_SHEPARD_STATUS_SOURCE_URL =
  'https://www.blueorigin.com/news/new-shepard-to-pause-flights';
const NEW_SHEPARD_STATUS_SOURCE_DATE_LABEL = 'January 30, 2026';

const VEHICLE_ENGINE_SLUGS: Record<string, string[]> = {
  'new-shepard': ['be-3pm'],
  'new-glenn': ['be-4', 'be-3u'],
  'blue-moon': ['be-7'],
  'blue-ring': []
};

type BlueOriginManifestEnhancementFacts = {
  missionSummary: string | null;
  failureReason: string | null;
};

type BlueOriginDiagnosticsTiming = {
  phase: 'fetch' | 'transform' | 'server-total';
  step: string;
  ms: number;
  status: 'ok' | 'error';
  detail: string | null;
};

type BlueOriginManifestLl2PayloadFlightRow = {
  ll2_payload_flight_id: number;
  ll2_launch_uuid: string;
  ll2_payload_id: number | null;
  destination: string | null;
  amount: number | null;
  launch_id: string | null;
  active: boolean | null;
};

type BlueOriginManifestLl2PayloadDetailRow = {
  ll2_payload_id: number;
  name: string;
  payload_type_id: number | null;
  manufacturer_id: number | null;
  operator_id: number | null;
};

type BlueOriginManifestLl2PayloadTypeRow = {
  ll2_payload_type_id: number;
  name: string;
};

type BlueOriginManifestLl2AgencyRow = {
  ll2_agency_id: number;
  name: string;
};

type BlueOriginManifestLl2SpacecraftFlightRow = {
  ll2_spacecraft_flight_id: number;
  ll2_launch_uuid: string;
  launch_crew: unknown;
  onboard_crew: unknown;
  landing_crew: unknown;
  active: boolean | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/blue-origin';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Blue Origin Program Hub, Missions, Flights, Crew & Payloads | ${BRAND_NAME}`;
  const description =
    'Blue Origin program hub with New Shepard and New Glenn flight tracking, crew and payload pages, internal contract coverage, and official media links.';

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
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function BlueOriginProgramPage() {
  const debugMode = true;
  const serverStartMs = nowMilliseconds();
  const timings: BlueOriginDiagnosticsTiming[] = [];

  const pushTiming = (
    phase: BlueOriginDiagnosticsTiming['phase'],
    step: string,
    startedAtMs: number,
    status: BlueOriginDiagnosticsTiming['status'],
    detail: string | null = null
  ) => {
    timings.push({
      phase,
      step,
      ms: Number((nowMilliseconds() - startedAtMs).toFixed(2)),
      status,
      detail
    });
  };

  const timedFetch = async <T,>(step: string, fetcher: () => Promise<T>): Promise<T> => {
    const startedAtMs = nowMilliseconds();
    try {
      const result = await fetcher();
      pushTiming('fetch', step, startedAtMs, 'ok');
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      pushTiming('fetch', step, startedAtMs, 'error', detail);
      throw error;
    }
  };
  const discoveryPagePromise = timedFetch('fetchProgramContractDiscoveryPage', () =>
    fetchProgramContractDiscoveryPage('blue-origin', { limit: 8 })
  ).catch((error) => {
    console.error('blue-origin discovery query error', error);
    return {
      items: [],
      total: 0,
      limit: 8,
      offset: 0,
      hasMore: false
    };
  });

  const [
    program,
    timeline,
    contracts,
    passengers,
    payloads,
    vehicles,
    engines,
    socialPosts,
    youtubeVideos,
    mediaImages,
    auditTrailPage,
    discoveryPage
  ] = await Promise.all([
    timedFetch('fetchBlueOriginProgramSnapshot', () => fetchBlueOriginProgramSnapshot()),
    timedFetch('fetchBlueOriginTimelineViewModel', () => fetchBlueOriginTimelineViewModel({
      mode: 'quick',
      mission: 'all',
      sourceType: 'all',
      includeSuperseded: false,
      from: null,
      to: null,
      cursor: null,
      limit: BLUE_ORIGIN_TIMELINE_INITIAL_LIMIT
    })),
    timedFetch('fetchBlueOriginContracts', () => fetchBlueOriginContracts('all')),
    timedFetch('fetchBlueOriginPassengersDatabaseOnly', () =>
      fetchBlueOriginPassengersDatabaseOnly('all')
    ),
    timedFetch('fetchBlueOriginPayloads', () => fetchBlueOriginPayloads('all')),
    timedFetch('fetchBlueOriginVehicles', () => fetchBlueOriginVehicles('all')),
    timedFetch('fetchBlueOriginEngines', () => fetchBlueOriginEngines('all')),
    timedFetch('fetchBlueOriginSocialPosts', () => fetchBlueOriginSocialPosts(8)),
    timedFetch('fetchBlueOriginYouTubeVideos', () => fetchBlueOriginYouTubeVideos(8)),
    timedFetch('fetchBlueOriginMediaImages', () => fetchBlueOriginMediaImages(12)),
    timedFetch('fetchBlueOriginAuditTrailPage', () =>
      fetchBlueOriginAuditTrailPage(BLUE_ORIGIN_PROCUREMENT_INITIAL_LIMIT)
    ),
    discoveryPagePromise
  ]);

  const launchAssemblyStartMs = nowMilliseconds();
  const dedupedUpcoming = dedupeProgramLaunches(program.upcoming);
  const dedupedRecent = dedupeProgramLaunches(program.recent);
  const allLaunches = buildBlueOriginLaunchRows(dedupedUpcoming, dedupedRecent);
  const launchByFlightCode = new Map<string, Launch>();
  for (const launch of allLaunches) {
    const flightCode = normalizeManifestLookupKey(extractBlueOriginFlightCode(launch));
    if (!flightCode || launchByFlightCode.has(flightCode)) continue;
    launchByFlightCode.set(flightCode, launch);
  }
  pushTiming('transform', 'assembleLaunchRows', launchAssemblyStartMs, 'ok');

  // 1. Transform Manifest Data
  const manifestTransformStartMs = nowMilliseconds();
  const nowForManifestMs = Date.now();
  const manifestLaunches = allLaunches;
  const manifestLaunchIds = [...new Set(
    manifestLaunches.flatMap((launch) => {
      const launchId = normalizeBlueOriginLaunchId(launch.id);
      const ll2LaunchId = normalizeBlueOriginLaunchId(launch.ll2Id);
      return [launchId, ll2LaunchId].filter((id): id is string => Boolean(id));
    })
  )];

  const manifestPassengerLookup = buildManifestRecordLookup(passengers.items);
  const manifestPayloadLookup = buildManifestRecordLookup(payloads.items);
  const launchesNeedingLl2ManifestPayloads = manifestLaunches.filter(
    (launch) =>
      getManifestRowsForLaunch(manifestPayloadLookup, launch).filter(
        isVerifiedBlueOriginManifestPayload
      ).length === 0
  );

  const [manifestEnhancementFacts, manifestLl2PayloadByLaunchId, manifestLl2SpacecraftFlightsByLaunchUuid] = await Promise.all([
    timedFetch('fetchBlueOriginManifestFactsByLaunchIds', () =>
      fetchBlueOriginManifestFactsByLaunchIds(manifestLaunchIds)
    ),
    timedFetch('fetchBlueOriginManifestLl2PayloadDataByLaunches', () =>
      fetchBlueOriginManifestLl2PayloadDataByLaunches(launchesNeedingLl2ManifestPayloads)
    ),
    timedFetch('fetchBlueOriginManifestLl2SpacecraftFlightsByLaunches', () =>
      fetchBlueOriginManifestLl2SpacecraftFlightsByLaunches(manifestLaunches)
    )
  ]);

  const manifestData = manifestLaunches.map((launch) => {
    const launchLl2PayloadData = getManifestRowsByLaunchKey(manifestLl2PayloadByLaunchId, launch);
    const ll2LaunchUuid = normalizeLl2LaunchUuid(launch.ll2Id);
    const launchLl2SpacecraftFlights = ll2LaunchUuid
      ? manifestLl2SpacecraftFlightsByLaunchUuid.get(ll2LaunchUuid) || []
      : [];
    const manifestCapacity = BLUE_ORIGIN_MANIFEST_SEAT_COUNT;
    const launchDedupeKey = buildManifestLaunchDedupeKey(launch);
    const enhancementFacts =
      manifestEnhancementFacts.get(launch.id) ||
      manifestEnhancementFacts.get(launch.ll2Id) ||
      null;
    const missionSummary = resolveBlueOriginEnhancementText(
      enhancementFacts?.missionSummary,
      launch.mission?.description || null
    );

    const ll2ManifestCrew = resolveBlueOriginManifestCrewRowsFromLl2SpacecraftFlights(
      launch,
      launchLl2SpacecraftFlights
    );
    const verifiedPassengerRows = [
      ...getManifestRowsForLaunch(manifestPassengerLookup, launch),
      ...ll2ManifestCrew.passengers
    ].filter(isVerifiedBlueOriginManifestPassenger);
    const humanPassengerRows: typeof verifiedPassengerRows = [];
    const passengerPayloadRows: Array<(typeof verifiedPassengerRows)[number] & { payloadType: string | null }> = [];
    for (const row of verifiedPassengerRows) {
      if (shouldTreatBlueOriginPassengerAsPayload(row)) {
        passengerPayloadRows.push({
          ...row,
          payloadType: normalizeBlueOriginFactText(row.role) || 'Payload'
        });
        continue;
      }
      humanPassengerRows.push(row);
    }
    passengerPayloadRows.push(...ll2ManifestCrew.devicePayloads);

    const launchPassengers = mergeManifestPeopleAndPayloadSourceRows(
      humanPassengerRows,
      launchDedupeKey,
      'traveler'
    );

    const verifiedPayloadRows = [
      ...getManifestRowsForLaunch(manifestPayloadLookup, launch).filter(isVerifiedBlueOriginManifestPayload),
      ...launchLl2PayloadData.filter(isVerifiedBlueOriginManifestPayload)
    ];

    if (verifiedPayloadRows.length === 0) {
      const syntheticPayloadRows = deriveSyntheticBlueOriginPayloadRowsFromMissionSummary(launch, missionSummary).filter(
        isVerifiedBlueOriginManifestPayload
      );
      verifiedPayloadRows.push(...syntheticPayloadRows);
    }

    const launchPayloads = mergeManifestPeopleAndPayloadSourceRows(
      [...verifiedPayloadRows, ...passengerPayloadRows],
      launchDedupeKey,
      'payload'
    );
    const mannedStatus = resolveBlueOriginMannedStatus({
      launch,
      missionSummary,
      manifestTravelerCount: launchPassengers.length,
      manifestPayloadCount: launchPayloads.length,
      ll2PassengerCount: ll2ManifestCrew.passengers.length
    });
    const manifestSourceTags = collectManifestSourceTags([...launchPassengers, ...launchPayloads]);

    const { seats, hasExplicitSeatAssignments } = buildManifestSeats(
      launchPassengers.map((passenger) => ({
        id: passenger.id,
        name: passenger.name,
        role: passenger.role,
        avatarUrl: passenger.imageUrl,
        seatIndex: passenger.seatIndex,
        confidence: passenger.confidence
      })),
      launchPayloads.map((payload) => ({
        id: payload.id,
        name: payload.name,
        payloadType: payload.payloadType
      })),
      manifestCapacity,
      { fillEmptySlots: false }
    );

    return {
      launch,
      seats,
      hasExplicitSeatAssignments,
      manifestCapacity,
      manifestTravelerCount: launchPassengers.length,
      manifestPayloadCount: launchPayloads.length,
      manifestSourceTags,
      mannedStatus,
      launchStatusTone: getLaunchStatusTone(launch.status, launch.statusText),
      launchStatus: normalizeBlueOriginFactText(
        launch.statusText || launch.status
      ) || 'Unknown'
    };
  });
  const manifestCarouselItems = sortByDateAsc(
    manifestData,
    (item) => item.launch.net,
    (item) => item.launch.id || item.launch.name
  ).map((item) => {
    const enhancementFacts =
      manifestEnhancementFacts.get(item.launch.id) ||
      manifestEnhancementFacts.get(item.launch.ll2Id) ||
      null;
    const missionSummary = resolveBlueOriginEnhancementText(
      enhancementFacts?.missionSummary,
      item.launch.mission?.description || null
    );
    const failureReason = resolveBlueOriginEnhancementText(
      enhancementFacts?.failureReason,
      item.launch.failReason || null
    );

    return {
      launchId: item.launch.id,
      launchName: item.launch.name,
      launchNet: item.launch.net,
      launchStatus: item.launchStatus,
      launchStatusTone: item.launchStatusTone,
      isFutureLaunch: isFutureLaunch(item.launch.net, nowForManifestMs),
      missionSummary,
      failureReason,
      launchHref: buildLaunchHref(item.launch),
      seats: item.seats,
      hasExplicitSeatAssignments: item.hasExplicitSeatAssignments,
      missionVehicle: normalizeBlueOriginFactText(item.launch.vehicle) || null,
      missionProvider: normalizeBlueOriginFactText(item.launch.provider) || 'Blue Origin',
      missionPad: item.launch.pad?.name
        ? `${normalizeBlueOriginFactText(item.launch.pad.name)} (${normalizeBlueOriginFactText(item.launch.pad.shortCode) || 'pad'})`
        : null,
      missionPadState: normalizeBlueOriginFactText(item.launch.pad?.state) || null,
      manifestCapacity: item.manifestCapacity,
      manifestTravelerCount: item.manifestTravelerCount,
      manifestPayloadCount: item.manifestPayloadCount,
      manifestSourceTags: item.manifestSourceTags,
      isUnmannedFlight: item.mannedStatus === 'unmanned'
    };
  });
  pushTiming('transform', 'buildManifestCarouselItems', manifestTransformStartMs, 'ok');

  // 2. Transform Hardware Data
  const hardwareTransformStartMs = nowMilliseconds();
  const hardwareItems = [
    ...vehicles.items.map((v) => ({
      id: v.id,
      slug: v.vehicleSlug,
      name: v.displayName,
      status: v.status,
      description: v.description || undefined,
      type: 'vehicle' as const,
      engines: (VEHICLE_ENGINE_SLUGS[v.vehicleSlug] || [])
        .map((engineSlug) =>
          engines.items.find((engine) => engine.engineSlug === engineSlug)
        )
        .filter((engine): engine is (typeof engines.items)[number] =>
          Boolean(engine)
        )
        .map((e) => ({
          id: e.id,
          slug: e.engineSlug,
          name: e.displayName,
          type: 'engine' as const
        }))
    })),
    ...engines.items.map((e) => ({
      id: e.id,
      slug: e.engineSlug,
      name: e.displayName,
      status: e.status,
      description: e.description || undefined,
      type: 'engine' as const
    }))
  ];
  pushTiming('transform', 'buildHardwareItems', hardwareTransformStartMs, 'ok');

  // 3. Transform Procurement Data
  const procurementTransformStartMs = nowMilliseconds();
  const procurementEntries: ProcurementEntry[] = sortByDateDesc(
    auditTrailPage.items,
    (entry) => entry.postedDate,
    (entry) => entry.id
  );
  pushTiming('transform', 'buildProcurementEntries', procurementTransformStartMs, 'ok');

  // 4. Transform Signal Log Data
  const signalTransformStartMs = nowMilliseconds();
  const timelineSignalEntries: SignalEntry[] = timeline.events.map((e) => {
    const eventFlightCode = extractBlueOriginFlightCodeFromText(
      `${e.title} ${e.summary || ''}`
    );
    const sourceFlightCode = extractBlueOriginFlightCodeFromUrl(e.source.href || null);
    const normalizedEventFlightCode = normalizeManifestLookupKey(eventFlightCode);
    const normalizedSourceFlightCode = normalizeManifestLookupKey(sourceFlightCode);
    const linkedLaunch =
      e.launch ||
      (normalizedEventFlightCode ? launchByFlightCode.get(normalizedEventFlightCode) : null) ||
      (normalizedSourceFlightCode ? launchByFlightCode.get(normalizedSourceFlightCode) : null);
    const launchHref = linkedLaunch ? buildLaunchHref(linkedLaunch) : null;

    return {
      id: e.id,
      type: 'technical' as const,
      title: e.title,
      date: e.date,
      summary: e.summary || undefined,
      sourceLabel: e.source.label,
      primaryUrl: launchHref || e.source.href,
      sourceUrl: e.source.href,
      confidence: e.confidence as 'high' | 'medium' | 'low'
    };
  });
  const socialSignalEntries: SignalEntry[] = socialPosts.map((p) => ({
    id: p.id,
    type: 'social' as const,
    title: 'Official Social Update',
    date: p.postedAt || '',
    summary: p.summary || undefined,
    sourceLabel: 'X / Twitter',
    primaryUrl: p.url,
    sourceUrl: p.url,
    tweetId: resolveXPostId(p.externalId, p.url)
  }));
  pushTiming('transform', 'buildSignalEntries', signalTransformStartMs, 'ok');

  // 5. Transform Media Data
  const mediaTransformStartMs = nowMilliseconds();
  const mediaItems = [
    ...mediaImages.map((img) => ({
      id: img.id,
      type: 'image' as const,
      url: img.sourceUrl || img.imageUrl,
      thumbnailUrl: img.imageUrl,
      title: img.title || 'Media Archive Image',
      subtitle: img.sourceLabel,
      publishedAt: img.publishedAt
    })),
    ...youtubeVideos.map((vid) => ({
      id: vid.id,
      type: 'video' as const,
      url: vid.url,
      thumbnailUrl: vid.thumbnailUrl || undefined,
      title: vid.title,
      subtitle: vid.summary || undefined,
      publishedAt: vid.publishedAt
    }))
  ];
  pushTiming('transform', 'buildMediaItems', mediaTransformStartMs, 'ok');

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const manifestUsesSeatIndexes = manifestData.some(
    (row) => row.hasExplicitSeatAssignments
  );
  const lastUpdated = program.lastUpdated || program.generatedAt;
  const nowMs = Date.now();
  const newShepardLaunches = allLaunches.filter(
    (launch) => getBlueOriginMissionKeyFromLaunch(launch) === 'new-shepard'
  );
  const totalNewShepardFlightCount = newShepardLaunches.length;
  const lastCompletedNewShepardLaunch =
    sortByDateDesc(
      newShepardLaunches.filter((launch) => !isFutureLaunch(launch.net, nowMs)),
      (launch) => launch.net,
      (launch) => launch.id || launch.name || ''
    )[0] || null;
  const lastCompletedNewShepardFlightCode = lastCompletedNewShepardLaunch
    ? extractBlueOriginFlightCode(lastCompletedNewShepardLaunch)
    : null;
  const lastCompletedNewShepardFlightHref = lastCompletedNewShepardFlightCode
    ? `/blue-origin/flights/${buildBlueOriginFlightSlug(lastCompletedNewShepardFlightCode)}`
    : lastCompletedNewShepardLaunch
      ? buildLaunchHref(lastCompletedNewShepardLaunch)
      : '/blue-origin/flights?mission=new-shepard';
  const upcomingNewShepardLaunchCount = newShepardLaunches.filter((launch) =>
    isFutureLaunch(launch.net, nowMs)
  ).length;
  const trackedNewShepardPassengers = passengers.items.filter(
    (row) => row.missionKey === 'new-shepard'
  );
  const trackedNewShepardHumanCount = trackedNewShepardPassengers.length;
  const trackedNewShepardUniqueHumanCount = new Set(
    trackedNewShepardPassengers
      .map((row) =>
        normalizeManifestLookupKey(
          row.travelerSlug || buildBlueOriginTravelerSlug(row.name)
        )
      )
      .filter((value): value is string => Boolean(value))
  ).size;
  const hasOfficialHumanCountGap =
    trackedNewShepardHumanCount !== NEW_SHEPARD_OFFICIAL_HUMAN_COUNT ||
    trackedNewShepardUniqueHumanCount !== NEW_SHEPARD_OFFICIAL_UNIQUE_HUMAN_COUNT;
  const highConfidenceTimelineRate =
    timeline.kpis.totalEvents > 0
      ? timeline.kpis.highConfidenceEvents / timeline.kpis.totalEvents
      : 0;
  const navCounts = {
    manifest: manifestLaunches.length,
    hardware: hardwareItems.length,
    procurement: auditTrailPage.total,
    timeline: timeline.kpis.totalEvents + socialSignalEntries.length,
    media: mediaItems.length
  };
  const lastUpdatedLabel = formatDateTimeLabel(lastUpdated);

  pushTiming('server-total', 'blueOriginProgramPage', serverStartMs, 'ok');
  if (debugMode) {
    console.info('[TMZ][BlueOriginHub][Server] timings', timings);
  }

  const diagnosticsPayload = debugMode
    ? buildBlueOriginHubDiagnosticsPayload({
        program,
        dedupedUpcoming,
        dedupedRecent,
        manifestData,
        timings,
        passengers: passengers.items,
        payloads: payloads.items,
        contracts,
        timelineEvents: timeline.events,
        socialPosts,
        mediaImages,
        youtubeVideos,
        vehicles: vehicles.items,
        engines: engines.items
      })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[96rem] gap-10 px-4 py-10 md:px-8">
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Blue Origin Program',
            description:
              'Blue Origin program hub for flights, manifests, hardware, contracts, and source-backed updates.',
            dateModified: program.lastUpdated || program.generatedAt
          }
        ]}
      />

      {/* Sidebar Navigation */}
      <div className="hidden w-56 flex-shrink-0 md:block">
        <BlueOriginJumpRail counts={navCounts} variant="desktop" />
      </div>

      <div className="flex flex-grow flex-col gap-12">
        <BlueOriginJumpRail counts={navCounts} variant="mobile" />

        <ProgramHubHero
          theme="blue-origin"
          eyebrow="Program Hub"
          title="Blue Origin"
          description="Flight manifests, traveler records, hardware, contracts, and source-backed updates for New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4 with a cleaner web mission-control shell."
          logo={
            <Image
              src="/assets/program-logos/blueorigin-official.png"
              alt="Blue Origin official logo"
              width={72}
              height={72}
              className="h-auto w-auto max-h-12 max-w-12 object-contain sm:max-h-14 sm:max-w-14"
            />
          }
          badges={[
            { label: 'Web mission control', tone: 'accent' },
            { label: `Updated ${lastUpdatedLabel}` }
          ]}
          metrics={[
            {
              label: 'Tracked manifests',
              value: manifestLaunches.length.toLocaleString(),
              detail: 'Flights rendered with traveler or payload context.'
            },
            {
              label: 'Traveler records',
              value: passengers.items.length.toLocaleString(),
              detail: 'Crew and passenger directory coverage from shared loaders.'
            },
            {
              label: 'Verified events',
              value: timeline.kpis.highConfidenceEvents.toLocaleString(),
              detail: `${formatPercent(highConfidenceTimelineRate)} of timeline events are high confidence.`
            },
            {
              label: 'Contracts + records',
              value: auditTrailPage.total.toLocaleString(),
              detail: `${contracts.items.length.toLocaleString()} contract pages plus procurement and award rows.`
            }
          ]}
          routes={[
            {
              href: '/blue-origin/missions',
              label: 'Mission hubs',
              description: 'New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4 route families.',
              eyebrow: 'Primary routes'
            },
            {
              href: '/blue-origin/flights',
              label: 'Flight records',
              description: 'Mission flight history with launch routing and manifest handoff.',
              eyebrow: 'Operations'
            },
            {
              href: '/blue-origin/travelers',
              label: 'Traveler directory',
              description: 'Crew and passenger profiles with mission-linked browsing.',
              eyebrow: 'People'
            },
            {
              href: '/blue-origin/contracts',
              label: 'Contracts',
              description: 'Internal story pages backed by SAM.gov and USAspending records.',
              eyebrow: 'Records'
            }
          ]}
          secondaryLinks={[
            { href: '/blue-origin/vehicles', label: 'Vehicles' },
            { href: '/blue-origin/engines', label: 'Engines' },
            { href: '/blue-origin/missions/new-shepard', label: 'New Shepard' }
          ]}
          footnote={
            <span>
              Last hub snapshot rendered <span className="font-semibold text-text1">{lastUpdatedLabel}</span>. New Shepard pause context stays visible below so the page still opens with the clearest current program signal.
            </span>
          }
        />

        <section className="rounded-2xl border border-stroke bg-surface-1 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text3">
                New Shepard Snapshot
              </p>
              <h2 className="mt-1 text-xl font-semibold text-text1">
                Human Flight Status
              </h2>
              <p className="mt-1 text-sm text-text2">
                Official totals, latest mission, and current launch posture.
              </p>
            </div>
            <Link
              href="/blue-origin/missions/new-shepard"
              className="rounded-full border border-stroke px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-text3 transition hover:text-text1"
            >
              Open Mission Hub
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text3">
                Flights Tracked
              </p>
              <p className="mt-2 text-2xl font-semibold text-text1">
                {totalNewShepardFlightCount}
              </p>
              <p className="text-xs text-text3">New Shepard missions in feed</p>
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text3">
                Humans Flown
              </p>
              <p className="mt-2 text-2xl font-semibold text-text1">
                {NEW_SHEPARD_OFFICIAL_HUMAN_COUNT}
              </p>
              <p className="text-xs text-text3">
                {NEW_SHEPARD_OFFICIAL_UNIQUE_HUMAN_COUNT} unique individuals
              </p>
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text3">
                Last Flight
              </p>
              {lastCompletedNewShepardLaunch ? (
                <>
                  <Link
                    href={lastCompletedNewShepardFlightHref}
                    className="mt-2 block text-sm font-semibold uppercase tracking-[0.08em] text-text1 hover:text-primary"
                  >
                    {lastCompletedNewShepardFlightCode?.toUpperCase() ||
                      lastCompletedNewShepardLaunch.name}
                  </Link>
                  <BlueOriginLocalTime
                    value={lastCompletedNewShepardLaunch.net}
                    variant="dateTime"
                    className="text-xs text-text3"
                  />
                </>
              ) : (
                <p className="mt-2 text-xs text-text3">
                  No completed New Shepard flights in current cache.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text3">
                Upcoming Flights
              </p>
              <p className="mt-2 text-2xl font-semibold text-text1">
                {upcomingNewShepardLaunchCount}
              </p>
              <p className="text-xs text-text3">Listed in current launch feed</p>
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text3">
                Program Status
              </p>
              <p className="mt-2 text-sm font-semibold text-text1">Paused</p>
              <p className="mt-1 text-xs text-text2">{NEW_SHEPARD_STATUS_SUMMARY}</p>
            </div>
          </div>

          <p className="mt-4 text-xs text-text3">
            Status source:{' '}
            <a
              href={NEW_SHEPARD_STATUS_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 transition hover:text-text1"
            >
              Blue Origin ({NEW_SHEPARD_STATUS_SOURCE_DATE_LABEL})
            </a>
          </p>
          {hasOfficialHumanCountGap ? (
            <p className="mt-2 text-xs text-text3">
              Internal roster currently tracks {trackedNewShepardHumanCount} humans (
              {trackedNewShepardUniqueHumanCount} unique), while Blue Origin reports{' '}
              {NEW_SHEPARD_OFFICIAL_HUMAN_COUNT} humans (
              {NEW_SHEPARD_OFFICIAL_UNIQUE_HUMAN_COUNT} unique).
            </p>
          ) : null}
        </section>

        <section id="manifest" className="scroll-mt-24 space-y-8">
          <div className="border-b border-stroke pb-4">
            <h2 className="text-2xl font-bold text-text1">
              01 Flight Manifests
            </h2>
            <p className="mt-1 text-sm text-text3 italic">
              {manifestUsesSeatIndexes
                ? 'Seat indexes are used when published; otherwise crew and payloads are rendered by verified flight roster. Manifests start at the earliest flight and cycle infinitely.'
                : 'Crew and payloads are rendered by verified flight roster when official seat indexes are unavailable. Manifests start at the earliest flight and cycle infinitely.'}
            </p>
          </div>
          <BlueOriginManifestCarousel items={manifestCarouselItems} />
        </section>

        <section id="hardware" className="scroll-mt-24 space-y-8">
          <div className="border-b border-stroke pb-4">
            <h2 className="text-2xl font-bold text-text1">
              02 Hardware Catalog
            </h2>
            <p className="mt-1 text-sm text-text3 italic">
              Architectural overview of propulsion systems and space vehicles.
            </p>
          </div>
          <BlueOriginHardwareCatalog items={hardwareItems} />
        </section>

        <section id="procurement" className="scroll-mt-24 space-y-8">
          <div className="border-b border-stroke pb-4">
            <h2 className="text-2xl font-bold text-text1">
              03 Contracts and Records
            </h2>
            <p className="mt-1 text-sm text-text3 italic">
              Internal contract pages with linked SAM.gov and USASpending source records.
            </p>
          </div>
          <BlueOriginProcurementLedger
            entries={procurementEntries}
            initialTotal={auditTrailPage.total}
            initialFetchLimit={auditTrailPage.limit}
            initialHasMore={auditTrailPage.hasMore}
          />
          <ProgramContractDiscoveryList
            title="Unmatched source records"
            subtitle="Relevant Blue Origin awards and notices that are still waiting for a confident match to an internal contract page."
            items={discoveryPage.items}
            emptyMessage="Source records will appear here when they are in scope for Blue Origin but are not yet matched to an internal contract page."
          />
        </section>

        <section id="timeline" className="scroll-mt-24 space-y-8">
          <div className="border-b border-stroke pb-4">
            <h2 className="text-2xl font-bold text-text1">
              04 Timeline and Updates
            </h2>
            <p className="mt-1 text-sm text-text3 italic">
              Source-backed mission milestones and official posts in one
              stream.
            </p>
          </div>
          <BlueOriginSignalLog
            timelineSignals={timelineSignalEntries}
            socialSignals={socialSignalEntries}
            initialTimelineNextCursor={timeline.nextCursor}
          />
        </section>

        <section id="media" className="scroll-mt-24 space-y-8">
          <div className="border-b border-stroke pb-4">
            <h2 className="text-2xl font-bold text-text1">05 Media Archive</h2>
            <p className="mt-1 text-sm text-text3 italic">
              Tracked image and video archive for Blue Origin coverage.
            </p>
          </div>
          <BlueOriginMediaArchive items={mediaItems} />
        </section>

        <footer className="mt-16 border-t border-stroke pt-8">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-text3">
            {BRAND_NAME} Blue Origin Program
          </p>
        </footer>
        {diagnosticsPayload ? (
          <BlueOriginHubDiagnostics payload={diagnosticsPayload} />
        ) : null}
      </div>
    </div>
  );
}

function nowMilliseconds() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function formatDateTimeLabel(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function isFutureLaunch(net: string | null | undefined, nowMs: number) {
  const launchMs = Date.parse(net || '');
  if (!Number.isFinite(launchMs)) return false;
  return launchMs > nowMs;
}

function dedupeProgramLaunches(launches: Launch[]) {
  const byKey = new Map<string, Launch>();
  const nowMs = Date.now();
  for (const launch of launches) {
    const key =
      launch.id ||
      launch.ll2Id ||
      extractBlueOriginFlightCode(launch) ||
      `${normalizeDateForDedupe(launch.net)}:${normalizeTextForDedupe(launch.name)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, launch);
      continue;
    }

    const existingMs = Date.parse(existing.net || '');
    const nextMs = Date.parse(launch.net || '');
    const existingIsPast = Number.isFinite(existingMs) && existingMs <= nowMs;
    const nextIsPast = Number.isFinite(nextMs) && nextMs <= nowMs;

    if (nextIsPast && !existingIsPast) {
      byKey.set(key, launch);
      continue;
    }
    if (existingIsPast && !nextIsPast) {
      continue;
    }

    if (!Number.isFinite(existingMs) && Number.isFinite(nextMs)) {
      byKey.set(key, launch);
      continue;
    }
    if (Number.isFinite(existingMs) && !Number.isFinite(nextMs)) {
      continue;
    }

    if (Number.isFinite(existingMs) && Number.isFinite(nextMs)) {
      const existingDelta = Math.abs(existingMs - nowMs);
      const nextDelta = Math.abs(nextMs - nowMs);
      if (nextDelta < existingDelta) {
        byKey.set(key, launch);
      }
    }
  }
  return [...byKey.values()];
}

function normalizeDateForDedupe(net: string | null | undefined) {
  const parsed = Date.parse(net || '');
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return 'unknown-date';
}

function normalizeTextForDedupe(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function buildBlueOriginLaunchRows(upcoming: Launch[], recent: Launch[]) {
  return dedupeProgramLaunches([...upcoming, ...recent]).sort((a, b) => {
    const aMs = Date.parse(a.net || '');
    const bMs = Date.parse(b.net || '');
    return bMs - aMs;
  });
}

type ManifestRecordForLookup = {
  id: string;
  name: string | null;
  launchId: string | null;
  flightCode: string | null;
  flightSlug: string | null;
  launchName: string | null;
  launchDate: string | null;
};

type ManifestRecordLookup<T extends ManifestRecordForLookup> = {
  byLaunchId: Map<string, T[]>;
  byFlightCode: Map<string, T[]>;
  byFlightSlug: Map<string, T[]>;
  byLaunchName: Map<string, T[]>;
  byLaunchNameDate: Map<string, T[]>;
};

function buildManifestLookupKeys(launch: Launch) {
  const flightCode = normalizeManifestLookupKey(extractBlueOriginFlightCode(launch));
  const launchName = normalizeManifestLookupKey(launch.name);
  const launchDate = normalizeManifestDateKey(launch.net);

  return {
    launchId: normalizeManifestLookupKey(launch.id),
    ll2LaunchId: normalizeManifestLookupKey(launch.ll2Id),
    flightCode,
    flightSlug: flightCode ? normalizeManifestLookupKey(buildBlueOriginFlightSlug(flightCode)) : null,
    launchName,
    launchNameDateKey: launchName && launchDate ? `${launchDate}|${launchName}` : null
  };
}

function buildManifestRecordLookup<T extends ManifestRecordForLookup>(
  rows: T[]
): ManifestRecordLookup<T> {
  const byLaunchId = new Map<string, T[]>();
  const byFlightCode = new Map<string, T[]>();
  const byFlightSlug = new Map<string, T[]>();
  const byLaunchName = new Map<string, T[]>();
  const byLaunchNameDate = new Map<string, T[]>();

  const addToLookup = (bucket: Map<string, T[]>, key: string | null, value: T) => {
    if (!key) return;
    const existing = bucket.get(key) || [];
    existing.push(value);
    bucket.set(key, existing);
  };

  for (const row of rows) {
    const launchId = normalizeManifestLookupKey(row.launchId);
    const flightCode = normalizeManifestLookupKey(row.flightCode);
    const flightSlug = normalizeManifestLookupKey(row.flightSlug);
    const launchName = normalizeManifestLookupKey(row.launchName);
    const launchDate = normalizeManifestDateKey(row.launchDate);

    addToLookup(byLaunchId, launchId, row);
    addToLookup(byFlightCode, flightCode, row);
    addToLookup(byFlightSlug, flightSlug, row);
    addToLookup(byLaunchName, launchName, row);
    addToLookup(
      byLaunchNameDate,
      launchName && launchDate ? `${launchDate}|${launchName}` : null,
      row
    );
  }

  return { byLaunchId, byFlightCode, byFlightSlug, byLaunchName, byLaunchNameDate };
}

function getManifestRowsForLaunch<T extends ManifestRecordForLookup>(
  lookup: ManifestRecordLookup<T>,
  launch: Launch
) {
  const keys = buildManifestLookupKeys(launch);
  const seen = new Set<string>();
  const rows: T[] = [];
  const addRows = (candidates?: T[]) => {
    for (const row of candidates || []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  };

  addRows(lookup.byLaunchId.get(keys.launchId || ''));
  addRows(lookup.byLaunchId.get(keys.ll2LaunchId || ''));
  addRows(lookup.byFlightCode.get(keys.flightCode || ''));
  addRows(lookup.byFlightSlug.get(keys.flightSlug || ''));
  addRows(lookup.byLaunchNameDate.get(keys.launchNameDateKey || ''));

  return rows;
}

function getManifestRowsByLaunchKey<T extends { id: string }>(
  rowsByLaunchKey: Map<string, T[]>,
  launch: Launch
) {
  const keys = buildManifestLookupKeys(launch);
  const seen = new Set<string>();
  const rows: T[] = [];
  const addRows = (candidates?: T[]) => {
    for (const row of candidates || []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  };

  addRows(rowsByLaunchKey.get(keys.launchId || ''));
  addRows(rowsByLaunchKey.get(keys.ll2LaunchId || ''));

  return rows;
}

function normalizeManifestLookupKey(value: unknown) {
  const normalized = normalizeBlueOriginFactText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeManifestDateKey(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

async function fetchBlueOriginManifestLl2PayloadDataByLaunches(
  launches: Launch[]
): Promise<Map<string, BlueOriginPayload[]>> {
  if (!launches.length || !isSupabaseAdminConfigured()) {
    return new Map<string, BlueOriginPayload[]>();
  }

  const launchByLookupKey = new Map<string, Launch[]>();
  const launchLl2Ids = new Set<string>();
  const addLaunchLookup = (key: string | null, launch: Launch) => {
    if (!key) return;
    const bucket = launchByLookupKey.get(key) || [];
    if (!bucket.includes(launch)) {
      bucket.push(launch);
      launchByLookupKey.set(key, bucket);
    }
  };

  for (const launch of launches) {
    const launchId = normalizeManifestLookupKey(launch.id);
    const ll2LaunchId = normalizeManifestLookupKey(launch.ll2Id);
    addLaunchLookup(launchId, launch);
    addLaunchLookup(ll2LaunchId, launch);
    if (ll2LaunchId) launchLl2Ids.add(ll2LaunchId);
  }

  const ll2LaunchIds = [...launchLl2Ids];
  if (!ll2LaunchIds.length) {
    return new Map<string, BlueOriginPayload[]>();
  }

  const supabase = createSupabaseAdminClient();

  const flightChunkQueries = chunkArray(ll2LaunchIds, BLUE_ORIGIN_LAUNCH_BATCH_SIZE).map(
    (chunk) =>
      supabase
        .from('ll2_payload_flights')
        .select('ll2_payload_flight_id,ll2_launch_uuid,ll2_payload_id,destination,amount,active,launch_id')
        .in('ll2_launch_uuid', chunk)
        .limit(5000)
  );

  const flightChunkResults = await Promise.all(flightChunkQueries);
  const payloadFlights: BlueOriginManifestLl2PayloadFlightRow[] = [];
  for (const result of flightChunkResults) {
    if (result.error) {
      console.error('blue origin manifest ll2 payload flights query error', result.error);
      continue;
    }

    payloadFlights.push(...((result.data || []) as BlueOriginManifestLl2PayloadFlightRow[]));
  }

  const payloadIdList = [...new Set(
    payloadFlights
      .map((row) => row.ll2_payload_id)
      .filter((value): value is number => value != null)
  )];
  if (!payloadIdList.length) {
    return new Map<string, BlueOriginPayload[]>();
  }

  const payloadById = new Map<number, BlueOriginManifestLl2PayloadDetailRow>();
  const payloadIdQueries = chunkArray(payloadIdList, BLUE_ORIGIN_LAUNCH_PAYLOAD_BATCH_SIZE).map(
    (chunk) =>
      supabase
        .from('ll2_payloads')
        .select('ll2_payload_id,name,payload_type_id,manufacturer_id,operator_id')
        .in('ll2_payload_id', chunk)
        .limit(5000)
  );

  const payloadIdResults = await Promise.all(payloadIdQueries);
  for (const result of payloadIdResults) {
    if (result.error) {
      console.error('blue origin manifest ll2 payload query error', result.error);
      continue;
    }

    for (const row of (result.data || []) as BlueOriginManifestLl2PayloadDetailRow[]) {
      payloadById.set(row.ll2_payload_id, row);
    }
  }

  const payloadTypeIdList = [...new Set(
    [...payloadById.values()]
      .map((row) => row.payload_type_id)
      .filter((value): value is number => value != null)
  )];
  const payloadTypeById = new Map<number, string>();
  const payloadTypeQueries = chunkArray(payloadTypeIdList, BLUE_ORIGIN_LAUNCH_PAYLOAD_BATCH_SIZE).map(
    (chunk) =>
      supabase
        .from('ll2_payload_types')
        .select('ll2_payload_type_id,name')
        .in('ll2_payload_type_id', chunk)
        .limit(5000)
  );

  const payloadTypeResults = await Promise.all(payloadTypeQueries);
  for (const result of payloadTypeResults) {
    if (result.error) {
      console.error('blue origin manifest ll2 payload type query error', result.error);
      continue;
    }

    for (const row of (result.data || []) as BlueOriginManifestLl2PayloadTypeRow[]) {
      payloadTypeById.set(row.ll2_payload_type_id, row.name);
    }
  }

  const agencyIds = [...new Set(
    [...payloadById.values()]
      .map((row) => row.operator_id || row.manufacturer_id)
      .filter((value): value is number => value != null)
  )];
  const agencyById = new Map<number, string>();
  const agencyQueries = chunkArray(agencyIds, BLUE_ORIGIN_LAUNCH_PAYLOAD_BATCH_SIZE).map(
    (chunk) =>
      supabase
        .from('ll2_agencies')
        .select('ll2_agency_id,name')
        .in('ll2_agency_id', chunk)
        .limit(5000)
  );

  const agencyResults = await Promise.all(agencyQueries);
  for (const result of agencyResults) {
    if (result.error) {
      console.error('blue origin manifest ll2 agency query error', result.error);
      continue;
    }

    for (const row of (result.data || []) as BlueOriginManifestLl2AgencyRow[]) {
      agencyById.set(row.ll2_agency_id, row.name);
    }
  }

  const payloadRowsByLaunchId = new Map<string, BlueOriginPayload[]>();
  const addPayloadByLookupKey = (
    lookupKey: string | null,
    payload: BlueOriginPayload
  ) => {
    if (!lookupKey) return;
    const rows = payloadRowsByLaunchId.get(lookupKey) || [];
    if (!rows.some((row) => row.id === payload.id)) {
      rows.push(payload);
      payloadRowsByLaunchId.set(lookupKey, rows);
    }
  };

  for (const row of payloadFlights) {
    if (!row.ll2_payload_id) continue;
    const normalizedLl2LaunchId = normalizeManifestLookupKey(row.ll2_launch_uuid);
    const normalizedLaunchId = normalizeManifestLookupKey(row.launch_id);
    const launchCandidates = [
      ...(normalizedLl2LaunchId ? launchByLookupKey.get(normalizedLl2LaunchId) || [] : []),
      ...(normalizedLaunchId ? launchByLookupKey.get(normalizedLaunchId) || [] : [])
    ];

    const launch = launchCandidates[0];
    if (!launch) continue;

    const payloadProfile = payloadById.get(row.ll2_payload_id);
    if (!payloadProfile) continue;

    const flightCode = extractBlueOriginFlightCode(launch);
    const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
    const payloadType = payloadProfile.payload_type_id
      ? payloadTypeById.get(payloadProfile.payload_type_id) || null
      : null;
    const agencyId = payloadProfile.operator_id || payloadProfile.manufacturer_id;
    const agency = agencyId && agencyById.get(agencyId)
      ? normalizeBlueOriginFactText(agencyById.get(agencyId))
      : null;

    const payloadRow: BlueOriginPayload = {
      id: `ll2_manifest:${launch.id}:${row.ll2_payload_flight_id}`,
      missionKey,
      flightCode,
      flightSlug: flightCode ? buildBlueOriginFlightSlug(flightCode) : null,
      name: payloadProfile.name,
      payloadType,
      orbit: normalizeBlueOriginFactText(row.destination) || normalizeBlueOriginFactText(launch.mission?.orbit) || null,
      agency,
      launchId: launch.id,
      launchName: normalizeBlueOriginFactText(launch.name) || launch.id,
      launchDate: normalizeBlueOriginFactText(launch.net) || null,
      source: 'll2_payload_manifest',
      confidence: 'high'
    };

    const launchLookupKeys = new Set<string>();
    for (const launchCandidate of launchCandidates) {
      const launchId = normalizeManifestLookupKey(launchCandidate.id);
      const ll2LaunchCandidateId = normalizeManifestLookupKey(launchCandidate.ll2Id);
      if (launchId) launchLookupKeys.add(launchId);
      if (ll2LaunchCandidateId) launchLookupKeys.add(ll2LaunchCandidateId);
    }
    if (normalizedLl2LaunchId) launchLookupKeys.add(normalizedLl2LaunchId);
    if (normalizedLaunchId) launchLookupKeys.add(normalizedLaunchId);

    for (const lookupKey of launchLookupKeys) {
      addPayloadByLookupKey(lookupKey, payloadRow);
    }
  }

  return payloadRowsByLaunchId;
}

async function fetchBlueOriginManifestLl2SpacecraftFlightsByLaunches(
  launches: Launch[]
): Promise<Map<string, BlueOriginManifestLl2SpacecraftFlightRow[]>> {
  if (!launches.length || !isSupabaseConfigured()) {
    return new Map<string, BlueOriginManifestLl2SpacecraftFlightRow[]>();
  }

  const ll2LaunchIds = [
    ...new Set(
      launches
        .map((launch) => normalizeLl2LaunchUuid(launch.ll2Id))
        .filter((value): value is string => Boolean(value))
    )
  ];
  if (!ll2LaunchIds.length) {
    return new Map<string, BlueOriginManifestLl2SpacecraftFlightRow[]>();
  }

  const runQuery = async (
    client: ReturnType<typeof createSupabasePublicClient> | ReturnType<typeof createSupabaseAdminClient>
  ) => {
    const queries = chunkArray(ll2LaunchIds, BLUE_ORIGIN_LAUNCH_SPACECRAFT_FLIGHT_BATCH_SIZE).map((chunk) =>
      client
        .from('ll2_spacecraft_flights')
        .select('ll2_spacecraft_flight_id,ll2_launch_uuid,launch_crew,onboard_crew,landing_crew,active')
        .in('ll2_launch_uuid', chunk)
        .limit(5_000)
    );

    const results = await Promise.all(queries);
    const rows: BlueOriginManifestLl2SpacecraftFlightRow[] = [];
    let errorCount = 0;

    for (const result of results) {
      if (result.error) {
        errorCount += 1;
        // eslint-disable-next-line no-console
        console.error('blue origin manifest ll2 spacecraft flights query error', result.error);
        continue;
      }

      rows.push(...((result.data || []) as BlueOriginManifestLl2SpacecraftFlightRow[]));
    }

    return { rows, errorCount };
  };

  let result = await runQuery(createSupabasePublicClient());
  if ((result.errorCount > 0 || result.rows.length === 0) && isSupabaseAdminConfigured()) {
    const adminResult = await runQuery(createSupabaseAdminClient());
    if (adminResult.rows.length > 0) {
      result = adminResult;
    }
  }

  const flightsByLaunchUuid = new Map<string, BlueOriginManifestLl2SpacecraftFlightRow[]>();
  for (const row of result.rows) {
    const uuid = normalizeLl2LaunchUuid(row.ll2_launch_uuid);
    if (!uuid) continue;
    const existing = flightsByLaunchUuid.get(uuid) || [];
    existing.push(row);
    flightsByLaunchUuid.set(uuid, existing);
  }

  return flightsByLaunchUuid;
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function collectManifestSourceTags(
  rows: Array<{ source?: string | null }>
) {
  const sourceSet = new Set<string>();

  for (const row of rows) {
    const label = normalizeManifestSourceLabel(row.source || null);
    if (label) sourceSet.add(label);
  }

  return [...sourceSet.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function normalizeManifestSourceLabel(value: string | null) {
  const normalized = normalizeBlueOriginFactText(value) || '';
  const lower = normalized.toLowerCase();
  if (!lower) return '';

  if (lower.startsWith('derived:mission_summary')) return 'Mission Summary';
  if (lower === 'database') return 'Blue Origin Database';
  if (lower.startsWith('launches_public_cache')) return 'Launches Public Cache';
  if (lower.startsWith('ll2-api')) return 'LL2 API';
  if (lower === 'll2_spacecraft_flights' || lower.startsWith('ll2_spacecraft_flights')) {
    return 'LL2 Spacecraft Flights';
  }
  if (lower === 'll2_payload_manifest' || lower.startsWith('ll2_payload_manifest')) {
    return 'LL2 Payload Manifest';
  }
  if (lower.startsWith('wikipedia')) return 'Wikipedia';
  if (lower.startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) {
    return 'Blue Origin Astronaut Directory (Wayback)';
  }
  if (lower.startsWith('blue-origin-wayback:new-shepard-mission-page')) {
    return 'Blue Origin Mission Page (Wayback)';
  }
  if (lower.startsWith('blue-origin-wayback:new-shepard-mission-rollup')) {
    return 'Blue Origin Mission Rollup (Wayback)';
  }
  if (lower.includes('blueorigin_multisource:bo_manifest_passengers')) {
    return 'Blue Origin Multisource Crew';
  }
  if (lower.includes('blueorigin_multisource:bo_manifest_payloads')) {
    return 'Blue Origin Multisource Payloads';
  }
  if (lower.startsWith('blueorigin_multisource')) return 'Blue Origin Multisource';
  if (lower.startsWith('curated-fallback')) return 'Blue Origin Curated';

  const source = normalized.split(':')[0] || normalized;
  return source ? `${source}` : '';
}

function mergeManifestPeopleAndPayloadSourceRows<T extends {
  id?: string | null;
  name?: string | null;
  source?: string | null;
  flightCode?: string | null;
  launchId?: string | null;
  launchName?: string | null;
  payloadType?: string | null;
}>(
  rows: T[],
  launchKeyOverride?: string | null,
  mergeKind: 'traveler' | 'payload' = 'payload'
): T[] {
  const deduped = new Map<string, T>();
  const mergeRows = (preferred: T, supplement: T): T => {
    const merged = { ...(preferred as any) } as Record<string, unknown>;
    const supplementObj = supplement as any as Record<string, unknown>;

    for (const [key, value] of Object.entries(supplementObj)) {
      if (value == null) continue;
      const current = merged[key];
      if (current == null) {
        merged[key] = value;
        continue;
      }

      if (typeof current === 'string' && typeof value === 'string') {
        if (!current.trim() && value.trim()) {
          merged[key] = value;
        }
      }
    }

    return merged as unknown as T;
  };

  for (const row of rows) {
    const flightKey =
      normalizeManifestDedupeKey(launchKeyOverride) ||
      normalizeManifestDedupeKey(row.flightCode || row.launchId || row.launchName || 'unknown');
    const nameKey =
      mergeKind === 'traveler'
        ? buildBlueOriginTravelerIdentityKey(row.name, row.flightCode)
        : normalizeManifestDedupeKey(row.name);
    if (!nameKey) continue;
    const typeKey = normalizeManifestDedupeKey((row as { payloadType?: string | null }).payloadType);
    const dedupeKey = `${flightKey}|${nameKey}${typeKey ? `|${typeKey}` : ''}`;

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, row);
      continue;
    }

    const existingConfidence = confidenceRank((existing as { confidence?: 'high' | 'medium' | 'low' }).confidence);
    const rowConfidence = confidenceRank((row as { confidence?: 'high' | 'medium' | 'low' }).confidence);

    if (rowConfidence > existingConfidence) {
      deduped.set(dedupeKey, mergeRows(row, existing));
      continue;
    }

    deduped.set(dedupeKey, mergeRows(existing, row));
  }

  return [...deduped.values()];
}

function confidenceRank(value: unknown): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function normalizeManifestDedupeKey(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFactText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isLikelyBlueOriginManifestPassengerName(value: string) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  if (/[|=]/.test(normalized)) return false;
  if (!/\p{L}/u.test(normalized)) return false;
  if (normalized.length > 96) return false;
  if (BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_PHRASE_PATTERN.test(normalized)) return false;
  if (BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_TOKEN_PATTERN.test(normalized)) return false;

  const tokenized = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokenized.length < 2 || tokenized.length > 6) return false;
  if (!tokenized.some((token) => token.length >= 2)) return false;
  return true;
}

function isLikelyBlueOriginManifestPayloadName(value: string) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  if (/[|=]/.test(normalized)) return false;
  if (!/\p{L}/u.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 96) return false;
  if (BLUE_ORIGIN_MANIFEST_PAYLOAD_NOISE_TOKEN_PATTERN.test(normalized)) return false;

  const tokenized = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokenized.length < 1 || tokenized.length > 8) return false;
  return tokenized.some((token) => token.length >= 2);
}

function isExcludedBlueOriginManifestSource(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  return BLUE_ORIGIN_MANIFEST_EXCLUDED_SOURCE_PATTERN.test(normalized.toLowerCase());
}

function shouldTreatBlueOriginPassengerAsPayload(row: Pick<BlueOriginPassenger, 'name' | 'role'>) {
  return isBlueOriginNonHumanCrewEntry(row.name, row.role);
}

type BlueOriginMannedStatus = 'manned' | 'unmanned' | 'unknown';

function resolveBlueOriginMannedStatus({
  launch,
  missionSummary,
  manifestTravelerCount,
  manifestPayloadCount,
  ll2PassengerCount
}: {
  launch: Launch;
  missionSummary: string | null;
  manifestTravelerCount: number;
  manifestPayloadCount: number;
  ll2PassengerCount: number;
}): BlueOriginMannedStatus {
  const summary = normalizeBlueOriginFactText(missionSummary);
  const launchCrewCount = countKnownHumanCrewMembersFromLaunch(launch);
  const rosterCount = Math.max(0, Math.trunc(manifestTravelerCount));
  const payloadCount = Math.max(0, Math.trunc(manifestPayloadCount));

  if (
    ll2PassengerCount > 0 ||
    launchCrewCount > 0 ||
    rosterCount > 0 ||
    hasCrewedMissionLanguage(summary)
  ) {
    return 'manned';
  }

  if (
    hasUncrewedMissionLanguage(summary) ||
    payloadCount > 0 ||
    hasPayloadMissionLanguage(summary)
  ) {
    return 'unmanned';
  }

  return 'unknown';
}

function countKnownHumanCrewMembersFromLaunch(launch: Launch) {
  let count = 0;
  for (const crew of launch.crew || []) {
    const name = normalizeBlueOriginFactText(crew?.astronaut || null);
    if (!name) continue;
    if (shouldTreatBlueOriginPassengerAsPayload({ name, role: crew?.role || null })) continue;
    count += 1;
  }
  return count;
}

function hasCrewedMissionLanguage(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  return /\b(?:crewed|crew(?:ed)?\s+(?:flight|mission|launch)|first\s+(?:human|manned|crewed)\s+flight|passengers?|astronauts?)\b/i.test(
    normalized
  );
}

function hasUncrewedMissionLanguage(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  return /\b(?:unmanned|uncrewed|without\s+crew|cargo-only|payload-only|test\s+flight)\b/i.test(
    normalized
  );
}

function hasPayloadMissionLanguage(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFactText(value);
  if (!normalized) return false;
  return /\b(?:payloads?|experiments?|microgravity|research|science|scientific|postcards?)\b/i.test(
    normalized
  );
}

function resolveBlueOriginManifestCrewRowsFromLl2SpacecraftFlights(
  launch: Launch,
  flights: BlueOriginManifestLl2SpacecraftFlightRow[]
): {
  passengers: BlueOriginPassenger[];
  devicePayloads: Array<BlueOriginPassenger & { payloadType: string | null }>;
} {
  if (!flights.length) return { passengers: [], devicePayloads: [] };

  const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
  const flightCode = extractBlueOriginFlightCode(launch);
  const flightSlug = flightCode ? buildBlueOriginFlightSlug(flightCode) : null;
  const launchId = normalizeBlueOriginLaunchId(launch.id);
  const launchName = normalizeBlueOriginFactText(launch.name) || null;
  const launchDate = normalizeBlueOriginFactText(launch.net) || null;
  const launchDedupeKey = buildManifestLaunchDedupeKey(launch);

  const passengerRows: BlueOriginPassenger[] = [];
  const devicePayloadRows: Array<BlueOriginPassenger & { payloadType: string | null }> = [];

  const ingestCrewBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;

    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, any>;

      const rawCrewRole = normalizeBlueOriginFactText(row?.role?.role ?? row?.role ?? null);
      const crewRole = normalizeBlueOriginTravelerRole(rawCrewRole);
      const astronautObject =
        row?.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as Record<string, any>) : null;
      const astronautName = resolveBlueOriginTravelerCanonicalName(
        normalizeBlueOriginFactText(astronautObject?.name ?? row?.astronaut ?? null),
        flightCode
      );
      if (!astronautName) continue;

      const astronautIdRaw = astronautObject?.id;
      const astronautId =
        typeof astronautIdRaw === 'number' && Number.isFinite(astronautIdRaw) ? astronautIdRaw : null;

      const nationality = formatLl2Nationality(astronautObject?.nationality);
      const profileUrl = normalizeBlueOriginFactText(astronautObject?.wiki) || normalizeBlueOriginFactText(astronautObject?.url) || null;
      const imageUrl =
        normalizeBlueOriginFactText(astronautObject?.image?.thumbnail_url) ||
        normalizeBlueOriginFactText(astronautObject?.image?.thumbnailUrl) ||
        normalizeBlueOriginFactText(astronautObject?.profile_image_thumbnail) ||
        normalizeBlueOriginFactText(astronautObject?.profile_image) ||
        normalizeBlueOriginFactText(astronautObject?.image?.image_url) ||
        normalizeBlueOriginFactText(astronautObject?.image?.imageUrl) ||
        normalizeBlueOriginFactText(astronautObject?.image_url) ||
        normalizeBlueOriginFactText(astronautObject?.imageUrl) ||
        null;
      const bio = normalizeBlueOriginFactText(astronautObject?.bio) || null;

      const base: BlueOriginPassenger = {
        id: `ll2_spacecraft_flights:${launchId || flightCode || 'blue-origin'}:${astronautId ?? buildBlueOriginTravelerSlug(astronautName)}`,
        missionKey,
        flightCode,
        flightSlug,
        travelerSlug: buildBlueOriginTravelerSlug(astronautName),
        seatIndex: null,
        name: astronautName,
        role: crewRole || 'Crew',
        nationality: nationality || null,
        launchId,
        launchName,
        launchDate,
        profileUrl,
        imageUrl,
        bio,
        source: 'll2_spacecraft_flights',
        confidence: 'high'
      };

      if (shouldTreatLl2CrewMemberAsPayload(astronautName, rawCrewRole)) {
        devicePayloadRows.push({
          ...base,
          payloadType: rawCrewRole || 'Payload'
        });
        continue;
      }

      passengerRows.push(base);
    }
  };

  for (const flight of flights) {
    ingestCrewBucket(flight.launch_crew);
    ingestCrewBucket(flight.onboard_crew);
    ingestCrewBucket(flight.landing_crew);
  }

  return {
    passengers: mergeManifestPeopleAndPayloadSourceRows(
      passengerRows,
      launchDedupeKey,
      'traveler'
    ),
    devicePayloads: mergeManifestPeopleAndPayloadSourceRows(
      devicePayloadRows,
      launchDedupeKey,
      'payload'
    )
  };
}

function shouldTreatLl2CrewMemberAsPayload(name: string, role: string | null | undefined) {
  return isBlueOriginNonHumanCrewEntry(name, role);
}

function formatLl2Nationality(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return normalizeBlueOriginFactText(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const obj = entry as Record<string, unknown>;
        return (
          normalizeBlueOriginFactText(obj.nationality_name_composed) ||
          normalizeBlueOriginFactText(obj.nationality_name) ||
          normalizeBlueOriginFactText(obj.name) ||
          ''
        );
      })
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].join(', ') : null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      normalizeBlueOriginFactText(obj.nationality_name_composed) ||
      normalizeBlueOriginFactText(obj.nationality_name) ||
      normalizeBlueOriginFactText(obj.name) ||
      null
    );
  }
  return null;
}

function deriveSyntheticBlueOriginPayloadRowsFromMissionSummary(launch: Launch, missionSummary: string | null): BlueOriginPayload[] {
  const summary = normalizeBlueOriginFactText(missionSummary);
  if (!summary) return [];

  const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
  const flightCode = extractBlueOriginFlightCode(launch);
  const flightSlug = flightCode ? buildBlueOriginFlightSlug(flightCode) : null;
  const launchId = normalizeBlueOriginLaunchId(launch.id);
  const launchName = normalizeBlueOriginFactText(launch.name) || null;
  const launchDate = normalizeBlueOriginFactText(launch.net) || null;
  const lower = summary.toLowerCase();
  const base = {
    missionKey,
    flightCode,
    flightSlug,
    orbit: null,
    agency: null,
    launchId,
    launchName,
    launchDate,
    source: 'derived:mission_summary',
    confidence: 'medium' as const
  };

  const experimentMatch = summary.match(/\b(\d{1,4})\s+experiments?\b/i);
  if (experimentMatch?.[1]) {
    const count = Number(experimentMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      return [
        {
          ...base,
          id: `derived:${launchId || flightCode || 'blue-origin'}:experiments:${count}`,
          name: `Experiments (${count})`,
          payloadType: 'Experiment'
        }
      ];
    }
  }

  const payloadCountMatch = summary.match(
    /\b(?:more\s+than\s+|over\s+|around\s+|approximately\s+|roughly\s+)?(\d{1,4})\s+[^.\n]{0,60}?\bpayloads?\b/i
  );
  if (payloadCountMatch?.[1]) {
    const count = Number(payloadCountMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      const label = lower.includes('microgravity')
        ? 'Microgravity research payloads'
        : lower.includes('commercial')
          ? 'Commercial payloads'
          : lower.includes('research') || lower.includes('science') || lower.includes('scientific')
            ? 'Research payloads'
            : 'Payloads';
      return [
        {
          ...base,
          id: `derived:${launchId || flightCode || 'blue-origin'}:payloads:${count}`,
          name: `${label} (${count})`,
          payloadType: label
        }
      ];
    }
  }

  if (/\bblue\s+ring\b/i.test(summary) && /\bpayload\b/i.test(summary)) {
    return [
      {
        ...base,
        id: `derived:${launchId || flightCode || 'blue-origin'}:payloads:blue-ring`,
        name: 'Blue Ring prototype payload',
        payloadType: 'Payload'
      }
    ];
  }

  if (/\bpayloads?\b/i.test(summary)) {
    const label = lower.includes('lunar gravity')
      ? 'Lunar gravity payloads'
      : lower.includes('microgravity') || lower.includes('weightlessness')
        ? 'Microgravity research payloads'
        : lower.includes('commercial') || lower.includes('customer')
          ? 'Commercial payloads'
          : lower.includes('postcard')
            ? 'Postcards payload'
            : lower.includes('payload mission')
              ? 'Mission payload set'
              : 'Mission payloads';

    return [
      {
        ...base,
        id: `derived:${launchId || flightCode || 'blue-origin'}:payloads:mission`,
        name: label,
        payloadType: label
      }
    ];
  }

  return [];
}

function isVerifiedBlueOriginManifestPassenger(
  row: Pick<BlueOriginPassenger, 'name' | 'source' | 'confidence'>
) {
  const name = normalizeBlueOriginFactText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginManifestPassengerName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isVerifiedBlueOriginManifestPayload(
  row: Pick<BlueOriginPayload, 'name' | 'source' | 'confidence'>
) {
  const name = normalizeBlueOriginFactText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginManifestPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function buildManifestLaunchDedupeKey(launch: Launch) {
  const keys = buildManifestLookupKeys(launch);
  return (
    keys.flightCode ||
    keys.launchId ||
    keys.ll2LaunchId ||
    keys.launchNameDateKey ||
    keys.launchName ||
    null
  );
}

async function fetchBlueOriginManifestFactsByLaunchIds(launchIds: string[]) {
  if (!launchIds.length || !isSupabaseAdminConfigured()) {
    return new Map<string, BlueOriginManifestEnhancementFacts>();
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('launch_trajectory_constraints')
    .select('launch_id,data')
    .in('launch_id', launchIds)
    .eq('source', BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE)
    .eq('constraint_type', 'bo_mission_facts')
    .order('fetched_at', { ascending: false });

  if (error || !Array.isArray(data)) {
    return new Map<string, BlueOriginManifestEnhancementFacts>();
  }

  const factsByLaunchId = new Map<string, BlueOriginManifestEnhancementFacts>();

  for (const row of data as Array<{ launch_id?: unknown; data?: any }>) {
    const launchId = normalizeBlueOriginLaunchId(row.launch_id);
    if (!launchId) continue;

    const current = factsByLaunchId.get(launchId) || {
      missionSummary: null,
      failureReason: null
    };

    const payload = row.data && typeof row.data === 'object' ? (row.data as any) : null;
    const facts = Array.isArray(payload?.facts) ? payload.facts : [];

    for (const fact of facts) {
      if (!fact || typeof fact !== 'object') continue;

      const key = normalizeBlueOriginFactText((fact as any).key);
      const value = normalizeBlueOriginFactText((fact as any).value);
      if (!key || !value) continue;

      if (key === BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY) {
        current.missionSummary = pickRicherText(current.missionSummary, value);
      } else if (key === BLUE_ORIGIN_FAILURE_REASON_FACT_KEY) {
        current.failureReason = pickRicherText(current.failureReason, value);
      }
    }

    factsByLaunchId.set(launchId, current);
  }

  return factsByLaunchId;
}

function resolveBlueOriginEnhancementText(
  enhancement: string | null | undefined,
  fallback: string | null | undefined
) {
  const preferred = normalizeBlueOriginFactText(enhancement);
  if (preferred) return preferred;
  return normalizeBlueOriginFactText(fallback);
}

function pickRicherText(current: string | null, candidate: string) {
  const normalizedCurrent = normalizeBlueOriginFactText(current);
  if (!normalizedCurrent) return candidate;
  if (candidate.length > normalizedCurrent.length) return candidate;
  return normalizedCurrent;
}

function normalizeBlueOriginFactText(value: unknown) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeBlueOriginLaunchId(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

const LL2_LAUNCH_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeLl2LaunchUuid(value: unknown) {
  const normalized = normalizeBlueOriginLaunchId(value);
  if (!normalized) return null;
  if (!LL2_LAUNCH_UUID_PATTERN.test(normalized)) return null;
  return normalized;
}

function buildBlueOriginHubDiagnosticsPayload({
  program,
  dedupedUpcoming,
  dedupedRecent,
  manifestData,
  timings,
  passengers,
  payloads,
  contracts,
  timelineEvents,
  socialPosts,
  mediaImages,
  youtubeVideos,
  vehicles,
  engines
}: {
  program: Awaited<ReturnType<typeof fetchBlueOriginProgramSnapshot>>;
  dedupedUpcoming: Launch[];
  dedupedRecent: Launch[];
  manifestData: Array<{
    launch: Launch;
    seats: Array<{ traveler?: { name?: string } | null; payload?: { name?: string } | null }>;
    hasExplicitSeatAssignments: boolean;
  }>;
  timings: BlueOriginDiagnosticsTiming[];
  passengers: BlueOriginPassenger[];
  payloads: Awaited<ReturnType<typeof fetchBlueOriginPayloads>>['items'];
  contracts: Awaited<ReturnType<typeof fetchBlueOriginContracts>>;
  timelineEvents: Awaited<ReturnType<typeof fetchBlueOriginTimelineViewModel>>['events'];
  socialPosts: Awaited<ReturnType<typeof fetchBlueOriginSocialPosts>>;
  mediaImages: Awaited<ReturnType<typeof fetchBlueOriginMediaImages>>;
  youtubeVideos: Awaited<ReturnType<typeof fetchBlueOriginYouTubeVideos>>;
  vehicles: Awaited<ReturnType<typeof fetchBlueOriginVehicles>>['items'];
  engines: Awaited<ReturnType<typeof fetchBlueOriginEngines>>['items'];
}) {
  const manifestRows = manifestData;
  const manifestRowsWithTravelers = manifestRows.filter((item) =>
    item.seats.some((seat) => Boolean(seat.traveler))
  );
  const manifestRowsWithPayloads = manifestRows.filter((item) =>
    item.seats.some((seat) => Boolean(seat.payload))
  );
  const coverageDenominator = Math.max(1, manifestRows.length);

  const timelineHighConfidenceCount = timelineEvents.filter((event) => event.confidence === 'high')
    .length;
  const tentativeUpcomingCount = dedupedUpcoming.filter((launch) =>
    isTentativeLaunch(launch)
  ).length;

  const programLaunches = [...program.upcoming, ...program.recent];
  const allVisibleManifests = dedupeLaunchesByDiagnosticKey(programLaunches);
  const manifestKeysWithData = new Set(
    manifestRows.map((item) => buildBlueOriginLaunchDiagnosticKey(item.launch))
  );

  const missingManifestLaunches = allVisibleManifests
    .filter((launch) => {
      const key = buildBlueOriginLaunchDiagnosticKey(launch);
      return !manifestKeysWithData.has(key);
    })
    .map((launch) => ({
      key: buildBlueOriginLaunchDiagnosticKey(launch),
      id: launch.id,
      name: launch.name,
      net: launch.net || null,
      mission: extractBlueOriginFlightCode(launch),
      href: buildLaunchHref(launch)
    }));

  const missingSeatManifestLaunches = dedupeProgramLaunches(
    manifestData.filter((item) => item.seats.length === 0).map((item) => item.launch)
  )
    .map((launch) => ({
      key: buildBlueOriginLaunchDiagnosticKey(launch),
      id: launch.id,
      name: launch.name,
      net: launch.net || null,
      mission: extractBlueOriginFlightCode(launch),
      href: buildLaunchHref(launch)
    }))
    .filter((entry) => !missingManifestLaunches.some((launch) => launch.key === entry.key));

  const combinedDuplicateGroups = buildBlueOriginDuplicateLaunchGroups(programLaunches);

  const warnings = [] as string[];
  if (missingSeatManifestLaunches.length) {
    warnings.push(`Manifests missing traveler/payload seats: ${missingSeatManifestLaunches.length}`);
  }
  if (missingManifestLaunches.length) {
    warnings.push(
      `Launches with no manifest rows linked to carousel: ${missingManifestLaunches.length}`
    );
  }
  if (combinedDuplicateGroups.length) {
    warnings.push(`Duplicate launch keys detected: ${combinedDuplicateGroups.length}`);
  }
  if (!manifestData.length) {
    warnings.push('No Blue Origin manifest rows were rendered.');
  }
  if (!contracts.items.length) {
    warnings.push('No contract rows were available for this render window.');
  }

  return {
    route: '/blue-origin',
    generatedAt: new Date().toISOString(),
    build: {
      revalidateSeconds: 60 * 10,
      programGeneratedAt: program.generatedAt,
      programLastUpdated: program.lastUpdated || null
    },
    counts: {
      upcomingInput: program.upcoming.length,
      recentInput: program.recent.length,
      upcomingDeduped: dedupedUpcoming.length,
      recentDeduped: dedupedRecent.length,
      launchesRendered: allVisibleManifests.length,
      passengers: passengers.length,
      payloads: payloads.length,
      contracts: contracts.items.length,
      timelineEvents: timelineEvents.length,
      socialPostsRaw: socialPosts.length,
      socialPostsEmbedded: socialPosts.filter((post) => post.externalId).length,
      socialPostsRendered: socialPosts.filter((post) => post.externalId).length,
      mediaImages: mediaImages.length,
      youtubeVideos: youtubeVideos.length,
      vehicles: vehicles.length,
      engines: engines.length
    },
    coverage: {
      travelerCoverageShare:
        manifestRowsWithTravelers.length / coverageDenominator,
      payloadCoverageShare:
        manifestRowsWithPayloads.length / coverageDenominator,
      highConfidenceTimelineShare:
        timelineEvents.length > 0 ? timelineHighConfidenceCount / timelineEvents.length : 0,
      tentativeUpcomingShare:
        dedupedUpcoming.length > 0 ? tentativeUpcomingCount / dedupedUpcoming.length : 0
    },
    duplicates: {
      upcoming: buildBlueOriginDuplicateLaunchGroups(program.upcoming),
      recent: buildBlueOriginDuplicateLaunchGroups(program.recent),
      combined: combinedDuplicateGroups,
      crossBucket: buildCrossBucketDuplicateLaunchGroups(program.upcoming, program.recent)
    },
    timings,
    launchesMissingManifest: [...missingManifestLaunches, ...missingSeatManifestLaunches],
    warnings
  } as BlueOriginHubDiagnosticsPayload;
}

function isTentativeLaunch(launch: Launch) {
  const normalized = (launch.statusText || launch.status || '').toLowerCase();
  return normalized.includes('tentative') || normalized.includes('tbd');
}

function dedupeLaunchesByDiagnosticKey(launches: Launch[]) {
  const byKey = new Map<string, Launch>();
  for (const launch of launches) {
    const key = buildBlueOriginLaunchDiagnosticKey(launch);
    if (!byKey.has(key)) byKey.set(key, launch);
  }
  return [...byKey.values()];
}

function buildBlueOriginDuplicateLaunchGroups(launches: Launch[]) {
  const byKey = new Map<string, Launch[]>();
  for (const launch of launches) {
    const key = buildBlueOriginLaunchDiagnosticKey(launch);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(launch);
    } else {
      byKey.set(key, [launch]);
    }
  }

  const rows: BlueOriginHubDiagnosticsPayload['duplicates']['upcoming'] = [];
  for (const [key, bucket] of byKey.entries()) {
    if (bucket.length <= 1) continue;
    rows.push({
      key,
      count: bucket.length,
      sample: bucket.slice(0, 3).map((launch) => ({
        id: launch.id,
        name: launch.name,
        net: launch.net || null,
        ll2Id: launch.ll2Id || null,
        status: launch.statusText || launch.status || null,
        mission: extractBlueOriginFlightCode(launch) || getBlueOriginMissionKeyFromLaunch(launch) || null
      }))
    });
  }
  return rows;
}

function buildCrossBucketDuplicateLaunchGroups(upcoming: Launch[], recent: Launch[]) {
  const upcomingByKey = new Map<string, Launch[]>();
  const recentByKey = new Map<string, Launch[]>();
  for (const launch of upcoming) {
    const key = buildBlueOriginLaunchDiagnosticKey(launch);
    const bucket = upcomingByKey.get(key) || [];
    bucket.push(launch);
    upcomingByKey.set(key, bucket);
  }
  for (const launch of recent) {
    const key = buildBlueOriginLaunchDiagnosticKey(launch);
    const bucket = recentByKey.get(key) || [];
    bucket.push(launch);
    recentByKey.set(key, bucket);
  }

  const rows: BlueOriginHubDiagnosticsPayload['duplicates']['crossBucket'] = [];
  for (const [key, upcomingSamples] of upcomingByKey.entries()) {
    const recentSamples = recentByKey.get(key);
    if (!recentSamples) continue;
    rows.push({
      key,
      upcomingCount: upcomingSamples.length,
      recentCount: recentSamples.length,
      upcomingSample: upcomingSamples
        .slice(0, 3)
        .map((launch) => ({
          id: launch.id,
          name: launch.name,
          net: launch.net || null,
          ll2Id: launch.ll2Id || null,
          status: launch.statusText || launch.status || null,
          mission: extractBlueOriginFlightCode(launch) || getBlueOriginMissionKeyFromLaunch(launch) || null
        })),
      recentSample: recentSamples
        .slice(0, 3)
        .map((launch) => ({
          id: launch.id,
          name: launch.name,
          net: launch.net || null,
          ll2Id: launch.ll2Id || null,
          status: launch.statusText || launch.status || null,
          mission: extractBlueOriginFlightCode(launch) || getBlueOriginMissionKeyFromLaunch(launch) || null
        }))
    });
  }

  return rows;
}

function buildBlueOriginLaunchDiagnosticKey(launch: Launch) {
  return extractBlueOriginFlightCode(launch) || launch.id || launch.name;
}
