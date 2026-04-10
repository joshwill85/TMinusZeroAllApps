import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCachedSetting } from './settings.ts';

export type BlueOriginSourceType =
  | 'blue-origin-official'
  | 'government-record'
  | 'll2-cache'
  | 'curated-fallback'
  | 'social';

export type BlueOriginMissionKey =
  | 'blue-origin-program'
  | 'new-shepard'
  | 'new-glenn'
  | 'blue-moon'
  | 'blue-ring'
  | 'be-4';

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function toIsoOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function classifyBlueOriginMission(textLike: string | null | undefined): BlueOriginMissionKey {
  const value = (textLike || '').toLowerCase();
  if (/new\s*shepard|\bns\s*-?\s*\d{1,3}\b/.test(value)) return 'new-shepard';
  if (/new\s*glenn|\bng\s*-?\s*\d{1,3}\b/.test(value)) return 'new-glenn';
  if (/blue\s*moon/.test(value)) return 'blue-moon';
  if (/blue\s*ring/.test(value)) return 'blue-ring';
  if (/\bbe\s*-?\s*4\b/.test(value)) return 'be-4';
  return 'blue-origin-program';
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
    sourceType?: BlueOriginSourceType;
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
    source_type: patch.sourceType || 'blue-origin-official',
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

  const { error } = await supabase.from('blue_origin_ingest_checkpoints').upsert(payload, { onConflict: 'source_key' });
  if (error) throw error;
}

export async function readSystemSetting(supabase: SupabaseClient, key: string) {
  return getCachedSetting(supabase, key);
}

export async function readBooleanSetting(supabase: SupabaseClient, key: string, fallback: boolean) {
  const value = await readSystemSetting(supabase, key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

export async function readStringSetting(supabase: SupabaseClient, key: string, fallback: string) {
  const value = await readSystemSetting(supabase, key);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
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

export async function insertSourceDocument(
  supabase: SupabaseClient,
  payload: {
    sourceKey: string;
    sourceType: BlueOriginSourceType;
    url: string;
    title: string;
    summary: string;
    announcedTime: string;
    httpStatus?: number | null;
    contentType?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    raw?: Record<string, unknown> | null;
    error?: string | null;
  }
) {
  const row = {
    source_key: payload.sourceKey,
    source_type: payload.sourceType,
    url: payload.url,
    title: payload.title,
    summary: payload.summary,
    announced_time: payload.announcedTime,
    fetched_at: new Date().toISOString(),
    http_status: payload.httpStatus || null,
    content_type: payload.contentType || null,
    etag: payload.etag || null,
    last_modified: toIsoOrNull(payload.lastModified) || null,
    raw: payload.raw || null,
    error: payload.error || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('blue_origin_source_documents')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function upsertTimelineEvent(
  supabase: SupabaseClient,
  payload: {
    eventKey: string;
    missionKey: BlueOriginMissionKey;
    title: string;
    summary: string;
    eventTime: string | null;
    announcedTime: string;
    sourceType: BlueOriginSourceType;
    confidence: 'high' | 'medium' | 'low';
    status: 'completed' | 'upcoming' | 'tentative' | 'superseded';
    sourceDocumentId?: string | null;
    sourceUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const row = {
    event_key: payload.eventKey,
    mission_key: payload.missionKey,
    title: payload.title,
    summary: payload.summary,
    event_time: payload.eventTime,
    announced_time: payload.announcedTime,
    source_type: payload.sourceType,
    confidence: payload.confidence,
    status: payload.status,
    source_document_id: payload.sourceDocumentId || null,
    source_url: payload.sourceUrl || null,
    metadata: payload.metadata || {},
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('blue_origin_timeline_events').upsert(row, { onConflict: 'event_key' });
  if (error) throw error;
}
