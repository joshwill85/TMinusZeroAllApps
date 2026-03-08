import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE, triggerEdgeJob } from '../_shared/edgeJobTrigger.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const PARSER_VERSION = 'v1';

const GOVDELIVERY_TOPIC_ID = 'USDHSCG_422';
const DEFAULT_FEED_URL = 'https://public.govdelivery.com/topics/USDHSCG_422/feed.rss';
const NAVCEN_MESSAGE_URL = 'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=';

const DEFAULTS = {
  enabled: true,
  lookbackHours: 72,
  itemLimit: 60,
  recheckLookbackDays: 30,
  recheckLimit: 20,
  matchHorizonDays: 21
};

type RssItem = {
  title: string | null;
  link: string | null;
  guid: string | null;
  publishedAt: string | null;
};

type CandidateLaunch = {
  launch_id: string;
  name: string | null;
  provider: string | null;
  vehicle: string | null;
  mission_name: string | null;
  pad_name: string | null;
  rocket_full_name: string | null;
  rocket_family: string | null;
  rocket_variant: string | null;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
};

type TimeWindow = { startIso: string; endIso: string; raw: string };

type ParsedHazardArea = {
  areaName: string;
  geometry: Record<string, unknown> | null;
  rawTextSnippet: string | null;
  validStartUtc: string | null;
  validEndUtc: string | null;
  windows: TimeWindow[];
  data: Record<string, unknown>;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'navcen_bnm_ingest');

  const stats: Record<string, unknown> = {
    feedUrl: null as string | null,
    lookbackHours: null as number | null,
    itemLimit: null as number | null,
    rssCursorBefore: null as string | null,
    rssCursorAfter: null as string | null,
    rssItems: 0,
    rssItemsConsidered: 0,
    rssItemsSkippedByCursor: 0,
    rssItemsSkippedByTitle: 0,
    bulletinsFetched: 0,
    navcenGuidsDiscovered: 0,
    navcenMessagesFetched: 0,
    navcenMessagesInserted: 0,
    navcenMessagesUnchanged: 0,
    hazardAreasParsed: 0,
    hazardAreasUpserted: 0,
    hazardAreasMatched: 0,
    hazardAreasAmbiguous: 0,
    hazardAreasUnmatched: 0,
    constraintsUpserted: 0,
    constraintsMergedInput: 0,
    constraintsInserted: 0,
    constraintsUpdated: 0,
    constraintsSkipped: 0,
    mergeFallback: false,
    launchCoverage: {} as Record<
      string,
      {
        hazardAreasMatched: number;
        constraintsUpserted: number;
      }
    >,
    trajectoryProductsTrigger: null as Record<string, unknown> | null,
    recheckGuids: 0,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'navcen_bnm_job_enabled',
      'navcen_bnm_feed_url',
      'navcen_bnm_lookback_hours',
      'navcen_bnm_item_limit',
      'navcen_bnm_rss_cursor_published_at',
      'navcen_bnm_recheck_days',
      'navcen_bnm_recheck_limit',
      'navcen_bnm_match_horizon_days'
    ]);

    const enabled = readBooleanSetting(settings.navcen_bnm_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const feedUrl = readStringSetting(settings.navcen_bnm_feed_url, DEFAULT_FEED_URL).trim() || DEFAULT_FEED_URL;
    const lookbackHours = clampInt(readNumberSetting(settings.navcen_bnm_lookback_hours, DEFAULTS.lookbackHours), 1, 240);
    const itemLimit = clampInt(readNumberSetting(settings.navcen_bnm_item_limit, DEFAULTS.itemLimit), 1, 200);
    const recheckDays = clampInt(readNumberSetting(settings.navcen_bnm_recheck_days, DEFAULTS.recheckLookbackDays), 1, 90);
    const recheckLimit = clampInt(readNumberSetting(settings.navcen_bnm_recheck_limit, DEFAULTS.recheckLimit), 0, 200);
    const matchHorizonDays = clampInt(readNumberSetting(settings.navcen_bnm_match_horizon_days, DEFAULTS.matchHorizonDays), 1, 90);

    stats.feedUrl = feedUrl;
    stats.lookbackHours = lookbackHours;
    stats.itemLimit = itemLimit;

    const cursorRaw = readStringSetting(settings.navcen_bnm_rss_cursor_published_at, '').trim();
    const cursorMs = cursorRaw ? Date.parse(cursorRaw) : NaN;
    stats.rssCursorBefore = cursorRaw || null;

    const nowMs = Date.now();
    const lookbackMs = lookbackHours * 60 * 60 * 1000;
    const lookbackCutoffMs = nowMs - lookbackMs;

    const candidates = await loadCandidateLaunches(supabase, matchHorizonDays);
    for (const candidate of candidates) {
      ensureNavcenLaunchCoverage(stats, candidate.launch_id);
    }

    const rssXml = await fetchText(feedUrl, { accept: 'application/rss+xml, application/xml, text/xml' });
    const rssItems = parseRss(rssXml);
    stats.rssItems = rssItems.length;

    const recentItems = rssItems
      .filter((item) => {
        const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
        if (Number.isFinite(t) && t < lookbackCutoffMs) return false;
        if (Number.isFinite(cursorMs) && Number.isFinite(t) && t <= cursorMs) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
        const aa = Number.isFinite(ta) ? ta : -Infinity;
        const bb = Number.isFinite(tb) ? tb : -Infinity;
        return bb - aa;
      })
      .slice(0, itemLimit);

    stats.rssItemsConsidered = recentItems.length;

    if (Number.isFinite(cursorMs)) {
      stats.rssItemsSkippedByCursor = rssItems.reduce((count, item) => {
        const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
        return count + (Number.isFinite(t) && t <= cursorMs ? 1 : 0);
      }, 0);
    }

    const navcenGuids = new Set<string>();
    const bulletinByGuid = new Map<string, { bulletinUrl: string | null; item: RssItem }>();

    for (const item of recentItems) {
      const itemGuid = item.guid?.trim() ?? '';
      if (itemGuid && /^\d+$/.test(itemGuid)) {
        if (!navcenGuids.has(itemGuid)) {
          navcenGuids.add(itemGuid);
          bulletinByGuid.set(itemGuid, { bulletinUrl: item.link ?? null, item });
        }
        continue;
      }

      if (!item.link) continue;
      const resolved = await resolveNavcenGuidsFromLink(item.link).catch((err) => {
        (stats.errors as any[]).push({
          step: 'resolve_bulletin',
          error: stringifyError(err),
          context: { link: item.link }
        });
        return [] as string[];
      });
      if (resolved.length) stats.bulletinsFetched = (stats.bulletinsFetched as number) + 1;
      for (const guid of resolved) {
        if (!navcenGuids.has(guid)) {
          navcenGuids.add(guid);
          bulletinByGuid.set(guid, { bulletinUrl: item.link, item });
        }
      }
    }

    // Re-check recent/active GUIDs in case NAVCEN edits a message without a new RSS/bulletin item.
    const recheckGuids = recheckLimit > 0 ? await loadGuidsToRecheck(supabase, recheckDays, recheckLimit) : [];
    stats.recheckGuids = recheckGuids.length;
    for (const guid of recheckGuids) {
      if (!navcenGuids.has(guid)) {
        navcenGuids.add(guid);
        bulletinByGuid.set(guid, { bulletinUrl: null, item: { title: null, link: null, guid: null, publishedAt: null } });
      }
    }

    stats.navcenGuidsDiscovered = navcenGuids.size;

    for (const guid of navcenGuids) {
      const context = bulletinByGuid.get(guid) ?? null;
      await ingestNavcenGuid({
        supabase,
        runId,
        guid,
        context,
        feedUrl,
        candidates,
        stats
      });
    }

    const maxRssMs = recentItems.reduce((max, item) => {
      const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (!Number.isFinite(t)) return max;
      return Math.max(max, t);
    }, Number.isFinite(cursorMs) ? cursorMs : -Infinity);
    if (Number.isFinite(maxRssMs)) {
      const nextCursor = new Date(maxRssMs).toISOString();
      stats.rssCursorAfter = nextCursor;
      await supabase
        .from('system_settings')
        .upsert({ key: 'navcen_bnm_rss_cursor_published_at', value: nextCursor, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }

    const ok = (stats.errors as Array<any>).length === 0;
    if (ok && hasPositiveNavcenLaunchCoverage(stats)) {
      stats.trajectoryProductsTrigger = await triggerEdgeJob({
        supabase,
        jobSlug: 'trajectory-products-generate',
        coalesce: TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE
      });
    }
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

async function ingestNavcenGuid({
  supabase,
  runId,
  guid,
  context,
  feedUrl,
  candidates,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  runId: number | null;
  guid: string;
  context: { bulletinUrl: string | null; item: RssItem } | null;
  feedUrl: string;
  candidates: CandidateLaunch[];
  stats: Record<string, unknown>;
}) {
  const messageUrl = `${NAVCEN_MESSAGE_URL}${encodeURIComponent(guid)}`;
  const res = await fetch(messageUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  stats.navcenMessagesFetched = (stats.navcenMessagesFetched as number) + 1;
  if (!res.ok) {
    (stats.errors as any[]).push({
      step: 'fetch_navcen_message',
      error: `navcen_${res.status}`,
      context: { guid, messageUrl }
    });
    return;
  }

  const html = await res.text().catch(() => '');
  const bytes = new TextEncoder().encode(html);
  const sha256 = await sha256Hex(bytes);
  const etag = res.headers.get('etag');
  const lmHeader = res.headers.get('last-modified');
  const lastModified = lmHeader ? new Date(lmHeader).toISOString() : null;

  const existing = await loadMessageByGuidAndHash(supabase, guid, sha256);
  if (existing) {
    stats.navcenMessagesUnchanged = (stats.navcenMessagesUnchanged as number) + 1;
  }

  const extractedText = extractTextFromHtml(html);
  const titleFromHtml = extractTitleFromHtml(html);
  const parsedTitle = titleFromHtml || inferTitleFromText(extractedText);
  const category = inferCategoryFromText(extractedText);

  const windows = parseTimeWindows(extractedText);
  const { validStartUtc, validEndUtc } = summarizeWindows(windows);

  const messageId =
    existing?.id ??
    (await insertMessage({
      supabase,
      guid,
      messageUrl,
      sha256,
      httpStatus: res.status,
      etag,
      lastModified,
      bytes: bytes.length,
      title: parsedTitle,
      category,
      validStartUtc,
      validEndUtc,
      rawText: extractedText,
      rawHtml: html,
      rssFeedUrl: feedUrl,
      context
    }).catch((err) => {
      (stats.errors as any[]).push({
        step: 'insert_message',
        error: stringifyError(err),
        context: { guid, messageUrl }
      });
      return null as string | null;
    }));

  if (!messageId) return;
  if (!existing) stats.navcenMessagesInserted = (stats.navcenMessagesInserted as number) + 1;

  const matchText = buildMatchText(context?.item?.title ?? null, parsedTitle, extractedText);
  const areas = parseHazardAreas(extractedText, windows, { validStartUtc, validEndUtc });
  stats.hazardAreasParsed = (stats.hazardAreasParsed as number) + areas.length;
  if (!areas.length) return;
  const constraintRows: Array<Record<string, unknown>> = [];
  const preparedConstraintRowsByLaunch = new Map<string, number>();

  for (const area of areas) {
    const match = matchHazardAreaToLaunch(area, candidates, matchText);
    const matchStatus = match.status;

    if (matchStatus === 'matched') stats.hazardAreasMatched = (stats.hazardAreasMatched as number) + 1;
    else if (matchStatus === 'ambiguous') stats.hazardAreasAmbiguous = (stats.hazardAreasAmbiguous as number) + 1;
    else stats.hazardAreasUnmatched = (stats.hazardAreasUnmatched as number) + 1;

    if (match.status === 'matched' && match.launchId) {
      bumpNavcenLaunchCoverage(stats, match.launchId, 'hazardAreasMatched');
    }

    const { areaRowUpserted } = await upsertHazardArea({
      supabase,
      messageId,
      guid,
      area,
      match
    }).catch((err) => {
      (stats.errors as any[]).push({
        step: 'upsert_hazard_area',
        error: stringifyError(err),
        context: { guid, areaName: area.areaName }
      });
      return { areaRowUpserted: false };
    });
    if (areaRowUpserted) stats.hazardAreasUpserted = (stats.hazardAreasUpserted as number) + 1;

    if (match.status === 'matched' && match.launchId && area.geometry) {
      const sourceId = buildConstraintSourceId({
        guid,
        messageSha256: sha256,
        areaName: area.areaName,
        validStartUtc: area.validStartUtc,
        validEndUtc: area.validEndUtc
      });

      const row = {
        launch_id: match.launchId,
        source: 'navcen_bnm',
        source_id: sourceId,
        constraint_type: 'hazard_area',
        ingestion_run_id: runId,
        source_hash: sha256,
        extracted_field_map: {
          geometry: Boolean(area.geometry),
          valid_window: Boolean(area.validStartUtc || area.validEndUtc),
          windows: Array.isArray(area.windows) && area.windows.length > 0,
          area_name: Boolean(area.areaName),
          navcen_guid: Boolean(guid)
        },
        parse_rule_id: 'navcen_bnm_hazard_extract_v1',
        parser_version: PARSER_VERSION,
        license_class: 'public_navcen',
        data: {
          navcenGuid: guid,
          title: parsedTitle,
          category,
          areaName: area.areaName,
          validStartUtc: area.validStartUtc,
          validEndUtc: area.validEndUtc,
          windows: area.windows,
          sourceUrl: messageUrl,
          rawTextSnippet: area.rawTextSnippet,
          sourceHash: sha256
        },
        geometry: area.geometry,
        confidence: typeof match.confidence === 'number' ? match.confidence / 100 : null,
        fetched_at: new Date().toISOString()
      };
      constraintRows.push(row);
      preparedConstraintRowsByLaunch.set(match.launchId, (preparedConstraintRowsByLaunch.get(match.launchId) ?? 0) + 1);
    }
  }

  if (!constraintRows.length) return;

  const merged = await upsertTrajectoryConstraintsIfChanged(supabase, constraintRows).catch((err) => {
    (stats.errors as any[]).push({
      step: 'upsert_constraint_batch',
      error: stringifyError(err),
      context: { guid, rows: constraintRows.length }
    });
    return null;
  });
  if (!merged) return;

  stats.constraintsMergedInput = (stats.constraintsMergedInput as number) + merged.input;
  stats.constraintsInserted = (stats.constraintsInserted as number) + merged.inserted;
  stats.constraintsUpdated = (stats.constraintsUpdated as number) + merged.updated;
  stats.constraintsSkipped = (stats.constraintsSkipped as number) + merged.skipped;
  stats.constraintsUpserted = (stats.constraintsUpserted as number) + constraintRows.length;
  stats.mergeFallback = Boolean(stats.mergeFallback) || merged.usedFallback;

  for (const [launchId, count] of preparedConstraintRowsByLaunch.entries()) {
    for (let i = 0; i < count; i += 1) {
      bumpNavcenLaunchCoverage(stats, launchId, 'constraintsUpserted');
    }
  }
}

function bumpNavcenLaunchCoverage(
  stats: Record<string, unknown>,
  launchId: string,
  key: 'hazardAreasMatched' | 'constraintsUpserted'
) {
  ensureNavcenLaunchCoverage(stats, launchId);
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  launchCoverage[launchId][key] += 1;
}

function ensureNavcenLaunchCoverage(stats: Record<string, unknown>, launchId: string) {
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  if (!launchCoverage[launchId]) {
    launchCoverage[launchId] = { hazardAreasMatched: 0, constraintsUpserted: 0 };
  }
}

function hasPositiveNavcenLaunchCoverage(stats: Record<string, unknown>) {
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  return Object.values(launchCoverage).some(
    (entry) =>
      (typeof entry?.hazardAreasMatched === 'number' && entry.hazardAreasMatched > 0) ||
      (typeof entry?.constraintsUpserted === 'number' && entry.constraintsUpserted > 0)
  );
}

async function loadCandidateLaunches(supabase: ReturnType<typeof createSupabaseAdminClient>, horizonDays: number) {
  const nowMs = Date.now();
  const fromIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,name,provider,vehicle,mission_name,pad_name,rocket_full_name,rocket_family,rocket_variant,net,window_start,window_end,pad_latitude,pad_longitude'
    )
    .gte('net', fromIso)
    .lte('net', toIso)
    .order('net', { ascending: true })
    .limit(250);
  if (error) throw error;

  const launches = (data as CandidateLaunch[] | null) ?? [];
  return launches.filter((row) => isNavcenPad(row.pad_latitude, row.pad_longitude));
}

function isNavcenPad(lat: number | null, lon: number | null) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  // NAVCEN BNM feed coverage appears US-focused; start with US coastal launch sites.
  // Cape Canaveral / KSC bounding box (same as scripts/generate-trajectory-products.ts).
  const isCape = lat >= 27.0 && lat <= 29.6 && lon >= -82.5 && lon <= -79.0;
  // Vandenberg bounding box (same as scripts/generate-trajectory-products.ts).
  const isVandenberg = lat >= 33.0 && lat <= 35.8 && lon >= -121.9 && lon <= -119.0;
  // Starbase / Boca Chica bounding box (same as scripts/generate-trajectory-products.ts).
  const isStarbase = lat >= 25.5 && lat <= 26.6 && lon >= -98.2 && lon <= -96.4;
  // Wallops / Mid-Atlantic (Rocket Lab, etc) rough bounding box.
  const isWallops = lat >= 36.5 && lat <= 38.5 && lon >= -76.5 && lon <= -74.0;
  return isCape || isVandenberg || isStarbase || isWallops;
}

async function loadGuidsToRecheck(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  lookbackDays: number,
  limit: number
) {
  const nowMs = Date.now();
  const fromIso = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('navcen_bnm_messages')
    .select('navcen_guid, fetched_at, valid_end')
    .gte('fetched_at', fromIso)
    .order('fetched_at', { ascending: false })
    .limit(Math.min(limit * 5, 1000));
  if (error) throw error;

  const guids: string[] = [];
  const seen = new Set<string>();
  for (const row of (data as any[]) || []) {
    const guid = typeof row?.navcen_guid === 'string' ? row.navcen_guid : null;
    if (!guid || seen.has(guid)) continue;
    const validEndMs = row?.valid_end ? Date.parse(row.valid_end) : NaN;
    if (Number.isFinite(validEndMs) && validEndMs < nowMs - 24 * 60 * 60 * 1000) continue;
    seen.add(guid);
    guids.push(guid);
    if (guids.length >= limit) break;
  }
  return guids;
}

async function insertMessage(args: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  guid: string;
  messageUrl: string;
  sha256: string;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
  title: string | null;
  category: string | null;
  validStartUtc: string | null;
  validEndUtc: string | null;
  rawText: string;
  rawHtml: string;
  rssFeedUrl: string;
  context: { bulletinUrl: string | null; item: RssItem } | null;
}) {
  const { supabase, context } = args;

  const row = {
    navcen_guid: args.guid,
    message_url: args.messageUrl,
    fetched_at: new Date().toISOString(),
    http_status: args.httpStatus,
    etag: args.etag,
    last_modified: args.lastModified,
    sha256: args.sha256,
    bytes: args.bytes,

    rss_feed_url: args.rssFeedUrl,
    govdelivery_topic_id: GOVDELIVERY_TOPIC_ID,
    govdelivery_bulletin_url: context?.bulletinUrl ?? null,
    rss_item_title: context?.item?.title ?? null,
    rss_item_published_at: context?.item?.publishedAt ?? null,

    title: args.title,
    category: args.category,
    valid_start: args.validStartUtc,
    valid_end: args.validEndUtc,

    raw_text: args.rawText,
    raw_html: args.rawHtml,
    raw: { windows: parseTimeWindows(args.rawText) },
    parse_version: PARSER_VERSION,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('navcen_bnm_messages')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // Unique constraint: (navcen_guid, sha256) - if a concurrent job inserted it, load the row.
    if (String(error.code) === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
      const existing = await loadMessageByGuidAndHash(supabase, args.guid, args.sha256);
      if (existing?.id) return existing.id;
    }
    throw error;
  }

  return (data as any)?.id ? String((data as any).id) : null;
}

async function loadMessageByGuidAndHash(supabase: ReturnType<typeof createSupabaseAdminClient>, guid: string, sha256: string) {
  const { data, error } = await supabase
    .from('navcen_bnm_messages')
    .select('id')
    .eq('navcen_guid', guid)
    .eq('sha256', sha256)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data?.id) return null;
  return { id: String((data as any).id) };
}

function parseHazardAreas(text: string, windows: TimeWindow[], summary: { validStartUtc: string | null; validEndUtc: string | null }) {
  const blocks = splitAreaBlocks(text);
  const out: ParsedHazardArea[] = [];

  const validStartUtc = summary.validStartUtc;
  const validEndUtc = summary.validEndUtc;

  // If there are no explicit AREA sections, try parsing the full message as one block.
  const effectiveBlocks = blocks.length ? blocks : [{ areaName: 'AREA', body: text }];

  for (const block of effectiveBlocks) {
    const points = extractLatLonPairs(block.body);
    const circle = points.length < 3 ? tryExtractCircle(block.body) : null;

    let geometry: Record<string, unknown> | null = null;
    let kind: string = 'polygon';
    if (points.length >= 3) {
      geometry = buildPolygonGeometry(points);
      kind = 'polygon';
    } else if (circle) {
      geometry = buildCircleGeometry(circle.center, circle.radiusMeters, 60);
      kind = 'circle';
    } else {
      geometry = null;
      kind = points.length ? 'insufficient_points' : 'none';
    }

    const rawTextSnippet = truncate(block.body.trim().replace(/\s+/g, ' '), 400) || null;

    out.push({
      areaName: block.areaName,
      geometry,
      rawTextSnippet,
      validStartUtc,
      validEndUtc,
      windows,
      data: {
        kind,
        points: points.slice(0, 200),
        hasCoastlineClosureHint: /COASTLINE|SHORELINE/i.test(block.body)
      }
    });
  }

  return out;
}

function splitAreaBlocks(text: string): Array<{ areaName: string; body: string }> {
  const direct = collectAreaMatches(text);
  if (direct.length) return buildAreaBlocks(text, direct);

  const lettered = collectLetteredAreaMatches(text);
  if (lettered.length) return buildAreaBlocks(text, lettered);

  return [];
}

function collectAreaMatches(text: string): Array<{ name: string; start: number; end: number }> {
  const re = /\bAREA\s+([A-Z]|\d{1,2})\b/gi;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const token = (m[1] || '').trim().toUpperCase();
    if (!token) continue;
    matches.push({ name: `AREA ${token}`, start: m.index, end: re.lastIndex });
  }
  return matches;
}

function collectLetteredAreaMatches(text: string): Array<{ name: string; start: number; end: number }> {
  const re = /(^|\n)\s*([A-Z])\.\s+FROM\b/gi;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const token = (m[2] || '').trim().toUpperCase();
    if (!token) continue;
    matches.push({ name: `AREA ${token}`, start: m.index, end: re.lastIndex });
  }
  return matches;
}

function buildAreaBlocks(text: string, matches: Array<{ name: string; start: number; end: number }>) {
  if (matches.length === 0) return [];
  const blocks: Array<{ areaName: string; body: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const next = matches[i + 1];
    const start = cur.end;
    const end = next ? next.start : text.length;
    blocks.push({ areaName: cur.name, body: text.slice(start, end) });
  }
  return blocks;
}

function extractLatLonPairs(text: string): Array<{ lat: number; lon: number }> {
  const cleaned = text
    .replace(/[(),;/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  const points: Array<{ lat: number; lon: number }> = [];

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const lat = parseCoordToken(tokens[i], 'lat');
    if (lat == null) continue;
    const lon = parseCoordToken(tokens[i + 1], 'lon');
    if (lon == null) continue;
    points.push({ lat, lon });
    i += 1;
  }
  return points;
}

function parseCoordToken(token: string, kind: 'lat' | 'lon'): number | null {
  const trimmed = token.trim().toUpperCase();
  if (!trimmed) return null;

  const hemi = trimmed.slice(-1);
  const hemiOk = kind === 'lat' ? hemi === 'N' || hemi === 'S' : hemi === 'E' || hemi === 'W';
  if (!hemiOk) return null;

  const body = trimmed.slice(0, -1);

  // Decimal degrees (e.g., 28.1234N)
  if (/^\d{1,3}(?:\.\d+)?$/.test(body)) {
    const deg = Number(body);
    if (!Number.isFinite(deg)) return null;
    const signed = hemi === 'S' || hemi === 'W' ? -deg : deg;
    return signed;
  }

  // DDMM.M / DDDMM.M (e.g., 2816.27N, 08034.59W)
  if (/^\d{4}\.\d+$/.test(body) && kind === 'lat') {
    const deg = Number(body.slice(0, 2));
    const min = Number(body.slice(2));
    if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
    const signed = hemi === 'S' ? -(deg + min / 60) : deg + min / 60;
    return signed;
  }
  if (/^\d{5}\.\d+$/.test(body) && kind === 'lon') {
    const deg = Number(body.slice(0, 3));
    const min = Number(body.slice(3));
    if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
    const signed = hemi === 'W' ? -(deg + min / 60) : deg + min / 60;
    return signed;
  }

  // DDMMSS / DDDMMSS (e.g., 283000N, 0802400W)
  if (/^\d{6}$/.test(body) && kind === 'lat') {
    const deg = Number(body.slice(0, 2));
    const min = Number(body.slice(2, 4));
    const sec = Number(body.slice(4, 6));
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
    const signed = hemi === 'S' ? -(deg + min / 60 + sec / 3600) : deg + min / 60 + sec / 3600;
    return signed;
  }
  if (/^\d{7}$/.test(body) && kind === 'lon') {
    const deg = Number(body.slice(0, 3));
    const min = Number(body.slice(3, 5));
    const sec = Number(body.slice(5, 7));
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
    const signed = hemi === 'W' ? -(deg + min / 60 + sec / 3600) : deg + min / 60 + sec / 3600;
    return signed;
  }

  // DMS with separators (e.g., 28-30-00N)
  const dms = body.match(/^(\d{1,3})[^0-9]+(\d{1,2})[^0-9]+(\d{1,2}(?:\.\d+)?)$/);
  if (dms) {
    const deg = Number(dms[1]);
    const min = Number(dms[2]);
    const sec = Number(dms[3]);
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
    const value = deg + min / 60 + sec / 3600;
    const signed = hemi === 'S' || hemi === 'W' ? -value : value;
    return signed;
  }

  // DM with separators (e.g., 28-30.00N)
  const dm = body.match(/^(\d{1,3})[^0-9]+(\d{1,2}(?:\.\d+)?)$/);
  if (dm) {
    const deg = Number(dm[1]);
    const min = Number(dm[2]);
    if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
    const value = deg + min / 60;
    const signed = hemi === 'S' || hemi === 'W' ? -value : value;
    return signed;
  }

  return null;
}

function buildPolygonGeometry(points: Array<{ lat: number; lon: number }>) {
  const ring = points.map((p) => [p.lon, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

function tryExtractCircle(text: string): { center: { lat: number; lon: number }; radiusMeters: number } | null {
  const upper = text.toUpperCase();
  const m = upper.match(/(\d+(?:\.\d+)?)\s*NM\s+RADIUS\s+(?:OF|AROUND|CENTERED\s+ON)\s+(\S+)\s+(\S+)/i);
  if (!m) return null;
  const radiusNm = Number(m[1]);
  if (!Number.isFinite(radiusNm) || radiusNm <= 0) return null;
  const lat = parseCoordToken(m[2], 'lat');
  const lon = parseCoordToken(m[3], 'lon');
  if (lat == null || lon == null) return null;
  return { center: { lat, lon }, radiusMeters: radiusNm * 1852 };
}

function buildCircleGeometry(center: { lat: number; lon: number }, radiusMeters: number, steps: number) {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 360;
    const p = directSpherical(center.lat, center.lon, bearing, radiusMeters);
    ring.push([p.lon, p.lat]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function directSpherical(lat1Deg: number, lon1Deg: number, azDeg: number, distM: number) {
  const R = 6_371_000;
  const az = (azDeg * Math.PI) / 180;
  const phi1 = (lat1Deg * Math.PI) / 180;
  const lambda1 = (lon1Deg * Math.PI) / 180;
  const delta = distM / R;

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(az);
  const phi2 = Math.asin(clamp(sinPhi2, -1, 1));

  const y = Math.sin(az) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  const lat = (phi2 * 180) / Math.PI;
  const lon = wrapLonDeg((lambda2 * 180) / Math.PI);
  return { lat, lon };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapLonDeg(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function inferTitleFromText(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const candidate = lines.find((l) => l.length >= 6 && l.length <= 140) ?? null;
  return candidate;
}

function inferCategoryFromText(text: string) {
  if (/SPACE\s+OPERATIONS/i.test(text)) return 'SPACE OPERATIONS';
  if (/ROCKET\s+LAUNCH/i.test(text)) return 'SPACE OPERATIONS';
  return null;
}

function extractTitleFromHtml(html: string) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return decodeHtmlEntities(stripTags(m[1] || '')).trim() || null;
}

function extractTextFromHtml(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h1|h2|h3|h4|h5|pre)>/gi, '\n');

  const noTags = stripTags(withBreaks);
  const decoded = decodeHtmlEntities(noTags);

  // Normalize whitespace, but preserve newlines.
  const lines = decoded
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  return lines.join('\n').trim();
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      if (!Number.isFinite(n)) return '';
      try {
        return String.fromCodePoint(n);
      } catch {
        return '';
      }
    });
}

function parseTimeWindows(text: string): TimeWindow[] {
  const upper = text.toUpperCase().replace(/\s+/g, ' ');
  const windows: TimeWindow[] = [];
  const seen = new Set<string>();

  const monthIdx = (mon: string) => {
    const m = mon.toUpperCase();
    return (
      {
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11
      } as Record<string, number>
    )[m];
  };

  const parseDdHhMm = (token: string, mon: string, yearStr: string) => {
    if (!/^\d{6}$/.test(token)) return null;
    const year = Number(yearStr);
    const mi = monthIdx(mon);
    if (!Number.isFinite(year) || mi == null) return null;
    const day = Number(token.slice(0, 2));
    const hour = Number(token.slice(2, 4));
    const min = Number(token.slice(4, 6));
    if (![day, hour, min].every((n) => Number.isFinite(n))) return null;
    if (day < 1 || day > 31 || hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    return new Date(Date.UTC(year, mi, day, hour, min, 0)).toISOString();
  };

  const addWindow = (startIso: string | null, endIso: string | null, raw: string) => {
    if (!startIso || !endIso) return;
    const key = `${startIso}|${endIso}`;
    if (seen.has(key)) return;
    seen.add(key);
    windows.push({ startIso, endIso, raw });
  };

  const parseDdSlashHhmm = (dayStr: string, hhmmStr: string, mon: string, yearStr: string) => {
    if (!/^\d{2}$/.test(dayStr) || !/^\d{4}$/.test(hhmmStr)) return null;
    const yearNum = Number(yearStr);
    const year = yearNum < 100 ? 2000 + yearNum : yearNum;
    const mi = monthIdx(mon);
    if (!Number.isFinite(year) || mi == null) return null;
    const day = Number(dayStr);
    const hour = Number(hhmmStr.slice(0, 2));
    const min = Number(hhmmStr.slice(2, 4));
    if (![day, hour, min].every((n) => Number.isFinite(n))) return null;
    if (day < 1 || day > 31 || hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    return new Date(Date.UTC(year, mi, day, hour, min, 0)).toISOString();
  };

  // Pattern: 120100Z TO 120400Z JAN 2026
  const re1 = /(\d{6})Z\s*(?:TO|-)\s*(\d{6})Z\s*([A-Z]{3})\s*(\d{4})/g;
  let m1: RegExpExecArray | null = null;
  while ((m1 = re1.exec(upper))) {
    const startIso = parseDdHhMm(m1[1], m1[3], m1[4]);
    const endIso = parseDdHhMm(m1[2], m1[3], m1[4]);
    addWindow(startIso, endIso, m1[0]);
  }

  // Pattern: 120100Z JAN 2026 TO 120400Z JAN 2026
  const re2 = /(\d{6})Z\s*([A-Z]{3})\s*(\d{4})\s*(?:TO|-)\s*(\d{6})Z\s*([A-Z]{3})\s*(\d{4})/g;
  let m2: RegExpExecArray | null = null;
  while ((m2 = re2.exec(upper))) {
    const startIso = parseDdHhMm(m2[1], m2[2], m2[3]);
    const endIso = parseDdHhMm(m2[4], m2[5], m2[6]);
    addWindow(startIso, endIso, m2[0]);
  }

  // Pattern: 18/2204 JAN 26 TO 19/0247 JAN 26
  const re3 = /(\d{2})\/(\d{4})\s*([A-Z]{3})\s*(\d{2,4})\s*(?:TO|-)\s*(\d{2})\/(\d{4})\s*([A-Z]{3})\s*(\d{2,4})/g;
  let m3: RegExpExecArray | null = null;
  while ((m3 = re3.exec(upper))) {
    const startIso = parseDdSlashHhmm(m3[1], m3[2], m3[3], m3[4]);
    const endIso = parseDdSlashHhmm(m3[5], m3[6], m3[7], m3[8]);
    addWindow(startIso, endIso, m3[0]);
  }

  return windows;
}

function summarizeWindows(windows: TimeWindow[]) {
  let minStart: string | null = null;
  let maxEnd: string | null = null;
  for (const w of windows) {
    if (!minStart || w.startIso < minStart) minStart = w.startIso;
    if (!maxEnd || w.endIso > maxEnd) maxEnd = w.endIso;
  }
  return { validStartUtc: minStart, validEndUtc: maxEnd };
}

function buildMatchText(rssTitle: string | null, pageTitle: string | null, extractedText: string) {
  const lines = extractedText
    .split('\n')
    .map((line) => line.trim().replace(/^\d+[.)]\s*/g, '').replace(/^[A-Z]\.\s*/g, ''))
    .filter(Boolean);

  const missionHints = extractMissionHints(lines).slice(0, 3);

  const signalRe =
    /BNM|SPACE|ROCKET|LAUNCH|STARLINK|FALCON|ATLAS|VULCAN|ELECTRON|NEW\s+SHEPARD|NEW\s+GLENN|CREW|DRAGON|CYGNUS/i;
  const signalLines = lines.filter((line) => signalRe.test(line)).slice(0, 6);
  const textLines = missionHints.length ? missionHints : signalLines.length ? signalLines : lines.slice(0, 4);

  const combined = [rssTitle, pageTitle, ...textLines].filter(Boolean).join(' ');
  return truncate(combined, 2000);
}

function evaluateTimeMatch(windows: TimeWindow[], launchWindow: { startMs: number; endMs: number }, launchNet: string | null) {
  const netMs = launchNet ? Date.parse(launchNet) : NaN;
  const hourMs = 60 * 60 * 1000;
  let bestScore = 0;
  let hasOverlap = false;
  let bestWindow: string | null = null;

  for (const window of windows) {
    const startMs = Date.parse(window.startIso);
    const endMs = Date.parse(window.endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const overlaps = startMs < launchWindow.endMs && endMs > launchWindow.startMs;
    if (overlaps) hasOverlap = true;

    let score = 0;
    if (overlaps) {
      if (Number.isFinite(netMs) && netMs >= startMs && netMs <= endMs) score = 1;
      else score = 0.7;
    } else if (Number.isFinite(netMs)) {
      const diff = Math.min(Math.abs(netMs - startMs), Math.abs(netMs - endMs));
      if (diff <= 2 * hourMs) score = 0.6;
      else if (diff <= 6 * hourMs) score = 0.4;
      else if (diff <= 12 * hourMs) score = 0.25;
    }

    if (score > bestScore) {
      bestScore = score;
      bestWindow = window.raw;
    }
  }

  return { timeScore: bestScore, hasOverlap, bestWindow };
}

function computeTextMatchScore(messageText: string, launchText: string | null) {
  if (!messageText || !launchText) return 0;
  const msgTokens = tokenizeMatchText(messageText);
  const launchTokens = tokenizeMatchText(launchText);
  if (!msgTokens.length || !launchTokens.length) return 0;

  const launchSet = new Set(launchTokens);
  const msgSet = new Set(msgTokens);

  const signalTokenSet = new Set([
    'STARLINK',
    'FALCON',
    'ATLAS',
    'VULCAN',
    'ELECTRON',
    'DELTA',
    'NEUTRON',
    'NEW',
    'SHEPARD',
    'GLENN',
    'DRAGON',
    'CYGNUS',
    'ORION',
    'CRS',
    'GPS',
    'NROL',
    'NASA',
    'SPACEX',
    'ULA',
    'BLUEORIGIN',
    'SIERRA',
    'DREAM',
    'CHASER',
    'BOEING',
    'STARLINER',
    'AXIOM',
    'ARTEMIS',
    'SLS'
  ]);

  const focusTokens = Array.from(msgSet).filter((token) => /\d/.test(token) || signalTokenSet.has(token));
  const tokensToScore = focusTokens.length ? focusTokens : Array.from(msgSet);

  let total = 0;
  let matched = 0;
  for (const token of tokensToScore) {
    const weight = /\d/.test(token) ? 2 : 1;
    total += weight;
    if (launchSet.has(token)) matched += weight;
  }

  if (!total) return 0;
  let score = matched / total;

  if (msgSet.has('STARLINK') && launchSet.has('STARLINK')) score = Math.min(1, score + 0.15);
  if (msgSet.has('FALCON') && launchSet.has('FALCON')) score = Math.min(1, score + 0.1);
  return clamp(score, 0, 1);
}

function tokenizeMatchText(text: string) {
  const normalized = normalizeMatchText(text);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 || /\d/.test(token));
}

function buildLaunchMatchText(launch: CandidateLaunch) {
  const parts: string[] = [];
  if (launch.name) parts.push(launch.name);
  if (launch.provider) parts.push(launch.provider);
  if (launch.vehicle) parts.push(launch.vehicle);
  if (launch.mission_name) parts.push(launch.mission_name);
  if (launch.pad_name) parts.push(launch.pad_name);
  if (launch.rocket_full_name) parts.push(launch.rocket_full_name);
  if (launch.rocket_family) parts.push(launch.rocket_family);
  if (launch.rocket_variant) parts.push(launch.rocket_variant);

  const provider = (launch.provider || '').toLowerCase();
  if (provider.includes('space') && provider.includes('x')) parts.push('SpaceX');
  if (provider.includes('blue') && provider.includes('origin')) parts.push('Blue Origin');
  if (provider.includes('united launch alliance') || provider.includes('ula')) parts.push('ULA');
  if (provider.includes('nasa')) parts.push('NASA');
  if (provider.includes('boeing')) parts.push('Boeing');

  return parts.filter(Boolean).join(' ');
}

function normalizeMatchText(text: string) {
  return text
    .toUpperCase()
    .replace(/SPACE\s+X/g, 'SPACEX')
    .replace(/BLUE\s+ORIGIN/g, 'BLUEORIGIN')
    .replace(/UNITED\s+LAUNCH\s+ALLIANCE/g, 'ULA')
    .replace(/NATIONAL\s+AERONAUTICS\s+AND\s+SPACE\s+ADMINISTRATION/g, 'NASA')
    .replace(/STARLINK\s+GROUP/g, 'STARLINK G')
    .replace(/\bGROUP\b/g, 'G')
    .replace(/NEW\s+SHEPARD/g, 'NEWSHEPARD')
    .replace(/NEW\s+GLENN/g, 'NEWGLENN')
    .replace(/VULCAN\s+CENTAUR/g, 'VULCANCENTAUR')
    .replace(/ATLAS\s+V/g, 'ATLASV')
    .replace(/DELTA\s+IV/g, 'DELTAIV')
    .replace(/FALCON\s+HEAVY/g, 'FALCONHEAVY')
    .replace(/FALCON\s+9/g, 'FALCON9')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMissionHints(lines: string[]) {
  const hints: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/\bFOR\s+([A-Z0-9][A-Z0-9 ./\\-]{2,80})/i);
    if (!match) continue;
    let hint = match[1] || '';
    hint = hint.replace(/[:.].*$/, '').trim();
    if (!hint) continue;
    const next = lines[i + 1] || '';
    if (next && /^[A-Z0-9][A-Z0-9 /-]{2,30}[:.]?$/.test(next) && /\d/.test(next)) {
      hint = `${hint} ${next.replace(/[:.]/g, '').trim()}`;
    }
    hints.push(hint);
  }
  return hints;
}

function matchHazardAreaToLaunch(area: ParsedHazardArea, candidates: CandidateLaunch[], matchText: string) {
  const windowCandidates = area.windows.length
    ? area.windows
    : area.validStartUtc && area.validEndUtc
      ? [{ startIso: area.validStartUtc, endIso: area.validEndUtc, raw: 'summary' }]
      : [];

  if (!windowCandidates.length) {
    return { status: 'unmatched', launchId: null as string | null, confidence: null as number | null, meta: { reason: 'no_time_windows' } };
  }

  const matches: Array<{
    launchId: string;
    score: number;
    name: string | null;
    geoScore: number;
    textScore: number;
    timeScore: number;
    hasOverlap: boolean;
    bestWindow: string | null;
  }> = [];

  for (const launch of candidates) {
    const window = launchWindowMs(launch);
    if (!window) continue;

    const timeEval = evaluateTimeMatch(windowCandidates, window, launch.net);
    if (timeEval.timeScore < 0.35) continue;

    const geoScore = area.geometry ? geometryPadProximityScore(area.geometry, launch.pad_latitude, launch.pad_longitude) : 0.5;
    const launchText = buildLaunchMatchText(launch);
    const textScore = computeTextMatchScore(matchText, launchText);
    const score = clamp(0.35 * geoScore + 0.45 * textScore + 0.2 * timeEval.timeScore, 0, 1);
    matches.push({
      launchId: launch.launch_id,
      score,
      name: launch.name ?? null,
      geoScore,
      textScore,
      timeScore: timeEval.timeScore,
      hasOverlap: timeEval.hasOverlap,
      bestWindow: timeEval.bestWindow
    });
  }

  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 1) {
    const only = matches[0];
    const strongGeo = only.geoScore >= 0.85;
    const strongText = only.textScore >= 0.7;
    const passes =
      only.score >= 0.6 ||
      (only.score >= 0.5 && only.timeScore >= 0.6 && (strongGeo || strongText)) ||
      (only.textScore >= 0.75 && only.timeScore >= 0.6);
    if (!passes) {
      return { status: 'unmatched', launchId: null as string | null, confidence: null as number | null, meta: { matches, reason: 'low_confidence' } };
    }
    return {
      status: 'matched',
      launchId: only.launchId,
      confidence: clampInt(Math.round(only.score * 100), 0, 100),
      meta: { matches }
    };
  }

  if (matches.length > 1) {
    const top = matches[0];
    const second = matches[1];
    const gap = top && second ? top.score - second.score : 0;
    const strong = top.geoScore >= 0.85 || top.textScore >= 0.7;
    if ((top.score >= 0.65 && gap >= 0.15) || (top.score >= 0.7 && gap >= 0.1 && strong)) {
      return {
        status: 'matched',
        launchId: top.launchId,
        confidence: clampInt(Math.round(top.score * 100), 0, 100),
        meta: { matches, gap }
      };
    }
    return { status: 'ambiguous', launchId: null as string | null, confidence: null as number | null, meta: { matches, gap } };
  }

  return { status: 'unmatched', launchId: null as string | null, confidence: null as number | null, meta: { matches: [] } };
}

function launchWindowMs(launch: CandidateLaunch) {
  const startMs = launch.window_start ? Date.parse(launch.window_start) : launch.net ? Date.parse(launch.net) : NaN;
  const endMs = launch.window_end
    ? Date.parse(launch.window_end)
    : launch.net
      ? Date.parse(launch.net) + 2 * 60 * 60 * 1000
      : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

function geometryPadProximityScore(
  geometry: Record<string, unknown>,
  padLat: number | null,
  padLon: number | null
) {
  if (typeof padLat !== 'number' || typeof padLon !== 'number') return 0.5;

  const bbox = computeGeoJsonBbox(geometry);
  if (!bbox) return 0.5;

  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLon = wrapLonDeg((bbox.minLon + bbox.maxLon) / 2);
  const km = haversineKm(padLat, padLon, centerLat, centerLon);

  if (!Number.isFinite(km)) return 0.5;
  if (km <= 150) return 1.0;
  if (km <= 300) return 0.8;
  if (km <= 600) return 0.5;
  return 0.1;
}

function computeGeoJsonBbox(geometry: Record<string, unknown>) {
  const type = typeof geometry?.type === 'string' ? geometry.type : null;
  const coords = (geometry as any)?.coordinates;
  if (!type || !coords) return null;

  const points: Array<[number, number]> = [];
  const pushPoint = (p: any) => {
    if (!Array.isArray(p) || p.length < 2) return;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    points.push([lon, lat]);
  };

  if (type === 'Polygon') {
    const rings = Array.isArray(coords) ? coords : [];
    for (const ring of rings) {
      for (const p of Array.isArray(ring) ? ring : []) pushPoint(p);
    }
  } else if (type === 'MultiPolygon') {
    for (const poly of Array.isArray(coords) ? coords : []) {
      for (const ring of Array.isArray(poly) ? poly : []) {
        for (const p of Array.isArray(ring) ? ring : []) pushPoint(p);
      }
    }
  } else {
    return null;
  }

  if (!points.length) return null;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const [lon, lat] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }

  if (![minLat, maxLat, minLon, maxLon].every((n) => Number.isFinite(n))) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const R = 6371;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function upsertHazardArea(args: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  messageId: string;
  guid: string;
  area: ParsedHazardArea;
  match: { status: string; launchId: string | null; confidence: number | null; meta: unknown };
}) {
  const row = {
    message_id: args.messageId,
    navcen_guid: args.guid,
    area_name: args.area.areaName,
    valid_start: args.area.validStartUtc,
    valid_end: args.area.validEndUtc,
    geometry: args.area.geometry,
    confidence: 90,
    raw_text_snippet: args.area.rawTextSnippet,
    data: {
      ...args.area.data,
      windows: args.area.windows
    },
    parse_version: PARSER_VERSION,
    match_status: args.match.status,
    matched_launch_id: args.match.launchId,
    match_confidence: args.match.confidence,
    match_strategy: 'time_geo_text_v2',
    match_meta: args.match.meta,
    matched_at: args.match.status === 'matched' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };

  const { error } = await args.supabase
    .from('navcen_bnm_hazard_areas')
    .upsert(row, { onConflict: 'message_id,area_name' });

  if (error) throw error;
  return { areaRowUpserted: true };
}

function buildConstraintSourceId(args: {
  guid: string;
  messageSha256: string;
  areaName: string;
  validStartUtc: string | null;
  validEndUtc: string | null;
}) {
  const shaShort = args.messageSha256.slice(0, 12);
  const area = args.areaName.replace(/\s+/g, '_').toUpperCase();
  const start = (args.validStartUtc || '').replace(/[:.]/g, '');
  const end = (args.validEndUtc || '').replace(/[:.]/g, '');
  return `guid:${args.guid}:sha:${shaShort}:area:${area}:start:${start}:end:${end}`;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemOpen = '<item';
  const itemClose = '</item>';
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf(itemOpen, cursor);
    if (start === -1) break;
    const startTagEnd = xml.indexOf('>', start);
    if (startTagEnd === -1) break;
    const end = xml.indexOf(itemClose, startTagEnd);
    if (end === -1) break;
    const raw = xml.slice(startTagEnd + 1, end);
    cursor = end + itemClose.length;

    const title = readRssTag(raw, 'title');
    const link = readRssTag(raw, 'link');
    const guid = readRssTag(raw, 'guid');
    const pubDateRaw = readRssTag(raw, 'pubDate');
    const pubMs = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    const publishedAt = Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null;
    items.push({
      title: title || null,
      link: link || null,
      guid: guid || null,
      publishedAt
    });
  }
  return items;
}

function readRssTag(source: string, tag: string): string {
  const open = `<${tag}`;
  const openIdx = source.indexOf(open);
  if (openIdx === -1) return '';
  const openEnd = source.indexOf('>', openIdx);
  if (openEnd === -1) return '';
  const close = `</${tag}>`;
  const closeIdx = source.indexOf(close, openEnd + 1);
  if (closeIdx === -1) return '';
  let raw = source.slice(openEnd + 1, closeIdx);
  raw = stripCdata(raw);
  return decodeXmlEntities(raw.trim());
}

function stripCdata(input: string): string {
  if (!input.includes('<![CDATA[')) return input;
  return input.split('<![CDATA[').join('').split(']]>').join('');
}

function decodeXmlEntities(input: string): string {
  if (!input) return '';
  return input
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&apos;').join("'")
    .split('&#39;').join("'")
    .split('&amp;').join('&');
}

async function resolveNavcenGuidsFromLink(link: string) {
  const parsed = safeParseUrl(link);
  const host = parsed?.hostname?.replace(/^www\./i, '').toLowerCase() ?? '';

  if (host === 'navcen.uscg.gov') {
    const guid = parsed?.searchParams?.get('guid')?.trim() ?? null;
    return guid && /^\d+$/.test(guid) ? [guid] : [];
  }

  const html = await fetchText(link, { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' });
  const matches = Array.from(html.matchAll(/broadcast-notice-to-mariners-message\?guid=(\d+)/gi)).map((m) => m[1]);
  return Array.from(new Set(matches)).filter((g) => /^\d+$/.test(g));
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function fetchText(url: string, opts?: { accept?: string }) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      accept: opts?.accept ?? '*/*'
    }
  });
  if (!res.ok) throw new Error(`fetch_${res.status}`);
  return await res.text();
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function truncate(value: string, maxLen: number) {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 1).trimEnd() + '…';
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function upsertTrajectoryConstraintsIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_trajectory_constraints_if_changed', {
    rows_in: rows
  });
  if (!error) {
    const stats = asPlainObject(data);
    return {
      input: readInt(stats.input),
      inserted: readInt(stats.inserted),
      updated: readInt(stats.updated),
      skipped: readInt(stats.skipped),
      usedFallback: false
    };
  }

  console.warn('upsert_launch_trajectory_constraints_if_changed failed; falling back to upsert', error);
  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_trajectory_constraints')
    .upsert(rows, { onConflict: 'launch_id,source,constraint_type,source_id' })
    .select('id');
  if (fallbackError) throw fallbackError;
  const touched = Array.isArray(fallbackRows) ? fallbackRows.length : rows.length;
  return {
    input: rows.length,
    inserted: 0,
    updated: touched,
    skipped: Math.max(0, rows.length - touched),
    usedFallback: true
  };
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
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
