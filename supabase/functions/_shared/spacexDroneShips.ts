import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
export const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
export const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';
export const WIKIDATA_ENTITY_BASE = 'https://www.wikidata.org/wiki/Special:EntityData';
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
export const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const WIKI_USER_AGENT = Deno.env.get('WIKI_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';

export const SPACEX_DRONE_SHIP_INGEST_JOB = 'spacex_drone_ship_ingest';
export const SPACEX_DRONE_SHIP_WIKI_SYNC_JOB = 'spacex_drone_ship_wiki_sync';

export const DRONE_SHIP_INGEST_SETTINGS_KEYS = [
  'spacex_drone_ship_ingest_enabled',
  'spacex_drone_ship_ingest_batch_size',
  'spacex_drone_ship_ingest_lookback_days',
  'spacex_drone_ship_ingest_lookahead_days',
  'spacex_drone_ship_ingest_stale_hours',
  'spacex_drone_ship_ingest_lock_ttl_seconds',
  'spacex_drone_ship_ll2_fetch_timeout_ms',
  'll2_rate_limit_per_hour'
] as const;

export const DRONE_SHIP_WIKI_SETTINGS_KEYS = [
  'spacex_drone_ship_wiki_sync_enabled',
  'spacex_drone_ship_wiki_sync_interval_days',
  'spacex_drone_ship_wiki_fetch_timeout_ms',
  'spacex_drone_ship_wiki_sync_lock_ttl_seconds'
] as const;

export const DRONE_SHIP_INGEST_DEFAULTS = {
  enabled: true,
  batchSize: 12,
  lookbackDays: 2,
  lookaheadDays: 7,
  staleHours: 48,
  lockTtlSeconds: 900,
  ll2FetchTimeoutMs: 12_000,
  ll2RateLimitPerHour: 300
} as const;

export const DRONE_SHIP_WIKI_DEFAULTS = {
  enabled: true,
  syncIntervalDays: 30,
  lockTtlSeconds: 900,
  wikiFetchTimeoutMs: 10_000
} as const;

export const DRONE_SHIP_WIKI_STAT_KEYS = [
  'spacex_drone_ship_wiki_sync_last_started_at',
  'spacex_drone_ship_wiki_sync_last_completed_at',
  'spacex_drone_ship_wiki_sync_last_success_at',
  'spacex_drone_ship_wiki_sync_last_error',
  'spacex_drone_ship_wiki_sync_last_checked_count',
  'spacex_drone_ship_wiki_sync_last_changed_count'
] as const;

export const DRONE_SHIP_INGEST_STAT_KEYS = [
  'spacex_drone_ship_ingest_last_started_at',
  'spacex_drone_ship_ingest_last_completed_at',
  'spacex_drone_ship_ingest_last_success_at',
  'spacex_drone_ship_ingest_last_error',
  'spacex_drone_ship_ingest_last_checked_count',
  'spacex_drone_ship_ingest_last_changed_count'
] as const;

export type CandidateRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  net: string | null;
  assignment_last_verified: string | null;
};

export type Ll2Landing = {
  id: number;
  attempt?: boolean;
  success?: boolean | null;
  landing?: string | null;
  landing_location?: {
    name?: string | null;
    abbrev?: string | null;
  } | null;
};

export const DRONE_SHIP_CANONICAL_SLUGS = ['ocisly', 'asog', 'jrti'] as const;
export type CanonicalShipSlug = (typeof DRONE_SHIP_CANONICAL_SLUGS)[number];

export type CanonicalizedShip = {
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

type JobStatePatch = {
  startedAt?: string;
  completedAt?: string;
  successAt?: string;
  error?: string;
  checkedCount?: number;
  changedCount?: number;
};

const SHIP_WIKIDATA_ID_BY_SLUG: Record<CanonicalShipSlug, string> = {
  ocisly: 'Q23891316',
  asog: 'Q107172359',
  jrti: 'Q96157645'
};

export function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function normalizeIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

function normalizeToken(value: string | null | undefined) {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function canonicalizeShip(name: string | null | undefined, abbrev: string | null | undefined): CanonicalizedShip {
  const rawName = normalizeNullableText(name);
  const rawAbbrev = normalizeNullableText(abbrev);
  const tokens = [normalizeToken(rawAbbrev), normalizeToken(rawName)].filter(Boolean);

  for (const token of tokens) {
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

export function resolveLandingResult(attempt: boolean | null, success: boolean | null) {
  if (attempt === false) return 'no_attempt';
  if (attempt === true && success === true) return 'success';
  if (attempt === true && success === false) return 'failure';
  return 'unknown';
}

export function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) headers.Authorization = `Token ${LL2_API_KEY}`;
  return headers;
}

export async function fetchLandingsForLaunch({
  supabase,
  ll2LaunchUuid,
  ll2RateLimit,
  stats,
  timeoutMs
}: {
  supabase: SupabaseClient;
  ll2LaunchUuid: string;
  ll2RateLimit: number;
  stats: Record<string, unknown>;
  timeoutMs: number;
}) {
  if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) return [] as Ll2Landing[];

  const rate = await tryConsumeLl2(supabase, ll2RateLimit);
  if (!rate.allowed) {
    stats.ll2RateLimited = true;
    return [] as Ll2Landing[];
  }

  const query = `firststage_launch__ids=${encodeURIComponent(ll2LaunchUuid)}`;
  const url = `${LL2_BASE}/landings/?format=json&mode=detailed&limit=20&${query}`;
  stats.ll2Calls = Number(stats.ll2Calls || 0) + 1;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: buildLl2Headers(),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      stats.ll2Timeouts = Number(stats.ll2Timeouts || 0) + 1;
      throw new Error(`ll2_fetch_timeout:${timeoutMs}`);
    }
    throw error;
  }

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

  const json = (await res.json().catch(() => ({}))) as { results?: unknown };
  return Array.isArray(json.results) ? (json.results as Ll2Landing[]) : [];
}

async function tryConsumeLl2(supabase: SupabaseClient, limit: number) {
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

export async function syncDroneShipWikiEnrichment({
  supabase,
  syncIntervalDays,
  stats,
  timeoutMs
}: {
  supabase: SupabaseClient;
  syncIntervalDays: number;
  stats: Record<string, unknown>;
  timeoutMs: number;
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
      stats.wikiSkippedFresh = Number(stats.wikiSkippedFresh || 0) + 1;
      continue;
    }

    try {
      const qid = normalizeText(current?.wikidata_id) || SHIP_WIKIDATA_ID_BY_SLUG[slug];
      if (!qid) throw new Error('missing_wikidata_id');

      const entity = await fetchWikidataEntity(qid, stats, timeoutMs);
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

      const labelMap = await fetchWikidataEntityLabels([ownerQid, operatorQid, countryQid, homePortQid], stats, timeoutMs);
      const commonsImage = imageTitle ? await fetchWikimediaCommonsImageMetadata(imageTitle, stats, timeoutMs) : null;
      const shipLabel =
        normalizeText(entity?.labels?.en?.value) ||
        (slug === 'ocisly' ? 'Of Course I Still Love You' : slug === 'asog' ? 'A Shortfall of Gravitas' : 'Just Read the Instructions');

      const updatePayload = {
        wikidata_id: qid,
        wiki_source_url: `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`,
        wikipedia_url: wikipediaTitle ? buildWikipediaArticleUrl(wikipediaTitle) : null,
        wikimedia_commons_category: commonsCategory || null,
        wiki_last_synced_at: new Date().toISOString(),
        image_url: normalizeNullableText(commonsImage?.url),
        image_source_url: normalizeNullableText(commonsImage?.sourceUrl),
        image_license: normalizeNullableText(commonsImage?.license),
        image_license_url: normalizeNullableText(commonsImage?.licenseUrl),
        image_credit: normalizeNullableText(commonsImage?.credit),
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

      stats.wikiSynced = Number(stats.wikiSynced || 0) + 1;
    } catch (err) {
      (stats.wikiFailures as Array<{ slug: CanonicalShipSlug; reason: string }>).push({
        slug,
        reason: stringifyError(err)
      });
    }
  }
}

async function fetchWikidataEntity(qid: string, stats: Record<string, unknown>, timeoutMs: number) {
  const safeQid = normalizeText(qid);
  if (!safeQid) return null;
  const url = `${WIKIDATA_ENTITY_BASE}/${encodeURIComponent(safeQid)}.json`;
  const payload = await fetchJsonWithWikiHeaders(url, stats, timeoutMs);
  const entities = (payload as { entities?: Record<string, unknown> } | null)?.entities;
  const entity = entities?.[safeQid];
  return entity && typeof entity === 'object' ? (entity as WikidataEntity) : null;
}

async function fetchWikidataEntityLabels(qids: Array<string | null | undefined>, stats: Record<string, unknown>, timeoutMs: number) {
  const labels = new Map<string, string>();
  const unique = [...new Set(qids.map((value) => normalizeText(value)).filter(Boolean))];
  if (!unique.length) return labels;

  const url =
    `${WIKIDATA_API}?action=wbgetentities&format=json&props=labels&languages=en&ids=` + encodeURIComponent(unique.join('|'));
  const payload = await fetchJsonWithWikiHeaders(url, stats, timeoutMs);
  const entities = (payload as { entities?: Record<string, unknown> } | null)?.entities;
  if (!entities || typeof entities !== 'object') return labels;

  for (const qid of unique) {
    const entity = entities[qid] as { labels?: { en?: { value?: string } } } | undefined;
    const label = normalizeText(entity?.labels?.en?.value);
    if (label) labels.set(qid, label);
  }
  return labels;
}

async function fetchWikimediaCommonsImageMetadata(imageTitle: string, stats: Record<string, unknown>, timeoutMs: number) {
  const title = normalizeText(imageTitle);
  if (!title) return null;
  const fileTitle = title.toLowerCase().startsWith('file:') ? title : `File:${title}`;
  const url =
    `${WIKIMEDIA_COMMONS_API}?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&titles=` + encodeURIComponent(fileTitle);

  const payload = await fetchJsonWithWikiHeaders(url, stats, timeoutMs);
  const pages = (payload as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages;
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

async function fetchJsonWithWikiHeaders(url: string, stats: Record<string, unknown>, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': WIKI_USER_AGENT,
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    stats.wikiTimeouts = Number(stats.wikiTimeouts || 0) + 1;
    if (isTimeoutError(error)) {
      throw new Error(`wiki_fetch_timeout:${timeoutMs}`);
    }
    throw error;
  }

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

  const enrichmentMissing = !normalizeText(row.image_url) || parseNumber(row.length_m) == null || !Number.isFinite(Number(row.year_built || NaN));
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

function isTimeoutError(error: unknown) {
  if (error instanceof DOMException) return error.name === 'TimeoutError' || error.name === 'AbortError';
  const message = stringifyError(error).toLowerCase();
  return message.includes('timeout') || message.includes('abort');
}

export async function startIngestionRun(supabase: SupabaseClient, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

export async function finishIngestionRun(
  supabase: SupabaseClient,
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

export async function upsertSettings(
  supabase: SupabaseClient,
  entries: Array<{ key: string; value: string | number | boolean }>
) {
  if (!entries.length) return;
  const updatedAt = new Date().toISOString();
  const rows = entries.map((entry) => ({
    ...entry,
    updated_at: updatedAt
  }));
  const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

export async function upsertJobState(supabase: SupabaseClient, jobPrefix: string, patch: JobStatePatch) {
  const entries: Array<{ key: string; value: string | number | boolean }> = [];

  if (patch.startedAt !== undefined) {
    entries.push({ key: `${jobPrefix}_last_started_at`, value: patch.startedAt });
  }
  if (patch.completedAt !== undefined) {
    entries.push({ key: `${jobPrefix}_last_completed_at`, value: patch.completedAt });
  }
  if (patch.successAt !== undefined) {
    entries.push({ key: `${jobPrefix}_last_success_at`, value: patch.successAt });
  }
  if (patch.error !== undefined) {
    entries.push({ key: `${jobPrefix}_last_error`, value: patch.error });
  }
  if (patch.checkedCount !== undefined) {
    entries.push({ key: `${jobPrefix}_last_checked_count`, value: patch.checkedCount });
  }
  if (patch.changedCount !== undefined) {
    entries.push({ key: `${jobPrefix}_last_changed_count`, value: patch.changedCount });
  }

  await upsertSettings(supabase, entries);
}

export async function tryAcquireJobLock(
  supabase: SupabaseClient,
  lockName: string,
  ttlSeconds: number,
  lockId: string
) {
  const { data, error } = await supabase.rpc('try_acquire_job_lock', {
    lock_name_in: lockName,
    ttl_seconds_in: ttlSeconds,
    locked_by_in: lockId
  });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseJobLock(supabase: SupabaseClient, lockName: string, lockId: string | null) {
  if (!lockId) return;
  const { error } = await supabase.rpc('release_job_lock', {
    lock_name_in: lockName,
    locked_by_in: lockId
  });
  if (error) {
    console.warn('Failed to release job lock', { lockName, lockId, error: error.message });
  }
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
