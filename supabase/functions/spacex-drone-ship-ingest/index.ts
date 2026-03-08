import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';
const WIKIDATA_ENTITY_BASE = 'https://www.wikidata.org/wiki/Special:EntityData';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKI_USER_AGENT = Deno.env.get('WIKI_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';

const DEFAULTS = {
  enabled: true,
  batchSize: 24,
  lookbackDays: 3650,
  lookaheadDays: 365,
  staleHours: 120,
  ll2RateLimitPerHour: 300,
  wikiSyncEnabled: true,
  wikiSyncIntervalDays: 30
};

const SETTINGS_KEYS = [
  'spacex_drone_ship_ingest_enabled',
  'spacex_drone_ship_ingest_batch_size',
  'spacex_drone_ship_ingest_lookback_days',
  'spacex_drone_ship_ingest_lookahead_days',
  'spacex_drone_ship_ingest_stale_hours',
  'll2_rate_limit_per_hour',
  'spacex_drone_ship_wiki_sync_enabled',
  'spacex_drone_ship_wiki_sync_interval_days'
];

type CandidateRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  net: string | null;
  assignment_last_verified: string | null;
};

type Ll2Landing = {
  id: number;
  attempt?: boolean;
  success?: boolean | null;
  landing?: string | null;
  landing_location?: {
    name?: string | null;
    abbrev?: string | null;
  } | null;
};

type CanonicalShipSlug = 'ocisly' | 'asog' | 'jrti';

type CanonicalizedShip = {
  slug: CanonicalShipSlug | null;
  nameRaw: string | null;
  abbrevRaw: string | null;
};

type DroneShipStaticRow = {
  slug: string | null;
  wikidata_id: string | null;
  wikipedia_url: string | null;
  wiki_last_synced_at: string | null;
  image_url: string | null;
  length_m: number | string | null;
  year_built: number | null;
};

type WikidataEntity = {
  labels?: Record<string, { value?: string }>;
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
  sitelinks?: Record<string, { title?: string }>;
};

const SHIP_WIKIDATA_ID_BY_SLUG: Record<CanonicalShipSlug, string> = {
  ocisly: 'Q23891316',
  asog: 'Q107172359',
  jrti: 'Q96157645'
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  let authorized = false;
  try {
    authorized = await requireJobAuth(req, supabase);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'spacex_drone_ship_ingest');
  const stats: Record<string, unknown> = {
    candidates: 0,
    processed: 0,
    skippedNoLl2Id: 0,
    ll2Calls: 0,
    ll2RateLimited: false,
    ll2RemoteRateLimited: false,
    assignmentsKnown: 0,
    assignmentsUnknown: 0,
    rowsUpserted: 0,
    failedLaunches: [] as Array<{ launchId: string; reason: string }>
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.spacex_drone_ship_ingest_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const batchSize = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_batch_size, DEFAULTS.batchSize),
      1,
      200
    );
    const lookbackDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_lookback_days, DEFAULTS.lookbackDays),
      30,
      36500
    );
    const lookaheadDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_lookahead_days, DEFAULTS.lookaheadDays),
      7,
      3650
    );
    const staleHours = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_stale_hours, DEFAULTS.staleHours),
      1,
      24 * 90
    );
    const ll2RateLimit = clampInt(readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour), 1, 10_000);
    const wikiSyncEnabled = readBooleanSetting(settings.spacex_drone_ship_wiki_sync_enabled, DEFAULTS.wikiSyncEnabled);
    const wikiSyncIntervalDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_wiki_sync_interval_days, DEFAULTS.wikiSyncIntervalDays),
      1,
      3650
    );

    const { data: candidateData, error: candidateError } = await supabase.rpc('get_spacex_drone_ship_ingest_candidates', {
      limit_n: batchSize,
      lookback_days: lookbackDays,
      lookahead_days: lookaheadDays,
      stale_hours: staleHours
    });
    if (candidateError) throw candidateError;

    const candidates = Array.isArray(candidateData) ? (candidateData as CandidateRow[]) : [];
    stats.candidates = candidates.length;
    if (candidates.length === 0) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_candidates' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_candidates', elapsedMs: Date.now() - startedAt, stats });
    }

    const nowIso = new Date().toISOString();
    const upsertRows: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      stats.processed = (stats.processed as number) + 1;
      const launchId = normalizeText(candidate.launch_id);
      const ll2LaunchUuid = normalizeText(candidate.ll2_launch_uuid);
      if (!launchId) continue;
      if (!ll2LaunchUuid) {
        stats.skippedNoLl2Id = (stats.skippedNoLl2Id as number) + 1;
        continue;
      }

      try {
        const landings = await fetchLandingsForLaunch({
          supabase,
          ll2LaunchUuid,
          ll2RateLimit,
          stats
        });
        const selected = selectLanding(landings);
        const canonical = canonicalizeShip(selected?.landing_location?.name, selected?.landing_location?.abbrev);
        const landingAttempt = typeof selected?.attempt === 'boolean' ? selected.attempt : null;
        const landingSuccess = typeof selected?.success === 'boolean' ? selected.success : null;
        const landingResult = resolveLandingResult(landingAttempt, landingSuccess);
        const landingTime = normalizeIso(selected?.landing ?? null);

        if (canonical.slug) {
          stats.assignmentsKnown = (stats.assignmentsKnown as number) + 1;
        } else {
          stats.assignmentsUnknown = (stats.assignmentsUnknown as number) + 1;
        }

        upsertRows.push({
          launch_id: launchId,
          launch_library_id: ll2LaunchUuid,
          ship_slug: canonical.slug,
          ship_name_raw: canonical.nameRaw,
          ship_abbrev_raw: canonical.abbrevRaw,
          landing_attempt: landingAttempt,
          landing_success: landingSuccess,
          landing_result: landingResult,
          landing_time: landingTime,
          source: 'll2',
          source_landing_id: selected ? String(selected.id) : null,
          last_verified_at: nowIso,
          updated_at: nowIso
        });
      } catch (err) {
        (stats.failedLaunches as Array<{ launchId: string; reason: string }>).push({
          launchId,
          reason: stringifyError(err)
        });
      }

      if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) break;
    }

    if (upsertRows.length > 0) {
      const { error: upsertError } = await supabase.from('spacex_drone_ship_assignments').upsert(upsertRows, {
        onConflict: 'launch_id'
      });
      if (upsertError) throw upsertError;
      stats.rowsUpserted = upsertRows.length;
    }

    if (wikiSyncEnabled) {
      await syncDroneShipWikiEnrichment({
        supabase,
        syncIntervalDays: wikiSyncIntervalDays,
        stats
      });
    } else {
      stats.wikiSkipped = true;
      stats.wikiSkipReason = 'disabled';
    }

    const hardRateLimited = (stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean);
    const hasFailures = (stats.failedLaunches as Array<{ launchId: string; reason: string }>).length > 0;
    const ok = !hardRateLimited && !hasFailures;

    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function fetchLandingsForLaunch({
  supabase,
  ll2LaunchUuid,
  ll2RateLimit,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  ll2LaunchUuid: string;
  ll2RateLimit: number;
  stats: Record<string, unknown>;
}) {
  if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) return [] as Ll2Landing[];

  const rate = await tryConsumeLl2(supabase, ll2RateLimit);
  if (!rate.allowed) {
    stats.ll2RateLimited = true;
    return [] as Ll2Landing[];
  }

  const query = `firststage_launch__ids=${encodeURIComponent(ll2LaunchUuid)}`;
  const url = `${LL2_BASE}/landings/?format=json&mode=detailed&limit=20&${query}`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  stats.ll2Calls = (stats.ll2Calls as number) + 1;

  if (res.status === 429) {
    stats.ll2RemoteRateLimited = true;
    return [] as Ll2Landing[];
  }
  if (res.status >= 500) {
    throw new Error(`LL2 landings fetch failed ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`LL2 landings fetch failed ${res.status}`);
  }

  const json = await res.json().catch(() => ({} as any));
  return Array.isArray(json?.results) ? (json.results as Ll2Landing[]) : [];
}

function selectLanding(landings: Ll2Landing[]) {
  if (!Array.isArray(landings) || landings.length === 0) return null;

  const scored = landings
    .filter((landing): landing is Ll2Landing => Number.isFinite(Number(landing?.id)))
    .map((landing) => {
      const canonical = canonicalizeShip(landing.landing_location?.name, landing.landing_location?.abbrev);
      let score = 0;
      if (canonical.slug) score += 100;
      if (landing.success === true) score += 30;
      if (landing.attempt === true) score += 15;
      if (landing.landing_location?.name) score += 5;
      if (landing.landing_location?.abbrev) score += 3;
      return { landing, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftAttempt = left.landing.attempt === true ? 1 : 0;
      const rightAttempt = right.landing.attempt === true ? 1 : 0;
      if (rightAttempt !== leftAttempt) return rightAttempt - leftAttempt;
      const leftSuccess = left.landing.success === true ? 1 : 0;
      const rightSuccess = right.landing.success === true ? 1 : 0;
      if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess;
      return Number(left.landing.id) - Number(right.landing.id);
    });

  return scored[0]?.landing || null;
}

function canonicalizeShip(name: string | null | undefined, abbrev: string | null | undefined): CanonicalizedShip {
  const rawName = normalizeText(name) || null;
  const rawAbbrev = normalizeText(abbrev) || null;
  const tokens = [normalizeToken(rawAbbrev), normalizeToken(rawName)].filter(Boolean);

  for (const token of tokens) {
    if (!token) continue;
    if (token === 'ocisly' || token === 'ofcourseistillloveyou') {
      return { slug: 'ocisly', nameRaw: rawName, abbrevRaw: rawAbbrev };
    }
    if (token === 'asog' || token === 'ashortfallofgravitas') {
      return { slug: 'asog', nameRaw: rawName, abbrevRaw: rawAbbrev };
    }
    if (token === 'jrti' || token === 'justreadtheinstructions') {
      return { slug: 'jrti', nameRaw: rawName, abbrevRaw: rawAbbrev };
    }
  }

  return { slug: null, nameRaw: rawName, abbrevRaw: rawAbbrev };
}

function resolveLandingResult(attempt: boolean | null, success: boolean | null) {
  if (attempt === false) return 'no_attempt';
  if (attempt === true && success === true) return 'success';
  if (attempt === true && success === false) return 'failure';
  return 'unknown';
}

function normalizeToken(value: string | null | undefined) {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) headers.Authorization = `Token ${LL2_API_KEY}`;
  return headers;
}

async function tryConsumeLl2(supabase: ReturnType<typeof createSupabaseAdminClient>, limit: number) {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);

  const { data, error } = await supabase.rpc('try_increment_api_rate', {
    provider_name: 'll2',
    window_start_in: windowStart.toISOString(),
    window_seconds_in: 3600,
    limit_in: limit
  });

  if (error) {
    console.error('rateCounter try_increment_api_rate error', error);
    return { allowed: false };
  }

  return { allowed: Boolean(data) };
}

async function syncDroneShipWikiEnrichment({
  supabase,
  syncIntervalDays,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  syncIntervalDays: number;
  stats: Record<string, unknown>;
}) {
  const canonicalSlugs: CanonicalShipSlug[] = ['ocisly', 'asog', 'jrti'];
  stats.wikiCandidates = canonicalSlugs.length;
  stats.wikiSynced = 0;
  stats.wikiSkippedFresh = 0;
  stats.wikiFailures = [] as Array<{ slug: CanonicalShipSlug; reason: string }>;
  if (typeof stats.wikiCalls !== 'number') stats.wikiCalls = 0;

  const { data, error } = await supabase
    .from('spacex_drone_ships')
    .select('slug,wikidata_id,wikipedia_url,wiki_last_synced_at,image_url,length_m,year_built')
    .in('slug', canonicalSlugs);

  if (error) {
    if (isMissingWikiSchemaError(error.message || '')) {
      stats.wikiSkipped = true;
      stats.wikiSkipReason = 'schema_not_ready';
      return;
    }
    throw error;
  }

  const rows = Array.isArray(data) ? (data as DroneShipStaticRow[]) : [];
  const rowBySlug = new Map<CanonicalShipSlug, DroneShipStaticRow>();
  for (const row of rows) {
    const slug = parseCanonicalShipSlug(row.slug);
    if (!slug) continue;
    rowBySlug.set(slug, row);
  }

  for (const slug of canonicalSlugs) {
    const current = rowBySlug.get(slug);
    if (current && !shouldSyncWikiRow(current, syncIntervalDays)) {
      stats.wikiSkippedFresh = (stats.wikiSkippedFresh as number) + 1;
      continue;
    }

    try {
      const qid = normalizeText(current?.wikidata_id) || SHIP_WIKIDATA_ID_BY_SLUG[slug];
      if (!qid) throw new Error('missing_wikidata_id');

      const entity = await fetchWikidataEntity(qid, stats);
      if (!entity) throw new Error(`missing_wikidata_entity:${qid}`);

      const imageTitle = readWikidataStringClaim(entity, 'P18');
      const commonsCategory = readWikidataStringClaim(entity, 'P373');
      const ownerQid = readWikidataEntityIdClaim(entity, 'P127');
      const operatorQid = readWikidataEntityIdClaim(entity, 'P137');
      const countryQid = readWikidataEntityIdClaim(entity, 'P495');
      const homePortQid = readWikidataEntityIdClaim(entity, 'P504');
      const wikipediaTitle = normalizeText(entity?.sitelinks?.enwiki?.title);
      const lengthM = readWikidataQuantityClaim(entity, 'P2043');
      const yearBuilt = readWikidataYearClaim(entity, ['P571', 'P575', 'P729']);

      const labelMap = await fetchWikidataEntityLabels([ownerQid, operatorQid, countryQid, homePortQid], stats);
      const commonsImage = imageTitle ? await fetchWikimediaCommonsImageMetadata(imageTitle, stats) : null;
      const shipLabel =
        normalizeText(entity?.labels?.en?.value) ||
        (slug === 'ocisly' ? 'Of Course I Still Love You' : slug === 'asog' ? 'A Shortfall of Gravitas' : 'Just Read the Instructions');

      const updatePayload = {
        wikidata_id: qid,
        wiki_source_url: `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`,
        wikipedia_url: wikipediaTitle ? buildWikipediaArticleUrl(wikipediaTitle) : null,
        wikimedia_commons_category: commonsCategory || null,
        wiki_last_synced_at: new Date().toISOString(),
        image_url: normalizeText(commonsImage?.url) || null,
        image_source_url: normalizeText(commonsImage?.sourceUrl) || null,
        image_license: normalizeText(commonsImage?.license) || null,
        image_license_url: normalizeText(commonsImage?.licenseUrl) || null,
        image_credit: normalizeText(commonsImage?.credit) || null,
        image_alt: `${shipLabel} autonomous drone ship`,
        length_m: lengthM,
        year_built: yearBuilt,
        home_port: labelMap.get(homePortQid) || null,
        owner_name: labelMap.get(ownerQid) || null,
        operator_name: labelMap.get(operatorQid) || null,
        country_name: labelMap.get(countryQid) || null,
        updated_at: new Date().toISOString()
      };

      const { error: updateError } = await supabase.from('spacex_drone_ships').update(updatePayload).eq('slug', slug);
      if (updateError) {
        if (isMissingWikiSchemaError(updateError.message || '')) {
          stats.wikiSkipped = true;
          stats.wikiSkipReason = 'schema_not_ready';
          return;
        }
        throw updateError;
      }

      stats.wikiSynced = (stats.wikiSynced as number) + 1;
    } catch (err) {
      (stats.wikiFailures as Array<{ slug: CanonicalShipSlug; reason: string }>).push({
        slug,
        reason: stringifyError(err)
      });
    }
  }
}

async function fetchWikidataEntity(qid: string, stats: Record<string, unknown>) {
  const safeQid = normalizeText(qid);
  if (!safeQid) return null;
  const url = `${WIKIDATA_ENTITY_BASE}/${encodeURIComponent(safeQid)}.json`;
  const payload = await fetchJsonWithWikiHeaders(url, stats);
  const entity = payload?.entities?.[safeQid];
  return entity && typeof entity === 'object' ? (entity as WikidataEntity) : null;
}

async function fetchWikidataEntityLabels(qids: Array<string | null | undefined>, stats: Record<string, unknown>) {
  const labels = new Map<string, string>();
  const unique = [...new Set(qids.map((value) => normalizeText(value)).filter(Boolean))];
  if (!unique.length) return labels;

  const url =
    `${WIKIDATA_API}?action=wbgetentities&format=json&props=labels&languages=en&ids=` +
    encodeURIComponent(unique.join('|'));
  const payload = await fetchJsonWithWikiHeaders(url, stats);
  const entities = payload?.entities;
  if (!entities || typeof entities !== 'object') return labels;

  for (const qid of unique) {
    const label = normalizeText(entities?.[qid]?.labels?.en?.value);
    if (label) labels.set(qid, label);
  }
  return labels;
}

async function fetchWikimediaCommonsImageMetadata(imageTitle: string, stats: Record<string, unknown>) {
  const title = normalizeText(imageTitle);
  if (!title) return null;
  const fileTitle = title.toLowerCase().startsWith('file:') ? title : `File:${title}`;
  const url =
    `${WIKIMEDIA_COMMONS_API}?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&titles=` +
    encodeURIComponent(fileTitle);

  const payload = await fetchJsonWithWikiHeaders(url, stats);
  const pages = payload?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const firstPage = Object.values(pages)[0] as { imageinfo?: Array<Record<string, unknown>> } | undefined;
  const imageInfo = Array.isArray(firstPage?.imageinfo) ? firstPage?.imageinfo?.[0] : null;
  if (!imageInfo || typeof imageInfo !== 'object') return null;

  const extMeta = (imageInfo.extmetadata || {}) as Record<string, { value?: string }>;
  const license = parseWikiMetaText(extMeta?.LicenseShortName?.value);
  const licenseUrl = normalizeUrl(parseWikiMetaText(extMeta?.LicenseUrl?.value));
  const artist = parseWikiMetaText(extMeta?.Artist?.value);
  const credit = parseWikiMetaText(extMeta?.Credit?.value) || artist;
  const imageUrl = normalizeUrl(normalizeText(imageInfo.url));
  const sourceUrl = normalizeUrl(normalizeText(imageInfo.descriptionurl));

  return {
    url: imageUrl,
    sourceUrl,
    license: license || null,
    licenseUrl,
    credit: credit || null
  };
}

async function fetchJsonWithWikiHeaders(url: string, stats: Record<string, unknown>) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': WIKI_USER_AGENT,
      accept: 'application/json'
    }
  });
  stats.wikiCalls = Number(stats.wikiCalls || 0) + 1;

  if (!response.ok) {
    throw new Error(`wiki_fetch_failed:${response.status}`);
  }

  return await response.json().catch(() => ({} as Record<string, unknown>));
}

function shouldSyncWikiRow(row: DroneShipStaticRow, syncIntervalDays: number) {
  const nowMs = Date.now();
  const syncedAtMs = Date.parse(normalizeText(row.wiki_last_synced_at));
  const hasSyncTimestamp = Number.isFinite(syncedAtMs);
  if (!hasSyncTimestamp) return true;

  const ageMs = nowMs - syncedAtMs;
  const intervalMs = syncIntervalDays * 24 * 60 * 60 * 1000;
  if (ageMs >= intervalMs) return true;

  const criticalMissing = !normalizeText(row.wikidata_id) || !normalizeText(row.wikipedia_url);
  if (criticalMissing && ageMs >= 24 * 60 * 60 * 1000) return true;

  const enrichmentMissing =
    !normalizeText(row.image_url) || parseNumber(row.length_m) == null || !Number.isFinite(Number(row.year_built || NaN));
  if (enrichmentMissing && ageMs >= 7 * 24 * 60 * 60 * 1000) return true;

  return false;
}

function parseCanonicalShipSlug(value: string | null | undefined): CanonicalShipSlug | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (normalized === 'ocisly') return 'ocisly';
  if (normalized === 'asog') return 'asog';
  if (normalized === 'jrti') return 'jrti';
  return null;
}

function readWikidataStringClaim(entity: WikidataEntity | null, propertyId: string) {
  const claimValue = readWikidataClaimValue(entity, propertyId);
  return typeof claimValue === 'string' ? claimValue.trim() : '';
}

function readWikidataEntityIdClaim(entity: WikidataEntity | null, propertyId: string) {
  const claimValue = readWikidataClaimValue(entity, propertyId);
  if (!claimValue || typeof claimValue !== 'object') return '';
  return normalizeText((claimValue as { id?: string }).id);
}

function readWikidataQuantityClaim(entity: WikidataEntity | null, propertyId: string) {
  const claimValue = readWikidataClaimValue(entity, propertyId);
  if (!claimValue || typeof claimValue !== 'object') return null;
  return parseNumber((claimValue as { amount?: string | number }).amount);
}

function readWikidataYearClaim(entity: WikidataEntity | null, propertyIds: string[]) {
  for (const propertyId of propertyIds) {
    const claimValue = readWikidataClaimValue(entity, propertyId);
    if (!claimValue || typeof claimValue !== 'object') continue;
    const time = normalizeText((claimValue as { time?: string }).time);
    const match = time.match(/^([+-]?\d{4,})/);
    if (!match) continue;
    const year = Number.parseInt(match[1], 10);
    if (Number.isFinite(year) && year >= 1800 && year <= 2100) return year;
  }
  return null;
}

function readWikidataClaimValue(entity: WikidataEntity | null, propertyId: string) {
  const claims = entity?.claims;
  if (!claims || typeof claims !== 'object') return null;
  const list = claims[propertyId];
  if (!Array.isArray(list) || !list.length) return null;
  return list[0]?.mainsnak?.datavalue?.value ?? null;
}

function buildWikipediaArticleUrl(title: string) {
  const normalized = normalizeText(title).replace(/\s+/g, '_');
  if (!normalized) return null;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(normalized).replace(/%2F/g, '/')}`;
}

function parseWikiMetaText(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const noTags = raw.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(noTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string) {
  if (!value) return '';
  let decoded = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  decoded = decoded.replace(/&#(\d+);/g, (_, code) => {
    const n = Number.parseInt(code, 10);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return String.fromCodePoint(n);
    } catch {
      return '';
    }
  });

  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const n = Number.parseInt(hex, 16);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return String.fromCodePoint(n);
    } catch {
      return '';
    }
  });

  return decoded;
}

function normalizeUrl(value: string | null | undefined) {
  const candidate = normalizeText(value);
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isMissingWikiSchemaError(message: string) {
  const normalized = message.toLowerCase();
  if (!normalized.includes('spacex_drone_ships')) return false;
  return normalized.includes('column') && normalized.includes('does not exist');
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
