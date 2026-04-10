import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

const PLATFORM = 'x';
const MATCH_VERSION = 'launch-social-link-backfill-v1';
const DEFAULTS = {
  enabled: true,
  scope: 'artemis',
  maxPerRun: 40,
  lookbackDays: 3650,
  horizonDays: 3650
};
const LAUNCH_SELECT_FIELDS = [
  'id',
  'name',
  'mission_name',
  'provider',
  'net',
  'hidden',
  'updates',
  'launch_info_urls',
  'mission_info_urls',
  'social_primary_post_id',
  'social_primary_post_url'
].join(',');
const LAUNCH_PAGE_SIZE = 500;
const LAUNCH_MAX_ROWS = 8000;

type LaunchRow = {
  id: string;
  name: string | null;
  mission_name: string | null;
  provider: string | null;
  net: string | null;
  hidden: boolean | null;
  updates: unknown[] | null;
  launch_info_urls: unknown[] | null;
  mission_info_urls: unknown[] | null;
  social_primary_post_id: string | null;
  social_primary_post_url: string | null;
};

type BackfillCandidate = {
  postId: string;
  postUrl: string;
  handle: string | null;
  discoveredAt: string | null;
  origin: 'update_info_url' | 'launch_info_url' | 'mission_info_url';
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const settings = await getSettings(supabase, [
    'launch_social_link_backfill_enabled',
    'launch_social_link_backfill_scope',
    'launch_social_link_backfill_max_per_run',
    'launch_social_link_backfill_lookback_days',
    'launch_social_link_backfill_horizon_days'
  ]);
  const enabled = readBooleanSetting(settings.launch_social_link_backfill_enabled, DEFAULTS.enabled);
  if (!enabled) {
    return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
  }

  const { runId } = await startIngestionRun(supabase, 'launch_social_link_backfill');
  const stats: Record<string, unknown> = {
    considered: 0,
    eligible: 0,
    alreadyLinked: 0,
    noCandidate: 0,
    matchesUpserted: 0,
    launchRowsPatched: 0,
    cacheRowsPatched: 0,
    socialRowsInserted: 0,
    skipped: false,
    skipReason: null as string | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  let lockId: string | null = null;

  try {
    const scope = readStringSetting(settings.launch_social_link_backfill_scope, DEFAULTS.scope).trim().toLowerCase() || DEFAULTS.scope;
    const maxPerRun = clampInt(readNumberSetting(settings.launch_social_link_backfill_max_per_run, DEFAULTS.maxPerRun), 1, 400);
    const lookbackDays = clampInt(readNumberSetting(settings.launch_social_link_backfill_lookback_days, DEFAULTS.lookbackDays), 1, 36500);
    const horizonDays = clampInt(readNumberSetting(settings.launch_social_link_backfill_horizon_days, DEFAULTS.horizonDays), 1, 36500);

    const lockTtlSeconds = clampInt(Math.max(120, maxPerRun * 20), 60, 3600);
    lockId = crypto.randomUUID();
    const { data: acquired, error: lockError } = await supabase.rpc('try_acquire_job_lock', {
      lock_name_in: 'launch_social_link_backfill',
      ttl_seconds_in: lockTtlSeconds,
      locked_by_in: lockId
    });
    if (lockError) throw lockError;
    if (!acquired) {
      stats.skipped = true;
      stats.skipReason = 'locked';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const launches = await loadScopedLaunches({
      supabase,
      scope,
      fromIso,
      toIso
    });
    stats.considered = launches.length;
    if (!launches.length) {
      stats.skipped = true;
      stats.skipReason = 'no_launches';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, fromIso, toIso, elapsedMs: Date.now() - startedAt });
    }

    let processed = 0;
    for (const launch of launches) {
      if (!isLaunchInScope(launch, scope)) continue;
      stats.eligible = Number(stats.eligible || 0) + 1;

      const alreadyLinked = Boolean(String(launch.social_primary_post_id || '').trim() || String(launch.social_primary_post_url || '').trim());
      if (alreadyLinked) {
        stats.alreadyLinked = Number(stats.alreadyLinked || 0) + 1;
        continue;
      }

      const candidates = extractCandidates(launch);
      const best = pickBestCandidate(candidates, launch.net);
      if (!best) {
        stats.noCandidate = Number(stats.noCandidate || 0) + 1;
        continue;
      }

      const matchedAt = new Date().toISOString();
      const postDate = derivePostDate(launch.net);
      const handleWithAt = best.handle ? `@${best.handle.replace(/^@+/, '')}` : '@unknown';

      const deactivatePatch = { active: false, updated_at: matchedAt };
      const { error: deactivateError } = await supabase
        .from('launch_social_matches')
        .update(deactivatePatch)
        .eq('launch_id', launch.id)
        .eq('platform', PLATFORM)
        .eq('active', true)
        .neq('external_post_id', best.postId);
      if (deactivateError) throw deactivateError;

      const { error: matchUpsertError } = await supabase.from('launch_social_matches').upsert(
        {
          launch_id: launch.id,
          platform: PLATFORM,
          external_post_id: best.postId,
          post_url: best.postUrl,
          account_handle: handleWithAt,
          score: 100,
          confidence: 'high',
          matched_at: best.discoveredAt || matchedAt,
          match_version: MATCH_VERSION,
          signals_json: {
            source: best.origin,
            discoveredAt: best.discoveredAt,
            mode: 'direct_url_link'
          },
          active: true,
          updated_at: matchedAt
        },
        { onConflict: 'launch_id,platform,external_post_id' }
      );
      if (matchUpsertError) throw matchUpsertError;
      stats.matchesUpserted = Number(stats.matchesUpserted || 0) + 1;

      const patch = {
        social_primary_post_id: best.postId,
        social_primary_post_url: best.postUrl,
        social_primary_post_platform: PLATFORM,
        social_primary_post_handle: handleWithAt,
        social_primary_post_matched_at: matchedAt,
        social_primary_post_for_date: postDate
      };

      const { error: launchPatchError } = await supabase.from('launches').update(patch).eq('id', launch.id);
      if (launchPatchError) throw launchPatchError;
      stats.launchRowsPatched = Number(stats.launchRowsPatched || 0) + 1;

      const { error: cachePatchError } = await supabase.from('launches_public_cache').update(patch).eq('launch_id', launch.id);
      if (cachePatchError) throw cachePatchError;
      stats.cacheRowsPatched = Number(stats.cacheRowsPatched || 0) + 1;

      const { data: existingSocial, error: existingSocialError } = await supabase
        .from('social_posts')
        .select('id')
        .eq('launch_id', launch.id)
        .eq('platform', PLATFORM)
        .eq('external_id', best.postId)
        .limit(1);
      if (existingSocialError) throw existingSocialError;

      if (!Array.isArray(existingSocial) || existingSocial.length === 0) {
        const socialRow = {
          launch_id: launch.id,
          platform: PLATFORM,
          post_type: 'provider_primary_link',
          status: 'sent',
          post_text: null,
          reply_text: null,
          external_id: best.postId,
          platform_results: {
            source: MATCH_VERSION,
            origin: best.origin,
            url: best.postUrl
          },
          scheduled_for: launch.net || null,
          posted_at: best.discoveredAt || launch.net || matchedAt
        };
        const { error: insertSocialError } = await supabase.from('social_posts').insert(socialRow);
        if (insertSocialError) throw insertSocialError;
        stats.socialRowsInserted = Number(stats.socialRowsInserted || 0) + 1;
      }

      processed += 1;
      if (processed >= maxPerRun) break;
    }

    await finishIngestionRun(supabase, runId, true, {
      ...stats,
      scope,
      maxPerRun,
      lookbackDays,
      horizonDays
    });
    return jsonResponse(
      {
        ok: true,
        ...stats,
        scope,
        maxPerRun,
        lookbackDays,
        horizonDays,
        elapsedMs: Date.now() - startedAt
      },
      200
    );
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'run', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, ...stats, elapsedMs: Date.now() - startedAt }, 500);
  } finally {
    if (lockId) {
      await supabase
        .rpc('release_job_lock', {
          lock_name_in: 'launch_social_link_backfill',
          locked_by_in: lockId
        })
        .catch(() => undefined);
    }
  }
});

function isLaunchInScope(launch: LaunchRow, scope: string) {
  const text = `${launch.name || ''} ${launch.mission_name || ''} ${launch.provider || ''}`.toLowerCase();
  if (scope === 'all') return true;
  if (scope === 'starship') return /\bstarship\b|\bift\b|\bsuper heavy\b/.test(text);
  if (scope === 'artemis') return /\bartemis\b/.test(text);
  return text.includes(scope);
}

async function loadScopedLaunches({
  supabase,
  scope,
  fromIso,
  toIso
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  scope: string;
  fromIso: string;
  toIso: string;
}) {
  const launches: LaunchRow[] = [];

  while (launches.length < LAUNCH_MAX_ROWS) {
    const rangeFrom = launches.length;
    const rangeTo = rangeFrom + LAUNCH_PAGE_SIZE - 1;

    let query: any = supabase
      .from('launches')
      .select(LAUNCH_SELECT_FIELDS)
      .eq('hidden', false)
      .gte('net', fromIso)
      .lte('net', toIso);
    query = applyScopeToLaunchQuery(query, scope);

    const { data, error } = await query.order('net', { ascending: true }).order('id', { ascending: true }).range(rangeFrom, rangeTo);
    if (error) throw error;

    const pageRows = Array.isArray(data) ? (data as LaunchRow[]) : [];
    if (!pageRows.length) break;

    launches.push(...pageRows);
    if (pageRows.length < LAUNCH_PAGE_SIZE) break;
  }

  return launches;
}

function applyScopeToLaunchQuery(query: any, scope: string) {
  if (scope === 'all') return query;
  if (scope === 'artemis') return query.or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%');
  if (scope === 'starship') {
    return query.or(
      'name.ilike.%Starship%,mission_name.ilike.%Starship%,name.ilike.%IFT%,mission_name.ilike.%IFT%,name.ilike.%Super Heavy%,mission_name.ilike.%Super Heavy%'
    );
  }

  const token = sanitizeScopeToken(scope);
  if (!token) return query;
  return query.or(`name.ilike.%${token}%,mission_name.ilike.%${token}%,provider.ilike.%${token}%`);
}

function sanitizeScopeToken(value: string) {
  return value
    .replace(/[%_]/g, '')
    .replace(/[(),'"`]/g, ' ')
    .replace(/[^a-z0-9\s-]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractCandidates(launch: LaunchRow): BackfillCandidate[] {
  const candidates: BackfillCandidate[] = [];

  const pushFromUrl = (
    rawUrl: unknown,
    origin: BackfillCandidate['origin'],
    discoveredAt: string | null
  ) => {
    const parsed = parseTweetReference(rawUrl);
    if (!parsed) return;
    candidates.push({
      postId: parsed.postId,
      postUrl: parsed.postUrl,
      handle: parsed.handle,
      discoveredAt,
      origin
    });
  };

  const updates = Array.isArray(launch.updates) ? launch.updates : [];
  for (const update of updates) {
    const discoveredAt = normalizeIso((update as any)?.created_on) || null;
    pushFromUrl((update as any)?.info_url, 'update_info_url', discoveredAt);
  }

  const launchInfoUrls = Array.isArray(launch.launch_info_urls) ? launch.launch_info_urls : [];
  for (const item of launchInfoUrls) {
    const discoveredAt = normalizeIso((item as any)?.published_at) || normalizeIso((item as any)?.modified_at) || null;
    pushFromUrl((item as any)?.url, 'launch_info_url', discoveredAt);
  }

  const missionInfoUrls = Array.isArray(launch.mission_info_urls) ? launch.mission_info_urls : [];
  for (const item of missionInfoUrls) {
    const discoveredAt = normalizeIso((item as any)?.published_at) || normalizeIso((item as any)?.modified_at) || null;
    pushFromUrl((item as any)?.url, 'mission_info_url', discoveredAt);
  }

  const byId = new Map<string, BackfillCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.postId);
    if (!existing) {
      byId.set(candidate.postId, candidate);
      continue;
    }
    const currentMs = parseDateOrZero(existing.discoveredAt);
    const nextMs = parseDateOrZero(candidate.discoveredAt);
    if (nextMs > currentMs) byId.set(candidate.postId, candidate);
  }
  return [...byId.values()];
}

function pickBestCandidate(candidates: BackfillCandidate[], netIso: string | null) {
  if (!candidates.length) return null;
  const netMs = parseDateOrZero(netIso);
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidate(candidate, netMs)
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return parseDateOrZero(b.candidate.discoveredAt) - parseDateOrZero(a.candidate.discoveredAt);
  });
  return scored[0]?.candidate || null;
}

function scoreCandidate(candidate: BackfillCandidate, netMs: number) {
  const originWeight = candidate.origin === 'update_info_url' ? 3000 : candidate.origin === 'launch_info_url' ? 2000 : 1000;
  const discoveredMs = parseDateOrZero(candidate.discoveredAt);
  if (!Number.isFinite(netMs) || !Number.isFinite(discoveredMs) || discoveredMs <= 0) return originWeight;
  const deltaHours = Math.abs(discoveredMs - netMs) / (1000 * 60 * 60);
  const closeness = Math.max(0, 1000 - Math.trunc(deltaHours));
  return originWeight + closeness;
}

function parseTweetReference(rawUrl: unknown) {
  if (typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (!url) return null;

  const match = url.match(/(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d{5,25})/i);
  if (!match?.[1] || !match?.[2]) return null;

  const handle = match[1].replace(/^@+/, '').trim().toLowerCase();
  const postId = match[2].trim();
  if (!postId) return null;

  const postUrl = `https://x.com/i/web/status/${encodeURIComponent(postId)}`;
  return {
    handle: handle || null,
    postId,
    postUrl
  };
}

function derivePostDate(netIso: string | null) {
  const iso = normalizeIso(netIso);
  return iso ? iso.slice(0, 10) : null;
}

function normalizeIso(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseDateOrZero(value: string | null | undefined) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
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
