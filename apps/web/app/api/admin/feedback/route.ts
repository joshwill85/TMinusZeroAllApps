import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../_lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), 200, 1, 500);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);

  const admin = gate.context.admin;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  const { data, error } = await admin
    .from('feedback_submissions')
    .select('id, created_at, user_id, name, email, message, page_path, source, launch_id')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('admin feedback fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ feedback: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
