import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

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
  const limit = clampInt(url.searchParams.get('limit'), 25, 1, 200);

  const [outliersRes, tablePressureRes] = await Promise.all([
    supabase.rpc('admin_get_pg_io_outliers', { limit_n: limit }),
    supabase.rpc('admin_get_table_write_pressure', { limit_n: limit })
  ]);

  if (outliersRes.error) {
    console.error('admin query-io outliers rpc error', outliersRes.error.message);
    return NextResponse.json({ error: 'failed_to_load_query_outliers' }, { status: 500 });
  }
  if (tablePressureRes.error) {
    console.error('admin query-io table pressure rpc error', tablePressureRes.error.message);
    return NextResponse.json({ error: 'failed_to_load_table_write_pressure' }, { status: 500 });
  }

  return NextResponse.json(
    {
      mode: 'db',
      outliers: Array.isArray(outliersRes.data) ? outliersRes.data : [],
      tableWritePressure: Array.isArray(tablePressureRes.data) ? tablePressureRes.data : []
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
