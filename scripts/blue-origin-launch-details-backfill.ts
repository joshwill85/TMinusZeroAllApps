import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import {
  extractBlueOriginFlightCodeFromText,
  extractBlueOriginFlightCodeFromUrl
} from '@/lib/utils/blueOrigin';

config({ path: '.env.local' });
config();

const BLUE_ORIGIN_OR_FILTER = [
  'provider.ilike.%Blue Origin%',
  'name.ilike.%Blue Origin%',
  'mission_name.ilike.%Blue Origin%',
  'name.ilike.%New Shepard%',
  'mission_name.ilike.%New Shepard%',
  'name.ilike.%New Glenn%',
  'mission_name.ilike.%New Glenn%',
  'name.ilike.%Blue Moon%',
  'mission_name.ilike.%Blue Moon%',
  'name.ilike.%Blue Ring%',
  'mission_name.ilike.%Blue Ring%'
].join(',');

const BLUE_ORIGIN_JOB_CHAIN = [
  'blue-origin-bootstrap',
  'blue-origin-vehicles-ingest',
  'blue-origin-engines-ingest',
  'blue-origin-missions-ingest',
  'blue-origin-news-ingest',
  'blue-origin-media-ingest',
  'blue-origin-passengers-ingest',
  'blue-origin-payloads-ingest',
  'blue-origin-contracts-ingest',
  'blue-origin-social-ingest',
  'blue-origin-snapshot-build'
] as const;

const BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const UPSERT_CHUNK_SIZE = 200;
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_LAUNCHES = 1600;
const DEFAULT_MAX_PAGES_PER_LAUNCH = 250;
const DEFAULT_MIN_ENHANCEMENT_COVERAGE = 0.6;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_RETRIES = 3;
const FETCH_RETRY_BASE_MS = 300;
const CRAWL_LINKS_PER_PAGE_LIMIT = 200;
const CRAWL_CONCURRENCY = 4;
const MISSION_GRAPHIC_LABEL_PATTERN =
  /(flightprofile|missionprofile|missiontimeline|bythenumbers|boosterrecovery|boosterlanding|trajectory|infographic|missionsummary|flightoverview|missionoverview|launchoverview|missiondiagram|missionchart|missiontimeline)/i;
const MISSION_GRAPHIC_CONTEXT_PATTERN =
  /(mission|trajectory|timeline|profile|booster|landing|recovery|infographic|summary|overview|diagram|chart|facts|statistics|numbers|data|fact|graphics?)/i;
const MISSION_GRAPHIC_EXCLUDE_PATTERN =
  /(webcast|comingsoon|shop|logo|logos|icon|icons|avatar|badge|button|social|instagram|twitter|facebook|youtube|linkedin|careers|header|footer|menu|promo|404|fourohfour)/i;
const BLUE_ORIGIN_MISSION_GRAPHIC_EXTENSIONS = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i;
const BLUE_ORIGIN_WAYBACK_DIRECT_PREFIX = 'https://web.archive.org/web/';
const BLUE_ORIGIN_NEWS_PATH_SEGMENTS = [
  'new-shepard',
  'new-glenn',
  'new-shepard-updates',
  'new-glenn-updates',
  'new-shepard-ns',
  'new-glenn-ng',
  'mission',
  'missions'
] as const;
const BLUE_ORIGIN_FLIGHT_CODE_PREFIXES = ['ns', 'ng'] as const;
const BLUE_ORIGIN_FLIGHT_FALLBACK_PREFIX = 'legacy-launch';

const BLUE_ORIGIN_MULTISOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_INFOGRAPHIC_SOURCE = 'blueorigin_mission_page';
const BLUE_ORIGIN_PAGE_FETCH_CACHE = new Map<string, Promise<CrawledBlueOriginPage | null>>();
const BLUE_ORIGIN_PAGE_LINK_CACHE = new Map<string, string[]>();
const WAYBACK_CDX_CACHE = new Map<string, { timestamp: string | null; at: number }>();
const BLUE_ORIGIN_MISSION_SECTION_LABELS = [
  'payload',
  'payloads',
  'mission statistics',
  'key mission statistics',
  'mission facts',
  'mission profile',
  'crew',
  'mission profile',
  'manifest',
  'launch summary'
] as const;
const BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY = 'mission_summary';
const BLUE_ORIGIN_FAILURE_REASON_FACT_KEY = 'failure_reason';
const BLUE_ORIGIN_MISSION_SUMMARY_SECTION_PATTERNS = [
  /mission\s+summary/i,
  /mission\s+overview/i,
  /launch\s+summary/i,
  /mission\s+profile/i,
  /flight\s+summary/i,
  /mission\s+facts/i,
  /key\s+mission\s+statistics/i,
  /mission\s+statistics/i
] as const;
const BLUE_ORIGIN_FAILURE_KEYWORDS = /\b(?:scrub|scrubbed|aborted|abort|failure|anomaly|anomal|called off|engine failure|pressur|booster.*failed|mission.*failed|did not|didn't|loss)\b/i;
const BLUE_ORIGIN_NOISE_PASSENGER_TOKEN = /\b(?:mission|launch|payload|spacecraft|orbit|apogee|booster|capsule|vehicle|recovered|booster|stage|new|shepard|glenn|blue|origin|recovery|landing|trajectory|suborbital|orbital|status|public|media|pod|video|image|gallery)\b/i;
const BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN = /\b(?:mission|launch|flight|blue origin|new shepard|new glenn|booster|capsule|crew|people|passenger|passengers|spaceflight|suborbital|orbital|news|timeline|statistics|profile|infographic)\b/i;
const BLUE_ORIGIN_REQUIRED_PERSON_WORDS = 2;

const BLUE_ORIGIN_MULTISOURCE_TYPES = [
  'bo_official_sources',
  'bo_manifest_passengers',
  'bo_manifest_payloads',
  'bo_mission_facts'
] as const;

type BlueOriginConstraintType = (typeof BLUE_ORIGIN_MULTISOURCE_TYPES)[number];

type LaunchCacheRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  mission_name: string | null;
  mission_description: string | null;
  fail_reason: string | null;
  net: string | null;
  provider: string | null;
  launch_info_urls: unknown;
  mission_info_urls: unknown;
};

type BlueOriginFlightRow = {
  id: string;
  flight_code: string;
  mission_key: string;
  launch_id: string | null;
  ll2_launch_uuid: string | null;
  launch_name: string | null;
  launch_date: string | null;
  status: string | null;
  official_mission_url: string | null;
  source: string | null;
  confidence: string | null;
  metadata: Record<string, unknown> | null;
};

type MissionGraphic = {
  id: string;
  label: string;
  url: string;
  sourceUrl?: string | null;
};

type JobsSummary = {
  slug: string;
  ok: boolean;
  status: number | null;
  error?: string;
};

type GapRow = {
  flightCode: string;
  launchName: string | null;
  launchDate: string | null;
  launchId: string | null;
  ll2LaunchUuid: string | null;
  reason: string;
};

type LaunchMaps = {
  byId: Map<string, LaunchCacheRow>;
  byLl2Uuid: Map<string, LaunchCacheRow>;
  byFlightCode: Map<string, LaunchCacheRow[]>;
};

type CrawledBlueOriginPage = {
  url: string;
  canonicalUrl: string;
  title: string | null;
  html: string;
  text: string;
  provenance: 'live' | 'wayback';
  archiveSnapshotUrl: string | null;
  fetchedAt: string;
};

type CrawlResult = {
  seedUrls: string[];
  discoveredUrls: string[];
  visitedUrls: string[];
  pages: CrawledBlueOriginPage[];
  errors: string[];
};

type PassengerDetail = {
  name: string;
  role: string | null;
  bioSnippet: string | null;
  sourceUrl: string;
};

type PayloadDetail = {
  name: string;
  payloadType: string | null;
  agency: string | null;
  description: string | null;
  sourceUrl: string;
};

type MissionFact = {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  context: string | null;
  sourceUrl: string;
};

type ExtractedEnhancements = {
  passengers: PassengerDetail[];
  payloads: PayloadDetail[];
  facts: MissionFact[];
  graphics: MissionGraphic[];
};

type BlueOriginConstraintBackfillResult = {
  rows: Array<Record<string, unknown>>;
  launchesEvaluated: number;
  launchesWithEnhancements: number;
  launchesWithoutEnhancements: number;
  launchesWithoutEnhancementsSample: Array<{
    launchId: string;
    launchName: string | null;
    flightCode: string | null;
    seedUrls: string[];
    discoveredUrls: number;
    visitedUrls: number;
  }>;
  audits: Array<{
    launchId: string;
    launchName: string | null;
    flightCode: string | null;
    seedUrls: string[];
    discoveredUrls: number;
    visitedUrls: number;
    pagesParsed: number;
    passengers: number;
    payloads: number;
    facts: number;
    graphics: number;
    errors: string[];
  }>;
};

const { values } = parseArgs({
  options: {
    skipJobs: { type: 'boolean' },
    jobs: { type: 'string' },
    timeoutSeconds: { type: 'string', default: String(DEFAULT_TIMEOUT_SECONDS) },
    maxLaunches: { type: 'string', default: String(DEFAULT_MAX_LAUNCHES) },
    maxPagesPerLaunch: { type: 'string', default: String(DEFAULT_MAX_PAGES_PER_LAUNCH) },
    minEnhancementCoverage: { type: 'string', default: String(DEFAULT_MIN_ENHANCEMENT_COVERAGE) },
    allowLowCoverage: { type: 'boolean' },
    dryRun: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  # Full Blue Origin launch-details backfill (jobs + constraints + gap report)
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \\
    scripts/blue-origin-launch-details-backfill.ts

Options:
  --skipJobs                 Skip invoking Blue Origin Edge ingest jobs
  --jobs <csv>               Override job chain (comma-separated function slugs)
  --timeoutSeconds <n>       Per-job invoke timeout (default: ${DEFAULT_TIMEOUT_SECONDS})
  --maxLaunches <n>          Max Blue Origin launch rows to scan (default: ${DEFAULT_MAX_LAUNCHES})
  --maxPagesPerLaunch <n>    Crawl page cap per launch (default: ${DEFAULT_MAX_PAGES_PER_LAUNCH})
  --minEnhancementCoverage <n>
                             Abort write if enhancement coverage ratio falls below n (default: ${DEFAULT_MIN_ENHANCEMENT_COVERAGE})
  --allowLowCoverage         Override low-coverage write abort safeguard
  --dryRun (alias: --dry-run) Compute/report only; do not write backfills

Environment:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const supabaseUrl = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const skipJobs = Boolean(values.skipJobs);
  const dryRun = Boolean(values.dryRun || values['dry-run']);
  const timeoutSeconds = clampInt(Number(values.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS), 15, 15 * 60);
  const maxLaunches = clampInt(Number(values.maxLaunches || DEFAULT_MAX_LAUNCHES), 1, 5000);
  const maxPagesPerLaunch = clampInt(Number(values.maxPagesPerLaunch || DEFAULT_MAX_PAGES_PER_LAUNCH), 1, 800);
  const minEnhancementCoverage = clampFloat(
    Number(values.minEnhancementCoverage || DEFAULT_MIN_ENHANCEMENT_COVERAGE),
    0,
    1
  );
  const allowLowCoverage = Boolean(values.allowLowCoverage);
  const requestedJobs = parseCsv(values.jobs);
  const jobs = requestedJobs.length ? requestedJobs : [...BLUE_ORIGIN_JOB_CHAIN];

  console.log('[blue-origin-launch-details-backfill] start');
  console.log(
    JSON.stringify(
      {
        skipJobs,
        dryRun,
        timeoutSeconds,
        maxLaunches,
        maxPagesPerLaunch,
        minEnhancementCoverage,
        allowLowCoverage,
        jobs
      },
      null,
      2
    )
  );

  const jobsSummary: JobsSummary[] = [];
  if (!skipJobs) {
    const jobsAuthToken = await fetchJobsAuthToken(supabase);
    for (const slug of jobs) {
      const result = await invokeEdgeJob(supabase, slug, jobsAuthToken, timeoutSeconds);
      jobsSummary.push(result);
      console.log(
        `[job:${slug}] ${result.ok ? 'ok' : 'error'} status=${result.status ?? 'unknown'}${
          result.error ? ` error=${result.error}` : ''
        }`
      );
    }
  }

  const launches = await fetchBlueOriginLaunches(supabase, maxLaunches);
  const launchMaps = buildLaunchMaps(launches);
  console.log(`[launches] scanned=${launches.length}`);

  const seededFlights = buildFlightRowsFromLaunches(launches);
  if (!dryRun && seededFlights.length) {
    await upsertInChunks(
      seededFlights,
      UPSERT_CHUNK_SIZE,
      async (chunk) =>
        supabase
          .from('blue_origin_flights')
          .upsert(chunk, { onConflict: 'flight_code' })
          .then((res) => ({ error: res.error }))
    );
  }
  console.log(`[flights] seeded=${seededFlights.length}${dryRun ? ' (dry-run)' : ''}`);

  const flightsBeforeResolution = await fetchBlueOriginFlights(supabase);
  const flightResolution = resolveFlightLaunchLinks(flightsBeforeResolution, launchMaps);
  if (!dryRun && flightResolution.updates.length) {
    await upsertInChunks(
      flightResolution.updates,
      UPSERT_CHUNK_SIZE,
      async (chunk) =>
        supabase
          .from('blue_origin_flights')
          .upsert(chunk, { onConflict: 'id' })
          .then((res) => ({ error: res.error }))
    );
  }
  console.log(
    `[flights] link updates=${flightResolution.updates.length} unresolved_after_resolver=${flightResolution.unresolved.length}${
      dryRun ? ' (dry-run)' : ''
    }`
  );

  const constraintBackfill = await buildBlueOriginConstraintRows(launches, maxPagesPerLaunch);
  const constraintRows = constraintBackfill.rows;
  const blueOriginLaunchIds = [...new Set(launches.map((launch) => String(launch.launch_id || '').trim()).filter(Boolean))];
  const enhancementCoverage =
    constraintBackfill.launchesEvaluated > 0
      ? constraintBackfill.launchesWithEnhancements / constraintBackfill.launchesEvaluated
      : 0;

  if (!dryRun && !allowLowCoverage && enhancementCoverage < minEnhancementCoverage) {
    throw new Error(
      `Enhancement coverage ${enhancementCoverage.toFixed(3)} below threshold ${minEnhancementCoverage.toFixed(
        3
      )}; aborting write to avoid replacing existing enrichment. Re-run with --allowLowCoverage to override.`
    );
  }

  if (!dryRun && constraintRows.length) {
    await upsertInChunks(
      constraintRows,
      UPSERT_CHUNK_SIZE,
      async (chunk) =>
        supabase
          .from('launch_trajectory_constraints')
          .upsert(chunk, { onConflict: 'launch_id,source,constraint_type,source_id' })
          .then((res) => ({ error: res.error }))
    );
  }

  console.log(
    `[constraints] prepared=${constraintRows.length} launches_evaluated=${constraintBackfill.launchesEvaluated} launches_with_enhancements=${constraintBackfill.launchesWithEnhancements} launches_without_enhancements=${constraintBackfill.launchesWithoutEnhancements}${
      dryRun ? ' (dry-run)' : ''
    }`
  );

  const flightsAfter = dryRun
    ? applyFlightUpdatesInMemory(flightsBeforeResolution, flightResolution.updates)
    : await fetchBlueOriginFlights(supabase);
  const gapRows = buildLaunchDetailGapRows(flightsAfter, launchMaps.byId);

  const report = {
    jobs: jobsSummary,
    launchesScanned: launches.length,
    flightRowsSeeded: seededFlights.length,
    flightRowsUpdated: flightResolution.updates.length,
    launchDetailConstraintsPrepared: constraintRows.length,
    launchesEvaluatedForEnhancements: constraintBackfill.launchesEvaluated,
    launchesWithEnhancements: constraintBackfill.launchesWithEnhancements,
    launchesWithoutEnhancements: constraintBackfill.launchesWithoutEnhancements,
    launchesWithoutEnhancementsSample: constraintBackfill.launchesWithoutEnhancementsSample,
    launchEnhancementAudits: constraintBackfill.audits,
    unresolvedLaunchDetailCount: gapRows.length,
    unresolvedLaunchDetails: gapRows
  };

  console.log('[blue-origin-launch-details-backfill] report');
  console.log(JSON.stringify(report, null, 2));
}

async function fetchJobsAuthToken(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', 'jobs_auth_token').maybeSingle();
  if (error) throw new Error(`Failed to read system_settings.jobs_auth_token (${error.message})`);
  const raw = asString((data as { value?: unknown } | null)?.value);
  const token = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)[0];
  if (!token) throw new Error('system_settings.jobs_auth_token is empty');
  return token;
}

async function invokeEdgeJob(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  jobsAuthToken: string,
  timeoutSeconds: number
): Promise<JobsSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const res = await supabase.functions.invoke(slug, {
      method: 'POST',
      body: {},
      headers: {
        'x-job-token': jobsAuthToken
      },
      signal: controller.signal
    });

    const status = (res as any)?.response?.status ?? null;
    if (res.error) {
      return {
        slug,
        ok: false,
        status,
        error: res.error.message
      };
    }

    const payload = res.data as any;
    const ok = typeof payload?.ok === 'boolean' ? payload.ok : true;
    const error = typeof payload?.error === 'string' ? payload.error : undefined;
    return { slug, ok, status, error };
  } catch (error) {
    return {
      slug,
      ok: false,
      status: null,
      error: stringifyError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBlueOriginLaunches(supabase: ReturnType<typeof createClient>, maxLaunches: number) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id,ll2_launch_uuid,name,mission_name,mission_description,fail_reason,net,provider,launch_info_urls,mission_info_urls'
      )
    .or(BLUE_ORIGIN_OR_FILTER)
    .order('net', { ascending: false })
    .limit(maxLaunches);

  if (error) throw new Error(`Failed to fetch launches_public_cache rows (${error.message})`);
  return (data || []) as LaunchCacheRow[];
}

async function fetchBlueOriginFlights(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('blue_origin_flights')
    .select(
      'id,flight_code,mission_key,launch_id,ll2_launch_uuid,launch_name,launch_date,status,official_mission_url,source,confidence,metadata'
    )
    .order('launch_date', { ascending: false, nullsFirst: false })
    .limit(2000);

  if (error) throw new Error(`Failed to fetch blue_origin_flights rows (${error.message})`);
  return (data || []) as BlueOriginFlightRow[];
}

function buildLaunchMaps(launches: LaunchCacheRow[]): LaunchMaps {
  const byId = new Map<string, LaunchCacheRow>();
  const byLl2Uuid = new Map<string, LaunchCacheRow>();
  const byFlightCode = new Map<string, LaunchCacheRow[]>();

  for (const launch of launches) {
    if (launch.launch_id) byId.set(launch.launch_id, launch);
    const ll2Uuid = String(launch.ll2_launch_uuid || '').trim();
    if (ll2Uuid) byLl2Uuid.set(ll2Uuid, launch);

    const flightCode = extractFlightCodeFromLaunch(launch);
    if (!flightCode) continue;
    const bucket = byFlightCode.get(flightCode) || [];
    bucket.push(launch);
    byFlightCode.set(flightCode, bucket);
  }

  for (const rows of byFlightCode.values()) {
    rows.sort((left, right) => (Date.parse(left.net || '') || 0) - (Date.parse(right.net || '') || 0));
  }

  return { byId, byLl2Uuid, byFlightCode };
}

function buildFlightRowsFromLaunches(launches: LaunchCacheRow[]) {
  const nowIso = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];

  for (const launch of launches) {
    const flightCode = extractFlightCodeFromLaunch(launch);
    if (!flightCode) continue;

    const missionKey = classifyBlueOriginMissionKey(launch, flightCode);
    const missionUrl = resolveBlueOriginMissionSourceUrl(launch, flightCode);
    rows.push({
      flight_code: flightCode,
      mission_key: missionKey,
      launch_id: launch.launch_id,
      ll2_launch_uuid: launch.ll2_launch_uuid || null,
      launch_name: launch.name || launch.mission_name || null,
      launch_date: launch.net,
      status: deriveFlightStatus(launch.net),
      official_mission_url: missionUrl,
      source: 'script:blue-origin-launch-details-backfill',
      confidence: 'high',
      metadata: {
        provider: launch.provider || null,
        launchName: launch.name || null,
        missionName: launch.mission_name || null
      },
      updated_at: nowIso
    });
  }

  return dedupeBy(rows, (row) => String(row.flight_code || ''));
}

function resolveFlightLaunchLinks(flights: BlueOriginFlightRow[], launchMaps: LaunchMaps) {
  const nowIso = new Date().toISOString();
  const updates: Array<Record<string, unknown>> = [];
  const unresolved: GapRow[] = [];

  for (const flight of flights) {
    const existingLaunch =
      (flight.launch_id ? launchMaps.byId.get(flight.launch_id) : null) ||
      (flight.ll2_launch_uuid ? launchMaps.byLl2Uuid.get(flight.ll2_launch_uuid) : null);
    const resolvedLaunch =
      existingLaunch || resolveLaunchByFlightCode(launchMaps.byFlightCode.get(flight.flight_code) || [], flight.launch_date);

    if (!resolvedLaunch?.launch_id) {
      unresolved.push({
        flightCode: flight.flight_code,
        launchName: flight.launch_name || null,
        launchDate: flight.launch_date || null,
        launchId: flight.launch_id,
        ll2LaunchUuid: flight.ll2_launch_uuid,
        reason: flight.launch_id ? 'launch_id_not_found_in_cache' : 'no_launch_id'
      });
      continue;
    }

    const resolvedMissionUrl = resolveBlueOriginMissionSourceUrl(resolvedLaunch, flight.flight_code);
    const shouldUpdateLaunchId = flight.launch_id !== resolvedLaunch.launch_id;
    const shouldUpdateLl2 = !flight.ll2_launch_uuid && !!resolvedLaunch.ll2_launch_uuid;
    const shouldUpdateLaunchName = !flight.launch_name && !!(resolvedLaunch.name || resolvedLaunch.mission_name);
    const shouldUpdateLaunchDate = !flight.launch_date && !!resolvedLaunch.net;
    const shouldUpdateOfficial = !flight.official_mission_url && !!resolvedMissionUrl;

    if (!shouldUpdateLaunchId && !shouldUpdateLl2 && !shouldUpdateLaunchName && !shouldUpdateLaunchDate && !shouldUpdateOfficial) {
      continue;
    }

    updates.push({
      id: flight.id,
      launch_id: resolvedLaunch.launch_id,
      ll2_launch_uuid: flight.ll2_launch_uuid || resolvedLaunch.ll2_launch_uuid || null,
      launch_name: flight.launch_name || resolvedLaunch.name || resolvedLaunch.mission_name || null,
      launch_date: flight.launch_date || resolvedLaunch.net || null,
      official_mission_url: flight.official_mission_url || resolvedMissionUrl || null,
      updated_at: nowIso
    });
  }

  return { updates, unresolved };
}

function applyFlightUpdatesInMemory(flights: BlueOriginFlightRow[], updates: Array<Record<string, unknown>>) {
  if (!updates.length) return flights;
  const byId = new Map(updates.map((row) => [String(row.id || ''), row]));
  return flights.map((flight) => {
    const update = byId.get(flight.id);
    if (!update) return flight;
    return {
      ...flight,
      launch_id: (update.launch_id as string | null) ?? flight.launch_id,
      ll2_launch_uuid: (update.ll2_launch_uuid as string | null) ?? flight.ll2_launch_uuid,
      launch_name: (update.launch_name as string | null) ?? flight.launch_name,
      launch_date: (update.launch_date as string | null) ?? flight.launch_date,
      official_mission_url: (update.official_mission_url as string | null) ?? flight.official_mission_url
    };
  });
}

function buildLaunchDetailGapRows(flights: BlueOriginFlightRow[], launchById: Map<string, LaunchCacheRow>) {
  const gaps: GapRow[] = [];
  for (const flight of flights) {
    const launchId = String(flight.launch_id || '').trim();
    if (!launchId) {
      gaps.push({
        flightCode: flight.flight_code,
        launchName: flight.launch_name || null,
        launchDate: flight.launch_date || null,
        launchId: null,
        ll2LaunchUuid: flight.ll2_launch_uuid,
        reason: 'no_launch_id'
      });
      continue;
    }
    if (!launchById.has(launchId)) {
      gaps.push({
        flightCode: flight.flight_code,
        launchName: flight.launch_name || null,
        launchDate: flight.launch_date || null,
        launchId,
        ll2LaunchUuid: flight.ll2_launch_uuid,
        reason: 'launch_id_not_found_in_launches_public_cache'
      });
    }
  }
  return gaps.sort((left, right) => {
    const leftMs = Date.parse(left.launchDate || '') || 0;
    const rightMs = Date.parse(right.launchDate || '') || 0;
    if (leftMs !== rightMs) return rightMs - leftMs;
    return left.flightCode.localeCompare(right.flightCode);
  });
}

async function buildBlueOriginConstraintRows(
  launches: LaunchCacheRow[],
  maxPagesPerLaunch: number
): Promise<BlueOriginConstraintBackfillResult> {
  const nowIso = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  const audits: BlueOriginConstraintBackfillResult['audits'] = [];
  const launchesWithoutEnhancements: BlueOriginConstraintBackfillResult['launchesWithoutEnhancementsSample'] = [];

  const launchInputs = launches.filter((launch) => Boolean(launch.launch_id));

  const results = await mapWithConcurrency(launchInputs, CRAWL_CONCURRENCY, async (launch) => {
    const flightCode = extractFlightCodeFromLaunch(launch);
    const seedUrls = buildBlueOriginMissionSourceCandidates(launch, flightCode || null);
    const crawl = await crawlBlueOriginLaunchPages(seedUrls, maxPagesPerLaunch);
    const extracted = extractBlueOriginEnhancementsFromPages(crawl.pages, flightCode || null);

    return {
      launch,
      flightCode,
      seedUrls,
      crawl,
      extracted
    };
  });

  for (const result of results) {
    const { launch, flightCode, seedUrls, crawl, extracted } = result;
    if (!launch.launch_id) continue;

    const launchId = launch.launch_id;
    const enhancementKey = flightCode || launchId;
    const missionFacts = mergeMissionFactsWithLaunchContext(extracted.facts, launch);

    rows.push({
      launch_id: launchId,
      source: BLUE_ORIGIN_MULTISOURCE,
      source_id: `${enhancementKey}:sources:v1`,
      constraint_type: 'bo_official_sources',
      confidence: crawl.pages.length > 0 ? 0.9 : 0.55,
      data: {
        flightCode: flightCode || null,
        launchName: launch.name || launch.mission_name || null,
        primaryLaunchUrl: seedUrls[0] || null,
        seedUrls,
        discoveredUrls: crawl.discoveredUrls,
        visitedUrls: crawl.visitedUrls,
        sourcePages: crawl.pages.map((page) => ({
          url: page.url,
          canonicalUrl: page.canonicalUrl,
          title: page.title,
          provenance: page.provenance,
          archiveSnapshotUrl: page.archiveSnapshotUrl,
          fetchedAt: page.fetchedAt
        })),
        crawlStats: {
          pagesFetched: crawl.visitedUrls.length,
          pagesParsed: crawl.pages.length,
          errors: crawl.errors
        }
      },
      fetched_at: nowIso
    });

    if (extracted.passengers.length > 0) {
      rows.push({
        launch_id: launchId,
        source: BLUE_ORIGIN_MULTISOURCE,
        source_id: `${enhancementKey}:passengers:v1`,
        constraint_type: 'bo_manifest_passengers',
        confidence: 0.9,
        data: {
          flightCode: flightCode || null,
          passengers: extracted.passengers,
          ll2MergePolicy: {
            preserveLl2: true,
            officialWinsWhenRicher: true,
            deDupMode: 'name_role'
          }
        },
        fetched_at: nowIso
      });
    }

    if (extracted.payloads.length > 0) {
      rows.push({
        launch_id: launchId,
        source: BLUE_ORIGIN_MULTISOURCE,
        source_id: `${enhancementKey}:payloads:v1`,
        constraint_type: 'bo_manifest_payloads',
        confidence: 0.86,
        data: {
          flightCode: flightCode || null,
          payloads: extracted.payloads,
          ll2MergePolicy: {
            preserveLl2: true,
            officialWinsWhenRicher: true,
            deDupMode: 'name_type'
          }
        },
        fetched_at: nowIso
      });
    }

    if (missionFacts.length > 0) {
      rows.push({
        launch_id: launchId,
        source: BLUE_ORIGIN_MULTISOURCE,
        source_id: `${enhancementKey}:facts:v1`,
        constraint_type: 'bo_mission_facts',
        confidence: 0.84,
        data: {
          flightCode: flightCode || null,
          facts: missionFacts
        },
        fetched_at: nowIso
      });
    }

    if (extracted.graphics.length > 0) {
      const missionUrl =
        crawl.pages.find((page) => page.canonicalUrl.includes('/missions/') || page.canonicalUrl.includes('/news/'))
          ?.canonicalUrl || seedUrls[0] || null;
      const archiveSnapshotUrl = crawl.pages.find((page) => page.archiveSnapshotUrl)?.archiveSnapshotUrl || null;
      const inferredFromWayback = crawl.pages.length > 0 && crawl.pages.every((page) => page.provenance === 'wayback');

      rows.push({
        launch_id: launchId,
        source: BLUE_ORIGIN_INFOGRAPHIC_SOURCE,
        source_id: buildMissionGraphicSourceId(flightCode || null, missionUrl || launchId),
        constraint_type: 'mission_infographic',
        confidence: inferredFromWayback ? 0.82 : 0.95,
        data: {
          flightCode: flightCode || null,
          missionUrl,
          archiveSnapshotUrl,
          fetchedFrom: inferredFromWayback ? 'wayback' : 'live',
          graphics: extracted.graphics
        },
        fetched_at: nowIso
      });
    }

    const hasEnhancement =
      extracted.passengers.length > 0 ||
      extracted.payloads.length > 0 ||
      missionFacts.length > 0 ||
      extracted.graphics.length > 0;

    if (!hasEnhancement) {
      launchesWithoutEnhancements.push({
        launchId,
        launchName: launch.name || launch.mission_name || null,
        flightCode: flightCode || null,
        seedUrls,
        discoveredUrls: crawl.discoveredUrls.length,
        visitedUrls: crawl.visitedUrls.length
      });
    }

    audits.push({
      launchId,
      launchName: launch.name || launch.mission_name || null,
      flightCode: flightCode || null,
      seedUrls,
      discoveredUrls: crawl.discoveredUrls.length,
      visitedUrls: crawl.visitedUrls.length,
      pagesParsed: crawl.pages.length,
      passengers: extracted.passengers.length,
      payloads: extracted.payloads.length,
      facts: missionFacts.length,
      graphics: extracted.graphics.length,
      errors: crawl.errors
    });
  }

  const dedupedRows = dedupeBy(rows, (row) =>
    [row.launch_id, row.source, row.constraint_type, row.source_id].map((part) => String(part || '')).join(':')
  );

  const launchesWithEnhancements = audits.filter(
    (audit) => audit.passengers > 0 || audit.payloads > 0 || audit.facts > 0 || audit.graphics > 0
  ).length;

  return {
    rows: dedupedRows,
    launchesEvaluated: launchInputs.length,
    launchesWithEnhancements,
    launchesWithoutEnhancements: Math.max(0, launchInputs.length - launchesWithEnhancements),
    launchesWithoutEnhancementsSample: launchesWithoutEnhancements.slice(0, 25),
    audits
  };
}

async function crawlBlueOriginLaunchPages(seedUrls: string[], maxPagesPerLaunch: number): Promise<CrawlResult> {
  const normalizedSeeds = dedupeBy(seedUrls, (url) => normalizeBlueOriginCrawlUrl(url) || '')
    .map((url) => normalizeBlueOriginCrawlUrl(url))
    .filter((url): url is string => Boolean(url));

  const queue = [...normalizedSeeds];
  const discovered = new Set<string>(normalizedSeeds);
  const visited = new Set<string>();
  const pages: CrawledBlueOriginPage[] = [];
  const errors: string[] = [];

  while (queue.length > 0 && visited.size < maxPagesPerLaunch) {
    const url = queue.shift() as string;
    if (!url || visited.has(url)) continue;
    visited.add(url);

    const fetched = await fetchBlueOriginPageWithArchiveFallback(url);
    if (!fetched) {
      errors.push(`${url}:fetch_failed`);
      continue;
    }

    pages.push(fetched);

    const linkCacheKey = normalizeBlueOriginCrawlUrl(fetched.canonicalUrl) || normalizeBlueOriginCrawlUrl(fetched.url) || fetched.url;
    let links = BLUE_ORIGIN_PAGE_LINK_CACHE.get(linkCacheKey);
    if (!links) {
      links = extractBlueOriginReadMoreLinks(fetched.html, fetched.canonicalUrl).slice(0, CRAWL_LINKS_PER_PAGE_LIMIT);
      BLUE_ORIGIN_PAGE_LINK_CACHE.set(linkCacheKey, links);
    }

    for (const link of links) {
      if (discovered.has(link)) continue;
      discovered.add(link);
      if (visited.size + queue.length >= maxPagesPerLaunch) continue;
      queue.push(link);
    }
  }

  return {
    seedUrls: normalizedSeeds,
    discoveredUrls: [...discovered],
    visitedUrls: [...visited],
    pages,
    errors
  };
}

async function fetchBlueOriginPageWithArchiveFallback(url: string): Promise<CrawledBlueOriginPage | null> {
  const normalizedUrl = normalizeBlueOriginCrawlUrl(url);
  if (!normalizedUrl) return null;

  const cachedPromise = BLUE_ORIGIN_PAGE_FETCH_CACHE.get(normalizedUrl);
  if (cachedPromise) {
    try {
      const cached = await cachedPromise;
      if (!cached) return null;
      return { ...cached };
    } catch {
      BLUE_ORIGIN_PAGE_FETCH_CACHE.delete(normalizedUrl);
    }
  }

  const fetchPromise = (async () => {
    const live = await fetchBlueOriginLiveHtml(normalizedUrl);
    if (live?.html) {
      return {
        url: normalizedUrl,
        canonicalUrl: normalizeBlueOriginCrawlUrl(extractCanonicalUrlFromHtml(live.html, normalizedUrl)) || normalizedUrl,
        title: extractHtmlTitle(live.html),
        html: live.html,
        text: extractMainText(live.html),
        provenance: 'live' as const,
        archiveSnapshotUrl: null,
        fetchedAt: new Date().toISOString()
      };
    }

    const snapshot = await fetchWaybackSnapshotHtml(normalizedUrl);
    if (!snapshot) return null;

    return {
      url: normalizedUrl,
      canonicalUrl: normalizeBlueOriginCrawlUrl(extractCanonicalUrlFromHtml(snapshot.html, normalizedUrl)) || normalizedUrl,
      title: extractHtmlTitle(snapshot.html),
      html: snapshot.html,
      text: extractMainText(snapshot.html),
      provenance: 'wayback' as const,
      archiveSnapshotUrl: snapshot.snapshotUrl,
      fetchedAt: new Date().toISOString()
    };
  })();

  BLUE_ORIGIN_PAGE_FETCH_CACHE.set(normalizedUrl, fetchPromise);
  try {
    const fetched = await fetchPromise;
    if (!fetched) {
      BLUE_ORIGIN_PAGE_FETCH_CACHE.delete(normalizedUrl);
      return null;
    }
    return { ...fetched };
  } catch {
    BLUE_ORIGIN_PAGE_FETCH_CACHE.delete(normalizedUrl);
    return null;
  }
}

async function fetchBlueOriginLiveHtml(url: string) {
  try {
    const response = await fetchWithTimeout(url, {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (!html.trim()) return null;
    if (looksLikeChallenge(response.status, html)) return null;
    return { html };
  } catch {
    return null;
  }
}

async function fetchWaybackSnapshotHtml(url: string) {
  const direct = await fetchWaybackDirectSnapshot(url);
  if (direct) return direct;

  const available = await fetchWaybackAvailableSnapshot(url);
  if (available) return available;

  return fetchWaybackCdxSnapshot(url);
}

async function fetchWaybackDirectSnapshot(url: string) {
  const directUrl = `${BLUE_ORIGIN_WAYBACK_DIRECT_PREFIX}${encodeURIComponent(url)}`;

  try {
    const response = await fetchWithTimeout(directUrl, {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!response.ok) return null;
    const snapshotUrl = extractWaybackSnapshotUrlFromResponse(response.url);
    if (!snapshotUrl) return null;
    const html = await response.text();
    if (!html.trim()) return null;
    return { snapshotUrl, html };
  } catch {
    return null;
  }
}

async function fetchWaybackAvailableSnapshot(url: string) {
  const waybackAvailableUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;

  try {
    const response = await fetchWithTimeout(waybackAvailableUrl, {
      accept: 'application/json',
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!response.ok) return null;

    const payload = (await response.json().catch(() => null)) as unknown;
    const snapshotUrl = readWaybackAvailableSnapshot(payload);
    if (!snapshotUrl) return null;

    const snapshotResponse = await fetchWithTimeout(snapshotUrl, {
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!snapshotResponse.ok) return null;

    const html = await snapshotResponse.text();
    if (!html.trim()) return null;
    return { snapshotUrl, html };
  } catch {
    return null;
  }
}

async function fetchWaybackCdxSnapshot(url: string) {
  const cached = WAYBACK_CDX_CACHE.get(url);
  const now = Date.now();
  if (cached && cached.timestamp && now - cached.at < 12 * 60 * 60 * 1000) {
    const cachedSnapshot = `https://web.archive.org/web/${cached.timestamp}id_/${url}`;
    const cachedResponse = await fetchWithTimeout(cachedSnapshot, {
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (cachedResponse.ok) {
      const html = await cachedResponse.text();
      if (html.trim()) {
        return { snapshotUrl: cachedSnapshot, html };
      }
    }
  }

  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    url
  )}&output=json&fl=timestamp,original,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&limit=20`;

  try {
    const cdxResponse = await fetchWithTimeout(cdxUrl, {
      accept: 'application/json',
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!cdxResponse.ok) return null;

    const payload = (await cdxResponse.json().catch(() => null)) as unknown;
    const latestTimestamp = extractLatestWaybackTimestamp(payload);
    if (cached && !latestTimestamp) {
      WAYBACK_CDX_CACHE.delete(url);
    }
    WAYBACK_CDX_CACHE.set(url, { timestamp: latestTimestamp, at: now });
    if (!latestTimestamp) return null;

    const snapshotUrl = `https://web.archive.org/web/${latestTimestamp}id_/${url}`;
    const snapshotResponse = await fetchWithTimeout(snapshotUrl, {
      'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
    });
    if (!snapshotResponse.ok) return null;
    const html = await snapshotResponse.text();
    if (!html.trim()) return null;
    return { snapshotUrl, html };
  } catch {
    return null;
  }
}

function extractWaybackSnapshotUrlFromResponse(responseUrl: string) {
  const waybackMatch = responseUrl.match(/\/web\/(\d{14}(?:id_)?)\/(https?:\/\/.+)$/);
  if (!waybackMatch) return null;

  const timestamp = waybackMatch[1];
  const requestedUrl = decodeURIComponent(waybackMatch[2] || '');
  if (!/^\d{14}(?:id_)?$/.test(timestamp) || !requestedUrl) return null;
  return `https://web.archive.org/web/${timestamp}/${requestedUrl}`;
}

function readWaybackAvailableSnapshot(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const normalizedPayload = payload as { archived_snapshots?: { closest?: { available?: boolean; status?: string; url?: string } } };
  const maybeClosest =
    normalizedPayload.archived_snapshots?.closest || null;

  const normalizedStatus = normalizeOptionalText(maybeClosest?.status);
  const normalizedAvailable =
    typeof maybeClosest?.available === 'boolean'
      ? maybeClosest.available
      : typeof maybeClosest?.available === 'string'
        ? ['true', '1'].includes(maybeClosest.available.toLowerCase())
        : null;

  const statusCode = Number.parseInt(normalizedStatus || '', 10);
  const isAvailable =
    normalizedAvailable === true ||
    (Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 400 && normalizedAvailable !== false);
  if (!isAvailable) return null;

  const closestUrl = normalizeOptionalText(maybeClosest?.url);
  if (closestUrl) return closestUrl;
  return null;
}

function extractLatestWaybackTimestamp(payload: unknown) {
  if (!Array.isArray(payload) || payload.length <= 1) return null;
  let latest: string | null = null;
  for (let index = 1; index < payload.length; index += 1) {
    const row = payload[index];
    if (!Array.isArray(row)) continue;
    const timestamp = String(row[0] || '').trim();
    if (!/^\d{8,14}$/.test(timestamp)) continue;
    if (!latest || timestamp > latest) latest = timestamp;
  }
  return latest;
}

function extractBlueOriginEnhancementsFromPages(
  pages: CrawledBlueOriginPage[],
  flightCode: string | null
): ExtractedEnhancements {
  const passengers = new Map<string, PassengerDetail>();
  const payloads = new Map<string, PayloadDetail>();
  const facts = new Map<string, MissionFact>();
  const graphics = new Map<string, MissionGraphic>();

  for (const page of pages) {
    const title = extractHtmlTitle(page.html) || '';
    const description = readMetaContentByName(page.html, 'description') || readMetaContentByProperty(page.html, 'og:description') || '';
    const text = page.text || '';

    const crewNames = dedupeStrings([
      ...extractCrewNamesFromProfileLinks(page.html),
      ...extractCrewNamesFromMainHtml(page.html),
      ...extractCrewNamesFromText(description),
      ...extractCrewNamesFromText(text)
    ]);

    for (const name of crewNames) {
      if (!isLikelyBlueOriginCrewName(name)) continue;
      const key = normalizeNameKey(name);
      if (!key) continue;
      const existing = passengers.get(key);
      const next: PassengerDetail = {
        name,
        role: 'Passenger',
        bioSnippet: null,
        sourceUrl: page.canonicalUrl
      };
      if (!existing) {
        passengers.set(key, next);
      }
    }

    const payloadCandidates = extractPayloadCandidates({ title, description, text });
    for (const payload of payloadCandidates) {
      const key = normalizeNameKey(payload.name);
      if (!key) continue;
      const existing = payloads.get(key);
      if (!existing) {
        payloads.set(key, {
          ...payload,
          sourceUrl: page.canonicalUrl
        });
      } else {
        if (!existing.description && payload.description) existing.description = payload.description;
        if (!existing.payloadType && payload.payloadType) existing.payloadType = payload.payloadType;
        if (!existing.agency && payload.agency) existing.agency = payload.agency;
      }
    }

    const factCandidates = extractMissionFacts({ title, description, text, flightCode: flightCode || '' });
    for (const fact of factCandidates) {
      const key = `${fact.key}:${fact.value.toLowerCase()}`;
      if (facts.has(key)) continue;
      facts.set(key, {
        ...fact,
        sourceUrl: page.canonicalUrl
      });
    }

    for (const graphic of extractBlueOriginMissionGraphicsFromHtml(page.html, flightCode || '')) {
      const key = normalizeComparableUrl(graphic.url) || graphic.url;
      if (graphics.has(key)) continue;
      graphics.set(key, {
        ...graphic,
        sourceUrl: page.canonicalUrl
      });
    }
  }

  return {
    passengers: [...passengers.values()].sort((left, right) => left.name.localeCompare(right.name)),
    payloads: [...payloads.values()].sort((left, right) => left.name.localeCompare(right.name)),
    facts: [...facts.values()].sort((left, right) => left.label.localeCompare(right.label)),
    graphics: sortBlueOriginMissionGraphics([...graphics.values()])
  };
}

function extractPayloadCandidates({ title, description, text }: { title: string; description: string; text: string }) {
  const candidates: PayloadDetail[] = [];
  const corpus = `${title}\n${description}\n${text}`;
  const payloadLines = extractLabeledTextBlock(corpus, /payloads?/i, /(?:\n\s*(?:key mission statistics|mission statistics|crew|manifest|mission profile|mission facts)\b|$)/i);
  const sectionCorpus = `${payloadLines}\n${corpus}`;

  const payloadSentencePatterns = [
    /payloads?\s+(?:include|included|carried|featured|comprised|were|are)\s+([^.\n]{8,600})/gi,
    /(?:carried|carrying|included)\s+([^.\n]{8,240})(?:\s+payloads?)?/gi,
    /(?:payload|mission payload)\s+(?:includes?|included|were|was|in)\s+([^.\n]{8,260})/gi,
    /(?:from|by)\s+([^.\n]+?)\s+flew\s+(?:on|onboard|as)\s+this\s+mission/gi
  ];

  for (const payloadSentencePattern of payloadSentencePatterns) {
    for (const match of sectionCorpus.matchAll(payloadSentencePattern)) {
      const segment = normalizeOptionalText(match[1]);
      if (!segment) continue;
      const names = splitEntityList(segment);
      for (const name of names) {
        const cleaned = sanitizePayloadName(name);
        if (!cleaned) continue;
        if (!isLikelyBlueOriginPayloadName(cleaned)) continue;
        candidates.push({
          name: cleaned,
          payloadType: inferPayloadType(cleaned),
          agency: inferAgency(cleaned),
          description: null,
          sourceUrl: ''
        });
      }
    }
  }

  const payloadCountMatch =
    sectionCorpus.match(/(?:launched|launched|carried|carrying)\s+(\d{1,4})\s+payloads?/i) ||
    sectionCorpus.match(/(\d{1,4})\s+payloads?\s+(?:were|was)?\s+carried/i);
  if (payloadCountMatch?.[1]) {
    const payloadCount = Number(payloadCountMatch[1] || '');
    if (Number.isFinite(payloadCount) && payloadCount > 0) {
      candidates.push({
        name: `Mission payload count: ${payloadCount}`,
        payloadType: 'Experiment',
        agency: null,
        description: null,
        sourceUrl: ''
      });
    }
  }

  const sectionBullets = extractLabeledBlockLines(payloadLines || corpus, 'payload');
  for (const bullet of sectionBullets) {
    const cleaned = sanitizePayloadName(bullet);
    if (!cleaned) continue;
    if (!isLikelyBlueOriginPayloadName(cleaned)) continue;
    candidates.push({
      name: cleaned,
      payloadType: inferPayloadType(cleaned),
      agency: inferAgency(cleaned),
      description: null,
      sourceUrl: ''
    });
  }

    const knownPayloadBlock = extractMissionPayloadSummary(corpus);
    if (knownPayloadBlock?.payloadType) {
      if (isLikelyBlueOriginPayloadName(knownPayloadBlock.name)) {
        candidates.push(knownPayloadBlock);
      }
    }

  const missionDescriptionPayloadPattern = /(payload mission|lunar gravity|microgravity|science payload)/i;
  if (missionDescriptionPayloadPattern.test(corpus) && candidates.length === 0) {
    const syntheticName = inferPayloadMissionSyntheticName(corpus);
    if (syntheticName) {
      candidates.push({
        name: syntheticName,
        payloadType: 'Experiment',
        agency: null,
        description: null,
        sourceUrl: ''
      });
    }
  }

  return dedupeBy(candidates, (value) => normalizeNameKey(value.name) || '').filter((value) => Boolean(value.name));
}

function extractMissionPayloadSummary(text: string) {
  const payloadMatch = text.match(/mission\s+(?:carried|included|carried\s+approximately)\s+([0-9]{1,4})\s+payloads?/i);
  if (!payloadMatch?.[1]) return null;
  const payloadCount = Number(payloadMatch[1] || '');
  if (!Number.isFinite(payloadCount) || payloadCount <= 0) return null;
  return {
    name: `${payloadCount} Mission Payload${payloadCount === 1 ? '' : 's'}`,
    payloadType: 'Experiment' as const,
    agency: null,
    description: null,
    sourceUrl: ''
  };
}

function extractMissionSummaryFromCorpus({
  title,
  description,
  text
}: {
  title: string;
  description: string;
  text: string;
}) {
  const corpus = `${title}\n${description}\n${text}`;
  const stopPattern =
    /(?:\n\s*(?:passengers?|crew|manifest|mission profile|mission facts|key mission statistics|mission statistics|launch statistics|gallery|related)\b|$)/i;

  for (const pattern of BLUE_ORIGIN_MISSION_SUMMARY_SECTION_PATTERNS) {
    const block = extractLabeledTextBlock(corpus, pattern, stopPattern);
    const normalized = normalizeMissionSummaryText(block);
    if (normalized) return normalized;
  }

  const labeledOverview = extractLabeledTextBlock(corpus, /(?:launch overview|mission overview|overview)/i, stopPattern);
  const normalizedOverview = normalizeMissionSummaryText(labeledOverview);
  if (normalizedOverview) return normalizedOverview;

  const descriptionSummary = normalizeMissionSummaryText(description);
  if (descriptionSummary) return descriptionSummary;

  const firstSentences = extractMissionFactsBySentences(text);
  return firstSentences;
}

function mergeMissionFactsWithLaunchContext(facts: MissionFact[], launch: LaunchCacheRow) {
  const merged = [...facts];
  const hasMissionSummary = merged.some((fact) => fact.key === BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY);
  const hasFailureReason = merged.some((fact) => fact.key === BLUE_ORIGIN_FAILURE_REASON_FACT_KEY);

  const launchSummary = normalizeMissionSummaryText(launch.mission_description);
  if (!hasMissionSummary && launchSummary) {
    merged.push({
      key: BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY,
      label: 'Mission Summary',
      value: launchSummary,
      unit: null,
      context: 'Blue Origin mission cache',
      sourceUrl: ''
    });
  }

  const launchFailure = normalizeMissionFailureText(launch.fail_reason);
  if (!hasFailureReason && launchFailure) {
    merged.push({
      key: BLUE_ORIGIN_FAILURE_REASON_FACT_KEY,
      label: 'Failure Reason',
      value: launchFailure,
      unit: null,
      context: 'Blue Origin mission cache',
      sourceUrl: ''
    });
  }

  return merged;
}

function extractFailureReasonFromCorpus({
  title,
  description,
  text
}: {
  title: string;
  description: string;
  text: string;
}) {
  const corpus = `${title}\n${description}\n${text}`;
  const normalizedCorpus = normalizeOptionalText(corpus);
  if (!normalizedCorpus) return null;

  const explicitFailureSection = extractLabeledTextBlock(
    normalizedCorpus,
    /(?:failure reason|failure|scrub|scrubbed|abort|anomaly)/i,
    /(?:\n\s*(?:manifest|crew|passengers?|payloads?|mission profile|mission statistics|mission facts|gallery|related)\b|$)/i
  );
  const explicitFailure = extractMissionFailureText(explicitFailureSection);
  if (explicitFailure) return explicitFailure;

  const sentencePatterns = [
    /(?:mission|launch)\s+was\s+(?:scrubbed|scrub|aborted|termination|terminated|called\s+off|cancelled|canceled)\b[^.]{0,240}\./i,
    /failure\s*(?:reason)?\s*:?\s*([^.]{12,280})/i,
    /\bdue\s+to\s+[^.]{12,280}\b/i
  ];

  for (const pattern of sentencePatterns) {
    const match = normalizedCorpus.match(pattern);
    if (!match) continue;
    const reason = normalizeMissionFailureText(match[0] || '');
    if (reason && BLUE_ORIGIN_FAILURE_KEYWORDS.test(reason)) return reason;
  }

  return null;
}

function normalizeMissionSummaryText(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (compact.length < 40) return null;
  if (compact.length <= 380) return compact;
  return compact.slice(0, 380).trim();
}

function extractMissionFactsBySentences(corpus: string) {
  const normalizedCorpus = normalizeOptionalText(corpus);
  if (!normalizedCorpus) return null;
  const sentenceMatches = normalizedCorpus.match(/[^.!?]+[.!?]/g) || [];
  for (const sentence of sentenceMatches) {
    const normalizedSentence = normalizeMissionSummaryText(sentence);
    if (!normalizedSentence) continue;
    if (normalizedSentence.length >= 50 && /mission/i.test(normalizedSentence)) return normalizedSentence;
  }
  return null;
}

function extractMissionFailureText(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (!BLUE_ORIGIN_FAILURE_KEYWORDS.test(compact)) return null;
  if (compact.length <= 320) return compact;
  return compact.slice(0, 320).trim();
}

function normalizeMissionFailureText(value: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (compact.length < 18) return null;
  if (compact.length <= 320) return compact;
  return compact.slice(0, 320).trim();
}

function extractMissionFacts({
  title,
  description,
  text,
  flightCode
}: {
  title: string;
  description: string;
  text: string;
  flightCode: string;
}) {
  const corpus = `${title}\n${description}\n${text}`;
  const facts: MissionFact[] = [];
  const seen = new Set<string>();
  const statSection = extractLabeledTextBlock(corpus, /(?:key mission statistics|mission statistics)/i, /(?:\n\s*(?:key mission statistics|mission statistics|crew|passengers|manifest|mission profile|mission facts|gallery|related)\b|$)/i);

  const addFact = (fact: MissionFact) => {
    if (!fact.key || !fact.value) return;
    const key = `${fact.key}:${fact.value.toLowerCase()}${fact.unit ? `:${fact.unit.toLowerCase()}` : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push(fact);
  };

  const missionSummary = extractMissionSummaryFromCorpus({ title, description, text });
  if (missionSummary) {
    addFact({
      key: BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY,
      label: 'Mission Summary',
      value: missionSummary,
      unit: null,
      context: flightCode || null,
      sourceUrl: ''
    });
  }

  const failureReason = extractFailureReasonFromCorpus({ title, description, text });
  if (failureReason) {
    addFact({
      key: BLUE_ORIGIN_FAILURE_REASON_FACT_KEY,
      label: 'Failure Reason',
      value: failureReason,
      unit: null,
      context: flightCode || null,
      sourceUrl: ''
    });
  }

  const nsFlightMatch = corpus.match(/(\d{1,3})(?:st|nd|rd|th)\s+new\s+shepard\s+flight/i);
  if (nsFlightMatch?.[1]) {
    addFact({
      key: 'new_shepard_flight_number',
      label: 'New Shepard Flight #',
      value: nsFlightMatch[1],
      unit: null,
      context: flightCode || null,
      sourceUrl: ''
    });
  }

  const ngFlightMatch = corpus.match(/(\d{1,3})(?:st|nd|rd|th)\s+new\s+glenn\s+flight/i);
  if (ngFlightMatch?.[1]) {
    addFact({
      key: 'new_glenn_flight_number',
      label: 'New Glenn Flight #',
      value: ngFlightMatch[1],
      unit: null,
      context: flightCode || null,
      sourceUrl: ''
    });
  }

  const payloadMissionMatch = corpus.match(/(\d{1,3})(?:st|nd|rd|th)\s+payload\s+mission/i);
  if (payloadMissionMatch?.[1]) {
    addFact({
      key: 'payload_mission_number',
      label: 'Payload Mission #',
      value: payloadMissionMatch[1],
      unit: null,
      context: flightCode || null,
      sourceUrl: ''
    });
  }

  const lunarGravityMatch = corpus.match(/(?:roughly\s+)?(\d+(?:\.\d+)?)\s+minutes?\s+of\s+lunar\s+gravity/i);
  if (lunarGravityMatch?.[1]) {
    addFact({
      key: 'lunar_gravity_duration',
      label: 'Lunar Gravity Duration',
      value: lunarGravityMatch[1],
      unit: 'minutes',
      context: null,
      sourceUrl: ''
    });
  }

  const microGravityMatch = corpus.match(/(?:roughly\s+)?(\d+(?:\.\d+)?)\s+minutes?\s+of\s+(?:microgravity|weightlessness)/i);
  if (microGravityMatch?.[1]) {
    addFact({
      key: 'microgravity_duration',
      label: 'Microgravity Duration',
      value: microGravityMatch[1],
      unit: 'minutes',
      context: null,
      sourceUrl: ''
    });
  }

  const apogeeMatch = corpus.match(
    /apogee\s+(?:of\s+)?(?:(?:more\s+than|roughly|approximately)?\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(km|kilometers|k|mi|mile|miles|ft|feet)\b/i
  );
  if (apogeeMatch?.[1]) {
    const unit = /mi|mile/i.test(apogeeMatch[2] || '') ? 'miles' : /^ft|feet$/i.test(apogeeMatch[2] || '') ? 'feet' : 'km';
    addFact({
      key: 'apogee',
      label: 'Apogee',
      value: apogeeMatch[1],
      unit,
      context: null,
      sourceUrl: ''
    });
  }

  if (statSection) {
    const lines = statSection.split('\n').map((entry) => entry.trim()).filter(Boolean);

    for (const line of lines) {
      const missionElapsedMatch = line.match(/mission\s+elapsed\s+time:\s*(.+)/i);
      if (missionElapsedMatch?.[1]) {
        addFact({
          key: 'mission_elapsed_time',
          label: 'Mission Elapsed Time',
          value: normalizeOptionalText(missionElapsedMatch[1]) || '',
          unit: null,
          context: null,
          sourceUrl: ''
        });
        continue;
      }

      const launchTimeMatch = line.match(/official\s+launch\s+time:\s*(.+)/i);
      if (launchTimeMatch?.[1]) {
        addFact({
          key: 'official_launch_time',
          label: 'Official Launch Time',
          value: normalizeOptionalText(launchTimeMatch[1]) || '',
          unit: null,
          context: null,
          sourceUrl: ''
        });
        continue;
      }

      const boosterApogeeMatch = line.match(/booster\s+apogee:\s*(.+)/i);
      if (boosterApogeeMatch?.[1]) {
        addFact({
          key: 'booster_apogee',
          label: 'Booster Apogee',
          value: normalizeOptionalText(boosterApogeeMatch[1]) || '',
          unit: null,
          context: null,
          sourceUrl: ''
        });
        continue;
      }

      const crewCapsuleApogeeMatch = line.match(/crew\s+capsule\s+apogee:\s*(.+)/i);
      if (crewCapsuleApogeeMatch?.[1]) {
        addFact({
          key: 'crew_capsule_apogee',
          label: 'Crew Capsule Apogee',
          value: normalizeOptionalText(crewCapsuleApogeeMatch[1]) || '',
          unit: null,
          context: null,
          sourceUrl: ''
        });
        continue;
      }

      const crewLandingMatch = line.match(/crew\s+capsule\s+landing\s+time:\s*(.+)/i);
      if (crewLandingMatch?.[1]) {
        addFact({
          key: 'crew_capsule_landing_time',
          label: 'Crew Capsule Landing Time',
          value: normalizeOptionalText(crewLandingMatch[1]) || '',
          unit: null,
          context: null,
          sourceUrl: ''
        });
      }
    }
  }

  const missionTimeMatch = corpus.match(/mission\s+elapsed\s+time:\s*([^\n.;]+)/i);
  if (missionTimeMatch?.[1]) {
    addFact({
      key: 'mission_elapsed_time',
      label: 'Mission Elapsed Time',
      value: normalizeOptionalText(missionTimeMatch[1]) || '',
      unit: null,
      context: null,
      sourceUrl: ''
    });
  }

  const launchTimeMatch = corpus.match(/official\s+launch\s+time:\s*([^\n.;]+)/i);
  if (launchTimeMatch?.[1]) {
    addFact({
      key: 'official_launch_time',
      label: 'Official Launch Time',
      value: normalizeOptionalText(launchTimeMatch[1]) || '',
      unit: null,
      context: null,
      sourceUrl: ''
    });
  }

  const maxVelocityMatch = corpus.match(/maximum\s+velocity:\s*([^\n.;]+)/i);
  if (maxVelocityMatch?.[1]) {
    addFact({
      key: 'maximum_velocity',
      label: 'Maximum Velocity',
      value: normalizeOptionalText(maxVelocityMatch[1]) || '',
      unit: null,
      context: null,
      sourceUrl: ''
    });
  }

  const gForceMatch = corpus.match(/(?:max|maximum|peak)\s+g[-\s]*force:\s*([^\n.;]+)/i);
  if (gForceMatch?.[1]) {
    addFact({
      key: 'g_force',
      label: 'Maximum G-Force',
      value: normalizeOptionalText(gForceMatch[1]) || '',
      unit: null,
      context: null,
      sourceUrl: ''
    });
  }

  return dedupeBy(facts, (fact) => `${fact.key}:${fact.value}:${fact.unit || ''}`);
}

function extractCrewNamesFromMainHtml(html: string) {
  const mainHtml = extractMainHtml(html);
  if (!mainHtml) return [] as string[];

  const sectionHints = ['Meet the Crew', 'Crew', 'Crew Members', 'Passenger', 'Passengers', 'People'];
  const sectionStart = findAnySectionStart(mainHtml, sectionHints);
  if (sectionStart < 0) return [] as string[];

  const sectionTail = mainHtml.slice(sectionStart);
  const sectionEndMarkers = [
    'Follow Blue Origin on',
    'Share this article',
    'Latest Posts',
    'Back to News',
    'Read more',
    'Related posts',
    'Mission Statistics'
  ];
  let sectionEnd = sectionTail.length;
  for (const marker of sectionEndMarkers) {
    const index = findIndexCaseInsensitive(sectionTail, marker);
    if (index >= 0 && index < sectionEnd) sectionEnd = index;
  }

  const sectionHtml = sectionTail.slice(0, sectionEnd);
  if (!sectionHtml.trim()) return [];

  const names = new Set<string>();
  const headingPattern = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  for (const match of sectionHtml.matchAll(headingPattern)) {
    const headingText = decodeHtmlValue((match[1] || '').replace(/<[^>]+>/g, ' '));
    const candidates = splitEntityList(headingText);
    for (const candidate of candidates) {
      const cleaned = sanitizePersonName(candidate);
      if (cleaned && isLikelyPersonName(cleaned)) names.add(cleaned);
    }
  }

  const bulletPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of sectionHtml.matchAll(bulletPattern)) {
    const textNode = decodeHtmlValue((match[1] || '').replace(/<[^>]+>/g, ' '));
    const cleaned = sanitizePersonName(textNode);
    if (cleaned && isLikelyPersonName(cleaned)) names.add(cleaned);
  }

  const plainCandidates = splitEntityList(
    sectionHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\b(meet the crew|crew members?|passengers)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  for (const candidate of plainCandidates) {
    const cleaned = sanitizePersonName(candidate);
    if (cleaned && isLikelyPersonName(cleaned)) names.add(cleaned);
  }

  return [...names];
}

function extractCrewNamesFromProfileLinks(html: string) {
  const names = new Set<string>();
  const pattern = /<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const rawHref = normalizeOptionalText(match[1]);
    if (!rawHref || !/\/blue-origin\/travelers(?:\/|$)/i.test(rawHref)) continue;
    const rawText = decodeHtmlValue((match[2] || '').replace(/<[^>]+>/g, ' '));
    const normalized = sanitizePersonName(rawText);
    if (!normalized || !isLikelyPersonName(normalized)) continue;
    names.add(normalized);
  }

  return [...names];
}

function extractCrewNamesFromText(text: string | null | undefined) {
  const normalized = normalizeOptionalText(text || '');
  if (!normalized) return [] as string[];

  const patterns = [
    /crew includes(?:[^:]*?:\s*|\s+)([^.]{8,2400})\./gi,
    /crew members?\s+are[:\s]+([^.]{8,2400})\./gi,
    /(?:flight|mission)\s+crew\s+was\s+([^.]{8,2400})\./gi,
    /(?:crew|passenger|astronauts?)\s+(?:were|are|include(?:d)?|included|consist(?:ed)?\s+of)\s+([^.]{8,2400})\./gi,
    /onboard[:\s]+([^.]{4,2400})\./gi
  ];

  const names = new Set<string>();

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const matched = match[1];
      if (!matched) continue;
      const extracted = splitEntityList(matched)
        .map((value) => sanitizePersonName(value))
        .filter((value): value is string => Boolean(value))
        .filter((value) => isLikelyPersonName(value));
      for (const value of extracted) {
        names.add(value);
      }
    }
  }

  const inlineCrewSections = extractLabeledBlockLines(normalized, 'crew', /(?:mission|passenger|payload|launch|mission statistics|key mission statistics)/i);
  for (const crewLine of inlineCrewSections) {
    const extracted = splitEntityList(crewLine)
      .map((value) => sanitizePersonName(value))
      .filter((value): value is string => Boolean(value))
      .filter((value) => isLikelyPersonName(value));
    for (const value of extracted) names.add(value);
  }

  return dedupeStrings([...names]);
}

function extractLabeledTextBlock(text: string, startPattern: RegExp, stopPattern: RegExp) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const startLineIndex = lines.findIndex((line) => startPattern.test(line));
  if (startLineIndex < 0) return '';

  const normalizedStop = new RegExp(stopPattern, 'i');
  const collected: string[] = [];
  for (let index = startLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (normalizedStop.test(line) || line.trim() === 'Mission Profile' || line.trim() === 'Back to News') {
      break;
    }
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function extractLabeledBlockLines(text: string, label: string, stopPattern?: RegExp) {
  const regex = new RegExp(`^\\s*[-*•]?\\s*${escapeRegExp(label)}\\b`, 'i');
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const matches: string[] = [];
  let inLabeledSection = false;
  const stop = stopPattern ? new RegExp(stopPattern, 'i') : null;

  for (const line of lines) {
    if (!inLabeledSection) {
      if (new RegExp(`\\b${escapeRegExp(label)}\\b`, 'i').test(line)) {
        inLabeledSection = true;
      }
      continue;
    }

    if (stop && stop.test(line)) {
      break;
    }

    if (/^[#-*•]\s*/.test(line) || /^\d+\./.test(line)) {
      const bullet = line.replace(/^[#-*•]\s*|^\d+\.\s*/g, '').trim();
      if (bullet) matches.push(bullet);
      continue;
    }

    if (regex.test(line)) {
      const trailing = line.replace(regex, '').trim();
      if (trailing) matches.push(trailing);
      continue;
    }

    if (!line) {
      break;
    }
  }

  return matches;
}

function findAnySectionStart(content: string, sectionHints: string[]) {
  let found = -1;
  let selected = -1;
  for (const hint of sectionHints) {
    const index = findIndexCaseInsensitive(content, hint);
    if (index >= 0 && (found === -1 || index < selected)) {
      found = selected = index;
    }
  }
  return selected;
}

function splitEntityList(value: string) {
  const text = decodeHtmlValue(value)
    .replace(/\s+and\s+/gi, ', ')
    .replace(/[;]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return [] as string[];

  return text
    .split(',')
    .map((entry) => normalizeOptionalText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) =>
      entry
        .replace(/^the\s+crew\s+includes\s*/i, '')
        .replace(/^the\s+crew\s+members?\s+(?:are|include)\s*/i, '')
        .replace(/^global\s+/i, '')
        .trim()
    )
    .filter(Boolean);
}

function sanitizePersonName(value: string | null | undefined) {
  const normalized = normalizeOptionalText((value || '').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}'’ .-]/gu, ' '));
  if (!normalized) return null;

  return normalized
    .replace(/\b(dr|mr|mrs|ms|prof|capt|commander|h\.e)\.?\s+/gi, '')
    .replace(/,\s*(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePayloadName(value: string | null | undefined) {
  const normalized = normalizeOptionalText((value || '').replace(/[^\p{L}\p{N}'’ .-]/gu, ' '));
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/^and\s+/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (cleaned.length < 2 || cleaned.length > 100) return null;
  if (/^payloads?$/i.test(cleaned)) return null;
  if (/^new\s+shepard$/i.test(cleaned)) return null;
  if (/\bmission\b/i.test(cleaned) && cleaned.split(' ').length <= 2) return null;
  return cleaned;
}

function isLikelyPersonName(value: string) {
  const cleaned = normalizeOptionalText(value);
  if (!cleaned) return false;
  if (/\b(ns-\d+|mission|launch|flight|payload)\b/i.test(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  let properWordCount = 0;
  for (const word of words) {
    if (/^[A-Z](?:\.[A-Z])+\.?$/u.test(word)) {
      properWordCount += 1;
      continue;
    }
    if (/^[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]*$/u.test(word)) {
      properWordCount += 1;
      continue;
    }
  }

  return properWordCount >= 2;
}

function isLikelyBlueOriginCrewName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (!isLikelyPersonName(normalized)) return false;
  if (BLUE_ORIGIN_NOISE_PASSENGER_TOKEN.test(normalized)) return false;
  if (/\b(News|Update|Updates|Mission|Mission|Timeline|Profile|Booster|Capsule|Spacecraft|Payload|Vehicle|Blue Origin|Blue|Origin)\b/i.test(normalized))
    return false;
  if (normalized.length > 90) return false;
  return true;
}

function isLikelyBlueOriginPayloadName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (normalized.length < 3 || normalized.length > 90) return false;
  if (BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (normalized.split(' ').length > 8) return false;
  return true;
}

function inferPayloadType(name: string) {
  const normalized = name.toLowerCase();
  if (/(experiment|payload|research|science)/.test(normalized)) return 'Experiment';
  if (/(capsule|crew)/.test(normalized)) return 'Crew Support';
  return null;
}

function inferAgency(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('nasa')) return 'NASA';
  if (normalized.includes('esa')) return 'ESA';
  if (normalized.includes('jaxa')) return 'JAXA';
  return null;
}

function inferPayloadMissionSyntheticName(text: string) {
  if (/lunar\s+gravity/i.test(text)) return 'Lunar Gravity Payloads';
  if (/microgravity|weightlessness/i.test(text)) return 'Microgravity Research Payloads';
  if (/payload\s+mission/i.test(text)) return 'Mission Payload Set';
  return null;
}

function extractBlueOriginReadMoreLinks(html: string, baseUrl: string) {
  const links: string[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const hrefRaw = decodeHtmlValue(match[1] || '');
    if (!hrefRaw) continue;

    const normalized = resolveBlueOriginUrl(baseUrl, hrefRaw);
    if (!normalized) continue;
    if (!shouldCrawlBlueOriginUrl(normalized)) continue;

    links.push(normalized);
  }

  return dedupeStrings(links);
}

function resolveBlueOriginUrl(baseUrl: string, href: string) {
  const trimmed = normalizeOptionalText(href);
  if (!trimmed) return null;

  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('#')) return null;

  try {
    const resolved = new URL(trimmed, baseUrl);
    return normalizeBlueOriginCrawlUrl(resolved.toString());
  } catch {
    return null;
  }
}

function normalizeBlueOriginCrawlUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = normalizeOptionalText(value);
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'blueorigin.com') return null;

  const pathname = normalizeBlueOriginLocalePath(parsed.pathname);
  if (!pathname) return null;
  if (!shouldCrawlBlueOriginPath(pathname)) return null;

  const cleaned = new URL(`https://www.blueorigin.com${pathname}`);
  for (const [key, valueItem] of parsed.searchParams.entries()) {
    if (/^utm_/i.test(key) || /^fbclid$/i.test(key) || /^gclid$/i.test(key)) continue;
    if (!valueItem) continue;
    cleaned.searchParams.set(key, valueItem);
  }

  const normalized = cleaned.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function shouldCrawlBlueOriginPath(pathname: string) {
  if (!pathname.startsWith('/')) return false;

  const disallowedPrefixes = ['/shop', '/careers', '/privacy', '/terms', '/investors', '/media-kit'];
  if (disallowedPrefixes.some((prefix) => pathname.startsWith(prefix))) return false;

  const normalized = pathname.toLowerCase();
  const isNewsPath = normalized.startsWith('/news/');
  const hasFlightCodeHint = /(ns|ng)-\d{1,3}\b/.test(normalized);
  const hasProgramHint =
    BLUE_ORIGIN_NEWS_PATH_SEGMENTS.some((segment) => normalized.includes(`/${segment}`)) ||
    /\/new-(shepard|glenn)-/.test(normalized);
  const isBlueOriginNewsHub =
    /^\/(new-shepard|new-glenn|blue-moon|blue-ring)\/?$/.test(normalized) &&
    !isNewsPath;

  return (
    normalized.startsWith('/missions/') ||
    normalized.startsWith('/missions/by/') ||
    (isNewsPath &&
      (hasFlightCodeHint ||
        (hasProgramHint &&
          !normalized.includes('/search') &&
          !normalized.includes('/sitemap') &&
          !normalized.endsWith('/blog') &&
          !normalized.includes('/careers') &&
          !normalized.includes('/events') &&
          !normalized.includes('/shop')))) ||
    isBlueOriginNewsHub
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

function shouldCrawlBlueOriginUrl(url: string) {
  const normalized = normalizeBlueOriginCrawlUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return shouldCrawlBlueOriginPath(parsed.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function extractCanonicalUrlFromHtml(html: string, fallbackUrl: string) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  const href = match?.[1] || null;
  const resolved = resolveBlueOriginUrl(fallbackUrl, href || '');
  return resolved || fallbackUrl;
}

function extractHtmlTitle(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const normalized = normalizeOptionalText(decodeHtmlValue(titleMatch[1].replace(/<[^>]+>/g, ' ')));
    if (normalized) return normalized;
  }

  const ogMatch = readMetaContentByProperty(html, 'og:title');
  return ogMatch || null;
}

function extractMainHtml(html: string) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return mainMatch?.[1] || html;
}

function extractMainText(html: string) {
  const source = extractMainHtml(html) || html;

  let text = source;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<\/(?:p|h\d|li|div|section|article|header|footer|main|br)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlValue(text);
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{2,}/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

function readMetaContentByName(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
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

function findIndexCaseInsensitive(text: string, needle: string) {
  if (!text || !needle) return -1;
  return text.toLowerCase().indexOf(needle.toLowerCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBlueOriginMissionGraphicsFromHtml(html: string, flightCode: string) {
  const normalizedFlightCode = String(flightCode || '')
    .trim()
    .toLowerCase();
  const normalizedFlightCodeHint = normalizedFlightCode.replace(/[^a-z0-9]/g, '');
  const byUrl = new Map<string, MissionGraphic>();

  const addGraphic = (rawUrl: string) => {
    const normalizedUrl = normalizeBlueOriginGraphicAssetUrl(rawUrl);
    if (!normalizedUrl) return;
    if (!isLikelyBlueOriginMissionGraphic(normalizedUrl, normalizedFlightCode)) return;
    const dedupeKey = normalizeComparableUrl(normalizedUrl) || normalizedUrl;
    if (byUrl.has(dedupeKey)) return;

    byUrl.set(dedupeKey, {
      id: `blue-origin-graphic:${dedupeKey}`,
      label: buildBlueOriginMissionGraphicLabel(normalizedUrl, normalizedFlightCode),
      url: normalizedUrl
    });
  };

  const absoluteAssetPattern = /https:\/\/d1o72l87sylvqg\.cloudfront\.net\/(?:redstone|blue-origin)\/[^"'<)\s]+/gi;
  for (const match of html.matchAll(absoluteAssetPattern)) addGraphic(match[0]);

  const quotedAssetPattern = /https?:\/\/[^"'<>\\s]+?\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#][^"'<)\s]*)?/gi;
  for (const match of html.matchAll(quotedAssetPattern)) {
    const candidate = String(match[0] || '').trim();
    if (!candidate) continue;
    let normalizedCandidate = candidate;
    try {
      normalizedCandidate = decodeURIComponent(candidate);
    } catch {
      // ignore decode failures
    }
    addGraphic(normalizedCandidate);
  }

  const srcSetPattern = /<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(srcSetPattern)) {
    const sourceSet = String(match[1] || '').trim();
    const candidates = sourceSet
      .split(',')
      .map((entry) => entry.trim().split(/\s+/)[0] || '')
      .filter(Boolean);
    for (const candidate of candidates) {
      let normalizedCandidate = candidate;
      try {
        normalizedCandidate = decodeURIComponent(candidate);
      } catch {
        // ignore decode failures
      }
      addGraphic(normalizedCandidate);
    }
  }

  const nextImagePattern = /\/_next\/image\?[^"'>\s]*url=([^&"'>\s]+)/gi;
  for (const match of html.matchAll(nextImagePattern)) {
    const encoded = match[1];
    if (!encoded) continue;
    try {
      addGraphic(decodeURIComponent(encoded));
    } catch {
      continue;
    }
  }

  const ogImage =
    readMetaContentByProperty(html, 'og:image') ||
    readMetaContentByName(html, 'og:image') ||
    readMetaContentByProperty(html, 'twitter:image');
  if (ogImage) addGraphic(ogImage);

  const imageCandidatePattern = /(?:url|src)=["']([^"']+\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#][^"']*)?)["']/gi;
  for (const match of html.matchAll(imageCandidatePattern)) {
    const rawCandidate = String(match[1] || '').trim();
    if (!rawCandidate) continue;
    let normalizedCandidate = rawCandidate;
    try {
      normalizedCandidate = decodeURIComponent(rawCandidate);
    } catch {
      // ignore decode failures
    }
    addGraphic(normalizedCandidate);
  }

  const structuredDataPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(structuredDataPattern)) {
    const payload = String(match[1] || '').trim();
    if (!payload) continue;
    try {
      const json = JSON.parse(payload);
      for (const imageUrl of extractImageUrlsFromJson(json, normalizedFlightCodeHint)) {
        addGraphic(imageUrl);
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return sortBlueOriginMissionGraphics([...byUrl.values()]);
}

function normalizeBlueOriginGraphicAssetUrl(value: string | null | undefined) {
  const raw = decodeHtmlValue(value || '')
    .replace(/\\+$/g, '')
    .trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'd1o72l87sylvqg.cloudfront.net') return null;
  const pathname = decodeURIComponent(parsed.pathname || '').replace(/\/+$/g, '');
  const normalizedPath = pathname.toLowerCase();
  if (!normalizedPath.startsWith('/redstone/') && !normalizedPath.startsWith('/blue-origin/')) return null;
  if (!/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(pathname)) return null;
  return `https://${host}${pathname}`;
}

function extractImageUrlsFromJson(value: any, flightCodeHint: string) {
  const urls = new Set<string>();
  const visit = (node: any) => {
    if (!node) return;
    if (typeof node === 'string') {
      let normalizedNode = decodeHtmlValue(node).trim();
      if (!normalizedNode) return;
      try {
        if (/%[0-9A-Fa-f]{2}/.test(normalizedNode)) {
          normalizedNode = decodeURIComponent(normalizedNode);
        }
      } catch {
        // Ignore malformed percent-encoding.
      }

      if (normalizedNode.startsWith('http://') || normalizedNode.startsWith('https://')) {
        if (normalizedNode.includes('cloudfront.net')) {
          urls.add(normalizedNode);
          return;
        }
        if (/\.(png|jpe?g|webp|gif|avif|svg)(?:[?#][^"'<>\\s]*)?$/i.test(normalizedNode)) {
          urls.add(normalizedNode);
        }
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (!child) continue;
        if ((key === 'image' || key === 'url' || key === 'contentUrl' || key === 'logo') && typeof child === 'string') {
          visit(child);
          continue;
        }
        visit(child);
      }
    }
  };

  visit(value);

  return [...urls].filter((url) => {
    if (!url) return false;
    if (!flightCodeHint) return true;
    const compactHint = String(flightCodeHint || '').toLowerCase();
    const normalizedUrl = url.toLowerCase();
    if (!compactHint) return true;
    return (
      normalizedUrl.includes(compactHint) ||
      normalizedUrl.includes('mission') ||
      /mission[_-]timeline|mission[_-]profile|flight[_-]profile|booster[_-]recovery|by[_-]the[_-]numbers/.test(
        normalizedUrl
      )
    );
  });
}

function isLikelyBlueOriginMissionGraphic(assetUrl: string, flightCode: string) {
  let parsed: URL;
  try {
    parsed = new URL(assetUrl);
  } catch {
    return false;
  }
  const filename = parsed.pathname.split('/').pop() || '';
  const compactName = filename.toLowerCase().replace(/[^a-z0-9]/g, '');
  const compactFlightCode = flightCode.replace(/[^a-z0-9]/g, '');
  if (MISSION_GRAPHIC_EXCLUDE_PATTERN.test(compactName)) {
    return false;
  }
  if (MISSION_GRAPHIC_LABEL_PATTERN.test(compactName)) return true;
  if (compactFlightCode && compactName.includes(compactFlightCode)) return true;
  if (MISSION_GRAPHIC_CONTEXT_PATTERN.test(compactName)) return true;
  return false;
}

function buildBlueOriginMissionGraphicLabel(assetUrl: string, flightCode: string) {
  let filename = '';
  try {
    filename = new URL(assetUrl).pathname.split('/').pop() || '';
  } catch {
    filename = assetUrl;
  }
  const withoutExtension = filename.replace(/\.[a-z0-9]+$/i, '');
  const withoutFlightPrefix = withoutExtension
    .replace(/^missions[_-]?[a-z]{2,3}[-_]?\d+[_-]?/i, '')
    .replace(/^(ng|ns)[-_]?\d+[_-]?/i, '')
    .replace(/^missions[_-]?/i, '');
  const normalizedWords = withoutFlightPrefix
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedWords) return flightCode ? `${flightCode.toUpperCase()} Mission Graphic` : 'Mission Graphic';
  return toTitleCase(normalizedWords);
}

function sortBlueOriginMissionGraphics(graphics: MissionGraphic[]) {
  const rank = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes('flight profile')) return 1;
    if (normalized.includes('trajectory')) return 2;
    if (normalized.includes('mission timeline')) return 3;
    if (normalized.includes('by the numbers')) return 4;
    if (normalized.includes('booster recovery')) return 5;
    return 99;
  };
  return [...graphics].sort((left, right) => {
    const delta = rank(left.label) - rank(right.label);
    if (delta !== 0) return delta;
    return left.label.localeCompare(right.label);
  });
}

function resolveBlueOriginMissionSourceUrl(launch: LaunchCacheRow, flightCode: string | null) {
  return buildBlueOriginMissionSourceCandidates(launch, flightCode)[0] || null;
}

function buildBlueOriginMissionSourceCandidates(launch: LaunchCacheRow, flightCode: string | null) {
  const normalizedFlightCode = String(flightCode || '').trim().toLowerCase();
  const normalized = normalizedFlightCode.replace(/^(ns|ng)-/, '');
  const missionCodeVariants = buildBlueOriginMissionCandidateVariants(normalizedFlightCode, normalized);
  const candidates = [
    ...extractInfoUrls(launch.launch_info_urls),
    ...extractInfoUrls(launch.mission_info_urls),
    ...missionCodeVariants,
    BLUE_ORIGIN_FLIGHT_CODE_PREFIXES.some((prefix) => normalizedFlightCode.startsWith(`${prefix}-`))
      ? `https://www.blueorigin.com/missions/${normalizedFlightCode}`
      : null
  ];

  const deduped = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeBlueOriginCrawlUrl(candidate) || normalizeBlueOriginMissionSourceUrl(candidate);
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return [...deduped];
}

function buildBlueOriginMissionCandidateVariants(flightCode: string, normalizedFlightNumber: string) {
  if (!flightCode) return [] as string[];
  if (!BLUE_ORIGIN_FLIGHT_CODE_PREFIXES.some((prefix) => flightCode.startsWith(`${prefix}-`))) return [];
  const missionCode = encodeURIComponent(flightCode);
  const normalizedNumber = encodeURIComponent(normalizedFlightNumber);

  const variants = new Set<string>([
    `/missions/${missionCode}`,
    `/missions/by/${missionCode}`,
    `/news/${missionCode}`,
    `/news/${missionCode}-mission`,
    `/news/${missionCode}-mission-updates`,
    `/news/${missionCode}-mission-announcement`,
    `/news/${missionCode}-launch-updates`
  ]);

  if (normalizedNumber) {
    variants.add(`/missions/ns-${normalizedNumber}`);
    variants.add(`/missions/by/ns-${normalizedNumber}`);
    variants.add(`/missions/ng-${normalizedNumber}`);
    variants.add(`/missions/by/ng-${normalizedNumber}`);
    variants.add(`/news/ns-${normalizedNumber}`);
    variants.add(`/news/ng-${normalizedNumber}`);
    variants.add(`/news/ns-${normalizedNumber}-mission`);
    variants.add(`/news/ng-${normalizedNumber}-mission`);
    variants.add(`/news/ns-${normalizedNumber}-mission-updates`);
    variants.add(`/news/ng-${normalizedNumber}-mission-updates`);
  }

  if (flightCode.startsWith('ns-')) {
    const flightCodePrefix = 'new-shepard';
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission`);
    variants.add(`/missions/${flightCodePrefix}-mission-${missionCode}`);
    variants.add(`/news/${flightCodePrefix}-mission-${missionCode}`);
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission-announcement`);
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission-launch-updates`);
    variants.add(`/news/${flightCodePrefix}-${missionCode}-mission-announcement`);
    variants.add(`/news/${flightCodePrefix}-${missionCode}-mission-launch-updates`);
    variants.add(`/news/${flightCodePrefix}-mission-${missionCode}-to-conduct-astronaut-rehearsal`);
    variants.add(`/news/ns-${normalizedNumber}-mission`);
    variants.add(`/news/ns-${normalizedNumber}-launch-updates`);
    variants.add(`/news/new-shepard-ns-${normalizedNumber}-mission`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}-launch-updates`);
    variants.add(`/missions/new-shepard-ns-${normalizedNumber}-mission`);
    variants.add(`/missions/new-shepard-ns-${normalizedNumber}-mission-updates`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}`);
  }

  if (flightCode.startsWith('ns-')) {
    variants.add(`/news/ns-${normalizedNumber}-mission-updates`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}-mission-updates`);
    variants.add(`/missions/ns-${normalizedNumber}-mission-updates`);
    variants.add(`/missions/new-shepard-mission-ns-${normalizedNumber}-mission-updates`);
  }

  if (flightCode.startsWith('ng-')) {
    const flightCodePrefix = 'new-glenn';
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission`);
    variants.add(`/missions/${flightCodePrefix}-mission-${missionCode}`);
    variants.add(`/news/${flightCodePrefix}-mission-${missionCode}`);
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission-announcement`);
    variants.add(`/missions/${flightCodePrefix}-${missionCode}-mission-launch-updates`);
    variants.add(`/news/${flightCodePrefix}-${missionCode}-mission-announcement`);
    variants.add(`/news/${flightCodePrefix}-mission-${missionCode}-launch-updates`);
    variants.add(`/news/ng-${normalizedNumber}-mission`);
    variants.add(`/news/ng-${normalizedNumber}-launch-updates`);
    variants.add(`/news/new-glenn-mission-ng-${normalizedNumber}`);
    variants.add(`/missions/new-glenn-ng-${normalizedNumber}-mission`);
    variants.add(`/news/new-glenn-mission-ng-${normalizedNumber}-launch-updates`);
    variants.add(`/news/new-glenn-ng-${normalizedNumber}-mission-announcement`);
    variants.add(`/news/new-glenn-ng-${normalizedNumber}-mission-launch-updates`);
  }

  return [...variants]
    .filter(Boolean)
    .map((entry) => `https://www.blueorigin.com${entry}`)
    .filter(
      (candidate) =>
        candidate.startsWith('https://www.blueorigin.com/news/') ||
        candidate.startsWith('https://www.blueorigin.com/missions/')
    );
}

function inferBlueOriginFlightCode(launch: LaunchCacheRow) {
  const text = `${launch.name || ''} ${launch.mission_name || ''}`.toLowerCase();
  const ngCodeMatch = text.match(/\bng[-\s]?(\d{1,3})\b/);
  if (ngCodeMatch?.[1]) return `ng-${Number(ngCodeMatch[1])}`;

  const nsCodeMatch = text.match(/\bns[-\s]?(\d{1,3})\b/);
  if (nsCodeMatch?.[1]) return `ns-${Number(nsCodeMatch[1])}`;

  const newGlennNumberMatch = text.match(/\bnew\s+glenn(?:\s+flight)?\s*#?\s*(\d{1,3})\b/);
  if (newGlennNumberMatch?.[1]) return `ng-${Number(newGlennNumberMatch[1])}`;

  const newShepardNumberMatch = text.match(/\bnew\s+shepard(?:\s+flight)?\s*#?\s*(\d{1,3})\b/);
  if (newShepardNumberMatch?.[1]) return `ns-${Number(newShepardNumberMatch[1])}`;
  return '';
}

function inferBlueOriginFlightCodeFromUrls(launchInfoUrls: string[], missionInfoUrls: string[]) {
  for (const url of [...launchInfoUrls, ...missionInfoUrls]) {
    const code = extractBlueOriginFlightCodeFromUrl(url);
    if (code) return code;
  }
  return null;
}

function buildBlueOriginFallbackFlightCode(launch: LaunchCacheRow) {
  const launchNameHint = `${launch.name || ''} ${launch.mission_name || ''}`;
  const dateHint = normalizeBlueOriginDateForFallbackCode(launch.net);
  const launchToken = normalizeBlueOriginFallbackToken(launchNameHint);
  const idToken = normalizeBlueOriginFallbackId(
    launch.launch_id || launch.ll2_launch_uuid || launchNameHint
  );
  return `${BLUE_ORIGIN_FLIGHT_FALLBACK_PREFIX}-${dateHint}-${launchToken}-${idToken}`;
}

function normalizeBlueOriginDateForFallbackCode(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return 'unknown-date';
  return new Date(parsed).toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizeBlueOriginFallbackToken(value: string) {
  const token = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'blue-origin-launch';
}

function normalizeBlueOriginFallbackId(value: string | null | undefined) {
  const token = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  return token || 'legacy';
}

function normalizeBlueOriginMissionSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'blueorigin.com') return null;
  const pathname = normalizeBlueOriginLocalePath(parsed.pathname);
  if (!pathname) return null;
  const isMissionPath =
    pathname.startsWith('/missions/') ||
    pathname.startsWith('/missions/by/') ||
    pathname.startsWith('/news/new-shepard-') ||
    pathname.startsWith('/news/new-glenn-') ||
    /^\/news\/(?:ns|ng)-\d{1,3}\b/.test(pathname);
  if (!isMissionPath) return null;
  return `https://www.blueorigin.com${pathname}`;
}

function extractInfoUrls(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      urls.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === 'object' && typeof (entry as any).url === 'string' && (entry as any).url.trim()) {
      urls.push((entry as any).url.trim());
    }
  }
  return urls;
}

function resolveLaunchByFlightCode(launches: LaunchCacheRow[], launchDate: string | null) {
  if (!launches.length) return null;
  if (!launchDate) return launches[0] || null;
  const targetMs = Date.parse(launchDate);
  if (!Number.isFinite(targetMs)) return launches[0] || null;
  return launches.reduce((best: LaunchCacheRow | null, current) => {
    if (!best) return current;
    const bestMs = Date.parse(best.net || '');
    const currentMs = Date.parse(current.net || '');
    const bestDelta = Number.isFinite(bestMs) ? Math.abs(bestMs - targetMs) : Number.MAX_SAFE_INTEGER;
    const currentDelta = Number.isFinite(currentMs) ? Math.abs(currentMs - targetMs) : Number.MAX_SAFE_INTEGER;
    return currentDelta < bestDelta ? current : best;
  }, null);
}

function extractFlightCodeFromLaunch(launch: LaunchCacheRow) {
  const combinedText = `${launch.name || ''} ${launch.mission_name || ''}`;
  const directCode = extractBlueOriginFlightCodeFromText(combinedText);
  if (directCode) return directCode;

  const launchInfoUrls = extractInfoUrls(launch.launch_info_urls);
  const missionInfoUrls = extractInfoUrls(launch.mission_info_urls);
  const inferredFromUrls = inferBlueOriginFlightCodeFromUrls(launchInfoUrls, missionInfoUrls);
  if (inferredFromUrls) return inferredFromUrls;

  const inferredFromText = inferBlueOriginFlightCode(launch);
  if (inferredFromText) return inferredFromText;

  return buildBlueOriginFallbackFlightCode(launch);
}

function classifyBlueOriginMissionKey(launch: LaunchCacheRow, flightCode: string) {
  if (flightCode.startsWith('ns-')) return 'new-shepard';
  if (flightCode.startsWith('ng-')) return 'new-glenn';
  const text = `${launch.name || ''} ${launch.mission_name || ''}`.toLowerCase();
  if (text.includes('new shepard')) return 'new-shepard';
  if (text.includes('new glenn')) return 'new-glenn';
  if (text.includes('blue moon')) return 'blue-moon';
  if (text.includes('blue ring')) return 'blue-ring';
  if (text.includes('be-4') || text.includes('be4')) return 'be-4';
  return 'blue-origin-program';
}

function deriveFlightStatus(net: string | null) {
  const netMs = Date.parse(String(net || ''));
  if (Number.isFinite(netMs) && netMs > Date.now()) return 'upcoming';
  return 'completed';
}

function buildMissionGraphicSourceId(flightCode: string | null, missionUrl: string) {
  if (flightCode) return flightCode;
  try {
    const parsed = new URL(missionUrl);
    const path = parsed.pathname.replace(/\/+$/g, '');
    return path || missionUrl;
  } catch {
    return missionUrl;
  }
}

function normalizeComparableUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/g, '') || '/';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function normalizeNameKey(value: string | null | undefined) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized || null;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function dedupeStrings(values: string[]) {
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

async function deleteBlueOriginLaunchDetailConstraints(
  supabase: ReturnType<typeof createClient>,
  launchIds: string[]
) {
  await runWithConcurrency(chunkArray(launchIds, UPSERT_CHUNK_SIZE), 4, async (chunk) => {
    const deleteInfographic = await supabase
      .from('launch_trajectory_constraints')
      .delete()
      .in('launch_id', chunk)
      .eq('source', BLUE_ORIGIN_INFOGRAPHIC_SOURCE)
      .eq('constraint_type', 'mission_infographic');
    if (deleteInfographic.error) throw new Error(deleteInfographic.error.message);

    const deleteMultiSource = await supabase
      .from('launch_trajectory_constraints')
      .delete()
      .in('launch_id', chunk)
      .eq('source', BLUE_ORIGIN_MULTISOURCE);
    if (deleteMultiSource.error) throw new Error(deleteMultiSource.error.message);
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  if (!items.length) return [] as R[];
  const maxWorkers = clampInt(concurrency, 1, 24);
  const output = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(maxWorkers, items.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        output[index] = await mapper(items[index], index);
      }
    })
  );

  return output;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>
) {
  if (!items.length) return;
  const maxWorkers = clampInt(concurrency, 1, 24);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(maxWorkers, items.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await handler(items[index], index);
      }
    })
  );
}

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  const step = Math.max(1, size);
  for (let index = 0; index < items.length; index += step) {
    out.push(items.slice(index, index + step));
  }
  return out;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal
      });
      if (attempt < FETCH_RETRIES && (response.status === 403 || response.status === 429 || response.status >= 500)) {
        await sleep(FETCH_RETRY_BASE_MS * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await sleep(FETCH_RETRY_BASE_MS * attempt);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('fetch_failed');
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeChallenge(status: number, html: string) {
  if (status !== 403 && status !== 429) return false;
  const normalized = html.toLowerCase();
  return (
    normalized.includes('vercel security checkpoint') ||
    normalized.includes("we're verifying your browser") ||
    normalized.includes('browser verification') ||
    normalized.includes('enable javascript to continue') ||
    normalized.includes('captcha')
  );
}

function decodeHtmlValue(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function toTitleCase(value: string) {
  return value
    .split(' ')
    .map((token) => (token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : token))
    .join(' ');
}

async function upsertInChunks<T extends Record<string, unknown>>(
  rows: T[],
  size: number,
  upsertChunk: (chunk: T[]) => Promise<{ error: { message: string } | null }>
) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    const { error } = await upsertChunk(chunk);
    if (error) throw new Error(error.message);
  }
}

function dedupeBy<T>(items: T[], keyFn: (value: T) => string) {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

function parseCsv(value: string | undefined) {
  const raw = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampFloat(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function sanitizeEnvValue(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

main().catch((error) => {
  console.error('[blue-origin-launch-details-backfill] fatal', stringifyError(error));
  process.exitCode = 1;
});
