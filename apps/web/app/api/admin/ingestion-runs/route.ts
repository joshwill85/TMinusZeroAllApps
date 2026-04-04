import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const job = url.searchParams.get('job')?.trim() ?? '';
  if (!job) return NextResponse.json({ error: 'missing_job' }, { status: 400 });

  const limitRaw = url.searchParams.get('limit')?.trim();
  const limitParsed = limitRaw ? Number(limitRaw) : 25;
  const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(Math.floor(limitParsed), 1), 100) : 25;

  const { supabase } = gate.context;

  const { data, error } = await supabase
    .from('ingestion_runs')
    .select('job_name, started_at, ended_at, success, error, stats')
    .eq('job_name', job)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('admin ingestion-runs fetch error', error);
    return NextResponse.json({ error: 'failed_to_load_runs' }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
