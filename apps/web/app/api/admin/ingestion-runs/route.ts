import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  }

  const url = new URL(request.url);
  const job = url.searchParams.get('job')?.trim() ?? '';
  if (!job) return NextResponse.json({ error: 'missing_job' }, { status: 400 });

  const limitRaw = url.searchParams.get('limit')?.trim();
  const limitParsed = limitRaw ? Number(limitRaw) : 25;
  const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(Math.floor(limitParsed), 1), 100) : 25;

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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

