import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

const USER_AGENT = 'TMinusZero/0.1 (support@tminuszero.app)';
const PLATFORM = 'x';
const MATCH_VERSION = 'launch-social-v1';
const DEFAULTS = {
  enabled: true,
  xEnabled: true,
  timezone: 'America/New_York',
  horizonDays: 7,
  maxPerRun: 30,
  topN: 3,
  maxAccountsPerProvider: 3,
  baselineMinutes: 30,
  farMinutes: 15,
  approachMinutes: 5,
  finalMinutes: 2,
  postMinutes: 30,
  farHours: 24,
  approachHours: 6,
  postHours: 6,
  matchThresholdHigh: 70,
  fetchTimeoutMs: 12000,
  errorCooldownMinutes: 30
};

type LaunchRow = {
  id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  provider: string | null;
  vehicle: string | null;
  rocket_full_name: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_location_name: string | null;
  pad_timezone: string | null;
  hidden: boolean | null;
  social_primary_post_id: string | null;
  social_primary_post_url: string | null;
  social_primary_post_platform: string | null;
  social_primary_post_handle: string | null;
  social_primary_post_matched_at: string | null;
  social_primary_post_for_date: string | null;
  spacex_x_post_id: string | null;
  spacex_x_post_url: string | null;
  spacex_x_post_captured_at: string | null;
  spacex_x_post_for_date: string | null;
};

type LaunchCandidate = LaunchRow & {
  netMs: number;
  netDate: string;
  providerKey: string;
};

type SocialAccountRow = {
  id: number;
  provider_key: string;
  provider_name: string;
  platform: string;
  handle: string;
  priority: number | null;
  active: boolean | null;
  cooldown_until: string | null;
};

type TimelineTweet = {
  id: string;
  url: string;
  text: string;
  normalizedText: string;
  createdAt: string | null;
  createdAtMs: number | null;
  accountHandle: string;
  media: TweetMedia[];
};

type TweetMedia = {
  mediaKey: string | null;
  normalizedUrl: string;
  type: string;
  width: number | null;
  height: number | null;
  altText: string | null;
};

type ScoredTweet = {
  tweet: TimelineTweet;
  score: number;
  signals: number;
  strongSignals: number;
  mediumSignals: number;
  signalBreakdown: Record<string, number>;
};

type AccountFetchResult = {
  status: 'ok' | 'cooldown' | 'error';
  tweets: TimelineTweet[];
  error?: string;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'launch_social_refresh');
  const stats: Record<string, unknown> = {
    considered: 0,
    topLaunchIds: [] as string[],
    dueLaunches: 0,
    staleCleared: 0,
    launchesWithoutAccounts: 0,
    launchesWithoutTweets: 0,
    launchesUnmatched: 0,
    accountsFetched: 0,
    accountsSkippedCooldown: 0,
    accountsFailed: 0,
    candidatesUpserted: 0,
    matched: 0,
    updated: 0,
    skipped: false,
    skipReason: null as string | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  let lockId: string | null = null;

  try {
    const settings = await getSettings(supabase, [
      'launch_social_enabled',
      'launch_social_x_enabled',
      'launch_social_timezone',
      'launch_social_top_n',
      'launch_social_horizon_days',
      'launch_social_max_per_run',
      'launch_social_max_accounts_per_provider',
      'launch_social_baseline_minutes',
      'launch_social_far_minutes',
      'launch_social_approach_minutes',
      'launch_social_final_minutes',
      'launch_social_post_minutes',
      'launch_social_far_hours',
      'launch_social_approach_hours',
      'launch_social_post_hours',
      'launch_social_match_threshold_high',
      'launch_social_fetch_timeout_ms',
      'launch_social_error_cooldown_minutes'
    ]);

    const enabled = readBooleanSetting(settings.launch_social_enabled, DEFAULTS.enabled);
    const xEnabled = readBooleanSetting(settings.launch_social_x_enabled, DEFAULTS.xEnabled);
    if (!enabled || !xEnabled) {
      stats.skipped = true;
      stats.skipReason = !enabled ? 'disabled' : 'x_disabled';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const timezone = readStringSetting(settings.launch_social_timezone, DEFAULTS.timezone).trim() || DEFAULTS.timezone;
    const topN = clampInt(readNumberSetting(settings.launch_social_top_n, DEFAULTS.topN), 1, 10);
    const horizonDays = clampInt(readNumberSetting(settings.launch_social_horizon_days, DEFAULTS.horizonDays), 1, 30);
    const maxPerRun = clampInt(readNumberSetting(settings.launch_social_max_per_run, DEFAULTS.maxPerRun), 1, 100);
    const maxAccountsPerProvider = clampInt(
      readNumberSetting(settings.launch_social_max_accounts_per_provider, DEFAULTS.maxAccountsPerProvider),
      1,
      10
    );
    const baselineMinutes = clampInt(
      readNumberSetting(settings.launch_social_baseline_minutes, DEFAULTS.baselineMinutes),
      5,
      120
    );
    const farMinutes = clampInt(readNumberSetting(settings.launch_social_far_minutes, DEFAULTS.farMinutes), 1, 60);
    const approachMinutes = clampInt(
      readNumberSetting(settings.launch_social_approach_minutes, DEFAULTS.approachMinutes),
      1,
      60
    );
    const finalMinutes = clampInt(readNumberSetting(settings.launch_social_final_minutes, DEFAULTS.finalMinutes), 1, 30);
    const postMinutes = clampInt(readNumberSetting(settings.launch_social_post_minutes, DEFAULTS.postMinutes), 5, 180);
    const farHours = clampInt(readNumberSetting(settings.launch_social_far_hours, DEFAULTS.farHours), 1, 120);
    const approachHours = clampInt(readNumberSetting(settings.launch_social_approach_hours, DEFAULTS.approachHours), 1, 48);
    const postHours = clampInt(readNumberSetting(settings.launch_social_post_hours, DEFAULTS.postHours), 1, 24);
    const matchThresholdHigh = clampInt(
      readNumberSetting(settings.launch_social_match_threshold_high, DEFAULTS.matchThresholdHigh),
      40,
      180
    );
    const fetchTimeoutMs = clampInt(
      readNumberSetting(settings.launch_social_fetch_timeout_ms, DEFAULTS.fetchTimeoutMs),
      2000,
      45000
    );
    const errorCooldownMinutes = clampInt(
      readNumberSetting(settings.launch_social_error_cooldown_minutes, DEFAULTS.errorCooldownMinutes),
      1,
      360
    );

    lockId = crypto.randomUUID();
    const lockTtlSeconds = clampInt(Math.max(120, maxPerRun * 30), 60, 3600);
    const { data: acquired, error: lockError } = await supabase.rpc('try_acquire_job_lock', {
      lock_name_in: 'launch_social_refresh',
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

    const now = new Date();
    const nowMs = now.getTime();
    const fromIso = new Date(nowMs - 6 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launchRows, error: launchesError } = await supabase
      .from('launches')
      .select(
        [
          'id',
          'name',
          'mission_name',
          'net',
          'provider',
          'vehicle',
          'rocket_full_name',
          'pad_name',
          'pad_short_code',
          'pad_location_name',
          'pad_timezone',
          'hidden',
          'social_primary_post_id',
          'social_primary_post_url',
          'social_primary_post_platform',
          'social_primary_post_handle',
          'social_primary_post_matched_at',
          'social_primary_post_for_date',
          'spacex_x_post_id',
          'spacex_x_post_url',
          'spacex_x_post_captured_at',
          'spacex_x_post_for_date'
        ].join(',')
      )
      .eq('hidden', false)
      .gte('net', fromIso)
      .lte('net', toIso)
      .order('net', { ascending: true })
      .limit(300);
    if (launchesError) throw launchesError;

    const parsed = parseLaunchCandidates(launchRows as LaunchRow[] | null, timezone);
    stats.considered = parsed.length;
    if (!parsed.length) {
      stats.skipped = true;
      stats.skipReason = 'no_candidates';
      await finishIngestionRun(supabase, runId, true, { ...stats, fromIso, toIso });
      return jsonResponse({ ok: true, ...stats, fromIso, toIso, elapsedMs: Date.now() - startedAt });
    }

    const staleIds = parsed
      .filter((launch) => isStalePrimaryDate(launch, nowMs))
      .map((launch) => launch.id);
    if (staleIds.length) {
      const cleared = await clearPrimaryPosts(supabase, staleIds);
      stats.staleCleared = cleared;
    }

    const upcoming = parsed.filter((launch) => launch.netMs >= nowMs).sort((a, b) => a.netMs - b.netMs);
    const topLaunches = upcoming.slice(0, topN);
    const topIds = new Set(topLaunches.map((launch) => launch.id));
    stats.topLaunchIds = topLaunches.map((launch) => launch.id);

    const { data: accountRows, error: accountsError } = await supabase
      .from('social_accounts')
      .select('id,provider_key,provider_name,platform,handle,priority,active,cooldown_until')
      .eq('active', true)
      .eq('platform', PLATFORM)
      .order('priority', { ascending: true })
      .order('id', { ascending: true });
    if (accountsError) throw accountsError;

    const allAccounts = normalizeAccounts(accountRows as SocialAccountRow[] | null);
    if (!allAccounts.length) {
      stats.skipped = true;
      stats.skipReason = 'no_accounts';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const accountsByProvider = groupAccountsByProvider(allAccounts);
    const latestFetchByLaunch = await loadLatestFetchedByLaunch(
      supabase,
      parsed.map((launch) => launch.id)
    );

    const due = parsed
      .filter((launch) => {
        const cadenceMinutes = resolveCadenceMinutes({
          isTop: topIds.has(launch.id),
          nowMs,
          netMs: launch.netMs,
          baselineMinutes,
          farMinutes,
          approachMinutes,
          finalMinutes,
          postMinutes,
          farHours,
          approachHours,
          postHours
        });
        if (cadenceMinutes == null) return false;
        const lastFetchedMs = latestFetchByLaunch.get(launch.id) ?? 0;
        if (!lastFetchedMs) return true;
        return nowMs - lastFetchedMs >= cadenceMinutes * 60 * 1000;
      })
      .sort((a, b) => {
        const aTop = topIds.has(a.id) ? 0 : 1;
        const bTop = topIds.has(b.id) ? 0 : 1;
        if (aTop !== bTop) return aTop - bTop;
        return a.netMs - b.netMs;
      })
      .slice(0, maxPerRun);

    stats.dueLaunches = due.length;
    if (!due.length) {
      stats.skipped = true;
      stats.skipReason = 'not_due';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const accountCache = new Map<string, AccountFetchResult>();
    const nowIso = new Date().toISOString();

    for (const launch of due) {
      const providerAccounts = pickProviderAccounts({
        providerKey: launch.providerKey,
        accountsByProvider,
        maxAccountsPerProvider
      });
      if (!providerAccounts.length) {
        stats.launchesWithoutAccounts = Number(stats.launchesWithoutAccounts || 0) + 1;
        continue;
      }

      const launchTweets: TimelineTweet[] = [];
      for (const account of providerAccounts) {
        const cacheKey = account.handle;
        const cached = accountCache.get(cacheKey);
        if (cached) {
          if (cached.status === 'ok') launchTweets.push(...cached.tweets);
          continue;
        }

        const loaded = await loadAccountTweets({
          supabase,
          account,
          timeoutMs: fetchTimeoutMs,
          cooldownMinutes: errorCooldownMinutes,
          nowMs
        });

        accountCache.set(cacheKey, loaded);
        if (loaded.status === 'ok') {
          stats.accountsFetched = Number(stats.accountsFetched || 0) + 1;
          launchTweets.push(...loaded.tweets);
        } else if (loaded.status === 'cooldown') {
          stats.accountsSkippedCooldown = Number(stats.accountsSkippedCooldown || 0) + 1;
        } else {
          stats.accountsFailed = Number(stats.accountsFailed || 0) + 1;
          (stats.errors as any[]).push({
            step: 'account_fetch',
            error: loaded.error || 'account_fetch_failed',
            context: { account: account.handle }
          });
        }
      }

      if (!launchTweets.length) {
        stats.launchesWithoutTweets = Number(stats.launchesWithoutTweets || 0) + 1;
        continue;
      }

      const context = buildLaunchMatchContext(launch);
      const ranked = rankTweetsForLaunch(launchTweets, context);
      if (ranked.length) {
        const candidateRows = ranked.slice(0, 80).map((item) => toCandidateRow(launch.id, item, nowIso));
        const upserted = await upsertCandidates(supabase, candidateRows);
        stats.candidatesUpserted = Number(stats.candidatesUpserted || 0) + upserted;
      }

      const best = chooseBestHighConfidence(ranked, context.netMs, matchThresholdHigh);
      if (!best) {
        stats.launchesUnmatched = Number(stats.launchesUnmatched || 0) + 1;
        continue;
      }

      await promoteMatch(supabase, {
        launch,
        best,
        matchedAt: nowIso
      });
      stats.matched = Number(stats.matched || 0) + 1;
      stats.updated = Number(stats.updated || 0) + 1;
    }

    await finishIngestionRun(supabase, runId, true, {
      ...stats,
      timezone,
      topN,
      horizonDays,
      maxPerRun,
      matchThresholdHigh
    });
    return jsonResponse(
      {
        ok: true,
        ...stats,
        timezone,
        topN,
        horizonDays,
        maxPerRun,
        matchThresholdHigh,
        elapsedMs: Date.now() - startedAt
      },
      200
    );
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as any[]).push({ step: 'run', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, ...stats, elapsedMs: Date.now() - startedAt }, 500);
  } finally {
    if (lockId) {
      try {
        await supabase.rpc('release_job_lock', { lock_name_in: 'launch_social_refresh', locked_by_in: lockId });
      } catch {
        // ignore (TTL expiry is fallback)
      }
    }
  }
});

function parseLaunchCandidates(rows: LaunchRow[] | null, fallbackTimezone: string) {
  const out: LaunchCandidate[] = [];
  for (const row of rows || []) {
    if (!row?.id || !row.net) continue;
    const netMs = Date.parse(row.net);
    if (!Number.isFinite(netMs)) continue;
    const tz = row.pad_timezone?.trim() || fallbackTimezone;
    const netDate = safeZonedDateTime(new Date(netMs), tz).date;
    out.push({
      ...row,
      netMs,
      netDate,
      providerKey: normalizeProviderKey(row.provider)
    });
  }
  return out;
}

function normalizeAccounts(rows: SocialAccountRow[] | null) {
  const out: SocialAccountRow[] = [];
  const seen = new Set<string>();
  for (const row of rows || []) {
    const handle = normalizeHandle(row.handle);
    const providerKey = normalizeProviderKey(row.provider_key || row.provider_name);
    if (!handle || !providerKey) continue;
    const dedupe = `${providerKey}:${handle}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      ...row,
      handle,
      provider_key: providerKey
    });
  }
  return out.sort((a, b) => (a.priority || 100) - (b.priority || 100));
}

function groupAccountsByProvider(rows: SocialAccountRow[]) {
  const byProvider = new Map<string, SocialAccountRow[]>();
  for (const row of rows) {
    const list = byProvider.get(row.provider_key) || [];
    list.push(row);
    byProvider.set(row.provider_key, list);
  }
  return byProvider;
}

function pickProviderAccounts({
  providerKey,
  accountsByProvider,
  maxAccountsPerProvider
}: {
  providerKey: string;
  accountsByProvider: Map<string, SocialAccountRow[]>;
  maxAccountsPerProvider: number;
}) {
  const rows = accountsByProvider.get(providerKey) || [];
  return rows.slice(0, maxAccountsPerProvider);
}

function resolveCadenceMinutes({
  isTop,
  nowMs,
  netMs,
  baselineMinutes,
  farMinutes,
  approachMinutes,
  finalMinutes,
  postMinutes,
  farHours,
  approachHours,
  postHours
}: {
  isTop: boolean;
  nowMs: number;
  netMs: number;
  baselineMinutes: number;
  farMinutes: number;
  approachMinutes: number;
  finalMinutes: number;
  postMinutes: number;
  farHours: number;
  approachHours: number;
  postHours: number;
}) {
  if (!isTop) return baselineMinutes;

  const hoursToNet = (netMs - nowMs) / (1000 * 60 * 60);
  if (hoursToNet > farHours) return farMinutes;
  if (hoursToNet > approachHours) return approachMinutes;
  if (hoursToNet > -1) return finalMinutes;
  if (hoursToNet > -postHours) return postMinutes;
  return null;
}

function isStalePrimaryDate(launch: LaunchCandidate, nowMs: number) {
  if (launch.netMs <= nowMs) return false;
  const storedPrimaryDate = String(launch.social_primary_post_for_date || '').trim();
  const storedLegacyDate = String(launch.spacex_x_post_for_date || '').trim();
  const hasPrimary = Boolean(
    launch.social_primary_post_id ||
      launch.social_primary_post_url ||
      launch.spacex_x_post_id ||
      launch.spacex_x_post_url
  );
  if (!hasPrimary) return false;

  const effectiveStoredDate = storedPrimaryDate || storedLegacyDate || '';
  if (!effectiveStoredDate) return false;
  return effectiveStoredDate !== launch.netDate;
}

async function loadLatestFetchedByLaunch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const out = new Map<string, number>();
  if (!launchIds.length) return out;

  const horizonIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('launch_social_candidates')
    .select('launch_id,fetched_at')
    .in('launch_id', launchIds)
    .gte('fetched_at', horizonIso)
    .order('fetched_at', { ascending: false })
    .limit(6000);
  if (error || !Array.isArray(data)) return out;

  for (const row of data) {
    const launchId = String((row as any)?.launch_id || '').trim();
    if (!launchId || out.has(launchId)) continue;
    const fetchedAt = String((row as any)?.fetched_at || '').trim();
    const ms = Date.parse(fetchedAt);
    if (Number.isFinite(ms)) out.set(launchId, ms);
  }
  return out;
}

async function loadAccountTweets({
  supabase,
  account,
  timeoutMs,
  cooldownMinutes,
  nowMs
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  account: SocialAccountRow;
  timeoutMs: number;
  cooldownMinutes: number;
  nowMs: number;
}): Promise<AccountFetchResult> {
  const cooldownUntilMs = account.cooldown_until ? Date.parse(account.cooldown_until) : NaN;
  if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
    return { status: 'cooldown', tweets: [] };
  }

  try {
    const tweets = await fetchTimelineTweets(account.handle, timeoutMs);
    await supabase
      .from('social_accounts')
      .update({
        last_fetch_at: new Date(nowMs).toISOString(),
        last_success_at: new Date(nowMs).toISOString(),
        last_error_at: null,
        last_error: null,
        cooldown_until: null,
        updated_at: new Date(nowMs).toISOString()
      })
      .eq('id', account.id);
    return { status: 'ok', tweets };
  } catch (err) {
    const message = stringifyError(err);
    const cooldownUntilIso = new Date(nowMs + cooldownMinutes * 60 * 1000).toISOString();
    await supabase
      .from('social_accounts')
      .update({
        last_fetch_at: new Date(nowMs).toISOString(),
        last_error_at: new Date(nowMs).toISOString(),
        last_error: message,
        cooldown_until: cooldownUntilIso,
        updated_at: new Date(nowMs).toISOString()
      })
      .eq('id', account.id);
    return { status: 'error', tweets: [], error: message };
  }
}

async function fetchTimelineTweets(handle: string, timeoutMs: number): Promise<TimelineTweet[]> {
  const safeHandle = normalizeHandle(handle);
  if (!safeHandle) return [];

  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(safeHandle)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`x_syndication_${res.status}`);

  const html = await res.text();
  const payload = extractNextDataJson(html);
  if (!payload) return [];

  let parsed: any = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }

  const entries = parsed?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return [];

  const out: TimelineTweet[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const tweet = entry?.content?.tweet;
    const id = String(tweet?.id_str || '').trim();
    if (!id || !/^\d+$/.test(id) || seen.has(id)) continue;

    const fullText = pickFirstString(tweet?.full_text, tweet?.text);
    if (!fullText) continue;

    const createdAt = pickFirstString(tweet?.created_at) || null;
    const createdAtMsRaw = createdAt ? Date.parse(createdAt) : NaN;
    const createdAtMs = Number.isFinite(createdAtMsRaw) ? createdAtMsRaw : null;

    const permalink = pickFirstString(tweet?.permalink);
    const resolvedUrl = permalink
      ? `https://x.com${permalink.startsWith('/') ? permalink : `/${permalink}`}`
      : `https://x.com/${encodeURIComponent(safeHandle)}/status/${encodeURIComponent(id)}`;
    const media = extractSyndicatedMedia(tweet);

    seen.add(id);
    out.push({
      id,
      url: resolvedUrl,
      text: fullText,
      normalizedText: normalizeMatchText(removeUrls(fullText)),
      createdAt,
      createdAtMs,
      accountHandle: safeHandle,
      media
    });
  }

  out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return out.slice(0, 120);
}

function extractNextDataJson(html: string) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const end = html.indexOf('</script>', jsonStart);
  if (end < 0) return null;
  return html.slice(jsonStart, end);
}

function extractSyndicatedMedia(tweetRaw: unknown): TweetMedia[] {
  const tweet = asRecord(tweetRaw);
  if (!tweet) return [];

  const candidates = [tweet, asRecord(tweet.retweeted_status), asRecord(tweet.quoted_status)].filter(
    (value): value is Record<string, unknown> => Boolean(value)
  );

  const out: TweetMedia[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const mediaRows = [
      ...readMediaRows(candidate.extended_entities),
      ...readMediaRows(candidate.entities),
      ...readMediaRows(asRecord(candidate.retweeted_status)?.extended_entities),
      ...readMediaRows(asRecord(candidate.retweeted_status)?.entities),
      ...readMediaRows(asRecord(candidate.quoted_status)?.extended_entities),
      ...readMediaRows(asRecord(candidate.quoted_status)?.entities)
    ];

    for (const row of mediaRows) {
      const mediaKey = pickFirstString(row.media_key, row.id_str, row.id);
      const normalizedUrl = normalizeMediaUrl(row.media_url_https, row.media_url);
      if (!normalizedUrl) continue;

      const dedupeKey = mediaKey ? `key:${mediaKey}` : `url:${normalizedUrl}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const { width, height } = resolveLargestMediaSize(row);
      out.push({
        mediaKey: mediaKey || null,
        normalizedUrl,
        type: normalizeMediaType(row.type),
        width,
        height,
        altText: pickFirstString(row.ext_alt_text, row.alt_text) || null
      });
    }
  }

  return out.slice(0, 8);
}

function readMediaRows(node: unknown) {
  const record = asRecord(node);
  const media = Array.isArray(record?.media) ? record.media : [];
  return media
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function resolveLargestMediaSize(media: Record<string, unknown>) {
  const sizes = asRecord(media.sizes);
  if (!sizes) return { width: null as number | null, height: null as number | null };

  let width: number | null = null;
  let height: number | null = null;
  for (const value of Object.values(sizes)) {
    const size = asRecord(value);
    if (!size) continue;
    const candidateWidth = finiteNumber(size.w);
    const candidateHeight = finiteNumber(size.h);
    if (candidateWidth == null || candidateHeight == null) continue;
    const currentArea = width != null && height != null ? width * height : -1;
    const candidateArea = candidateWidth * candidateHeight;
    if (candidateArea >= currentArea) {
      width = candidateWidth;
      height = candidateHeight;
    }
  }
  return { width, height };
}

function normalizeMediaType(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'photo';
  return normalized;
}

function normalizeMediaUrl(...values: unknown[]) {
  for (const value of values) {
    const candidate = pickFirstString(value);
    if (!candidate) continue;

    const normalized = candidate.startsWith('//')
      ? `https:${candidate}`
      : candidate.startsWith('http://')
        ? `https://${candidate.slice('http://'.length)}`
        : candidate;
    try {
      const parsed = new URL(normalized);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.toLowerCase().includes('twimg.com')) {
        return parsed.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
}

function rankTweetsForLaunch(
  tweets: TimelineTweet[],
  context: ReturnType<typeof buildLaunchMatchContext>
): ScoredTweet[] {
  const ranked = tweets
    .map((tweet) => {
      const score = scoreTweetForLaunch(tweet, context);
      return { tweet, ...score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDelta = Math.abs((a.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - context.netMs);
      const bDelta = Math.abs((b.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - context.netMs);
      return aDelta - bDelta;
    });

  const deduped: ScoredTweet[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (seen.has(item.tweet.id)) continue;
    seen.add(item.tweet.id);
    deduped.push(item);
  }
  return deduped;
}

function chooseBestHighConfidence(ranked: ScoredTweet[], netMs: number, threshold: number) {
  if (!ranked.length) return null;
  const eligible = ranked.filter((item) => isHighConfidence(item, threshold));
  if (!eligible.length) return null;

  const best = eligible[0]!;
  const second = eligible[1];
  if (!second) return best;

  if (best.score - second.score >= 6) return best;

  const bestDelta = Math.abs((best.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - netMs);
  const secondDelta = Math.abs((second.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - netMs);
  return secondDelta < bestDelta ? second : best;
}

function isHighConfidence(item: ScoredTweet, threshold: number) {
  if (item.score < threshold) return false;
  if (item.strongSignals >= 1) return true;
  return item.mediumSignals >= 2;
}

function scoreTweetForLaunch(
  tweet: TimelineTweet,
  context: ReturnType<typeof buildLaunchMatchContext>
): Omit<ScoredTweet, 'tweet'> {
  const text = tweet.normalizedText;
  if (!text) {
    return {
      score: 0,
      signals: 0,
      strongSignals: 0,
      mediumSignals: 0,
      signalBreakdown: {}
    };
  }

  let score = 0;
  let signals = 0;
  let strongSignals = 0;
  let mediumSignals = 0;
  const signalBreakdown: Record<string, number> = {};
  const add = (name: string, delta: number, kind: 'strong' | 'medium' = 'medium') => {
    score += delta;
    signalBreakdown[name] = (signalBreakdown[name] || 0) + delta;
    signals += 1;
    if (kind === 'strong') strongSignals += 1;
    if (kind === 'medium') mediumSignals += 1;
  };

  if (context.missionPhrase && text.includes(context.missionPhrase)) {
    add('mission_phrase', 90, 'strong');
  } else if (context.missionWords.length >= 2) {
    const matchedWords = context.missionWords.filter((word) => text.includes(word)).length;
    if (matchedWords >= 2) add('mission_words', 30, 'medium');
  }

  if (context.launchPhrase && text.includes(context.launchPhrase)) {
    add('launch_phrase', 55, 'strong');
  }

  if (context.rocketPhrase && text.includes(context.rocketPhrase)) {
    add('rocket_phrase', 24, 'medium');
  }

  if (context.padShort && containsPadReference(text, context.padShort)) {
    add('pad_short', 28, 'medium');
  }

  if (context.padName && text.includes(context.padName)) {
    add('pad_name', 14, 'medium');
  }

  if (context.locationPhrase && text.includes(context.locationPhrase)) {
    add('location_phrase', 10, 'medium');
  }

  for (const token of context.identifiers) {
    if (!token || token.length < 3) continue;
    if (!text.includes(token)) continue;
    add(`identifier:${token}`, token.includes(' ') ? 20 : 16, 'medium');
  }

  if (text.startsWith('@') || text.startsWith('rt @')) {
    score -= 20;
    signalBreakdown.reply_or_retweet_penalty = (signalBreakdown.reply_or_retweet_penalty || 0) - 20;
  }

  if (Number.isFinite(context.netMs) && tweet.createdAtMs != null && Number.isFinite(tweet.createdAtMs)) {
    const deltaHours = (tweet.createdAtMs - context.netMs) / (1000 * 60 * 60);
    if (deltaHours <= 24 && deltaHours >= -120) {
      add('time_near', 22, 'medium');
    } else if (deltaHours <= 48 && deltaHours >= -240) {
      add('time_wide', 10, 'medium');
    } else {
      score -= 20;
      signalBreakdown.time_penalty = (signalBreakdown.time_penalty || 0) - 20;
    }
  }

  return { score, signals, strongSignals, mediumSignals, signalBreakdown };
}

function buildLaunchMatchContext(launch: LaunchCandidate) {
  const mission = deriveMissionName(launch);
  const missionPhrase = normalizeMatchText(mission);
  const launchPhrase = normalizeMatchText(launch.name);
  const rocketPhrase = normalizeMatchText(launch.rocket_full_name || launch.vehicle);
  const padShort = normalizeMatchText(launch.pad_short_code);
  const padName = normalizeMatchText(launch.pad_name);
  const locationPhrase = normalizeMatchText(launch.pad_location_name);
  const identifiers = extractIdentifiers([
    launch.name,
    mission,
    launch.rocket_full_name,
    launch.vehicle,
    launch.pad_short_code,
    launch.pad_name
  ]);

  const missionWords = missionPhrase
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && !COMMON_MISSION_WORDS.has(part));

  return {
    missionPhrase,
    missionWords,
    launchPhrase,
    rocketPhrase,
    padShort,
    padName,
    locationPhrase,
    identifiers,
    netMs: launch.netMs
  };
}

function deriveMissionName(launch: LaunchRow) {
  const mission = String(launch.mission_name || '').trim();
  if (mission) return mission;

  const name = String(launch.name || '').trim();
  if (!name) return '';
  const parts = name
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1] || name;
  return name;
}

const COMMON_MISSION_WORDS = new Set([
  'mission',
  'launch',
  'satellite',
  'satellites',
  'orbit',
  'from',
  'with',
  'stage',
  'booster'
]);

function extractIdentifiers(values: Array<string | null | undefined>) {
  const out = new Set<string>();

  for (const rawValue of values) {
    const value = String(rawValue || '').toLowerCase();
    if (!value) continue;
    const normalized = normalizeMatchText(value);
    if (!normalized) continue;

    for (const match of normalized.matchAll(/\b[a-z]{0,8}\d[a-z0-9-]{1,}\b/g)) {
      const token = String(match[0] || '').trim();
      if (token.length >= 4) out.add(token);
    }
    for (const match of normalized.matchAll(/\b\d{1,3}-\d{1,3}\b/g)) {
      const token = String(match[0] || '').trim();
      if (token) out.add(token);
    }

    const group = normalized.match(/\bgroup\s+(\d{1,3}-\d{1,3})\b/);
    if (group?.[1]) {
      out.add(group[1]);
      out.add(`group ${group[1]}`);
    }
    const crew = normalized.match(/\bcrew[-\s]?(\d{1,3})\b/);
    if (crew?.[1]) {
      out.add(`crew-${crew[1]}`);
      out.add(`crew ${crew[1]}`);
    }
    if (normalized.includes('starlink')) out.add('starlink');
    if (normalized.includes('dragon')) out.add('dragon');
    if (normalized.includes('starship')) out.add('starship');
    if (normalized.includes('falcon 9')) out.add('falcon 9');
    if (normalized.includes('falcon heavy')) out.add('falcon heavy');
  }

  return [...out];
}

function containsPadReference(text: string, padShort: string) {
  const normalizedPad = normalizeMatchText(padShort).replace(/\s+/g, '');
  if (!normalizedPad) return false;

  if (/^\d+[a-z]?$/.test(normalizedPad)) {
    return (
      text.includes(`pad ${normalizedPad}`) ||
      text.includes(`slc-${normalizedPad}`) ||
      text.includes(`lc-${normalizedPad}`) ||
      text.includes(`launch complex ${normalizedPad}`)
    );
  }

  return text.includes(`pad ${normalizedPad}`) || text.includes(normalizedPad);
}

function toCandidateRow(launchId: string, item: ScoredTweet, fetchedAtIso: string) {
  return {
    launch_id: launchId,
    platform: PLATFORM,
    account_handle: item.tweet.accountHandle,
    external_post_id: item.tweet.id,
    post_url: item.tweet.url,
    post_text: item.tweet.text,
    posted_at: item.tweet.createdAt,
    fetched_at: fetchedAtIso,
    dedupe_key: `${launchId}:${PLATFORM}:${item.tweet.id}`,
    raw_payload: {
      score: item.score,
      signals: item.signals,
      strongSignals: item.strongSignals,
      mediumSignals: item.mediumSignals,
      signalBreakdown: item.signalBreakdown,
      media: item.tweet.media.map((media) => ({
        mediaKey: media.mediaKey,
        normalizedUrl: media.normalizedUrl,
        type: media.type,
        width: media.width,
        height: media.height,
        altText: media.altText
      }))
    }
  };
}

async function upsertCandidates(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return 0;
  const { error } = await supabase.from('launch_social_candidates').upsert(rows, { onConflict: 'dedupe_key' });
  if (error) throw error;
  return rows.length;
}

async function promoteMatch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    launch,
    best,
    matchedAt
  }: {
    launch: LaunchCandidate;
    best: ScoredTweet;
    matchedAt: string;
  }
) {
  const deactivatePatch = { active: false, updated_at: matchedAt };
  const { error: deactivateError } = await supabase
    .from('launch_social_matches')
    .update(deactivatePatch)
    .eq('launch_id', launch.id)
    .eq('platform', PLATFORM)
    .eq('active', true)
    .neq('external_post_id', best.tweet.id);
  if (deactivateError) throw deactivateError;

  const { error: upsertError } = await supabase.from('launch_social_matches').upsert(
    {
      launch_id: launch.id,
      platform: PLATFORM,
      external_post_id: best.tweet.id,
      post_url: best.tweet.url,
      account_handle: best.tweet.accountHandle,
      score: best.score,
      confidence: 'high',
      matched_at: matchedAt,
      match_version: MATCH_VERSION,
      signals_json: {
        signals: best.signals,
        strongSignals: best.strongSignals,
        mediumSignals: best.mediumSignals,
        signalBreakdown: best.signalBreakdown
      },
      active: true,
      updated_at: matchedAt
    },
    { onConflict: 'launch_id,platform,external_post_id' }
  );
  if (upsertError) throw upsertError;

  const patch = buildPrimaryPatch(launch, best, matchedAt);
  const { error: launchError } = await supabase.from('launches').update(patch).eq('id', launch.id);
  if (launchError) throw launchError;

  const { error: cacheError } = await supabase.from('launches_public_cache').update(patch).eq('launch_id', launch.id);
  if (cacheError) throw cacheError;
}

function buildPrimaryPatch(launch: LaunchCandidate, best: ScoredTweet, matchedAtIso: string) {
  const handleWithAt = best.tweet.accountHandle.startsWith('@')
    ? best.tweet.accountHandle
    : `@${best.tweet.accountHandle}`;

  const patch: Record<string, unknown> = {
    social_primary_post_id: best.tweet.id,
    social_primary_post_url: best.tweet.url,
    social_primary_post_platform: PLATFORM,
    social_primary_post_handle: handleWithAt,
    social_primary_post_matched_at: matchedAtIso,
    social_primary_post_for_date: launch.netDate
  };

  if (launch.providerKey === 'spacex') {
    patch.spacex_x_post_id = best.tweet.id;
    patch.spacex_x_post_url = best.tweet.url;
    patch.spacex_x_post_captured_at = matchedAtIso;
    patch.spacex_x_post_for_date = launch.netDate;
  }

  return patch;
}

async function clearPrimaryPosts(supabase: ReturnType<typeof createSupabaseAdminClient>, launchIds: string[]) {
  if (!launchIds.length) return 0;

  const patch = {
    social_primary_post_id: null,
    social_primary_post_url: null,
    social_primary_post_platform: null,
    social_primary_post_handle: null,
    social_primary_post_matched_at: null,
    social_primary_post_for_date: null,
    spacex_x_post_id: null,
    spacex_x_post_url: null,
    spacex_x_post_captured_at: null,
    spacex_x_post_for_date: null
  };

  const { error: launchError } = await supabase.from('launches').update(patch).in('id', launchIds);
  if (launchError) throw launchError;

  const { error: cacheError } = await supabase.from('launches_public_cache').update(patch).in('launch_id', launchIds);
  if (cacheError) throw cacheError;

  return launchIds.length;
}

function normalizeProviderKey(raw: string | null | undefined) {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'unknown') return '';
  if (normalized === 'nasa' || normalized.includes('national aeronautics and space administration')) return 'nasa';
  if (normalized.includes('spacex')) return 'spacex';
  if (normalized === 'ula' || normalized.includes('united launch alliance')) return 'ula';
  if (normalized.includes('rocket lab')) return 'rocket-lab';
  if (normalized.includes('blue origin')) return 'blue-origin';
  if (normalized.includes('arianespace')) return 'arianespace';
  return normalized
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

function normalizeHandle(raw: string | null | undefined) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function normalizeMatchText(value: string | null | undefined) {
  const input = String(value || '')
    .toLowerCase()
    .normalize('NFKD');
  if (!input) return '';
  return input
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&amp;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeUrls(value: string) {
  return String(value || '').replace(/https?:\/\/\S+/g, ' ').trim();
}

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function safeZonedDateTime(date: Date, timeZone: string) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = clampInt(Number(get('hour')), 0, 23);
    const minute = clampInt(Number(get('minute')), 0, 59);
    const dateStr = year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
    return { date: dateStr, hour, minute };
  } catch {
    const iso = date.toISOString();
    return { date: iso.slice(0, 10), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
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
