import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

type UpcomingLaunchRow = {
  launch_id: string | null;
  net: string | null;
};

const DEFAULT_SITE_URL = 'https://www.tminuszero.app';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 25_000;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'og_prewarm');
  const stats: Record<string, unknown> = {
    launches: 0,
    warmed: 0,
    errors: [] as Array<{ step: string; error: string; detail?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'og_prewarm_enabled',
      'og_prewarm_limit',
      'og_prewarm_site_url',
      'og_prewarm_timeout_ms'
    ]);

    const enabled = readBooleanSetting(settings.og_prewarm_enabled, true);
    stats.enabled = enabled;
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true });
      return jsonResponse({ ok: true, skipped: true });
    }

    const limit = clampInt(readNumberSetting(settings.og_prewarm_limit, DEFAULT_LIMIT), 1, MAX_LIMIT);
    const timeoutMs = clampInt(
      readNumberSetting(settings.og_prewarm_timeout_ms, DEFAULT_TIMEOUT_MS),
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );
    const siteUrl = resolveSiteUrl(readStringSetting(settings.og_prewarm_site_url, ''));
    stats.limit = limit;
    stats.timeoutMs = timeoutMs;
    stats.siteUrl = siteUrl;

    const nowIso = new Date().toISOString();
    const launches = await loadNextLaunches(supabase, { nowIso, limit });
    stats.launches = launches.length;
    if (!launches.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
      return jsonResponse({ ok: true, warmed: 0, launches: 0 });
    }

    let warmed = 0;
    for (const row of launches) {
      const id = row.launch_id ? row.launch_id.trim() : '';
      if (!id) continue;
      const { ok, error, ogImageUrl } = await prewarmLaunch({ siteUrl, id, timeoutMs });
      if (ok) {
        warmed += 1;
      } else if (error) {
        (stats.errors as Array<any>).push({
          step: 'prewarmLaunch',
          error,
          detail: { id, ogImageUrl: ogImageUrl || null }
        });
      }
    }
    stats.warmed = warmed;

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, { ...stats, elapsedMs: Date.now() - startedAt }, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, warmed, launches: launches.length, elapsedMs: Date.now() - startedAt }, ok ? 200 : 207);
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, { ...stats, elapsedMs: Date.now() - startedAt }, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

async function loadNextLaunches(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  { nowIso, limit }: { nowIso: string; limit: number }
) {
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, net')
    .gte('net', nowIso)
    .in('pad_country_code', ['USA', 'US'])
    .order('net', { ascending: true })
    .order('launch_id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as UpcomingLaunchRow[];
}

async function prewarmLaunch({
  siteUrl,
  id,
  timeoutMs
}: {
  siteUrl: string;
  id: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; error?: string; ogImageUrl?: string }> {
  const shareUrl = `${siteUrl}/share/launch-fast/${encodeURIComponent(id)}`;
  const shareResponse = await fetchWithTimeout(shareUrl, {
    timeoutMs,
    headers: {
      'User-Agent': 'Twitterbot/1.0',
      Accept: 'text/html,*/*;q=0.8'
    }
  });

  if (!shareResponse.ok) {
    return { ok: false, error: `share_status_${shareResponse.status}` };
  }

  const html = await shareResponse.text();
  const ogImageUrl = extractOgImageUrl(html);
  if (!ogImageUrl) {
    return { ok: false, error: 'missing_og_image' };
  }

  const ogResponse = await fetchWithTimeout(ogImageUrl, {
    timeoutMs,
    headers: { 'User-Agent': 'Twitterbot/1.0', Accept: 'image/*,*/*;q=0.8' }
  });

  if (!ogResponse.ok) {
    return { ok: false, error: `og_status_${ogResponse.status}`, ogImageUrl };
  }

  return { ok: true, ogImageUrl };
}

function extractOgImageUrl(html: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    if (!/\bproperty\s*=\s*['"]og:image['"]/i.test(tag) && !/\bname\s*=\s*['"]twitter:image['"]/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (content) return content;
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  {
    timeoutMs,
    headers
  }: {
    timeoutMs: number;
    headers?: Record<string, string>;
  }
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveSiteUrl(explicit: string) {
  const raw = explicit.trim();
  if (!raw) {
    const envUrl = String(Deno.env.get('SITE_URL') || Deno.env.get('NEXT_PUBLIC_SITE_URL') || '').trim();
    return envUrl ? envUrl.replace(/\/+$/, '') : DEFAULT_SITE_URL;
  }
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
