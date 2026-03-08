import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

const USER_AGENT = 'TMinusZero/0.1 (support@tminuszero.app)';
const MIN_MATCH_SCORE = 55;
const DEFAULTS = {
  enabled: true,
  timezone: 'America/New_York',
  hour: 8,
  minute: 0,
  maxPerRun: 10,
  lookbackHours: 18,
  horizonDays: 4,
  screenName: 'SpaceX'
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
  hidden: boolean | null;
  spacex_x_post_id: string | null;
  spacex_x_post_url: string | null;
  spacex_x_post_captured_at: string | null;
  spacex_x_post_for_date: string | null;
};

type LaunchCandidate = LaunchRow & {
  netDate: string;
  netMs: number;
};

type TimelineTweet = {
  id: string;
  url: string;
  text: string;
  normalizedText: string;
  createdAt: string | null;
  createdAtMs: number | null;
};

type TimelineFetchResult = {
  tweets: TimelineTweet[];
  unavailableReason: string | null;
};

type LaunchSnapshotUpdate = {
  launchId: string;
  tweetId: string;
  tweetUrl: string;
  capturedAt: string;
  forDate: string;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'spacex_x_post_snapshot');

  const stats: Record<string, unknown> = {
    considered: 0,
    todaysLaunches: 0,
    tweetsFetched: 0,
    matched: 0,
    unmatched: 0,
    updated: 0,
    cleared: 0,
    skipped: false,
    skipReason: null as string | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'spacex_x_snapshot_enabled',
      'spacex_x_snapshot_timezone',
      'spacex_x_snapshot_hour',
      'spacex_x_snapshot_minute',
      'spacex_x_snapshot_max_per_run',
      'spacex_x_snapshot_lookback_hours',
      'spacex_x_snapshot_horizon_days',
      'spacex_x_snapshot_screen_name'
    ]);

    const enabled = readBooleanSetting(settings.spacex_x_snapshot_enabled, DEFAULTS.enabled);
    if (!enabled) {
      stats.skipped = true;
      stats.skipReason = 'disabled';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const timezone = readStringSetting(settings.spacex_x_snapshot_timezone, DEFAULTS.timezone).trim() || DEFAULTS.timezone;
    const hour = clampInt(readNumberSetting(settings.spacex_x_snapshot_hour, DEFAULTS.hour), 0, 23);
    const minute = clampInt(readNumberSetting(settings.spacex_x_snapshot_minute, DEFAULTS.minute), 0, 59);
    const maxPerRun = clampInt(readNumberSetting(settings.spacex_x_snapshot_max_per_run, DEFAULTS.maxPerRun), 1, 50);
    const lookbackHours = clampInt(readNumberSetting(settings.spacex_x_snapshot_lookback_hours, DEFAULTS.lookbackHours), 1, 96);
    const horizonDays = clampInt(readNumberSetting(settings.spacex_x_snapshot_horizon_days, DEFAULTS.horizonDays), 1, 14);
    const screenName = readStringSetting(settings.spacex_x_snapshot_screen_name, DEFAULTS.screenName).trim() || DEFAULTS.screenName;

    const now = new Date();
    const nowZoned = safeZonedDateTime(now, timezone);
    const afterCaptureTime = nowZoned.hour > hour || (nowZoned.hour === hour && nowZoned.minute >= minute);
    if (!afterCaptureTime) {
      stats.skipped = true;
      stats.skipReason = 'before_capture_time';
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, hour, minute });
      return jsonResponse({ ok: true, ...stats, timezone, hour, minute, elapsedMs: Date.now() - startedAt });
    }

    const nowMs = now.getTime();
    const fromIso = new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();
    const today = nowZoned.date;

    const { data, error } = await supabase
      .from('launches')
      .select(
        'id,name,mission_name,net,provider,vehicle,rocket_full_name,pad_name,pad_short_code,pad_location_name,hidden,spacex_x_post_id,spacex_x_post_url,spacex_x_post_captured_at,spacex_x_post_for_date'
      )
      .eq('hidden', false)
      .ilike('provider', '%spacex%')
      .gte('net', fromIso)
      .lte('net', toIso)
      .order('net', { ascending: true })
      .limit(200);

    if (error) throw error;
    const candidates = Array.isArray(data) ? (data as LaunchRow[]) : [];
    stats.considered = candidates.length;

    if (!candidates.length) {
      stats.skipped = true;
      stats.skipReason = 'no_candidates';
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today, fromIso, toIso });
      return jsonResponse({ ok: true, ...stats, timezone, today, fromIso, toIso, elapsedMs: Date.now() - startedAt });
    }

    let todaysLaunches = 0;
    const toClear: string[] = [];
    const toUpdate: LaunchCandidate[] = [];

    for (const launch of candidates) {
      if (!launch?.id || !launch.net) continue;
      const netMs = Date.parse(launch.net);
      if (!Number.isFinite(netMs)) continue;

      const netDate = safeZonedDateTime(new Date(netMs), timezone).date;
      if (netDate === today) todaysLaunches += 1;

      const storedDate = launch.spacex_x_post_for_date?.trim() || null;
      if (
        storedDate &&
        storedDate !== netDate &&
        netMs > nowMs &&
        (launch.spacex_x_post_id || launch.spacex_x_post_url)
      ) {
        toClear.push(launch.id);
      }

      const needsRefresh = !storedDate || storedDate !== netDate || !launch.spacex_x_post_id;
      if (needsRefresh) {
        toUpdate.push({ ...launch, netDate, netMs });
      }
    }

    stats.todaysLaunches = todaysLaunches;

    if (toClear.length) {
      const cleared = await clearLaunches(supabase, toClear);
      stats.cleared = cleared;
    }

    const updateBatch = toUpdate.slice(0, maxPerRun);
    if (!updateBatch.length) {
      stats.skipped = true;
      stats.skipReason = 'already_captured';
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today });
      return jsonResponse({ ok: true, ...stats, timezone, today, elapsedMs: Date.now() - startedAt });
    }

    const timeline = await fetchTimelineTweets(screenName);
    if (timeline.unavailableReason) {
      stats.skipped = true;
      stats.skipReason = 'timeline_unavailable';
      stats.timelineUnavailableReason = timeline.unavailableReason;
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today, screenName });
      return jsonResponse({ ok: true, ...stats, timezone, today, screenName, elapsedMs: Date.now() - startedAt });
    }

    const timelineTweets = timeline.tweets;
    stats.tweetsFetched = timelineTweets.length;
    if (!timelineTweets.length) {
      stats.skipped = true;
      stats.skipReason = 'no_tweets';
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today, screenName });
      return jsonResponse({ ok: true, ...stats, timezone, today, screenName, elapsedMs: Date.now() - startedAt });
    }

    const capturedAt = new Date().toISOString();
    const updates: LaunchSnapshotUpdate[] = [];

    for (const launch of updateBatch) {
      const matchedTweet = pickBestTweetForLaunch(launch, timelineTweets);
      if (!matchedTweet) {
        stats.unmatched = Number(stats.unmatched || 0) + 1;
        continue;
      }

      updates.push({
        launchId: launch.id,
        tweetId: matchedTweet.id,
        tweetUrl: matchedTweet.url,
        capturedAt,
        forDate: launch.netDate
      });
    }

    if (!updates.length) {
      stats.skipped = true;
      stats.skipReason = 'no_launch_match';
      await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today, screenName });
      return jsonResponse({ ok: true, ...stats, timezone, today, screenName, elapsedMs: Date.now() - startedAt });
    }

    const updated = await setLaunchSnapshots(supabase, updates);
    stats.matched = updates.length;
    stats.updated = updated;

    await finishIngestionRun(supabase, runId, true, { ...stats, timezone, today, screenName });
    return jsonResponse({ ok: true, ...stats, timezone, today, screenName, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as any[]).push({ step: 'run', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, ...stats, elapsedMs: Date.now() - startedAt }, 500);
  }
});

async function fetchTimelineTweets(screenName: string): Promise<TimelineFetchResult> {
  const safe = screenName.trim().replace(/^@/, '');
  if (!safe) return { tweets: [], unavailableReason: 'invalid_screen_name' };

  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(safe)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'text/html', 'user-agent': USER_AGENT } });
  } catch (err) {
    return { tweets: [], unavailableReason: `x_syndication_fetch_error:${stringifyError(err)}` };
  }
  if (!res.ok) return { tweets: [], unavailableReason: `x_syndication_${res.status}` };

  const html = await res.text();
  const payload = extractNextDataJson(html);
  if (!payload) return { tweets: [], unavailableReason: null };

  let parsed: any = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { tweets: [], unavailableReason: null };
  }

  const entries = parsed?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return { tweets: [], unavailableReason: null };

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
      : `https://x.com/${encodeURIComponent(safe)}/status/${encodeURIComponent(id)}`;

    seen.add(id);
    out.push({
      id,
      url: resolvedUrl,
      text: fullText,
      normalizedText: normalizeMatchText(removeUrls(fullText)),
      createdAt,
      createdAtMs
    });
  }

  out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return { tweets: out.slice(0, 80), unavailableReason: null };
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

function pickBestTweetForLaunch(launch: LaunchCandidate, tweets: TimelineTweet[]) {
  const context = buildLaunchMatchContext(launch);

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

  if (!ranked.length) return null;
  const best = ranked[0]!;
  if (best.score < MIN_MATCH_SCORE || best.signals < 1) return null;

  const second = ranked[1];
  if (second && second.score >= MIN_MATCH_SCORE && best.score - second.score < 6) {
    const bestDelta = Math.abs((best.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - context.netMs);
    const secondDelta = Math.abs((second.tweet.createdAtMs ?? Number.MAX_SAFE_INTEGER) - context.netMs);
    return secondDelta < bestDelta ? second.tweet : best.tweet;
  }

  return best.tweet;
}

function scoreTweetForLaunch(
  tweet: TimelineTweet,
  context: ReturnType<typeof buildLaunchMatchContext>
): { score: number; signals: number } {
  const text = tweet.normalizedText;
  if (!text) return { score: 0, signals: 0 };

  let score = 0;
  let signals = 0;

  if (context.missionPhrase && text.includes(context.missionPhrase)) {
    score += 90;
    signals += 2;
  } else if (context.missionWords.length >= 2) {
    const matchedWords = context.missionWords.filter((word) => text.includes(word)).length;
    if (matchedWords >= 2) {
      score += 30;
      signals += 1;
    }
  }

  if (context.launchPhrase && text.includes(context.launchPhrase)) {
    score += 55;
    signals += 2;
  }

  if (context.rocketPhrase && text.includes(context.rocketPhrase)) {
    score += 24;
    signals += 1;
  }

  if (context.padShort && containsPadReference(text, context.padShort)) {
    score += 28;
    signals += 1;
  }

  if (context.padName && text.includes(context.padName)) {
    score += 14;
    signals += 1;
  }

  if (context.locationPhrase && text.includes(context.locationPhrase)) {
    score += 10;
    signals += 1;
  }

  let identifierHits = 0;
  for (const token of context.identifiers) {
    if (!token || token.length < 3) continue;
    if (!text.includes(token)) continue;
    identifierHits += 1;
    score += token.includes(' ') ? 20 : 16;
  }
  if (identifierHits > 0) signals += Math.min(2, identifierHits);

  if (text.startsWith('@') || text.startsWith('rt @')) {
    score -= 20;
  }

  if (Number.isFinite(context.netMs) && tweet.createdAtMs != null && Number.isFinite(tweet.createdAtMs)) {
    const deltaHours = (tweet.createdAtMs - context.netMs) / (1000 * 60 * 60);
    if (deltaHours <= 24 && deltaHours >= -120) {
      score += 22;
    } else if (deltaHours <= 48 && deltaHours >= -240) {
      score += 10;
    } else {
      score -= 20;
    }
  }

  return { score, signals };
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
    const ns = normalized.match(/\bns[-\s]?(\d{1,3})\b/);
    if (ns?.[1]) {
      out.add(`ns-${ns[1]}`);
      out.add(`ns ${ns[1]}`);
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
  }
  return '';
}

async function setLaunchSnapshots(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  updates: LaunchSnapshotUpdate[]
) {
  if (!updates.length) return 0;
  let updated = 0;

  for (const update of updates) {
    const patch = {
      spacex_x_post_id: update.tweetId,
      spacex_x_post_url: update.tweetUrl,
      spacex_x_post_captured_at: update.capturedAt,
      spacex_x_post_for_date: update.forDate
    };

    const { error: launchesError } = await supabase.from('launches').update(patch).eq('id', update.launchId);
    if (launchesError) throw launchesError;

    await supabase.from('launches_public_cache').update(patch).eq('launch_id', update.launchId);
    updated += 1;
  }

  return updated;
}

async function clearLaunches(supabase: ReturnType<typeof createSupabaseAdminClient>, launchIds: string[]) {
  if (!launchIds.length) return 0;

  const patch = {
    spacex_x_post_id: null,
    spacex_x_post_url: null,
    spacex_x_post_captured_at: null,
    spacex_x_post_for_date: null
  };

  const { error: launchesError } = await supabase.from('launches').update(patch).in('id', launchIds);
  if (launchesError) throw launchesError;

  await supabase.from('launches_public_cache').update(patch).in('launch_id', launchIds);
  return launchIds.length;
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
    const dateStr = year && month && day ? `${year}-${month}-${day}` : new Date(date.getTime()).toISOString().slice(0, 10);
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
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
