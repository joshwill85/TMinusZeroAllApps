import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { getLatestSuccessfulIngestionRuns } from '../_shared/ingestionRuns.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getCachedSetting, getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import { extractUrlFromValue, normalizeNetPrecision } from '../_shared/ll2.ts';
import {
  mapLl2ToLaunchUpsert,
  upsertLaunches,
  upsertLl2PayloadManifest,
  upsertLl2References,
  upsertLl2SpacecraftManifest
} from '../_shared/ll2Ingest.ts';
import { fetchSnapiPage, toSnapiUid, type SnapiItem, type SnapiItemType } from '../_shared/snapi.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const DEFAULTS = {
  ll2RateLimit: 300,
  ll2IncrementalLimit: 100,
  ll2IncrementalLookbackMinutes: 60,
  ll2EventBatchSize: 1,
  ll2EventStaleHours: 24,
  cdcOverlapMinutes: 20,
  snapiRateLimit: 60,
  snapiLookbackDays: 365,
  snapiPageSize: 100,
  snapiMaxPages: 20,
  publicCacheHistoryDays: 36500,
  publicCacheHorizonDays: 36500,
  publicCachePageSize: 1000
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const startedAt = Date.now();
  const { runId: cycleRunId } = await startIngestionRun(supabase, 'ingestion_cycle');
  const results: Record<string, unknown> = {};
  const errors: Array<{ step: string; error: string }> = [];

  try {
    try {
      const settings = await getSettings(supabase, ['ll2_location_filter_mode']);
      const locationFilterMode = readLocationFilterModeSetting(settings.ll2_location_filter_mode);
      results.locationSync =
        locationFilterMode === 'us' ? await ensureUsLocationIds(supabase) : { skipped: true, mode: locationFilterMode };
    } catch (err) {
      errors.push({ step: 'locationSync', error: stringifyError(err) });
    }

    try {
      results.snapiIngest = await runSnapiIngestion(supabase);
    } catch (err) {
      errors.push({ step: 'snapiIngest', error: stringifyError(err) });
    }

    try {
      results.ll2EventIngest = await runLl2EventIngestion(supabase);
    } catch (err) {
      errors.push({ step: 'll2EventIngest', error: stringifyError(err) });
    }

    let publicCacheResult:
      | {
          refreshed: number;
          removed: number;
          pages: number;
          mode: string;
          mutated: boolean;
          providerKeys: string[];
          providerKeysCount: number;
        }
      | null = null;

    try {
      publicCacheResult = await runPublicCacheRefresh(supabase);
      results.publicCache = {
        refreshed: publicCacheResult.refreshed,
        removed: publicCacheResult.removed,
        pages: publicCacheResult.pages,
        mode: publicCacheResult.mode,
        mutated: publicCacheResult.mutated,
        providerKeysCount: publicCacheResult.providerKeysCount
      };
    } catch (err) {
      errors.push({ step: 'publicCache', error: stringifyError(err) });
    }

    try {
      const shouldRefreshProviders = publicCacheResult ? publicCacheResult.mutated : true;
      results.providersCache = await refreshProvidersPublicCache(supabase, {
        force: shouldRefreshProviders,
        reason: shouldRefreshProviders ? 'public_cache_changed' : 'public_cache_unchanged',
        providerKeys: publicCacheResult?.providerKeys ?? []
      });
    } catch (err) {
      errors.push({ step: 'providersCache', error: stringifyError(err) });
    }

    const ok = errors.length === 0;
    await finishIngestionRun(supabase, cycleRunId, ok, { results, errors }, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, results, errors });
  } catch (err) {
    const message = stringifyError(err);
    errors.push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, cycleRunId, false, { results, errors }, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, results, errors }, 500);
  }
});

async function refreshProvidersPublicCache(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  opts: { force: boolean; reason: string; providerKeys?: string[] }
) {
  if (!opts.force) {
    return { skipped: true, reason: opts.reason || 'public_cache_unchanged' };
  }

  const providerKeys = Array.from(new Set((opts.providerKeys || []).map(normalizeProviderKey).filter(Boolean))) as string[];
  if (!providerKeys.length) {
    return { skipped: true, reason: opts.reason, targetedKeys: 0 };
  }

  const { data, error } = await supabase.rpc('refresh_providers_public_cache_for_keys', {
    provider_keys_in: providerKeys
  });
  if (!error) {
    return { ...(data ?? { ok: true }), reason: opts.reason, targetedKeys: providerKeys.length };
  }

  // Backward-compatible fallback for environments before migration 0221.
  console.warn('refresh_providers_public_cache_for_keys failed; falling back to full refresh', error);
  const { data: fallbackData, error: fallbackError } = await supabase.rpc('refresh_providers_public_cache');
  if (fallbackError) {
    console.warn('refresh_providers_public_cache failed', fallbackError);
    return { skipped: true, reason: opts.reason, targetedKeys: providerKeys.length, error: fallbackError.message };
  }
  return { ...(fallbackData ?? { ok: true }), reason: opts.reason, targetedKeys: providerKeys.length, fallback: true };
}

async function ensureUsLocationIds(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data } = await supabase
    .from('system_settings')
    .select('value, updated_at')
    .eq('key', 'll2_us_location_ids')
    .maybeSingle();

  const existingIds = parseLocationIds(data?.value);
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
  const ageHours = Number.isFinite(updatedAt) ? (Date.now() - updatedAt) / (1000 * 60 * 60) : Infinity;

  if (existingIds.length && ageHours < 24) {
    return { ids: existingIds, refreshed: false };
  }

  const rate = await tryConsumeProvider(supabase, 'll2');
  if (!rate.allowed) {
    return { ids: existingIds, refreshed: false, skipped: true };
  }

  const url = `${LL2_BASE}/locations/?format=json&country_code=USA&limit=100`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  if (!res.ok) {
    return { ids: existingIds, refreshed: false, error: `ll2_location_${res.status}` };
  }
  const json = await res.json();
  const ids = (json.results || []).map((loc: any) => loc.id).filter((id: any) => typeof id === 'number');
  if (ids.length) {
    await supabase
      .from('system_settings')
      .upsert({ key: 'll2_us_location_ids', value: ids, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }

  return { ids: ids.length ? ids : existingIds, refreshed: true };
}

async function runLl2Incremental(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { runId } = await startIngestionRun(supabase, 'll2_incremental');
  try {
    const settings = await getSettings(supabase, ['ll2_incremental_limit', 'll2_incremental_lookback_minutes']);
    const incrementalLimit = clampInt(
      readNumberSetting(settings.ll2_incremental_limit, DEFAULTS.ll2IncrementalLimit),
      1,
      100
    );
    const lookbackMinutes = clampInt(
      readNumberSetting(settings.ll2_incremental_lookback_minutes, DEFAULTS.ll2IncrementalLookbackMinutes),
      1,
      360
    );
    const effectiveLookback = Math.max(lookbackMinutes, DEFAULTS.cdcOverlapMinutes);

    const { data: latest } = await supabase
      .from('launches')
      .select('last_updated_source')
      .order('last_updated_source', { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestIso = latest?.last_updated_source ? Date.parse(latest.last_updated_source) : NaN;
    const sinceIso = Number.isFinite(latestIso)
      ? new Date(latestIso - effectiveLookback * 60 * 1000).toISOString()
      : undefined;
    const { launches, skipped, skipReason } = await fetchLl2Launches({
      limit: incrementalLimit,
      offset: 0,
      ordering: '-last_updated',
      sinceIso
    });

    if (skipped) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, skipReason });
      return { skipped: true, skipReason };
    }

    const launchesToProcess = await filterLl2LaunchesByUpdatedAt(supabase, launches);
    if (!launchesToProcess.length) {
      await finishIngestionRun(supabase, runId, true, { upserted: 0, sinceIso, lookbackMinutes: effectiveLookback, skipped: true, skipReason: 'unchanged' });
      return { upserted: 0, skipped: true, skipReason: 'unchanged' };
    }

    await upsertLl2References(supabase, launchesToProcess, { insertOnly: true });
    const rows = launchesToProcess.map(mapLl2ToLaunchUpsert);
    await upsertLaunches(supabase, rows);
    await upsertLl2PayloadManifest(supabase, launchesToProcess);
    await upsertLl2SpacecraftManifest(supabase, launchesToProcess);

    await finishIngestionRun(supabase, runId, true, { upserted: rows.length, sinceIso, lookbackMinutes: effectiveLookback });
    return { upserted: rows.length };
  } catch (err) {
    await finishIngestionRun(supabase, runId, false, undefined, stringifyError(err));
    throw err;
  }
}

async function filterLl2LaunchesByUpdatedAt(supabase: ReturnType<typeof createSupabaseAdminClient>, launches: any[]) {
  if (!Array.isArray(launches) || launches.length === 0) return [];

  function normalizeNonEmptyString(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  const ids = Array.from(
    new Set(
      launches
        .map((row) => (typeof row?.id === 'string' ? row.id.trim() : ''))
        .filter((id) => id)
    )
  );

  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('launches')
    .select('ll2_launch_uuid, last_updated_source')
    .in('ll2_launch_uuid', ids);
  if (error) throw error;

  const existingByLl2 = new Map<string, string | null>();
  for (const row of data || []) {
    const key = typeof (row as any)?.ll2_launch_uuid === 'string' ? String((row as any).ll2_launch_uuid) : '';
    if (!key) continue;
    const value = (row as any)?.last_updated_source ? String((row as any).last_updated_source) : null;
    existingByLl2.set(key, value);
  }

  return launches.filter((launch) => {
    const ll2LaunchUuid = typeof launch?.id === 'string' ? launch.id.trim() : '';
    if (!ll2LaunchUuid) return false;

    const existing = existingByLl2.get(ll2LaunchUuid);
    if (!existing) return true;

    const incomingRaw = normalizeNonEmptyString(launch?.last_updated) || normalizeNonEmptyString(launch?.net);
    if (!incomingRaw) return true;

    const incomingMs = Date.parse(incomingRaw);
    const existingMs = existing ? Date.parse(existing) : NaN;
    if (!Number.isFinite(incomingMs) || !Number.isFinite(existingMs)) return true;

    return incomingMs > existingMs;
  });
}

async function runSnapiIngestion(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { runId } = await startIngestionRun(supabase, 'snapi_ingest');
  try {
    const types: SnapiItemType[] = ['articles', 'blogs', 'reports'];
    const items: Array<SnapiItem & { snapi_uid: string; item_type: 'article' | 'blog' | 'report' }> = [];
    const pendingBackfillUpdates: Array<{ key: string; value: unknown }> = [];
    let truncated = false;
    const backfillKeys: Record<SnapiItemType, { offset: string; done: string }> = {
      articles: { offset: 'snapi_backfill_articles_offset', done: 'snapi_backfill_articles_done' },
      blogs: { offset: 'snapi_backfill_blogs_offset', done: 'snapi_backfill_blogs_done' },
      reports: { offset: 'snapi_backfill_reports_offset', done: 'snapi_backfill_reports_done' }
    };
    const settings = await getSettings(supabase, Object.values(backfillKeys).flatMap((v) => [v.offset, v.done]));
    const sinceIso = await fetchSnapiSince(supabase);

    for (const type of types) {
      const itemType = type === 'articles' ? 'article' : type === 'blogs' ? 'blog' : 'report';
      const keys = backfillKeys[type];
      const backfillDone = readBooleanSetting(settings[keys.done], false);
      let offset = backfillDone ? 0 : readNumberSetting(settings[keys.offset], 0);
      let typeDone = backfillDone;
      let pages = 0;

      while (true) {
        const rate = await tryConsumeProvider(supabase, 'snapi');
        if (!rate.allowed) {
          await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'rate_limit' });
          return { skipped: true, reason: 'rate_limit' };
        }

        const page = await fetchSnapiPage({
          type,
          limit: DEFAULTS.snapiPageSize,
          offset,
          sinceIso: backfillDone ? sinceIso : undefined,
          hasLaunch: false
        });

        if (page.skipped) {
          await finishIngestionRun(supabase, runId, true, { skipped: true, reason: page.skipReason });
          return { skipped: true, reason: page.skipReason };
        }

        for (const item of page.items) {
          if (!Number.isFinite(Number(item?.id)) || !item?.title || !item?.url) continue;
          items.push({ ...item, snapi_uid: toSnapiUid(type, item.id), item_type: itemType });
        }

        pages++;
        if (!page.next || page.items.length === 0) {
          if (!backfillDone) {
            typeDone = true;
          }
          break;
        }
        if (pages >= DEFAULTS.snapiMaxPages) {
          truncated = true;
          break;
        }
        offset += DEFAULTS.snapiPageSize;
      }

      if (!backfillDone) {
        pendingBackfillUpdates.push({ key: keys.offset, value: offset });
        if (typeDone) pendingBackfillUpdates.push({ key: keys.done, value: true });
      }
    }

    if (!items.length) {
      for (const update of pendingBackfillUpdates) {
        await upsertSetting(supabase, update.key, update.value);
      }
      await finishIngestionRun(supabase, runId, true, { fetched: 0, items: 0, uniqueItems: 0, duplicates: 0, truncated });
      return { fetched: 0, items: 0, uniqueItems: 0, duplicates: 0, truncated };
    }

    const uniqueItems = dedupeSnapiItems(items);
    const duplicates = items.length - uniqueItems.length;

    const { launchJoinRows, eventRows, unmatchedLaunchRefs } = await buildSnapiJoinRows(supabase, uniqueItems);

    const fetchedAt = new Date().toISOString();
    const rows = uniqueItems.map((item) => ({
      snapi_uid: item.snapi_uid,
      snapi_id: item.id,
      item_type: item.item_type,
      title: item.title,
      url: item.url,
      news_site: item.news_site ?? null,
      summary: item.summary ?? null,
      image_url: item.image_url ?? null,
      published_at: item.published_at ?? null,
      updated_at: item.updated_at ?? null,
      featured: item.featured ?? null,
      authors: item.authors ?? null,
      fetched_at: fetchedAt
    }));

    const { error: upsertError } = await supabase.from('snapi_items').upsert(rows, { onConflict: 'snapi_uid' });
    if (upsertError) throw upsertError;

    const snapiUids = [...new Set(uniqueItems.map((item) => item.snapi_uid))];

    for (const chunk of chunkArray(snapiUids, 200)) {
      if (!chunk.length) continue;
      const { error } = await supabase.from('snapi_item_launches').delete().in('snapi_uid', chunk);
      if (error) throw error;
      const { error: eventDeleteError } = await supabase.from('snapi_item_events').delete().in('snapi_uid', chunk);
      if (eventDeleteError) throw eventDeleteError;
    }

    if (launchJoinRows.length) {
      const { error } = await supabase.from('snapi_item_launches').upsert(launchJoinRows, { onConflict: 'snapi_uid,launch_id' });
      if (error) throw error;
    }

    if (eventRows.length) {
      const { error } = await supabase.from('snapi_item_events').upsert(eventRows, { onConflict: 'snapi_uid,ll2_event_id' });
      if (error) throw error;
    }

    for (const update of pendingBackfillUpdates) {
      await upsertSetting(supabase, update.key, update.value);
    }

    await finishIngestionRun(supabase, runId, true, {
      fetched: items.length,
      items: uniqueItems.length,
      uniqueItems: uniqueItems.length,
      duplicates,
      launchLinks: launchJoinRows.length,
      eventLinks: eventRows.length,
      unmatchedLaunchRefs,
      truncated
    });

    return {
      fetched: items.length,
      items: uniqueItems.length,
      uniqueItems: uniqueItems.length,
      duplicates,
      launchLinks: launchJoinRows.length,
      eventLinks: eventRows.length,
      unmatchedLaunchRefs,
      truncated
    };
  } catch (err) {
    await finishIngestionRun(supabase, runId, false, undefined, stringifyError(err));
    throw err;
  }
}

function dedupeSnapiItems<T extends { snapi_uid: string; updated_at?: string | null }>(items: T[]) {
  const byUid = new Map<string, T>();

  for (const item of items) {
    const uid = item.snapi_uid;
    const existing = byUid.get(uid);
    if (!existing) {
      byUid.set(uid, item);
      continue;
    }

    const existingUpdated = existing.updated_at ? Date.parse(existing.updated_at) : NaN;
    const nextUpdated = item.updated_at ? Date.parse(item.updated_at) : NaN;
    if (Number.isFinite(nextUpdated) && (!Number.isFinite(existingUpdated) || nextUpdated > existingUpdated)) {
      byUid.set(uid, item);
    }
  }

  return [...byUid.values()];
}

async function runLl2EventIngestion(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { runId } = await startIngestionRun(supabase, 'll2_event_ingest');
  try {
    const settings = await getSettings(supabase, [
      'll2_event_ingest_enabled',
      'll2_event_ingest_batch_size',
      'll2_event_ingest_stale_hours'
    ]);

    const enabled = readBooleanSetting(settings.ll2_event_ingest_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return { skipped: true, reason: 'disabled' };
    }

    const batchSize = clampInt(
      readNumberSetting(settings.ll2_event_ingest_batch_size, DEFAULTS.ll2EventBatchSize),
      1,
      10
    );
    const staleHours = clampInt(
      readNumberSetting(settings.ll2_event_ingest_stale_hours, DEFAULTS.ll2EventStaleHours),
      1,
      720
    );

    const candidateIds = await fetchSnapiEventIds(supabase);
    if (!candidateIds.length) {
      await finishIngestionRun(supabase, runId, true, { fetched: 0, reason: 'no_candidates' });
      return { fetched: 0 };
    }

    const { targets, totalMissing, totalStale } = await selectLl2EventTargets(supabase, candidateIds, staleHours, batchSize);
    if (!targets.length) {
      await finishIngestionRun(supabase, runId, true, { fetched: 0, totalMissing, totalStale, reason: 'nothing_due' });
      return { fetched: 0, totalMissing, totalStale };
    }

    let fetched = 0;
    let upserted = 0;
    let launchLinks = 0;
    let unmatchedLaunches = 0;
    let notFound = 0;
    let skippedRemote = false;
    let skipReason: string | null = null;

    for (const eventId of targets) {
      const rate = await tryConsumeProvider(supabase, 'll2');
      if (!rate.allowed) {
        skipReason = 'rate_limit';
        break;
      }

      const { event, skipped, skipReason: remoteSkipReason, notFound: remoteNotFound } = await fetchLl2Event(eventId);
      if (skipped) {
        skippedRemote = true;
        skipReason = remoteSkipReason;
        break;
      }
      if (remoteNotFound) {
        notFound += 1;
        continue;
      }
      if (!event) continue;

      const eventRow = mapLl2EventRow(event);
      await upsertLl2Event(supabase, eventRow);

      const { rows: joinRows, unmatched } = await buildLl2EventLaunchRows(supabase, event);
      unmatchedLaunches += unmatched;
      await replaceLl2EventLaunchRows(supabase, eventRow.ll2_event_id, joinRows);

      fetched += 1;
      upserted += 1;
      launchLinks += joinRows.length;
    }

    const stats = {
      fetched,
      upserted,
      launchLinks,
      unmatchedLaunches,
      notFound,
      skippedRemote,
      skipReason,
      totalMissing,
      totalStale,
      batchSize
    };

    await finishIngestionRun(supabase, runId, true, stats);
    return stats;
  } catch (err) {
    await finishIngestionRun(supabase, runId, false, undefined, stringifyError(err));
    throw err;
  }
}

async function fetchSnapiSince(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('snapi_items')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fallbackIso = new Date(Date.now() - DEFAULTS.snapiLookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const baseIso = !error && data?.updated_at ? (data.updated_at as string) : fallbackIso;
  return subtractMinutesIso(baseIso, DEFAULTS.cdcOverlapMinutes);
}

async function buildSnapiJoinRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  items: Array<SnapiItem & { snapi_uid: string; item_type: string }>
) {
  const launchIds = new Set<string>();
  for (const item of items) {
    for (const launch of item.launches || []) {
      if (launch?.launch_id) launchIds.add(launch.launch_id);
    }
  }

  const launchMap = new Map<string, string>();
  for (const chunk of chunkArray([...launchIds], 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from('launches').select('id, ll2_launch_uuid').in('ll2_launch_uuid', chunk);
    if (error) throw error;
    for (const row of data || []) {
      if (row.ll2_launch_uuid) launchMap.set(row.ll2_launch_uuid, row.id);
    }
  }

  const launchJoinRows: Array<{ snapi_uid: string; launch_id: string }> = [];
  const eventRows: Array<{ snapi_uid: string; ll2_event_id: number; provider?: string | null }> = [];
  let unmatchedLaunchRefs = 0;

  for (const item of items) {
    const seenLaunches = new Set<string>();
    for (const launch of item.launches || []) {
      if (launch?.launch_id) seenLaunches.add(launch.launch_id);
    }
    for (const ll2LaunchId of seenLaunches) {
      const internalId = launchMap.get(ll2LaunchId);
      if (!internalId) {
        unmatchedLaunchRefs++;
        continue;
      }
      launchJoinRows.push({ snapi_uid: item.snapi_uid, launch_id: internalId });
    }

    const seenEvents = new Set<number>();
    for (const event of item.events || []) {
      const eventId = Number(event?.event_id);
      if (!Number.isFinite(eventId) || seenEvents.has(eventId)) continue;
      seenEvents.add(eventId);
      eventRows.push({ snapi_uid: item.snapi_uid, ll2_event_id: eventId, provider: event?.provider ?? null });
    }
  }

  return { launchJoinRows, eventRows, unmatchedLaunchRefs };
}

async function fetchSnapiEventIds(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase.from('snapi_item_events').select('ll2_event_id');
  if (error) throw error;
  const ids = new Set<number>();
  for (const row of data || []) {
    const id = Number((row as { ll2_event_id: unknown }).ll2_event_id);
    if (Number.isFinite(id)) ids.add(id);
  }
  return [...ids.values()];
}

async function selectLl2EventTargets(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  eventIds: number[],
  staleHours: number,
  batchSize: number
) {
  const existing = await loadLl2EventMap(supabase, eventIds);
  const staleCutoff = Date.now() - staleHours * 60 * 60 * 1000;
  const missing: number[] = [];
  const stale: number[] = [];

  for (const eventId of eventIds) {
    const row = existing.get(eventId);
    if (!row) {
      missing.push(eventId);
      continue;
    }
    const fetchedAt = row.fetched_at || row.updated_at || null;
    const fetchedMs = fetchedAt ? Date.parse(fetchedAt) : NaN;
    if (!Number.isFinite(fetchedMs) || fetchedMs < staleCutoff) {
      stale.push(eventId);
    }
  }

  const targets = [...missing, ...stale].slice(0, batchSize);
  return { targets, totalMissing: missing.length, totalStale: stale.length };
}

async function loadLl2EventMap(supabase: ReturnType<typeof createSupabaseAdminClient>, eventIds: number[]) {
  const map = new Map<number, { fetched_at?: string | null; updated_at?: string | null }>();
  for (const chunk of chunkArray(eventIds, 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from('ll2_events')
      .select('ll2_event_id, fetched_at, updated_at')
      .in('ll2_event_id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      const id = Number((row as { ll2_event_id: unknown }).ll2_event_id);
      if (Number.isFinite(id)) {
        map.set(id, row as { fetched_at?: string | null; updated_at?: string | null });
      }
    }
  }
  return map;
}

async function fetchLl2Event(eventId: number) {
  const url = `${LL2_BASE}/events/${eventId}/?format=json&mode=detailed`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 404) {
    return { event: null, skipped: false, skipReason: null, notFound: true };
  }
  if (res.status === 429) {
    return { event: null, skipped: true, skipReason: 'remote_rate_limit', notFound: false };
  }
  if (res.status >= 500) {
    return { event: null, skipped: true, skipReason: `server_${res.status}`, notFound: false };
  }
  if (!res.ok) throw new Error(`LL2 event fetch failed ${res.status}`);

  const event = await res.json();
  return { event, skipped: false, skipReason: null, notFound: false };
}

function mapLl2EventRow(event: any) {
  const type = event.type || {};
  const location = event.location || {};
  const image = event.image || {};
  const imageLicense = image?.license || {};

  return {
    ll2_event_id: event.id,
    name: event.name || 'Event',
    slug: event.slug || null,
    description: event.description || null,
    type_id: typeof type.id === 'number' ? type.id : null,
    type_name: type.name || null,
    date: event.date || null,
    date_precision: event.date_precision != null ? normalizeNetPrecision(event.date_precision) : null,
    duration: event.duration || null,
    location_id: typeof location.id === 'number' ? location.id : null,
    location_name: location.name || null,
    location_country_code: resolveCountryCode(location.country ?? location.country_code),
    webcast_live: typeof event.webcast_live === 'boolean' ? event.webcast_live : null,
    image_url: extractImageFullUrl(image),
    image_credit: image?.credit || null,
    image_license_name: imageLicense?.name || null,
    image_license_url: imageLicense?.link || imageLicense?.url || null,
    image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
    info_urls: event.info_urls || null,
    vid_urls: event.vid_urls || null,
    updates: event.updates || null,
    url: event.url || null,
    last_updated_source: event.last_updated || null,
    raw: event,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function upsertLl2Event(supabase: ReturnType<typeof createSupabaseAdminClient>, row: any) {
  const { error } = await supabase.from('ll2_events').upsert(row, { onConflict: 'll2_event_id' });
  if (error) throw error;
}

async function buildLl2EventLaunchRows(supabase: ReturnType<typeof createSupabaseAdminClient>, event: any) {
  const launchIds = new Set<string>();
  for (const launch of event.launches || []) {
    const id = launch?.id || launch?.launch_id;
    if (typeof id === 'string' && id) launchIds.add(id);
  }
  if (!launchIds.size) return { rows: [] as Array<{ ll2_event_id: number; launch_id: string }>, unmatched: 0 };

  const launchMap = new Map<string, string>();
  for (const chunk of chunkArray([...launchIds], 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from('launches').select('id, ll2_launch_uuid').in('ll2_launch_uuid', chunk);
    if (error) throw error;
    for (const row of data || []) {
      if (row.ll2_launch_uuid) launchMap.set(row.ll2_launch_uuid, row.id);
    }
  }

  const rows: Array<{ ll2_event_id: number; launch_id: string }> = [];
  let unmatched = 0;
  for (const ll2LaunchId of launchIds) {
    const internalId = launchMap.get(ll2LaunchId);
    if (!internalId) {
      unmatched += 1;
      continue;
    }
    rows.push({ ll2_event_id: event.id, launch_id: internalId });
  }

  return { rows, unmatched };
}

async function replaceLl2EventLaunchRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  ll2EventId: number,
  rows: Array<{ ll2_event_id: number; launch_id: string }>
) {
  const { error: deleteError } = await supabase.from('ll2_event_launches').delete().eq('ll2_event_id', ll2EventId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error } = await supabase.from('ll2_event_launches').upsert(rows, { onConflict: 'll2_event_id,launch_id' });
  if (error) throw error;
}

async function runPublicCacheRefresh(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { runId } = await startIngestionRun(supabase, 'public_cache_refresh');
  try {
    const lastSuccess = await getLastSuccessfulRun(supabase, 'public_cache_refresh');
    const settings = await getSettings(supabase, [
      'public_cache_history_days',
      'public_cache_horizon_days',
      'public_cache_page_size'
    ]);
    const historyDays = readNumberSetting(settings.public_cache_history_days, DEFAULTS.publicCacheHistoryDays);
    const horizonDays = readNumberSetting(settings.public_cache_horizon_days, DEFAULTS.publicCacheHorizonDays);
    const pageSize = clampInt(
      readNumberSetting(settings.public_cache_page_size, DEFAULTS.publicCachePageSize),
      1,
      1000
    );

    const now = Date.now();
    const fromIso = historyDays > 0 ? new Date(now - historyDays * 24 * 60 * 60 * 1000).toISOString() : null;
    const toIso = horizonDays > 0 ? new Date(now + horizonDays * 24 * 60 * 60 * 1000).toISOString() : null;

    const sinceIso = lastSuccess ? subtractMinutesIso(lastSuccess, DEFAULTS.cdcOverlapMinutes) : null;
    const mode = sinceIso ? 'incremental' : 'full';
    let offset = 0;
    let total = 0;
    let removed = 0;
    let page = 0;
    const touchedProviderKeys = new Set<string>();

    while (true) {
      let query = supabase.from('launches').select('*');
      if (sinceIso) {
        query = query.gte('updated_at', sinceIso).order('updated_at', { ascending: true });
      } else {
        query = query.eq('hidden', false);
        if (fromIso) query = query.gte('net', fromIso);
        if (toIso) query = query.lt('net', toIso);
        query = query.order('net', { ascending: true });
      }
      query = query.range(offset, offset + pageSize - 1);

      const { data, error } = await query;

      if (error) throw error;
      if (!data || data.length === 0) break;

      const cacheRows: any[] = [];
      const toDelete: string[] = [];

      for (const row of data) {
        const providerKey = normalizeProviderKey(row.provider);
        if (providerKey) touchedProviderKeys.add(providerKey);

        const inWindow = isWithinWindow(row.net, fromIso, toIso);
        if (row.hidden || !inWindow) {
          if (row.id) toDelete.push(row.id);
          continue;
        }
        cacheRows.push(buildPublicCacheRow(row));
      }

      if (cacheRows.length) {
        const { error: upsertError } = await supabase
          .from('launches_public_cache')
          .upsert(cacheRows, { onConflict: 'launch_id' });
        if (upsertError) throw upsertError;
      }

      if (toDelete.length) {
        const { error: deleteError } = await supabase.from('launches_public_cache').delete().in('launch_id', toDelete);
        if (deleteError) throw deleteError;
      }

      total += cacheRows.length;
      removed += toDelete.length;
      page += 1;
      if (data.length < pageSize) break;
      offset += data.length;
    }

    const mutated = total > 0 || removed > 0;
    const providerKeys = [...touchedProviderKeys];
    const providerKeysCount = providerKeys.length;

    await finishIngestionRun(supabase, runId, true, {
      refreshed: total,
      removed,
      pages: page,
      window: { fromIso, toIso },
      pageSize,
      sinceIso,
      mode,
      mutated,
      providerKeysCount
    });
    return { refreshed: total, removed, pages: page, mode, mutated, providerKeys, providerKeysCount };
  } catch (err) {
    await finishIngestionRun(supabase, runId, false, undefined, stringifyError(err));
    throw err;
  }
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function subtractMinutesIso(iso: string, minutes: number) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms - minutes * 60 * 1000).toISOString();
}

function isWithinWindow(net: string | null | undefined, fromIso: string | null, toIso: string | null) {
  if (!net) return false;
  const ts = Date.parse(net);
  if (!Number.isFinite(ts)) return false;
  if (fromIso) {
    const fromTs = Date.parse(fromIso);
    if (Number.isFinite(fromTs) && ts < fromTs) return false;
  }
  if (toIso) {
    const toTs = Date.parse(toIso);
    if (Number.isFinite(toTs) && ts >= toTs) return false;
  }
  return true;
}

async function getLastSuccessfulRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  try {
    const [latestRun] = await getLatestSuccessfulIngestionRuns(supabase, [jobName]);
    return latestRun?.endedAt ?? null;
  } catch (error) {
    console.warn('Failed to read last ingestion run', {
      jobName,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function fetchLl2Launches({
  limit,
  offset,
  ordering,
  sinceIso
}: {
  limit: number;
  offset: number;
  ordering: 'last_updated' | '-last_updated';
  sinceIso?: string;
}) {
  const locationIds = await getLocationIdsFromSettings();
  const supabase = createSupabaseAdminClient();
  const rate = await tryConsumeProvider(supabase, 'll2');
  if (!rate.allowed) {
    return { launches: [], skipped: true, total: 0, skipReason: 'rate_limit' };
  }

  const updatedFilter = sinceIso ? `&last_updated__gte=${encodeURIComponent(sinceIso)}` : '';
  const locationFilter = locationIds.length ? `&location__ids=${locationIds.join(',')}` : '';
  const url = `${LL2_BASE}/launches/?format=json&limit=${limit}&offset=${offset}&mode=detailed&include_suborbital=true&ordering=${ordering}${locationFilter}${updatedFilter}`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 429) {
    return { launches: [], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    return { launches: [], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 fetch failed ${res.status}`);

  const json = await res.json();
  return { launches: json.results as any[], skipped: false, total: json.count ?? 0, skipReason: null };
}

async function getLocationIdsFromSettings() {
  const supabase = createSupabaseAdminClient();
  const settings = await getSettings(supabase, ['ll2_location_filter_mode', 'll2_us_location_ids']);
  const locationFilterMode = readLocationFilterModeSetting(settings.ll2_location_filter_mode);
  if (locationFilterMode !== 'us') return [];
  return parseLocationIds(settings.ll2_us_location_ids);
}

function parseLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
}

function readLocationFilterModeSetting(value: unknown): 'us' | 'all' {
  const raw = readStringSetting(value, 'all').trim().toLowerCase();
  return raw === 'us' ? 'us' : 'all';
}

function resolveCountryCode(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = resolveCountryCode(item);
      if (code) return code;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as {
      alpha_3_code?: string;
      alpha_2_code?: string;
      country_code?: string;
      code?: string;
    };
    return obj.alpha_3_code || obj.alpha_2_code || obj.country_code || obj.code || null;
  }
  return null;
}

function normalizeProviderKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  return normalized === 'unknown' ? null : normalized;
}

function extractImageFullUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { image_url?: string; url?: string; thumbnail_url?: string };
    return obj.image_url || obj.url || obj.thumbnail_url || null;
  }
  return null;
}

function buildPublicCacheRow(row: any) {
  const videoUrl = extractUrlFromValue(row.video_url);
  return {
    launch_id: row.id,
    ll2_launch_uuid: row.ll2_launch_uuid,
    ll2_agency_id: row.ll2_agency_id,
    ll2_pad_id: row.ll2_pad_id,
    ll2_rocket_config_id: row.ll2_rocket_config_id,
    name: row.name,
    launch_designator: row.launch_designator,
    agency_launch_attempt_count: row.agency_launch_attempt_count,
    agency_launch_attempt_count_year: row.agency_launch_attempt_count_year,
    location_launch_attempt_count: row.location_launch_attempt_count,
    location_launch_attempt_count_year: row.location_launch_attempt_count_year,
    orbital_launch_attempt_count: row.orbital_launch_attempt_count,
    orbital_launch_attempt_count_year: row.orbital_launch_attempt_count_year,
    pad_launch_attempt_count: row.pad_launch_attempt_count,
    pad_launch_attempt_count_year: row.pad_launch_attempt_count_year,
    pad_turnaround: row.pad_turnaround,
    mission_patches: row.mission_patches,
    updates: row.updates,
    timeline: row.timeline,
    image_url: row.image_url,
    image_credit: row.image_credit,
    image_license_name: row.image_license_name,
    image_license_url: row.image_license_url,
    image_single_use: row.image_single_use,
    provider: row.provider,
    provider_type: row.provider_type,
    provider_country_code: row.provider_country_code,
    provider_description: row.provider_description,
    vehicle: row.vehicle,
    rocket_full_name: row.rocket_full_name,
    rocket_family: row.rocket_family,
    rocket_manufacturer: row.rocket_manufacturer,
    rocket_manufacturer_logo_url: row.rocket_manufacturer_logo_url,
    rocket_manufacturer_image_url: row.rocket_manufacturer_image_url,
    rocket_description: row.rocket_description,
    rocket_image_url: row.rocket_image_url,
    rocket_variant: row.rocket_variant,
    rocket_length_m: row.rocket_length_m,
    rocket_diameter_m: row.rocket_diameter_m,
    rocket_reusable: row.rocket_reusable,
    rocket_maiden_flight: row.rocket_maiden_flight,
    rocket_leo_capacity: row.rocket_leo_capacity,
    rocket_gto_capacity: row.rocket_gto_capacity,
    rocket_launch_mass: row.rocket_launch_mass,
    rocket_launch_cost: row.rocket_launch_cost,
    rocket_info_url: row.rocket_info_url,
    rocket_wiki_url: row.rocket_wiki_url,
    mission_name: row.mission_name,
    mission_type: row.mission_type,
    mission_orbit: row.mission_orbit,
    mission_description: row.mission_description,
    mission_info_urls: row.mission_info_urls,
    mission_vid_urls: row.mission_vid_urls,
    mission_agencies: row.mission_agencies,
    launch_info_urls: row.launch_info_urls,
    launch_vid_urls: row.launch_vid_urls,
    flightclub_url: row.flightclub_url,
    hashtag: row.hashtag,
    probability: row.probability,
    hold_reason: row.hold_reason,
    fail_reason: row.fail_reason,
    programs: row.programs,
    crew: row.crew,
    payloads: row.payloads,
    net: row.net,
    net_precision: normalizeNetPrecision(row.net_precision),
    window_start: row.window_start,
    window_end: row.window_end,
    status_name: row.status_name,
    status_abbrev: row.status_abbrev,
    weather_concerns: row.weather_concerns ?? null,
    weather_icon_url: row.weather_icon_url ?? null,
    tier: row.tier_override || row.tier_auto || 'routine',
    featured: row.featured ?? false,
    pad_name: row.pad_name,
    pad_short_code: row.pad_short_code,
    pad_state: row.pad_state,
    pad_state_code: row.pad_state,
    pad_timezone: row.pad_timezone,
    location_name: row.pad_location_name || row.pad_name,
    pad_location_name: row.pad_location_name,
    pad_country_code: row.pad_country_code,
    pad_map_url: row.pad_map_url,
    pad_latitude: row.pad_latitude,
    pad_longitude: row.pad_longitude,
    provider_logo_url: row.provider_logo_url,
    provider_image_url: row.provider_image_url,
    image_thumbnail_url: row.image_thumbnail_url,
    webcast_live: row.webcast_live,
    video_url: videoUrl,
    social_primary_post_id: row.social_primary_post_id,
    social_primary_post_url: row.social_primary_post_url,
    social_primary_post_platform: row.social_primary_post_platform,
    social_primary_post_handle: row.social_primary_post_handle,
    social_primary_post_matched_at: row.social_primary_post_matched_at,
    social_primary_post_for_date: row.social_primary_post_for_date,
    spacex_x_post_id: row.spacex_x_post_id,
    spacex_x_post_url: row.spacex_x_post_url,
    spacex_x_post_captured_at: row.spacex_x_post_captured_at,
    spacex_x_post_for_date: row.spacex_x_post_for_date,
    cache_generated_at: new Date().toISOString()
  };
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

async function upsertSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  value: unknown
) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function tryConsumeProvider(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  provider: 'll2' | 'snapi'
) {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);

  const cfg =
    provider === 'll2'
      ? { limit: await readLl2RateLimit(supabase), windowSeconds: 3600 }
      : { limit: await readSnapiRateLimit(supabase), windowSeconds: 3600 };

  const { data, error } = await supabase.rpc('try_increment_api_rate', {
    provider_name: provider,
    window_start_in: windowStart.toISOString(),
    window_seconds_in: cfg.windowSeconds,
    limit_in: cfg.limit
  });

  if (error) {
    console.error('rateCounter try_increment_api_rate error', error);
    return { allowed: false, limit: cfg.limit, windowEndsAt: new Date(windowStart.getTime() + 3600 * 1000) };
  }

  return {
    allowed: Boolean(data),
    limit: cfg.limit,
    windowEndsAt: new Date(windowStart.getTime() + 3600 * 1000)
  };
}

async function readLl2RateLimit(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  return readNumberSetting(await getCachedSetting(supabase, 'll2_rate_limit_per_hour'), DEFAULTS.ll2RateLimit);
}

async function readSnapiRateLimit(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  return readNumberSetting(await getCachedSetting(supabase, 'snapi_rate_limit_per_hour'), DEFAULTS.snapiRateLimit);
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) {
    headers.Authorization = `Token ${LL2_API_KEY}`;
  }
  return headers;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
