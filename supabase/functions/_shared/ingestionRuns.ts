import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type IngestionRunId = number | string | null | undefined;

export async function reconcileStaleIngestionRuns(
  supabase: SupabaseClient,
  {
    jobName,
    currentRunId,
    staleBeforeIso,
    errorMessage = 'stale_run_reconciled_timeout'
  }: {
    jobName: string;
    currentRunId?: IngestionRunId;
    staleBeforeIso: string;
    errorMessage?: string;
  }
) {
  let query = supabase
    .from('ingestion_runs')
    .select('id')
    .eq('job_name', jobName)
    .is('ended_at', null)
    .lt('started_at', staleBeforeIso);

  if (currentRunId != null) {
    query = query.neq('id', currentRunId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const staleIds = ((data as Array<{ id?: number | string }> | null) || [])
    .map((row) => row.id)
    .filter((id): id is number | string => id !== null && id !== undefined);
  if (!staleIds.length) return 0;

  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success: false,
      error: errorMessage,
      stats: {
        reconciled: true,
        reason: errorMessage
      }
    })
    .in('id', staleIds);
  if (updateError) throw updateError;

  return staleIds.length;
}

export async function tryAcquireJobLock(
  supabase: SupabaseClient,
  {
    lockName,
    ttlSeconds,
    lockId
  }: {
    lockName: string;
    ttlSeconds: number;
    lockId: string;
  }
) {
  const { data, error } = await supabase.rpc('try_acquire_job_lock', {
    lock_name_in: lockName,
    ttl_seconds_in: ttlSeconds,
    locked_by_in: lockId
  });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseJobLock(
  supabase: SupabaseClient,
  {
    lockName,
    lockId
  }: {
    lockName: string;
    lockId: string;
  }
) {
  const { error } = await supabase.rpc('release_job_lock', {
    lock_name_in: lockName,
    locked_by_in: lockId
  });
  if (error) throw error;
}
