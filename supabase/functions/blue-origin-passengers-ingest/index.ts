import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyBlueOriginMission,
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  readNumberSetting,
  startIngestionRun,
  stringifyError,
  updateCheckpoint
} from '../_shared/blueOriginIngest.ts';

const LL2_API_BASE = 'https://ll.thespacedevs.com/2.2.0';
const LL2_FETCH_TIMEOUT_MS = 9000;
const LL2_FETCH_MAX_PAGES = 6;
const LL2_FETCH_RETRIES = 2;
const LL2_RETRY_BACKOFF_MS = 900;
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_MISSION_CONSTRAINT_PASSENGER_SOURCE = 'blueorigin_multisource.bo_manifest_passengers';
const BLUE_ORIGIN_MISSION_FETCH_TIMEOUT_MS = 12000;
const BLUE_ORIGIN_MISSION_FETCH_RETRIES = 2;
const BLUE_ORIGIN_MISSION_FETCH_BACKOFF_MS = 700;
const BLUE_ORIGIN_REVALIDATE_TIMEOUT_MS = 8000;
const BLUE_ORIGIN_REVALIDATE_MAX_TRAVELER_SLUGS = 200;
const BLUE_ORIGIN_REVALIDATE_MAX_LAUNCH_IDS = 200;
const BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_PHRASE_PATTERN =
  /\b(?:crew included|landing gear|aft fins?|drag brakes?|ring wedge fins?|the capsule|crew capsule|protecting our planet|parachutes?)\b/i;
const BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_TOKEN_PATTERN =
  /\b(?:capsule|booster|payload|experiment|fins?|brakes?|gear|parachute|touchdown|deploys?|planet|ring|wedge|rocket|vehicle|mission|launch|shepard|glenn|blue|origin|protecting)\b/i;
const BLUE_ORIGIN_MANIFEST_PASSENGER_ALLOWED_PARTICLES = new Set<string>([
  'de',
  'da',
  'del',
  'della',
  'di',
  'van',
  'von',
  'bin',
  'al',
  'la',
  'le',
  'du',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'v',
  'vi'
]);
const BLUE_ORIGIN_MANIFEST_PASSENGER_STOPWORDS = new Set<string>([
  'advisor',
  'academy',
  'background',
  'career',
  'ceo',
  'chief',
  'club',
  'commercial',
  'competitive',
  'comprised',
  'crew',
  'customers',
  'director',
  'engineer',
  'estate',
  'events',
  'facebook',
  'future',
  'high',
  'industry',
  'included',
  'investor',
  'launched',
  'lead',
  'linkedin',
  'lockheed',
  'martin',
  'meaning',
  'meet',
  'meteorology',
  'mit',
  'nasa',
  'national',
  'neocity',
  'nola',
  'orleans',
  'planetarium',
  'president',
  'real',
  'reliable',
  'research',
  'said',
  'security',
  'senior',
  'share',
  'single',
  'stage',
  'stem',
  'students',
  'systems',
  'through',
  'university',
  'ventures',
  'vice'
]);

type LaunchPassengerRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  mission_name: string | null;
  mission_description: string | null;
  net: string | null;
  provider: string | null;
  crew: Array<{ astronaut?: string | null; role?: string | null; nationality?: string | null }> | null;
};

type Ll2AstronautLaunchRow = {
  ll2_astronaut_id: number;
  ll2_launch_uuid: string;
  role: string | null;
};

type Ll2AstronautRow = {
  ll2_astronaut_id: number;
  name: string;
  nationality: string | null;
  agency_name: string | null;
  bio: string | null;
  type: string | null;
  status: string | null;
  profile_image: string | null;
  profile_image_thumbnail: string | null;
  wiki: string | null;
  twitter: string | null;
  instagram: string | null;
  raw: Record<string, unknown> | null;
};

type PassengerUpsert = {
  mission_key: string;
  flight_code: string | null;
  flight_slug: string | null;
  traveler_slug: string;
  name: string;
  role: string | null;
  nationality: string | null;
  launch_id: string | null;
  launch_name: string | null;
  launch_date: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updated_at: string;
};

type ExistingPassengerRow = {
  launch_id: string | null;
  flight_code: string | null;
  traveler_slug?: string | null;
  name: string;
  role: string | null;
  nationality: string | null;
  launch_name: string | null;
  launch_date: string | null;
  source: string | null;
  confidence: string | null;
  metadata: Record<string, unknown> | null;
};

type TravelerProfileUpsert = {
  traveler_slug: string;
  canonical_name: string;
  bio_short: string | null;
  primary_image_url: string | null;
  primary_profile_url: string | null;
  nationality: string | null;
  source_confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updated_at: string;
};

type TravelerSourceUpsert = {
  source_key: string;
  traveler_slug: string;
  launch_id: string | null;
  flight_code: string | null;
  source_type: string;
  source_url: string | null;
  source_document_id: string | null;
  profile_url: string | null;
  image_url: string | null;
  bio_full: string | null;
  bio_excerpt: string | null;
  attribution: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  content_sha256: string | null;
  captured_at: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type Ll2ApiResponse<T> = {
  next?: string | null;
  results?: T[];
};

type Ll2ApiLaunchRow = {
  id: string;
  name: string | null;
  net: string | null;
  launch_service_provider?: {
    name?: string | null;
  } | null;
  rocket?: {
    spacecraft_stage?: {
      launch_crew?: Array<{
        role?: {
          role?: string | null;
        } | null;
        astronaut?: {
          id?: number | null;
          url?: string | null;
          name?: string | null;
          nationality?: string | null;
          bio?: string | null;
          profile_image?: string | null;
          profile_image_thumbnail?: string | null;
          wiki?: string | null;
          twitter?: string | null;
          instagram?: string | null;
        } | null;
      }>;
    } | null;
  } | null;
};

type MissionConstraintRow = {
  launch_id: string;
  constraint_type: string | null;
  data: Record<string, unknown> | null;
  fetched_at: string | null;
};

type MissionPassengerContext = {
  bio: string | null;
  imageUrl: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_passengers_ingest');

  const stats: Record<string, unknown> = {
    launchesScanned: 0,
    ll2ApiLaunchesScanned: 0,
    ll2AstronautLinksScanned: 0,
    ll2AstronautProfilesScanned: 0,
    ll2AstronautProfileMatches: 0,
    passengersFromLl2ApiDetailed: 0,
    passengersFromLl2: 0,
    passengersFromLl2Profiles: 0,
    passengersFromCacheCrew: 0,
    passengersFromMissionConstraints: 0,
    missionConstraintRowsPruned: 0,
    missionPagesEnriched: 0,
    missionPassengerMediaHits: 0,
    passengersUpserted: 0,
    passengerRowsMergedWithExisting: 0,
    travelerProfilesUpserted: 0,
    travelerSourcesUpserted: 0,
    travelerCanonicalWritesSkipped: false,
    travelerCanonicalSkipReason: null as string | null,
    revalidateRequested: false,
    revalidateSucceeded: false,
    revalidateHttpStatus: null as number | null,
    revalidateError: null as string | null,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_passengers_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'blue_origin_passengers', {
      sourceType: 'll2-cache',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null
    });

    const ll2WindowHours = clampNumber(await readNumberSetting(supabase, 'blue_origin_passengers_ll2_window_hours', 96), 24, 240);

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,ll2_launch_uuid,name,mission_name,mission_description,net,provider,crew')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%')
      .order('net', { ascending: false })
      .limit(800);

    if (launchError) throw launchError;
    const rows = (launchRows || []) as LaunchPassengerRow[];
    stats.launchesScanned = rows.length;

    const launchesByUuid = new Map<string, LaunchPassengerRow>();
    const ll2LaunchUuids = [] as string[];
    const launchInferenceRows = [] as Array<{
      launchId: string;
      netMs: number;
      launch: LaunchPassengerRow;
      missionKey: string;
      flightCode: string | null;
    }>;
    for (const launch of rows) {
      const uuid = (launch.ll2_launch_uuid || '').trim();
      if (!uuid) continue;
      launchesByUuid.set(uuid, launch);
      ll2LaunchUuids.push(uuid);

      const netMs = Date.parse(String(launch.net || ''));
      if (!Number.isFinite(netMs)) continue;
      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);
      launchInferenceRows.push({
        launchId: launch.launch_id,
        netMs,
        launch,
        missionKey,
        flightCode
      });
    }

    const ll2AstronautLinks = [] as Ll2AstronautLaunchRow[];
    for (const chunk of chunkArray([...new Set(ll2LaunchUuids)], 200)) {
      const { data, error } = await supabase
        .from('ll2_astronaut_launches')
        .select('ll2_astronaut_id,ll2_launch_uuid,role')
        .in('ll2_launch_uuid', chunk)
        .limit(5_000);
      if (error) throw error;
      ll2AstronautLinks.push(...((data || []) as Ll2AstronautLaunchRow[]));
    }
    stats.ll2AstronautLinksScanned = ll2AstronautLinks.length;

    const ll2AstronautIds = [...new Set(ll2AstronautLinks.map((row) => row.ll2_astronaut_id))];
    const ll2Astronauts = [] as Ll2AstronautRow[];
    for (const chunk of chunkArray(ll2AstronautIds, 200)) {
      const { data, error } = await supabase
        .from('ll2_astronauts')
        .select('ll2_astronaut_id,name,nationality,agency_name,bio,type,status,profile_image,profile_image_thumbnail,wiki,twitter,instagram,raw')
        .in('ll2_astronaut_id', chunk)
        .limit(2_000);
      if (error) throw error;
      ll2Astronauts.push(...((data || []) as Ll2AstronautRow[]));
    }

    const { data: blueOriginAstronautRows, error: blueOriginAstronautError } = await supabase
      .from('ll2_astronauts')
      .select('ll2_astronaut_id,name,nationality,agency_name,bio,type,status,profile_image,profile_image_thumbnail,wiki,twitter,instagram,raw')
      .ilike('agency_name', '%Blue Origin%')
      .limit(1_500);
    if (blueOriginAstronautError) throw blueOriginAstronautError;
    ll2Astronauts.push(...((blueOriginAstronautRows || []) as Ll2AstronautRow[]));

    const dedupedAstronautsById = new Map<number, Ll2AstronautRow>();
    for (const row of ll2Astronauts) dedupedAstronautsById.set(row.ll2_astronaut_id, row);
    const ll2AstronautsDeduped = [...dedupedAstronautsById.values()];

    stats.ll2AstronautProfilesScanned = ll2AstronautsDeduped.length;

    const astronautById = new Map(ll2AstronautsDeduped.map((row) => [row.ll2_astronaut_id, row]));
    const candidateMap = new Map<string, PassengerUpsert>();
    let ll2ApiLaunches = [] as Ll2ApiLaunchRow[];
    try {
      ll2ApiLaunches = await fetchLl2ApiNewShepardLaunches();
    } catch (ll2ApiError) {
      stats.errors.push({
        step: 'll2_api.launch_detailed',
        error: stringifyError(ll2ApiError)
      });
      ll2ApiLaunches = [];
    }
    stats.ll2ApiLaunchesScanned = ll2ApiLaunches.length;

    for (const launch of ll2ApiLaunches) {
      const provider = String(launch.launch_service_provider?.name || '').toLowerCase();
      const launchName = String(launch.name || '').trim();
      const launchNet = typeof launch.net === 'string' ? launch.net : null;
      const flightCode = extractFlightCode(launchName);
      if (!flightCode) continue;
      if (!provider.includes('blue origin') && !launchName.toLowerCase().includes('new shepard')) continue;

      const matchedLocalLaunch =
        launchesByUuid.get(String(launch.id || '').trim()) ||
        findLaunchByFlightCode(launchInferenceRows, flightCode, launchNet);
      const missionKey =
        matchedLocalLaunch
          ? classifyBlueOriginMission(`${matchedLocalLaunch.name || ''} ${matchedLocalLaunch.mission_name || ''}`)
          : classifyBlueOriginMission(launchName);

      const launchCrew = launch.rocket?.spacecraft_stage?.launch_crew || [];
      for (const crewEntry of launchCrew) {
        const astronaut = crewEntry?.astronaut;
        const person = String(astronaut?.name || '').trim();
        if (!person) continue;

        const candidate: PassengerUpsert = {
          mission_key: missionKey,
          flight_code: flightCode,
          flight_slug: flightCode,
          traveler_slug: buildTravelerSlug(person),
          name: person,
          role: normalizeLl2CrewRole(crewEntry?.role?.role || null),
          nationality: normalizeOptionalText(astronaut?.nationality || null),
          launch_id: matchedLocalLaunch?.launch_id || null,
          launch_name: matchedLocalLaunch?.name || launchName || null,
          launch_date: matchedLocalLaunch?.net || launchNet,
          source: 'll2_api.launch_detailed',
          confidence: 'high',
          metadata: {
            ll2LaunchUuid: launch.id || null,
            ll2AstronautId: astronaut?.id || null,
            missionName: matchedLocalLaunch?.mission_name || null,
            provider: matchedLocalLaunch?.provider || launch.launch_service_provider?.name || null,
            profileUrl: normalizeUrl(astronaut?.wiki || astronaut?.url || null),
            imageUrl: extractGenericAstronautImageUrl(astronaut),
            bio: normalizeOptionalText(astronaut?.bio || null),
            twitter: normalizeUrl(astronaut?.twitter || null),
            instagram: normalizeUrl(astronaut?.instagram || null),
            ll2AstronautUrl: normalizeUrl(astronaut?.url || null)
          },
          updated_at: new Date().toISOString()
        };

        const key = buildPassengerKey(candidate.launch_id, candidate.name, candidate.flight_code);
        mergePassengerCandidate(candidateMap, key, candidate);
        stats.passengersFromLl2ApiDetailed = Number(stats.passengersFromLl2ApiDetailed || 0) + 1;
      }
    }

    for (const link of ll2AstronautLinks) {
      const launch = launchesByUuid.get(link.ll2_launch_uuid);
      const astronaut = astronautById.get(link.ll2_astronaut_id);
      if (!launch || !astronaut?.name) continue;

      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);
      const person = astronaut.name.trim();
      if (!person) continue;

      const candidate: PassengerUpsert = {
        mission_key: missionKey,
        flight_code: flightCode,
        flight_slug: flightCode || null,
        traveler_slug: buildTravelerSlug(person),
        name: person,
        role: normalizeLl2CrewRole(link.role || null),
        nationality: parseAstronautNationality(astronaut.nationality, astronaut.raw),
        launch_id: launch.launch_id,
        launch_name: launch.name,
        launch_date: launch.net,
        source: 'll2_astronaut_launches',
        confidence: 'high',
        metadata: {
          ll2LaunchUuid: link.ll2_launch_uuid,
          ll2AstronautId: link.ll2_astronaut_id,
          ll2AstronautStatus: astronaut.status || null,
          missionName: launch.mission_name || null,
          provider: launch.provider || null,
          profileUrl: extractAstronautProfileUrl(astronaut),
          imageUrl: extractAstronautImageUrl(astronaut),
          bio: astronaut.bio || null,
          twitter: astronaut.twitter || null,
          instagram: astronaut.instagram || null
        },
        updated_at: new Date().toISOString()
      };

      const key = buildPassengerKey(candidate.launch_id, person, candidate.flight_code);
      mergePassengerCandidate(candidateMap, key, candidate);
      stats.passengersFromLl2 = Number(stats.passengersFromLl2 || 0) + 1;
    }

    for (const launch of rows) {
      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);

      for (const crew of launch.crew || []) {
        const person = (crew?.astronaut || '').trim();
        if (!person) continue;

        const candidate: PassengerUpsert = {
          mission_key: missionKey,
          flight_code: flightCode,
          flight_slug: flightCode || null,
          traveler_slug: buildTravelerSlug(person),
          name: person,
          role: normalizeLl2CrewRole(crew?.role || null),
          nationality: (crew?.nationality || '').trim() || null,
          launch_id: launch.launch_id,
          launch_name: launch.name,
          launch_date: launch.net,
          source: 'launches_public_cache.crew',
          confidence: 'medium',
          metadata: {
            missionName: launch.mission_name || null,
            provider: launch.provider || null
          },
          updated_at: new Date().toISOString()
        };

        const key = buildPassengerKey(candidate.launch_id, person, candidate.flight_code);
        mergePassengerCandidate(candidateMap, key, candidate);
        stats.passengersFromCacheCrew = Number(stats.passengersFromCacheCrew || 0) + 1;
      }
    }

    try {
      const constraintCandidates = await buildMissionConstraintPassengerCandidates({
        supabase,
        launches: rows
      });
      const prunedCount = await pruneMissionConstraintPassengerRows(
        supabase,
        constraintCandidates.meta.constraintLaunchIds
      );
      const trustedNamesByLaunch = buildTrustedPassengerNamesByLaunch(candidateMap);
      const acceptedConstraintRows = constraintCandidates.rows.filter((row) =>
        shouldAcceptMissionConstraintPassenger(row, trustedNamesByLaunch)
      );
      stats.passengersFromMissionConstraints = acceptedConstraintRows.length;
      stats.missionConstraintRowsPruned = prunedCount;
      stats.missionPagesEnriched = constraintCandidates.meta.pagesEnriched;
      stats.missionPassengerMediaHits = constraintCandidates.meta.passengerMediaHits;
      for (const candidate of acceptedConstraintRows) {
        const key = buildPassengerKey(candidate.launch_id, candidate.name, candidate.flight_code);
        mergePassengerCandidate(candidateMap, key, candidate);
      }
    } catch (constraintError) {
      stats.errors.push({
        step: 'blueorigin_multisource.bo_manifest_passengers',
        error: stringifyError(constraintError)
      });
      stats.passengersFromMissionConstraints = 0;
      stats.missionConstraintRowsPruned = 0;
      stats.missionPagesEnriched = 0;
      stats.missionPassengerMediaHits = 0;
    }

    const blueOriginAstronautProfiles = ll2AstronautsDeduped.filter((row) => {
      const agency = String(row.agency_name || '').toLowerCase();
      if (agency.includes('blue origin')) return true;
      const bio = String(row.bio || '').toLowerCase();
      if (bio.includes('blue origin') || bio.includes('new shepard')) return true;
      return false;
    });

    for (const astronaut of blueOriginAstronautProfiles) {
      const person = (astronaut.name || '').trim();
      if (!person) continue;
      const candidateDates = extractAstronautFlightDates(astronaut);
      if (candidateDates.length === 0) continue;

      let matchedLaunch: (typeof launchInferenceRows)[number] | null = null;
      let matchedDateIso: string | null = null;
      let matchedDeltaHours: number | null = null;

      for (const dateIso of candidateDates) {
        const dateMs = Date.parse(dateIso);
        if (!Number.isFinite(dateMs)) continue;
        const inferred = inferClosestLaunch(launchInferenceRows, dateMs, ll2WindowHours);
        if (!inferred) continue;

        const deltaHours = Math.abs(inferred.netMs - dateMs) / (60 * 60 * 1000);
        if (!matchedLaunch || (matchedDeltaHours !== null && deltaHours < matchedDeltaHours)) {
          matchedLaunch = inferred;
          matchedDateIso = dateIso;
          matchedDeltaHours = deltaHours;
        }
      }

      if (!matchedLaunch) continue;
      stats.ll2AstronautProfileMatches = Number(stats.ll2AstronautProfileMatches || 0) + 1;

      const role = inferRoleFromAstronautType(astronaut.type);
      const candidate: PassengerUpsert = {
        mission_key: matchedLaunch.missionKey,
        flight_code: matchedLaunch.flightCode,
        flight_slug: matchedLaunch.flightCode || null,
        traveler_slug: buildTravelerSlug(person),
        name: person,
        role,
        nationality: parseAstronautNationality(astronaut.nationality, astronaut.raw),
        launch_id: matchedLaunch.launchId,
        launch_name: matchedLaunch.launch.name,
        launch_date: matchedLaunch.launch.net,
        source: 'll2_astronauts.profile_inference',
        confidence: 'medium',
        metadata: {
          ll2AstronautId: astronaut.ll2_astronaut_id,
          ll2AstronautStatus: astronaut.status || null,
          ll2AstronautType: astronaut.type || null,
          ll2AgencyName: astronaut.agency_name || null,
          inferredFromFlightIso: matchedDateIso,
          inferredDeltaHours: matchedDeltaHours,
          inferenceWindowHours: ll2WindowHours,
          profileUrl: extractAstronautProfileUrl(astronaut),
          imageUrl: extractAstronautImageUrl(astronaut),
          bio: astronaut.bio || null,
          twitter: astronaut.twitter || null,
          instagram: astronaut.instagram || null
        },
        updated_at: new Date().toISOString()
      };

      const key = buildPassengerKey(candidate.launch_id, person, candidate.flight_code);
      mergePassengerCandidate(candidateMap, key, candidate);
      stats.passengersFromLl2Profiles = Number(stats.passengersFromLl2Profiles || 0) + 1;
    }

    const candidateRows = [...candidateMap.values()];
    const mergedWithExisting = await mergePassengerCandidatesWithExistingRows(supabase, candidateRows);
    const upserts = mergedWithExisting.rows;
    stats.passengerRowsMergedWithExisting = mergedWithExisting.mergedCount;

    if (upserts.length > 0) {
      await upsertPassengerRows(supabase, upserts);
    }
    stats.passengersUpserted = upserts.length;

    if (upserts.length > 0) {
      const travelerProfiles = buildTravelerProfileUpserts(upserts);
      const travelerSources = await buildTravelerSourceUpserts(upserts);

      try {
        if (travelerProfiles.length > 0) {
          const { error: travelerUpsertError } = await supabase
            .from('blue_origin_travelers')
            .upsert(travelerProfiles, { onConflict: 'traveler_slug' });
          if (travelerUpsertError) throw travelerUpsertError;
        }

        if (travelerSources.length > 0) {
          const { error: sourceUpsertError } = await supabase
            .from('blue_origin_traveler_sources')
            .upsert(travelerSources, { onConflict: 'source_key' });
          if (sourceUpsertError) throw sourceUpsertError;
        }

        stats.travelerProfilesUpserted = travelerProfiles.length;
        stats.travelerSourcesUpserted = travelerSources.length;
      } catch (travelerWriteError) {
        if (isMissingTravelerCanonicalSchema(travelerWriteError)) {
          stats.travelerCanonicalWritesSkipped = true;
          stats.travelerCanonicalSkipReason = stringifyError(travelerWriteError);
        } else {
          throw travelerWriteError;
        }
      }

      const travelerSlugs = collectDistinctNormalizedText(
        upserts.map((row) => normalizeOptionalText(row.traveler_slug))
      ).slice(0, BLUE_ORIGIN_REVALIDATE_MAX_TRAVELER_SLUGS);
      const launchIds = collectDistinctNormalizedText(
        upserts.map((row) => normalizeLaunchId(row.launch_id))
      ).slice(0, BLUE_ORIGIN_REVALIDATE_MAX_LAUNCH_IDS);

      if (travelerSlugs.length > 0 || launchIds.length > 0) {
        stats.revalidateRequested = true;
        const revalidateResult = await requestBlueOriginRevalidate({
          travelerSlugs,
          launchIds
        });
        stats.revalidateSucceeded = revalidateResult.ok;
        stats.revalidateHttpStatus = revalidateResult.status;
        stats.revalidateError = revalidateResult.error;
      }
    }

    await updateCheckpoint(supabase, 'blue_origin_passengers', {
      sourceType: 'll2-cache',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.passengersUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        launchesScanned: stats.launchesScanned,
        ll2ApiLaunchesScanned: stats.ll2ApiLaunchesScanned,
        ll2AstronautLinksScanned: stats.ll2AstronautLinksScanned,
        ll2AstronautProfilesScanned: stats.ll2AstronautProfilesScanned,
        ll2AstronautProfileMatches: stats.ll2AstronautProfileMatches,
        passengersFromLl2ApiDetailed: stats.passengersFromLl2ApiDetailed,
        passengersFromLl2: stats.passengersFromLl2,
        passengersFromLl2Profiles: stats.passengersFromLl2Profiles,
        passengersFromCacheCrew: stats.passengersFromCacheCrew,
        passengersFromMissionConstraints: stats.passengersFromMissionConstraints,
        missionConstraintRowsPruned: stats.missionConstraintRowsPruned,
        missionPagesEnriched: stats.missionPagesEnriched,
        missionPassengerMediaHits: stats.missionPassengerMediaHits,
        passengerRowsMergedWithExisting: stats.passengerRowsMergedWithExisting,
        travelerProfilesUpserted: stats.travelerProfilesUpserted,
        travelerSourcesUpserted: stats.travelerSourcesUpserted,
        travelerCanonicalWritesSkipped: stats.travelerCanonicalWritesSkipped,
        travelerCanonicalSkipReason: stats.travelerCanonicalSkipReason,
        revalidateRequested: stats.revalidateRequested,
        revalidateSucceeded: stats.revalidateSucceeded,
        revalidateHttpStatus: stats.revalidateHttpStatus,
        revalidateError: stats.revalidateError
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_passengers', {
      sourceType: 'll2-cache',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function extractFlightCode(text: string) {
  const normalized = text.toLowerCase();
  const ns = normalized.match(/\bns\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ns?.[1]) return `ns-${Number(ns[1])}`;
  const ng = normalized.match(/\bng\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ng?.[1]) return `ng-${Number(ng[1])}`;
  return null;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const out = [] as T[][];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildPassengerKey(launchId: unknown, name: string, flightCode?: unknown) {
  const launchKey = String(launchId || flightCode || 'na').trim().toLowerCase();
  return `${launchKey}:${name.toLowerCase().trim()}`;
}

function mergePassengerCandidate(
  map: Map<string, PassengerUpsert>,
  key: string,
  next: PassengerUpsert
) {
  const current = map.get(key);
  if (!current) {
    map.set(key, next);
    return;
  }

  const currentRank = confidenceRank(String(current.confidence || 'medium'));
  const nextRank = confidenceRank(String(next.confidence || 'medium'));
  if (nextRank > currentRank) {
    map.set(key, mergePassengerRow(next, current));
    return;
  }
  if (nextRank < currentRank) {
    map.set(key, mergePassengerRow(current, next));
    return;
  }

  const currentRichness = passengerRowRichness(current);
  const nextRichness = passengerRowRichness(next);
  if (nextRichness >= currentRichness) {
    map.set(key, mergePassengerRow(next, current));
    return;
  }

  map.set(key, mergePassengerRow(current, next));
}

async function pruneMissionConstraintPassengerRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const normalizedLaunchIds = [...new Set(launchIds.map((value) => normalizeOptionalText(value)).filter((value): value is string => Boolean(value)))];
  if (!normalizedLaunchIds.length) return 0;

  let pruned = 0;
  for (const chunk of chunkArray(normalizedLaunchIds, 200)) {
    const { error, count } = await supabase
      .from('blue_origin_passengers')
      .delete({ count: 'exact' })
      .eq('source', BLUE_ORIGIN_MISSION_CONSTRAINT_PASSENGER_SOURCE)
      .in('launch_id', chunk);
    if (error) throw error;
    pruned += Number(count || 0);
  }
  return pruned;
}

function buildTrustedPassengerNamesByLaunch(rows: Map<string, PassengerUpsert>) {
  const byLaunch = new Map<string, Set<string>>();

  for (const row of rows.values()) {
    if (!isTrustedPassengerSource(row.source)) continue;
    const launchKey = buildPassengerLaunchLookupKey(row.launch_id, row.flight_code);
    if (!launchKey) continue;
    const nameKey = normalizeNameKey(row.name);
    if (!nameKey) continue;

    const bucket = byLaunch.get(launchKey) || new Set<string>();
    bucket.add(nameKey);
    byLaunch.set(launchKey, bucket);
  }

  return byLaunch;
}

function shouldAcceptMissionConstraintPassenger(
  row: PassengerUpsert,
  trustedNamesByLaunch: Map<string, Set<string>>
) {
  const launchKey = buildPassengerLaunchLookupKey(row.launch_id, row.flight_code);
  if (!launchKey) return false;
  const trustedNames = trustedNamesByLaunch.get(launchKey);
  if (!trustedNames || trustedNames.size === 0) return false;

  const nameKey = normalizeNameKey(row.name);
  if (!nameKey) return false;
  return trustedNames.has(nameKey);
}

function buildPassengerLaunchLookupKey(launchId: string | null | undefined, flightCode: string | null | undefined) {
  const launchKey = normalizeOptionalText(launchId)?.toLowerCase();
  if (launchKey) return launchKey;
  const flightKey = normalizeOptionalText(flightCode)?.toLowerCase();
  if (flightKey) return flightKey;
  return null;
}

function isTrustedPassengerSource(source: string | null | undefined) {
  const normalized = normalizeOptionalText(source)?.toLowerCase() || '';
  if (!normalized) return false;
  if (normalized === BLUE_ORIGIN_MISSION_CONSTRAINT_PASSENGER_SOURCE) return false;
  if (normalized.startsWith('launches_public_cache.')) return false;
  return true;
}

async function mergePassengerCandidatesWithExistingRows(supabase: ReturnType<typeof createSupabaseAdminClient>, rows: PassengerUpsert[]) {
  if (!rows.length) {
    return {
      rows: [] as PassengerUpsert[],
      mergedCount: 0
    };
  }

  const launchIds = [...new Set(rows.map((row) => normalizeOptionalText(row.launch_id)).filter((value): value is string => Boolean(value)))];
  if (!launchIds.length) {
    return {
      rows,
      mergedCount: 0
    };
  }

  const existingRows = [] as ExistingPassengerRow[];
  for (const chunk of chunkArray(launchIds, 250)) {
    const fetched = await fetchExistingPassengerRowsByLaunchIds(supabase, chunk);
    existingRows.push(...fetched);
  }

  const existingByKey = new Map<string, ExistingPassengerRow>();
  for (const row of existingRows) {
    const key = buildPassengerKey(row.launch_id, row.name, row.flight_code);
    existingByKey.set(key, row);
  }

  let mergedCount = 0;
  const mergedRows = rows.map((row) => {
    const key = buildPassengerKey(row.launch_id, row.name, row.flight_code);
    const existing = existingByKey.get(key);
    if (!existing) return row;

    mergedCount += 1;
    const existingAsUpsert = toPassengerUpsertFromExisting(existing);
    const merged = choosePreferredPassengerRow(row, existingAsUpsert);
    return {
      ...merged,
      traveler_slug: merged.traveler_slug || buildTravelerSlug(merged.name),
      updated_at: row.updated_at
    };
  });

  return {
    rows: mergedRows,
    mergedCount
  };
}

async function fetchExistingPassengerRowsByLaunchIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const runQuery = async (includeTravelerSlug: boolean) => {
    const selectColumns = includeTravelerSlug
      ? 'launch_id,flight_code,traveler_slug,name,role,nationality,launch_name,launch_date,source,confidence,metadata'
      : 'launch_id,flight_code,name,role,nationality,launch_name,launch_date,source,confidence,metadata';

    return await supabase
      .from('blue_origin_passengers')
      .select(selectColumns)
      .in('launch_id', launchIds)
      .limit(8000);
  };

  let response = await runQuery(true);
  if (response.error && isMissingTravelerSlugColumn(response.error)) {
    response = await runQuery(false);
  }
  if (response.error) throw response.error;

  return (response.data || []) as ExistingPassengerRow[];
}

async function upsertPassengerRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: PassengerUpsert[]
) {
  if (!rows.length) return;
  const doUpsert = async (stripTravelerSlug: boolean) => {
    const payload = stripTravelerSlug ? rows.map(({ traveler_slug: _, ...rest }) => rest) : rows;
    return await supabase
      .from('blue_origin_passengers')
      .upsert(payload, { onConflict: 'launch_id,name_normalized' });
  };

  let response = await doUpsert(false);
  if (response.error && isMissingTravelerSlugColumn(response.error)) {
    response = await doUpsert(true);
  }

  if (response.error) throw response.error;
}

function isMissingTravelerSlugColumn(error: unknown) {
  const message = stringifyError(error);
  return /traveler_slug/i.test(message) && /(column|schema|cache|exist|unknown)/i.test(message);
}

function isMissingTravelerCanonicalSchema(error: unknown) {
  const message = stringifyError(error);
  return (
    /blue_origin_travelers|blue_origin_traveler_sources/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  );
}

function toPassengerUpsertFromExisting(row: ExistingPassengerRow): PassengerUpsert {
  return {
    mission_key: classifyBlueOriginMission(`${row.launch_name || ''} ${row.flight_code || ''}`),
    flight_code: normalizeOptionalText(row.flight_code),
    flight_slug: normalizeOptionalText(row.flight_code),
    traveler_slug: normalizeOptionalText(row.traveler_slug) || buildTravelerSlug(row.name),
    name: row.name,
    role: normalizeLl2CrewRole(row.role),
    nationality: normalizeOptionalText(row.nationality),
    launch_id: normalizeOptionalText(row.launch_id),
    launch_name: normalizeOptionalText(row.launch_name),
    launch_date: normalizeOptionalText(row.launch_date),
    source: normalizeOptionalText(row.source) || 'database',
    confidence: normalizeConfidence(row.confidence),
    metadata: toMetadataObject(row.metadata),
    updated_at: new Date().toISOString()
  };
}

function choosePreferredPassengerRow(left: PassengerUpsert, right: PassengerUpsert) {
  const leftRank = confidenceRank(String(left.confidence || 'medium'));
  const rightRank = confidenceRank(String(right.confidence || 'medium'));
  if (leftRank > rightRank) return mergePassengerRow(left, right);
  if (rightRank > leftRank) return mergePassengerRow(right, left);

  const leftScore = passengerRowRichness(left);
  const rightScore = passengerRowRichness(right);
  if (leftScore >= rightScore) return mergePassengerRow(left, right);
  return mergePassengerRow(right, left);
}

function confidenceRank(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  return 1;
}

function mergePassengerRow(primary: PassengerUpsert, secondary: PassengerUpsert): PassengerUpsert {
  const merged: PassengerUpsert = { ...primary };
  const mergedMetadata = {
    ...toMetadataObject(secondary.metadata),
    ...toMetadataObject(primary.metadata)
  };

  const fillFields: Array<keyof PassengerUpsert> = [
    'mission_key',
    'role',
    'nationality',
    'flight_code',
    'flight_slug',
    'traveler_slug',
    'launch_id',
    'launch_name',
    'launch_date'
  ];
  for (const field of fillFields) {
    const primaryValue = merged[field];
    const secondaryValue = secondary[field];
    if (hasValue(primaryValue) || !hasValue(secondaryValue)) continue;
    merged[field] = secondaryValue;
  }

  merged.traveler_slug = normalizeOptionalText(String(merged.traveler_slug || '')) || buildTravelerSlug(merged.name);
  merged.role = normalizeLl2CrewRole(merged.role);
  merged.metadata = mergedMetadata;
  return merged;
}

function passengerRowRichness(value: PassengerUpsert) {
  let score = 0;
  if (hasValue(value.role)) score += 1;
  if (hasValue(value.nationality)) score += 1;
  if (hasValue(value.flight_code)) score += 1;
  if (hasValue(value.launch_id)) score += 1;
  const metadata = toMetadataObject(value.metadata);
  if (hasValue(metadata.profileUrl) || hasValue(metadata.profile_url)) score += 2;
  if (hasValue(metadata.imageUrl) || hasValue(metadata.image_url)) score += 1;
  if (hasValue(metadata.bio)) score += 1;
  return score;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
}

function buildTravelerSlug(name: string) {
  const normalized = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized || 'traveler';
}

function buildTravelerProfileUpserts(rows: PassengerUpsert[]) {
  const grouped = new Map<string, PassengerUpsert[]>();
  for (const row of rows) {
    const slug = normalizeOptionalText(row.traveler_slug) || buildTravelerSlug(row.name);
    const bucket = grouped.get(slug) || [];
    bucket.push(row);
    grouped.set(slug, bucket);
  }

  const nowIso = new Date().toISOString();
  const upserts = [] as TravelerProfileUpsert[];

  for (const [slug, bucket] of grouped.entries()) {
    const sorted = [...bucket].sort((left, right) => {
      const rightScore = confidenceRank(right.confidence) * 20 + passengerRowRichness(right);
      const leftScore = confidenceRank(left.confidence) * 20 + passengerRowRichness(left);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.name.length - left.name.length;
    });
    const best = sorted[0] as PassengerUpsert;
    const profileUrls = collectDistinctText(
      sorted.flatMap((row) => collectPreferredMetadataUrls(toMetadataObject(row.metadata), TRAVELER_PROFILE_URL_KEYS))
    );
    const imageUrls = collectDistinctText(
      sorted.map((row) =>
        readMetadataUrl(row.metadata, [
          'imageUrl',
          'image_url',
          'profileImage',
          'profile_image',
          'profile_image_thumbnail'
        ])
      )
    );
    const bios = collectDistinctText(
      sorted.map((row) => readMetadataText(row.metadata, ['bio', 'summary', 'description', 'extract']))
    );

    upserts.push({
      traveler_slug: slug,
      canonical_name: best.name,
      bio_short: trimText(bios[0] || null, 1200),
      primary_image_url: imageUrls[0] || null,
      primary_profile_url: profileUrls[0] || null,
      nationality: deriveTravelerNationality(sorted),
      source_confidence: normalizeConfidence(sorted.map((row) => row.confidence).sort((left, right) => confidenceRank(right) - confidenceRank(left))[0]),
      metadata: {
        sourceCount: sorted.length,
        launchCount: [...new Set(sorted.map((row) => row.launch_id).filter(Boolean))].length,
        flightCodes: [...new Set(sorted.map((row) => normalizeOptionalText(row.flight_code)).filter(Boolean))].slice(0, 40),
        sourceTypes: [...new Set(sorted.map((row) => normalizeSourceType(row.source)))].slice(0, 20),
        profileUrls: profileUrls.slice(0, 20),
        imageUrls: imageUrls.slice(0, 20),
        generatedBy: 'blue-origin-passengers-ingest'
      },
      updated_at: nowIso
    });
  }

  return upserts;
}

async function buildTravelerSourceUpserts(rows: PassengerUpsert[]) {
  const nowIso = new Date().toISOString();
  const upserts = [] as TravelerSourceUpsert[];

  for (const row of rows) {
    const metadata = toMetadataObject(row.metadata);
    const travelerSlug = normalizeOptionalText(row.traveler_slug) || buildTravelerSlug(row.name);
    const sourceType = normalizeSourceType(row.source);
    const profileUrl = resolvePreferredMetadataUrl(metadata, TRAVELER_PROFILE_URL_KEYS) || null;
    const imageUrl =
      readMetadataUrl(metadata, [
        'imageUrl',
        'image_url',
        'profileImage',
        'profile_image',
        'profile_image_thumbnail'
      ]) || null;
    const bioFull =
      trimText(
        readMetadataText(metadata, ['bio', 'summary', 'description', 'extract', 'missionDescription']),
        8_000
      ) || null;
    const sourceUrl = resolvePreferredMetadataUrl(metadata, TRAVELER_SOURCE_URL_KEYS) || profileUrl || null;
    const capturedAt =
      normalizeIso(metadata.capturedAt) ||
      normalizeIso(metadata.captured_at) ||
      normalizeIso(metadata.backfilledAt) ||
      normalizeIso(metadata.backfilled_at) ||
      normalizeIso(row.launch_date) ||
      null;

    const sourceSeed = [
      travelerSlug,
      normalizeOptionalText(row.launch_id) || 'na',
      normalizeOptionalText(row.flight_code) || 'na',
      normalizeSourceType(row.source),
      profileUrl || 'na',
      imageUrl || 'na',
      trimText(bioFull, 256) || 'na'
    ].join('|');
    const sourceKey = `bo-traveler-source:${await sha256Hex(sourceSeed)}`;
    const contentSha256 = await sha256Hex([profileUrl || '', imageUrl || '', bioFull || '', row.name].join('|'));

    upserts.push({
      source_key: sourceKey,
      traveler_slug: travelerSlug,
      launch_id: normalizeOptionalText(row.launch_id),
      flight_code: normalizeOptionalText(row.flight_code),
      source_type: sourceType,
      source_url: sourceUrl,
      source_document_id:
        normalizeOptionalText(String(metadata.sourceDocumentId || metadata.source_document_id || '')) || null,
      profile_url: profileUrl,
      image_url: imageUrl,
      bio_full: bioFull,
      bio_excerpt: trimText(bioFull, 460),
      attribution: {
        source: row.source,
        role: row.role || null,
        nationality: row.nationality || null,
        ll2AstronautId: metadata.ll2AstronautId ?? null,
        ll2LaunchUuid: metadata.ll2LaunchUuid ?? null,
        provider: metadata.provider ?? null
      },
      confidence: row.confidence,
      content_sha256: contentSha256,
      captured_at: capturedAt,
      metadata: {
        missionKey: row.mission_key,
        launchName: row.launch_name,
        generatedBy: 'blue-origin-passengers-ingest'
      },
      updated_at: nowIso
    });
  }

  return upserts;
}

function toMetadataObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function hasValue(value: unknown) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

const TRAVELER_PROFILE_URL_KEYS = [
  'sourceUrl',
  'source_url',
  'missionUrl',
  'mission_url',
  'profileUrl',
  'profile_url',
  'wiki',
  'wikiUrl',
  'll2AstronautUrl',
  'll2_astronaut_url',
  'url'
];

const TRAVELER_SOURCE_URL_KEYS = [
  'sourceUrl',
  'source_url',
  'missionUrl',
  'mission_url',
  'url',
  'profileUrl',
  'profile_url',
  'wiki',
  'wikiUrl',
  'll2AstronautUrl',
  'll2_astronaut_url'
];

function readMetadataUrl(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const normalized = normalizeUrl(metadata[key]);
    if (normalized) return normalized;
  }
  return null;
}

function readMetadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeOptionalText(typeof metadata[key] === 'string' ? metadata[key] : null);
    if (value) return value;
  }
  return null;
}

function collectPreferredMetadataUrls(metadata: Record<string, unknown>, keys: string[]) {
  const candidates = [] as string[];
  for (const key of keys) {
    const normalized = normalizeUrl(metadata[key]);
    if (normalized) candidates.push(normalized);
  }
  const unique = [...new Set(candidates)];
  return unique.sort((left, right) => rankTravelerProfileUrl(right) - rankTravelerProfileUrl(left) || left.localeCompare(right));
}

function resolvePreferredMetadataUrl(metadata: Record<string, unknown>, keys: string[]) {
  return collectPreferredMetadataUrls(metadata, keys)[0] || null;
}

function rankTravelerProfileUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 0;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

  if (host === 'blueorigin.com' && /^\/news\/(?:ns|ng)-\d{1,3}-mission-updates$/.test(path)) return 125;
  if (host === 'blueorigin.com' && /^\/news\/(?:new-shepard|new-glenn)-(?:ns|ng)-\d{1,3}-mission$/.test(path)) return 120;
  if (host === 'blueorigin.com' && path.startsWith('/missions/')) return 110;
  if (host === 'blueorigin.com') return 100;
  if (host === 'web.archive.org') return 90;
  if (host === 'nasa.gov') return 70;
  return 30;
}

function collectDistinctText(items: Array<string | null>) {
  const seen = new Set<string>();
  const values = [] as string[];
  for (const item of items) {
    const normalized = normalizeOptionalText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
}

function deriveTravelerNationality(rows: PassengerUpsert[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const nationality = normalizeOptionalText(row.nationality);
    if (!nationality) continue;
    counts.set(nationality, (counts.get(nationality) || 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function trimText(value: string | null | undefined, limit: number) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const maxLength = Math.max(24, Math.trunc(limit));
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSourceType(source: string | null | undefined) {
  const normalized = normalizeOptionalText(source)?.toLowerCase() || 'unknown';
  if (normalized.startsWith('ll2_api.')) return 'll2_api';
  if (normalized.startsWith('ll2_astronaut_launches')) return 'll2_astronaut_launches';
  if (normalized.startsWith('ll2_astronauts.profile_inference')) return 'll2_astronauts';
  if (normalized.startsWith('launches_public_cache.crew')) return 'launches_public_cache';
  if (normalized.startsWith('blueorigin_multisource.bo_manifest_passengers')) return 'blueorigin_multisource';
  return normalized.replace(/[^a-z0-9_.-]/g, '-').slice(0, 80) || 'unknown';
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function collectDistinctNormalizedText(values: Array<string | null>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeLaunchId(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() || null;
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

async function requestBlueOriginRevalidate({
  travelerSlugs,
  launchIds
}: {
  travelerSlugs: string[];
  launchIds: string[];
}) {
  const callbackUrl = normalizeOptionalText(Deno.env.get('TMZ_REVALIDATE_BLUE_ORIGIN_URL'));
  const callbackToken = normalizeOptionalText(Deno.env.get('TMZ_REVALIDATE_BLUE_ORIGIN_TOKEN'));
  if (!callbackUrl || !callbackToken) {
    return {
      ok: false,
      status: null as number | null,
      error: 'revalidate_not_configured'
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(callbackUrl);
  } catch {
    return {
      ok: false,
      status: null as number | null,
      error: 'revalidate_url_invalid'
    };
  }

  const payload = {
    source: 'blue-origin-passengers-ingest',
    reason: 'traveler-passenger-upsert',
    travelerSlugs: travelerSlugs.slice(0, BLUE_ORIGIN_REVALIDATE_MAX_TRAVELER_SLUGS),
    launchIds: launchIds.slice(0, BLUE_ORIGIN_REVALIDATE_MAX_LAUNCH_IDS)
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), BLUE_ORIGIN_REVALIDATE_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callbackToken}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (response.ok) {
      return { ok: true, status: response.status, error: null as string | null };
    }

    const bodyText = (await response.text()).slice(0, 260);
    return {
      ok: false,
      status: response.status,
      error: `revalidate_http_${response.status}${bodyText ? `:${bodyText}` : ''}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null as number | null,
      error: `revalidate_request_failed:${stringifyError(error)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLl2ApiNewShepardLaunches() {
  const launches = [] as Ll2ApiLaunchRow[];
  let next = `${LL2_API_BASE}/launch/?search=${encodeURIComponent('New Shepard')}&mode=detailed&limit=100`;
  let pageCount = 0;

  while (next && pageCount < LL2_FETCH_MAX_PAGES) {
    pageCount += 1;
    const payload = (await fetchJsonWithRetry(
      next,
      LL2_FETCH_TIMEOUT_MS,
      LL2_FETCH_RETRIES,
      LL2_RETRY_BACKOFF_MS
    )) as Ll2ApiResponse<Ll2ApiLaunchRow>;
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    launches.push(...rows);
    next = typeof payload?.next === 'string' ? payload.next : '';
  }

  return launches;
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TMinusZeroBot/1.0 (support@tminuszero.app)'
      }
    });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  backoffMs: number
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b429\b|\b5\d\d\b/.test(message);
      lastError = error instanceof Error ? error : new Error(message);
      if (!retryable || attempt >= retries) break;
      const delayMs = backoffMs * attempt + Math.round(Math.random() * 250);
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`failed to fetch ${url}`);
}

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TMinusZeroBot/1.0 (support@tminuszero.app)',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  backoffMs: number
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b429\b|\b5\d\d\b/.test(message);
      lastError = error instanceof Error ? error : new Error(message);
      if (!retryable || attempt >= retries) break;
      const delayMs = backoffMs * attempt + Math.round(Math.random() * 250);
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`failed to fetch ${url}`);
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function findLaunchByFlightCode(
  launches: Array<{
    launch: LaunchPassengerRow;
    flightCode: string | null;
  }>,
  flightCode: string | null,
  netIso: string | null
) {
  if (!flightCode) return null;
  const matching = launches.filter((entry) => entry.flightCode === flightCode);
  if (!matching.length) return null;
  if (matching.length === 1) return matching[0]?.launch || null;

  const netMs = Date.parse(String(netIso || ''));
  if (!Number.isFinite(netMs)) return matching[0]?.launch || null;
  let best: LaunchPassengerRow | null = matching[0]?.launch || null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of matching) {
    const candidateMs = Date.parse(String(candidate.launch.net || ''));
    if (!Number.isFinite(candidateMs)) continue;
    const delta = Math.abs(candidateMs - netMs);
    if (delta < bestDelta) {
      best = candidate.launch;
      bestDelta = delta;
    }
  }
  return best;
}

async function buildMissionConstraintPassengerCandidates({
  supabase,
  launches
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launches: LaunchPassengerRow[];
}) {
  const launchById = new Map<string, LaunchPassengerRow>();
  for (const launch of launches) {
    const launchId = normalizeOptionalText(launch.launch_id);
    if (!launchId) continue;
    launchById.set(launchId, launch);
  }

  const launchIds = [...launchById.keys()];
  if (!launchIds.length) {
    return {
      rows: [] as PassengerUpsert[],
      meta: {
        constraintLaunchIds: [] as string[],
        pagesEnriched: 0,
        passengerMediaHits: 0
      }
    };
  }

  const constraints = [] as MissionConstraintRow[];
  for (const chunk of chunkArray(launchIds, 250)) {
    const { data, error } = await supabase
      .from('launch_trajectory_constraints')
      .select('launch_id,constraint_type,data,fetched_at')
      .in('launch_id', chunk)
      .eq('source', BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE)
      .in('constraint_type', ['bo_manifest_passengers', 'bo_official_sources'])
      .order('fetched_at', { ascending: false })
      .limit(6_000);
    if (error) throw error;
    constraints.push(...((data || []) as MissionConstraintRow[]));
  }

  const constraintsByLaunch = new Map<
    string,
    {
      passengerPayloads: Array<Record<string, unknown>>;
      officialSourcePayloads: Array<Record<string, unknown>>;
    }
  >();
  for (const row of constraints) {
    const launchId = normalizeOptionalText(row.launch_id);
    if (!launchId) continue;
    const constraintType = normalizeOptionalText(row.constraint_type);
    if (!constraintType) continue;
    const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : null;
    if (!data) continue;

    const bucket = constraintsByLaunch.get(launchId) || {
      passengerPayloads: [],
      officialSourcePayloads: []
    };
    if (constraintType === 'bo_manifest_passengers') {
      bucket.passengerPayloads.push(data);
    } else if (constraintType === 'bo_official_sources') {
      bucket.officialSourcePayloads.push(data);
    }
    constraintsByLaunch.set(launchId, bucket);
  }

  const rows = [] as PassengerUpsert[];
  let pagesEnriched = 0;
  let passengerMediaHits = 0;

  for (const [launchId, launch] of launchById.entries()) {
    const constraintBucket = constraintsByLaunch.get(launchId);
    if (!constraintBucket) continue;

    const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
    const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);
    const missionUrls = resolveMissionUrlsFromOfficialSources(constraintBucket.officialSourcePayloads);
    const passengerRowsForLaunch = [] as PassengerUpsert[];

    for (const payload of constraintBucket.passengerPayloads) {
      const passengers = Array.isArray(payload.passengers) ? payload.passengers : [];
      for (const passengerEntry of passengers) {
        if (!passengerEntry || typeof passengerEntry !== 'object') continue;
        const passenger = passengerEntry as Record<string, unknown>;
        const person = normalizeManifestPassengerName(
          typeof passenger.name === 'string' ? passenger.name : null
        );
        if (!person) continue;

        const profileUrl =
          normalizeUrl(passenger.profileUrl) ||
          normalizeUrl(passenger.profile_url) ||
          normalizeUrl(passenger.sourceUrl) ||
          normalizeUrl(passenger.source_url) ||
          missionUrls.profileUrl ||
          null;
        const imageUrl =
          normalizeUrl(passenger.imageUrl) ||
          normalizeUrl(passenger.image_url) ||
          normalizeUrl(passenger.profileImage) ||
          normalizeUrl(passenger.profile_image) ||
          normalizeUrl(passenger.profile_image_thumbnail) ||
          null;
        const bio =
          normalizeOptionalText(typeof passenger.bioSnippet === 'string' ? passenger.bioSnippet : null) ||
          normalizeOptionalText(typeof passenger.bio === 'string' ? passenger.bio : null) ||
          normalizeOptionalText(typeof passenger.description === 'string' ? passenger.description : null) ||
          null;

        passengerRowsForLaunch.push({
          mission_key: missionKey,
          flight_code: flightCode,
          flight_slug: flightCode || null,
          traveler_slug: buildTravelerSlug(person),
          name: person,
          role: normalizeLl2CrewRole(typeof passenger.role === 'string' ? passenger.role : null),
          nationality: normalizeOptionalText(typeof passenger.nationality === 'string' ? passenger.nationality : null),
          launch_id: launchId,
          launch_name: normalizeOptionalText(launch.name) || null,
          launch_date: normalizeOptionalText(launch.net) || null,
          source: BLUE_ORIGIN_MISSION_CONSTRAINT_PASSENGER_SOURCE,
          confidence: 'high',
          metadata: {
            missionName: launch.mission_name || null,
            provider: launch.provider || null,
            profileUrl,
            sourceUrl:
              normalizeUrl(passenger.sourceUrl) ||
              normalizeUrl(passenger.source_url) ||
              missionUrls.profileUrl ||
              null,
            imageUrl,
            bio,
            sourceDocumentId:
              normalizeOptionalText(typeof passenger.sourceDocumentId === 'string' ? passenger.sourceDocumentId : null) ||
              normalizeOptionalText(typeof passenger.source_document_id === 'string' ? passenger.source_document_id : null) ||
              null
          },
          updated_at: new Date().toISOString()
        });
      }
    }

    if (!passengerRowsForLaunch.length) continue;

    const needsMediaEnrichment = passengerRowsForLaunch.some((row) => {
      const metadata = toMetadataObject(row.metadata);
      return !readMetadataUrl(metadata, ['imageUrl', 'image_url']) || !readMetadataText(metadata, ['bio']);
    });

    if (needsMediaEnrichment && missionUrls.fetchUrl) {
      const html = await fetchTextWithRetry(
        missionUrls.fetchUrl,
        BLUE_ORIGIN_MISSION_FETCH_TIMEOUT_MS,
        BLUE_ORIGIN_MISSION_FETCH_RETRIES,
        BLUE_ORIGIN_MISSION_FETCH_BACKOFF_MS
      ).catch(() => null);

      if (html) {
        pagesEnriched += 1;
        const contexts = extractPassengerContextFromMissionHtml(
          html,
          passengerRowsForLaunch.map((row) => row.name),
          missionUrls.fetchUrl
        );
        for (const row of passengerRowsForLaunch) {
          const context = contexts.get(normalizeNameKey(row.name));
          if (!context) continue;
          const metadata = toMetadataObject(row.metadata);
          let enriched = false;

          const existingImage = readMetadataUrl(metadata, ['imageUrl', 'image_url']);
          if (!existingImage && context.imageUrl) {
            metadata.imageUrl = context.imageUrl;
            enriched = true;
          }

          const existingBio = readMetadataText(metadata, ['bio', 'summary', 'description', 'extract']);
          if (!existingBio && context.bio) {
            metadata.bio = context.bio;
            enriched = true;
          }

          if (enriched) {
            row.metadata = metadata;
            passengerMediaHits += 1;
          }
        }
      }
    }

    rows.push(...passengerRowsForLaunch);
  }

  return {
    rows,
    meta: {
      constraintLaunchIds: [...constraintsByLaunch.keys()],
      pagesEnriched,
      passengerMediaHits
    }
  };
}

function resolveMissionUrlsFromOfficialSources(payloads: Array<Record<string, unknown>>) {
  const candidates = [] as string[];
  const add = (value: unknown) => {
    const normalized = normalizeUrl(value);
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  for (const payload of payloads) {
    add(payload.primaryLaunchUrl);
    const seedUrls = Array.isArray(payload.seedUrls) ? payload.seedUrls : [];
    for (const seedUrl of seedUrls) add(seedUrl);

    const sourcePages = Array.isArray(payload.sourcePages) ? payload.sourcePages : [];
    for (const sourcePage of sourcePages) {
      if (!sourcePage || typeof sourcePage !== 'object') continue;
      const page = sourcePage as Record<string, unknown>;
      add(page.canonicalUrl);
      add(page.url);
      add(page.archiveSnapshotUrl);
    }
  }

  let fetchUrl = candidates.find((url) => isWaybackUrl(url)) || candidates[0] || null;
  let profileUrl = candidates.find((url) => !isWaybackUrl(url)) || null;

  if (!profileUrl && fetchUrl && isWaybackUrl(fetchUrl)) {
    profileUrl = extractOriginalUrlFromWayback(fetchUrl);
  }
  if (!profileUrl) profileUrl = fetchUrl;

  return {
    profileUrl,
    fetchUrl
  };
}

function isWaybackUrl(url: string) {
  return /web\.archive\.org\/web\/\d+\//i.test(url);
}

function extractOriginalUrlFromWayback(url: string) {
  const match = url.match(/web\/\d+\/(https?:\/\/.+)$/i);
  if (!match?.[1]) return null;
  return normalizeUrl(match[1]);
}

function extractPassengerContextFromMissionHtml(html: string, names: string[], pageUrl: string) {
  const byName = new Map<string, MissionPassengerContext>();
  const mainHtml = extractMainHtml(html);
  const pageImageUrl =
    normalizeUrl(readMetaContentByProperty(html, 'og:image')) ||
    normalizeUrl(readMetaContentByName(html, 'og:image')) ||
    normalizeUrl(readMetaContentByProperty(html, 'twitter:image')) ||
    null;

  const seen = new Set<string>();
  for (const nameRaw of names) {
    const name = normalizeOptionalText(nameRaw);
    if (!name) continue;
    const key = normalizeNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const escapedName = escapeRegExp(name);
    const headingPattern = new RegExp(
      `<(?:h[1-6]|strong|b)[^>]*>[^<]{0,120}${escapedName}[^<]{0,120}</(?:h[1-6]|strong|b)>[\\s\\S]{0,2200}`,
      'i'
    );
    const headingSegment = mainHtml.match(headingPattern)?.[0] || '';
    const fallbackSegment = headingSegment || extractSegmentAroundName(mainHtml, name, 2400);
    const segment = fallbackSegment || mainHtml;

    const paragraphMatch = segment.match(/<p[^>]*>([\s\S]{20,2400}?)<\/p>/i);
    const bio = paragraphMatch
      ? trimText(stripHtmlText(paragraphMatch[1]), 1200)
      : null;

    const nameAltImageTag = segment.match(
      new RegExp(`<img[^>]+alt=["'][^"']*${escapedName}[^"']*["'][^>]*>`, 'i')
    )?.[0];
    const firstImageTag = nameAltImageTag || segment.match(/<img\b[^>]*>/i)?.[0] || null;
    const imageUrl = extractImageUrlFromTag(firstImageTag, pageUrl) || pageImageUrl;

    if (!bio && !imageUrl) continue;
    byName.set(key, {
      bio: bio || null,
      imageUrl: imageUrl || null
    });
  }

  return byName;
}

function extractMainHtml(html: string) {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return match?.[1] || html;
}

function extractSegmentAroundName(html: string, name: string, maxChars: number) {
  const lowerHtml = html.toLowerCase();
  const lowerName = name.toLowerCase();
  const index = lowerHtml.indexOf(lowerName);
  if (index < 0) return '';
  const radius = Math.max(500, Math.trunc(maxChars / 2));
  const start = Math.max(0, index - radius);
  const end = Math.min(html.length, index + radius);
  return html.slice(start, end);
}

function extractImageUrlFromTag(tag: string | null | undefined, pageUrl: string) {
  if (!tag) return null;
  const srcset = readHtmlAttribute(tag, 'srcset');
  if (srcset) {
    const first = srcset
      .split(',')
      .map((entry) => entry.trim().split(/\s+/)[0] || '')
      .find((entry) => Boolean(entry));
    const normalized = normalizeRelativeUrl(first || null, pageUrl);
    if (normalized) return normalized;
  }

  const attrs = ['src', 'data-src', 'data-image', 'data-original-src', 'data-lazy-src'];
  for (const attr of attrs) {
    const raw = readHtmlAttribute(tag, attr);
    const normalized = normalizeRelativeUrl(raw, pageUrl);
    if (normalized) return normalized;
  }
  return null;
}

function readHtmlAttribute(tag: string, attribute: string) {
  const pattern = new RegExp(`${escapeRegExp(attribute)}=["']([^"']+)["']`, 'i');
  const match = tag.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlValue(match[1]);
}

function normalizeRelativeUrl(value: string | null | undefined, pageUrl: string) {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  if (raw.startsWith('data:')) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return normalizeUrl(raw);
  }
}

function readMetaContentByName(html: string, name: string) {
  const pattern = new RegExp(`<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlValue(match[1]);
}

function readMetaContentByProperty(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlValue(match[1]);
}

function stripHtmlText(value: string) {
  const normalized = decodeHtmlValue(value.replace(/<[^>]+>/g, ' '));
  return normalizeOptionalText(normalized);
}

function decodeHtmlValue(value: string) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function escapeRegExp(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNameKey(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeManifestPassengerName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length < 3 || cleaned.length > 96) return null;
  if (/\d/.test(cleaned)) return null;
  if (/[|=<>/]/.test(cleaned)) return null;
  if (!/^[\p{L}\p{M}.'’` -]+$/u.test(cleaned)) return null;
  if (BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_PHRASE_PATTERN.test(cleaned)) return null;
  if (BLUE_ORIGIN_MANIFEST_PASSENGER_NOISE_TOKEN_PATTERN.test(cleaned)) return null;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return null;

  let coreWordCount = 0;
  for (const word of words) {
    const stripped = word
      .replace(/^[.'’`-]+/g, '')
      .replace(/[.'’`-]+$/g, '')
      .replace(/\./g, '');
    if (!stripped) return null;
    if (!/\p{L}/u.test(stripped)) return null;

    const lower = stripped.toLowerCase();
    if (BLUE_ORIGIN_MANIFEST_PASSENGER_ALLOWED_PARTICLES.has(lower)) continue;
    if (BLUE_ORIGIN_MANIFEST_PASSENGER_STOPWORDS.has(lower)) return null;
    if (/^(?:ii|iii|iv|v|vi|jr|sr)$/i.test(lower)) continue;
    if (!/^\p{Lu}[\p{L}\p{M}'’`-]*$/u.test(stripped)) return null;
    if (stripped.length < 2) return null;
    coreWordCount += 1;
  }

  if (coreWordCount < 2) return null;

  return cleaned;
}

function normalizeLl2CrewRole(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'crew';
  if (normalized.includes('tourist') || normalized.includes('private')) return 'crew';
  if (normalized.includes('passenger')) return 'crew';
  if (normalized.includes('crew') || normalized.includes('astronaut')) return 'crew';
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function extractAstronautFlightDates(astronaut: Ll2AstronautRow) {
  const dates = new Set<string>();
  const raw = astronaut.raw || {};

  const first = normalizeIso(raw.first_flight);
  const last = normalizeIso(raw.last_flight);
  if (first) dates.add(first);
  if (last) dates.add(last);

  return [...dates.values()];
}

function normalizeIso(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function inferClosestLaunch<T extends { netMs: number }>(
  launches: T[],
  candidateMs: number,
  windowHours: number
) {
  let best: T | null = null;
  let bestDeltaMs = Number.POSITIVE_INFINITY;
  const windowMs = windowHours * 60 * 60 * 1000;

  for (const launch of launches) {
    const delta = Math.abs(launch.netMs - candidateMs);
    if (delta > windowMs) continue;
    if (delta < bestDeltaMs) {
      best = launch;
      bestDeltaMs = delta;
    }
  }
  return best;
}

function inferRoleFromAstronautType(value: string | null) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('private') || normalized.includes('space tourist')) return 'crew';
  if (normalized.includes('government') || normalized.includes('military')) return 'crew';
  return 'crew';
}

function parseAstronautNationality(nationality: string | null, raw: Record<string, unknown> | null) {
  const fromRaw = raw?.nationality;
  const candidates = [nationality, typeof fromRaw === 'string' ? fromRaw : null].filter((value): value is string => typeof value === 'string');
  for (const value of candidates) {
    const parsed = parseNationalityJsonString(value);
    if (parsed) return parsed;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function extractAstronautProfileUrl(astronaut: Ll2AstronautRow) {
  const candidates = [
    astronaut.wiki,
    typeof astronaut.raw?.wiki === 'string' ? astronaut.raw.wiki : null,
    typeof astronaut.raw?.url === 'string' ? astronaut.raw.url : null
  ];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractGenericAstronautImageUrl(astronaut: any) {
  if (!astronaut || typeof astronaut !== 'object') return null;
  const image = astronaut.image && typeof astronaut.image === 'object' ? astronaut.image : null;
  const candidates = [
    astronaut.profile_image_thumbnail,
    astronaut.profile_image,
    astronaut.profileImageThumbnail,
    astronaut.profileImage,
    image?.thumbnail_url,
    image?.thumbnailUrl,
    image?.image_url,
    image?.imageUrl,
    image?.url,
    astronaut.image_url,
    astronaut.imageUrl
  ];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractAstronautImageUrl(astronaut: Ll2AstronautRow) {
  const raw = astronaut.raw && typeof astronaut.raw === 'object' ? (astronaut.raw as any) : null;
  const rawImage = raw?.image && typeof raw.image === 'object' ? raw.image : null;
  const candidates = [
    astronaut.profile_image_thumbnail,
    astronaut.profile_image,
    typeof astronaut.raw?.profile_image === 'string' ? astronaut.raw.profile_image : null,
    typeof astronaut.raw?.profile_image_thumbnail === 'string' ? astronaut.raw.profile_image_thumbnail : null
    ,
    typeof rawImage?.thumbnail_url === 'string' ? rawImage.thumbnail_url : null,
    typeof rawImage?.thumbnailUrl === 'string' ? rawImage.thumbnailUrl : null,
    typeof rawImage?.image_url === 'string' ? rawImage.image_url : null,
    typeof rawImage?.imageUrl === 'string' ? rawImage.imageUrl : null,
    typeof rawImage?.url === 'string' ? rawImage.url : null,
    typeof raw?.image_url === 'string' ? raw.image_url : null,
    typeof raw?.imageUrl === 'string' ? raw.imageUrl : null
  ];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  parsed.hash = '';
  const host = normalizeUrlHost(parsed.hostname);
  if (!host) return null;
  if (isOpenSourceTravelerProfileHost(host)) return null;

  if (host === 'blueorigin.com') {
    const pathname = normalizeBlueOriginLocalePath(parsed.pathname);
    if (!pathname) return 'https://www.blueorigin.com';

    const flightCode = extractFlightCodeFromBlueOriginPath(pathname);
    if (
      flightCode &&
      (/^\/news\/(?:new-shepard|new-glenn)-(?:ns|ng)-\d{1,3}-mission$/i.test(pathname) ||
        /^\/news\/(?:ns|ng)-\d{1,3}-mission$/i.test(pathname) ||
        /^\/news\/(?:new-shepard|new-glenn)-mission-(?:ns|ng)-\d{1,3}$/i.test(pathname))
    ) {
      return `https://www.blueorigin.com/news/${flightCode}-mission-updates`;
    }

    return `https://www.blueorigin.com${pathname}`;
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
  return parsed.toString();
}

function normalizeUrlHost(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function isOpenSourceTravelerProfileHost(host: string) {
  const normalized = normalizeUrlHost(host);
  if (!normalized) return false;
  const openSourceHostSuffixes = ['thespacedevs.com', 'wikipedia.org', 'wikidata.org'];
  return openSourceHostSuffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
}

function normalizeBlueOriginLocalePath(pathname: string) {
  if (typeof pathname !== 'string') return '';
  const trimmed = pathname.trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/+$/g, '');
  if (!withoutTrailingSlash) return '';

  const localeAware = withoutTrailingSlash.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, '');
  return localeAware || '/';
}

function extractFlightCodeFromBlueOriginPath(pathname: string) {
  const normalized = String(pathname || '').toLowerCase();
  const match = normalized.match(/\b(ns|ng)-(\d{1,3})\b/);
  if (!match?.[1] || !match?.[2]) return null;
  return `${match[1]}-${Number(match[2])}`;
}

function parseNationalityJsonString(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    const names = parsed
      .map((entry) => (entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).name || '').trim() : ''))
      .filter(Boolean);
    if (names.length === 0) return null;
    return names.join(', ');
  } catch {
    return null;
  }
}
