import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

export async function startIngestionRun(jobName: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { supabase, runId: null as number | null };
  }
  return { supabase, runId: data.id as number };
}

export async function finishIngestionRun({
  supabase,
  runId,
  success,
  stats,
  error
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  runId: number | null;
  success: boolean;
  stats?: Record<string, unknown>;
  error?: string;
}) {
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
