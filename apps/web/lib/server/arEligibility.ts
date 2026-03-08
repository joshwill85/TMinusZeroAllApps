import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { parseIsoDurationToMs } from '@/lib/utils/launchMilestones';

const AR_ELIGIBLE_LIMIT = 3;
const AR_LOOKAHEAD_LIMIT = 50;
const AR_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const AR_EXPIRY_MS = 3 * 60 * 60 * 1000;

export type ArEligibleLaunch = {
  launchId: string;
  net: string | null;
  expiresAt: string;
};

export async function fetchArEligibleLaunches({
  nowMs = Date.now(),
  limit = AR_ELIGIBLE_LIMIT,
  lookahead = AR_LOOKAHEAD_LIMIT
}: {
  nowMs?: number;
  limit?: number;
  lookahead?: number;
} = {}): Promise<ArEligibleLaunch[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabaseServerClient();
  const fromIso = new Date(nowMs - AR_LOOKBACK_MS).toISOString();

  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, net, status_name, timeline, pad_latitude, pad_longitude')
    .gte('net', fromIso)
    .order('net', { ascending: true })
    .limit(Math.max(limit, lookahead));

  if (error || !data) {
    console.warn('ar eligibility query error', error);
    return [];
  }

  const candidates: Array<{ launchId: string; net: string | null; expiresAtMs: number }> = [];
  for (const row of data) {
    if (!row?.launch_id) continue;
    const expiresAtMs = computeExpiryMs(row);
    if (expiresAtMs == null || expiresAtMs < nowMs) continue;
    const hasPad = typeof row.pad_latitude === 'number' && typeof row.pad_longitude === 'number';
    if (!hasPad) continue;
    candidates.push({
      launchId: row.launch_id,
      net: row.net ?? null,
      expiresAtMs
    });
  }

  if (candidates.length === 0) return [];

  const eligible: ArEligibleLaunch[] = [];
  for (const candidate of candidates) {
    eligible.push({
      launchId: candidate.launchId,
      net: candidate.net,
      expiresAt: new Date(candidate.expiresAtMs).toISOString()
    });
    if (eligible.length >= limit) break;
  }

  return eligible;
}

function computeExpiryMs(row: {
  net?: string | null;
  status_name?: string | null;
  timeline?: Array<{ relative_time?: string | null }> | null;
  pad_latitude?: number | null;
  pad_longitude?: number | null;
}): number | null {
  const netMs = row.net ? Date.parse(row.net) : NaN;
  if (!Number.isFinite(netMs)) return null;

  const ignoreTimeline = row.status_name === 'hold' || row.status_name === 'scrubbed';
  const completeAtMs = ignoreTimeline ? netMs : netMs + (getMaxTimelineOffsetMs(row.timeline) ?? 0);
  return completeAtMs + AR_EXPIRY_MS;
}

function getMaxTimelineOffsetMs(timeline?: Array<{ relative_time?: string | null }> | null): number | null {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of timeline) {
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null) continue;
    if (offsetMs > max) max = offsetMs;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}
