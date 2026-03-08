import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';
import { DEFAULT_TOP_IO_JOBS, summarizeJobIo, type IngestionRunJobIoRow } from '@/lib/server/adminJobIo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const auth = await requireAdminRequest();
  if (!auth.ok) return auth.response;
  const supabase = auth.context.supabase;

  const url = new URL(request.url);
  const sinceHours = clampInt(url.searchParams.get('sinceHours'), 72, 1, 24 * 30);
  const limitPerJob = clampInt(url.searchParams.get('limitPerJob'), 200, 1, 1000);
  const jobs = String(url.searchParams.get('jobs') || '')
    .split(',')
    .map((job) => job.trim())
    .filter(Boolean);
  const targetJobs = jobs.length ? jobs : [...DEFAULT_TOP_IO_JOBS];
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const rows = await Promise.all(
    targetJobs.map(async (job) => {
      const { data, error } = await supabase
        .from('ingestion_runs')
        .select('id,job_name,started_at,ended_at,success,error,stats')
        .eq('job_name', job)
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
        .limit(limitPerJob);

      if (error) {
        return {
          job,
          runs: 0,
          successRatePct: 0,
          avgMovedPerRun: 0,
          p50MovedPerRun: 0,
          p95MovedPerRun: 0,
          zeroMoveRuns: 0,
          zeroMoveRatePct: 0,
          last5Moved: [] as number[],
          movementSource: 'explicit' as const,
          sampleKeys: [] as string[],
          error: error.message
        };
      }

      const runRows = (Array.isArray(data) ? data : []) as IngestionRunJobIoRow[];
      if (!runRows.length) {
        return {
          job,
          runs: 0,
          successRatePct: 0,
          avgMovedPerRun: 0,
          p50MovedPerRun: 0,
          p95MovedPerRun: 0,
          zeroMoveRuns: 0,
          zeroMoveRatePct: 0,
          last5Moved: [] as number[],
          movementSource: 'explicit' as const,
          sampleKeys: [] as string[]
        };
      }

      return summarizeJobIo(runRows);
    })
  );

  return NextResponse.json(
    {
      mode: 'db',
      sinceIso,
      sinceHours,
      rows
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
