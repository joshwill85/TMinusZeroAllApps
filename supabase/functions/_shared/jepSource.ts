import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type JepSourceFetchRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
type JepSourceFetchTriggerMode = 'scheduled' | 'manual' | 'backfill' | 'retry';

type JsonRecord = Record<string, unknown>;

export async function startJepSourceFetchRun(
  client: SupabaseClient,
  {
    sourceKey,
    triggerMode = 'scheduled',
    requestRef,
    metadata = {}
  }: {
    sourceKey: string;
    triggerMode?: JepSourceFetchTriggerMode;
    requestRef?: string | null;
    metadata?: JsonRecord;
  }
) {
  const { data, error } = await client
    .from('jep_source_fetch_runs')
    .insert({
      source_key: sourceKey,
      status: 'running',
      trigger_mode: triggerMode,
      request_ref: normalizeRequestRef(requestRef),
      metadata
    })
    .select('id')
    .single();

  if (error) {
    console.warn('Failed to start jep_source_fetch_runs record', { sourceKey, error: error.message });
    return { runId: null as number | null };
  }

  return { runId: data?.id ? Number(data.id) : null };
}

export async function finishJepSourceFetchRun(
  client: SupabaseClient,
  runId: number | null,
  {
    status,
    versionId,
    assetCount,
    rowCount,
    errorText,
    metadata = {}
  }: {
    status: JepSourceFetchRunStatus;
    versionId?: number | null;
    assetCount?: number;
    rowCount?: number;
    errorText?: string | null;
    metadata?: JsonRecord;
  }
) {
  if (!runId) return;

  const { error } = await client
    .from('jep_source_fetch_runs')
    .update({
      status,
      version_id: versionId ?? null,
      asset_count: clampCount(assetCount),
      row_count: clampCount(rowCount),
      error_text: errorText?.trim() || null,
      metadata,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', runId);

  if (error) {
    console.warn('Failed to finish jep_source_fetch_runs record', { runId, error: error.message });
  }
}

export async function upsertJepSourceVersion(
  client: SupabaseClient,
  {
    sourceKey,
    versionKey,
    versionLabel,
    upstreamUrl,
    contentHash,
    releaseAt,
    fetchedAt,
    metadata = {}
  }: {
    sourceKey: string;
    versionKey: string;
    versionLabel?: string | null;
    upstreamUrl?: string | null;
    contentHash?: string | null;
    releaseAt?: string | null;
    fetchedAt?: string | null;
    metadata?: JsonRecord;
  }
) {
  const { data, error } = await client
    .from('jep_source_versions')
    .upsert(
      {
        source_key: sourceKey,
        version_key: versionKey,
        version_label: versionLabel?.trim() || null,
        upstream_url: normalizeRequestRef(upstreamUrl),
        content_hash: contentHash?.trim() || null,
        release_at: releaseAt ?? null,
        fetched_at: fetchedAt ?? new Date().toISOString(),
        metadata,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'source_key,version_key' }
    )
    .select('id')
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error(`Failed to resolve source version id for ${sourceKey}`);
  return Number(data.id);
}

function clampCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value as number));
}

function normalizeRequestRef(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, 4000) : null;
}
