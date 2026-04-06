import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reparseWs45Forecasts } from '@/lib/server/ws45ForecastIngest';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  scope: z.enum(['quarantined_recent', 'version_stale', 'forecast_id', 'forecast_ids']).default('quarantined_recent'),
  limit: z.number().int().min(1).max(100).optional(),
  forecastId: z.string().uuid().optional(),
  forecastIds: z.array(z.string().uuid()).max(100).optional()
});

export async function POST(request: Request) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const admin = gate.context.admin;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const result = await reparseWs45Forecasts({
    supabaseAdmin: admin,
    scope: parsed.data.scope,
    limit: parsed.data.limit,
    forecastId: parsed.data.forecastId,
    forecastIds: parsed.data.forecastIds
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'ws45_reparse_failed', result }, { status: 502 });
  }

  return NextResponse.json({ ok: true, result });
}
