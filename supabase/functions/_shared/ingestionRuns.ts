import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type IngestionRunId = number | string | null | undefined;

export type LatestSuccessfulIngestionRun = {
  jobName: string;
  startedAt: string | null;
  endedAt: string | null;
  success: boolean;
};

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

export async function getLatestSuccessfulIngestionRuns(
  supabase: SupabaseClient,
  jobNames: string[]
): Promise<LatestSuccessfulIngestionRun[]> {
  const uniqueJobNames = Array.from(new Set(jobNames.filter((jobName) => typeof jobName === 'string' && jobName.length > 0)));
  if (!uniqueJobNames.length) return [];

  const { data, error } = await supabase.rpc('get_latest_successful_ingestion_runs_v1', {
    job_names_in: uniqueJobNames
  });
  if (error) {
    if (!isMissingLatestSuccessfulRunsRpc(error.message || '')) throw error;

    const fallbackRows = await Promise.all(
      uniqueJobNames.map(async (jobName) => {
        const { data: latestRow, error: fallbackError } = await supabase
          .from('ingestion_runs')
          .select('job_name,started_at,ended_at,success')
          .eq('job_name', jobName)
          .eq('success', true)
          .order('ended_at', { ascending: false, nullsFirst: false })
          .order('started_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (fallbackError) throw fallbackError;
        return latestRow ? [latestRow as Record<string, unknown>] : [];
      })
    );

    return mapLatestSuccessfulIngestionRuns(fallbackRows.flat());
  }

  return mapLatestSuccessfulIngestionRuns(data as Array<Record<string, unknown>> | null);
}

function mapLatestSuccessfulIngestionRuns(data: Array<Record<string, unknown>> | null) {
  const latestByJob = new Map<string, LatestSuccessfulIngestionRun>();

  for (const row of data || []) {
    const mapped = mapLatestSuccessfulIngestionRun(row);
    if (!mapped || latestByJob.has(mapped.jobName)) continue;
    latestByJob.set(mapped.jobName, mapped);
  }

  return [...latestByJob.values()];
}

function mapLatestSuccessfulIngestionRun(row: Record<string, unknown>) {
  const jobName = typeof row.job_name === 'string' ? row.job_name : '';
  if (!jobName) return null;

  return {
    jobName,
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : null,
    success: row.success === true
  } satisfies LatestSuccessfulIngestionRun;
}

function isMissingLatestSuccessfulRunsRpc(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('get_latest_successful_ingestion_runs_v1') &&
    (normalized.includes('does not exist') ||
      normalized.includes('could not find the function') ||
      normalized.includes('function'))
  );
}
