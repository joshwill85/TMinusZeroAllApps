import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ArtemisSourceType = 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';

export type ArtemisMissionKey =
  | 'program'
  | 'artemis-i'
  | 'artemis-ii'
  | 'artemis-iii'
  | 'artemis-iv'
  | 'artemis-v'
  | 'artemis-vi'
  | 'artemis-vii';

export const ARTEMIS_SOURCE_KEYS = [
  'nasa_campaign_pages',
  'nasa_blog_posts',
  'nasa_reference_timelines',
  'nasa_rss',
  'oig_reports',
  'gao_reports',
  'moon_to_mars_docs',
  'ntrs_api',
  'techport_api',
  'nasa_budget_docs',
  'usaspending_awards',
  'nasa_media_assets'
] as const;

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;

  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;

    const message = typeof anyErr.message === 'string' ? anyErr.message : null;
    const details = typeof anyErr.details === 'string' ? anyErr.details : null;
    const hint = typeof anyErr.hint === 'string' ? anyErr.hint : null;
    const code = typeof anyErr.code === 'string' ? anyErr.code : null;
    const status =
      typeof anyErr.status === 'number'
        ? String(anyErr.status)
        : typeof anyErr.status === 'string'
          ? anyErr.status
          : null;
    const name = typeof anyErr.name === 'string' ? anyErr.name : null;

    const parts = [message, details, hint].filter(Boolean).join(' • ');
    const prefix = [name, code, status].filter(Boolean).join(':');

    if (parts) return prefix ? `${prefix}: ${parts}` : parts;

    try {
      return JSON.stringify(err);
    } catch {
      // fall through
    }
  }

  return String(err);
}

export function toIsoOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function classifyMission(nameLike: string | null | undefined): ArtemisMissionKey {
  const value = (nameLike || '').toLowerCase();
  if (/\bartemis\s*(vii|7)\b/.test(value)) return 'artemis-vii';
  if (/\bartemis\s*(vi|6)\b/.test(value)) return 'artemis-vi';
  if (/\bartemis\s*(v|5)\b/.test(value)) return 'artemis-v';
  if (/\bartemis\s*(iv|4)\b/.test(value)) return 'artemis-iv';
  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
  return 'program';
}

export async function startIngestionRun(supabase: SupabaseClient, jobName: string) {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .insert({ job_name: jobName, started_at: new Date().toISOString(), success: false })
    .select('id')
    .single();

  if (error || !data?.id) throw error || new Error(`Failed to start ingestion run for ${jobName}`);
  return { runId: data.id as string };
}

export async function finishIngestionRun(
  supabase: SupabaseClient,
  runId: string,
  success: boolean,
  stats?: Record<string, unknown>,
  errorMessage?: string
) {
  await supabase
    .from('ingestion_runs')
    .update({
      success,
      ended_at: new Date().toISOString(),
      stats: stats || null,
      error: errorMessage || null
    })
    .eq('id', runId);
}

export async function updateCheckpoint(
  supabase: SupabaseClient,
  sourceKey: string,
  patch: {
    sourceType?: ArtemisSourceType;
    status?: 'pending' | 'running' | 'complete' | 'error';
    cursor?: string | null;
    recordsIngested?: number;
    lastAnnouncedTime?: string | null;
    lastEventTime?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    lastError?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const payload: Record<string, unknown> = {
    source_key: sourceKey,
    source_type: patch.sourceType || 'nasa_primary',
    updated_at: new Date().toISOString()
  };

  if (patch.status) payload.status = patch.status;
  if ('cursor' in patch) payload.cursor = patch.cursor;
  if (typeof patch.recordsIngested === 'number') payload.records_ingested = patch.recordsIngested;
  if ('lastAnnouncedTime' in patch) payload.last_announced_time = patch.lastAnnouncedTime;
  if ('lastEventTime' in patch) payload.last_event_time = patch.lastEventTime;
  if ('startedAt' in patch) payload.started_at = patch.startedAt;
  if ('endedAt' in patch) payload.ended_at = patch.endedAt;
  if ('lastError' in patch) payload.last_error = patch.lastError;
  if (patch.metadata) payload.metadata = patch.metadata;

  const { error } = await supabase.from('artemis_ingest_checkpoints').upsert(payload, { onConflict: 'source_key' });
  if (error) throw error;
}

export async function loadCheckpoints(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('source_key, source_type, status, cursor, records_ingested, last_announced_time, last_event_time, last_error, updated_at')
    .order('source_key', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function isBootstrapComplete(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('status')
    .neq('status', 'complete')
    .limit(1);
  if (error) throw error;
  return !data || data.length === 0;
}

export async function setSystemSetting(supabase: SupabaseClient, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function readSystemSetting(supabase: SupabaseClient, key: string) {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value;
}

export async function readBooleanSetting(supabase: SupabaseClient, key: string, fallback: boolean) {
  const value = await readSystemSetting(supabase, key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

export async function readNumberSetting(supabase: SupabaseClient, key: string, fallback: number) {
  const value = await readSystemSetting(supabase, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export async function readStringSetting(supabase: SupabaseClient, key: string, fallback = '') {
  const value = await readSystemSetting(supabase, key);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

type DailyQuotaClaimOptions = {
  stateKey: string;
  limitKey: string;
  reserveKey: string;
  requested?: number;
  defaultLimit: number;
  defaultReserve: number;
};

type DailyQuotaWindowOptions = {
  stateKey: string;
  limitKey: string;
  reserveKey: string;
  defaultLimit: number;
  defaultReserve: number;
};

export type DailyQuotaWindow = {
  date: string;
  used: number;
  limit: number;
  reserve: number;
  maxUsable: number;
  available: number;
  remaining: number;
  stateKey: string;
};

export type DailyQuotaClaim = {
  date: string;
  requested: number;
  granted: number;
  used: number;
  limit: number;
  reserve: number;
  available: number;
  remaining: number;
  stateKey: string;
};

export async function readDailyQuotaWindow(supabase: SupabaseClient, options: DailyQuotaWindowOptions): Promise<DailyQuotaWindow> {
  const today = new Date().toISOString().slice(0, 10);
  const limit = Math.max(0, Math.trunc(await readNumberSetting(supabase, options.limitKey, options.defaultLimit)));
  const reserve = Math.max(0, Math.trunc(await readNumberSetting(supabase, options.reserveKey, options.defaultReserve)));

  const rawState = await readSystemSetting(supabase, options.stateKey);
  const state = coerceQuotaState(rawState);
  const used = state.date === today ? state.used : 0;
  const maxUsable = Math.max(0, limit - reserve);
  const available = Math.max(0, maxUsable - used);

  return {
    date: today,
    used,
    limit,
    reserve,
    maxUsable,
    available,
    remaining: available,
    stateKey: options.stateKey
  };
}

export async function claimDailyQuota(supabase: SupabaseClient, options: DailyQuotaClaimOptions): Promise<DailyQuotaClaim> {
  const requested = Math.max(0, Math.trunc(options.requested ?? 1));
  const limit = Math.max(0, Math.trunc(await readNumberSetting(supabase, options.limitKey, options.defaultLimit)));
  const reserve = Math.max(0, Math.trunc(await readNumberSetting(supabase, options.reserveKey, options.defaultReserve)));

  const rpcClaim = await claimDailyQuotaWithRpc(supabase, {
    stateKey: options.stateKey,
    requested,
    limit,
    reserve
  });
  if (rpcClaim) return rpcClaim;

  const window = await readDailyQuotaWindow(supabase, {
    stateKey: options.stateKey,
    limitKey: options.limitKey,
    reserveKey: options.reserveKey,
    defaultLimit: options.defaultLimit,
    defaultReserve: options.defaultReserve
  });

  const usedBaseline = window.used;
  const available = window.available;
  const granted = Math.min(requested, available);
  const used = usedBaseline + granted;
  const remaining = Math.max(0, window.maxUsable - used);

  await setSystemSetting(supabase, options.stateKey, {
    date: window.date,
    used,
    limit: window.limit,
    reserve: window.reserve,
    updatedAt: new Date().toISOString()
  });

  return {
    date: window.date,
    requested,
    granted,
    used,
    limit: window.limit,
    reserve: window.reserve,
    available,
    remaining,
    stateKey: options.stateKey
  };
}

async function claimDailyQuotaWithRpc(
  supabase: SupabaseClient,
  request: {
    stateKey: string;
    requested: number;
    limit: number;
    reserve: number;
  }
): Promise<DailyQuotaClaim | null> {
  const { data, error } = await supabase.rpc('claim_system_setting_quota', {
    p_state_key: request.stateKey,
    p_requested: request.requested,
    p_limit: request.limit,
    p_reserve: request.reserve
  });

  if (error) return null;
  const record = normalizeQuotaRpcPayload(data);
  if (!record) return null;

  const requested = coerceNumericSetting(record.requested);
  const granted = coerceNumericSetting(record.granted);

  return {
    date: typeof record.date === 'string' ? record.date : '',
    requested,
    granted,
    used: coerceNumericSetting(record.used, 0),
    limit: coerceNumericSetting(record.limit, 0),
    reserve: coerceNumericSetting(record.reserve, 0),
    available: coerceNumericSetting(record.available, 0),
    remaining: coerceNumericSetting(record.remaining, 0),
    stateKey: request.stateKey
  } as DailyQuotaClaim;
}

function coerceNumericSetting(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return Number.isFinite(fallback) ? Math.max(0, Math.trunc(fallback)) : 0;
}

function normalizeQuotaRpcPayload(data: unknown) {
  if (!data) return null;
  if (Array.isArray(data)) return data.length ? (data[0] as Record<string, unknown>) : null;
  if (typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

function coerceQuotaState(value: unknown): { date: string | null; used: number } {
  if (!value || typeof value !== 'object') {
    return { date: null, used: 0 };
  }

  const state = value as Record<string, unknown>;
  const date = typeof state.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.date) ? state.date : null;

  let used = 0;
  if (typeof state.used === 'number' && Number.isFinite(state.used)) {
    used = Math.max(0, Math.trunc(state.used));
  } else if (typeof state.used === 'string') {
    const parsed = Number(state.used);
    if (Number.isFinite(parsed)) used = Math.max(0, Math.trunc(parsed));
  }

  return { date, used };
}

export async function insertSourceDocument(
  supabase: SupabaseClient,
  input: {
    sourceKey: string;
    sourceType: ArtemisSourceType;
    url: string;
    title?: string;
    summary?: string;
    publishedAt?: string | null;
    announcedTime?: string | null;
    httpStatus?: number;
    contentType?: string | null;
    parseVersion?: string;
    raw?: Record<string, unknown>;
    error?: string | null;
  }
) {
  const payload = {
    source_key: input.sourceKey,
    source_type: input.sourceType,
    url: input.url,
    title: input.title || null,
    summary: input.summary || null,
    published_at: input.publishedAt || null,
    announced_time: input.announcedTime || null,
    fetched_at: new Date().toISOString(),
    http_status: input.httpStatus || null,
    content_type: input.contentType || null,
    parse_version: input.parseVersion || 'v1',
    raw: input.raw || null,
    error: input.error || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('artemis_source_documents')
    .insert(payload)
    .select('id')
    .single();
  if (error || !data?.id) throw error || new Error('failed_to_insert_artemis_source_document');
  return data.id as string;
}

export async function upsertTimelineEvent(
  supabase: SupabaseClient,
  input: {
    fingerprint: string;
    missionKey: ArtemisMissionKey;
    title: string;
    summary?: string;
    eventTime?: string | null;
    eventTimePrecision?: 'minute' | 'hour' | 'day' | 'month' | 'unknown';
    announcedTime: string;
    sourceType: ArtemisSourceType;
    confidence: 'primary' | 'oversight' | 'secondary';
    sourceDocumentId: string;
    sourceUrl?: string | null;
    supersedesEventId?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
) {
  const row = {
    fingerprint: input.fingerprint,
    mission_key: input.missionKey,
    title: input.title,
    summary: input.summary || null,
    event_time: input.eventTime || null,
    event_time_precision: input.eventTimePrecision || 'unknown',
    announced_time: input.announcedTime,
    source_type: input.sourceType,
    confidence: input.confidence,
    source_document_id: input.sourceDocumentId,
    source_url: input.sourceUrl || null,
    supersedes_event_id: input.supersedesEventId || null,
    tags: input.tags || [],
    metadata: input.metadata || {},
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase.from('artemis_timeline_events').upsert(row, { onConflict: 'fingerprint' }).select('id').single();
  if (error || !data?.id) throw error || new Error('failed_to_upsert_artemis_timeline_event');
  return data.id as string;
}
