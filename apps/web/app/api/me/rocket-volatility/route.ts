import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { computeRocketVolatility, type RocketVolatilityUpdateRow } from '@/lib/server/rocketVolatility';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LAUNCHES = 50;
const MAX_LOOKBACK_DAYS = 3650;

const requestSchema = z.object({
  lookbackDays: z.number().int().min(1).max(MAX_LOOKBACK_DAYS).optional(),
  launches: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1)
      })
    )
    .min(1)
    .max(MAX_LAUNCHES)
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'premium_required' }, { status: 402 });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const lookbackDays = parsed.data.lookbackDays ?? 120;
  const sinceIso = new Date(Date.now() - lookbackDays * DAY_MS).toISOString();

  const launchMap = new Map<string, { id: string; name: string }>();
  for (const launch of parsed.data.launches) {
    if (!launch?.id || !launch?.name) continue;
    if (!launchMap.has(launch.id)) {
      launchMap.set(launch.id, { id: launch.id, name: launch.name });
    }
  }
  const launches = Array.from(launchMap.values()).slice(0, MAX_LAUNCHES);
  if (launches.length === 0) {
    return NextResponse.json({ error: 'no_launches' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const launchIds = launches.map((launch) => launch.id);
  const chunkSize = 150;
  const updates: RocketVolatilityUpdateRow[] = [];

  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const chunk = launchIds.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from('launch_updates')
      .select('id, launch_id, changed_fields, old_values, new_values, detected_at')
      .in('launch_id', chunk)
      .gte('detected_at', sinceIso)
      .order('detected_at', { ascending: false })
      .limit(5000);

    if (error) {
      console.error('rocket volatility query error', error);
      return NextResponse.json({ error: 'launch_updates_query_failed' }, { status: 500 });
    }

    if (Array.isArray(data) && data.length > 0) {
      updates.push(...(data as RocketVolatilityUpdateRow[]));
    }
  }

  const volatility = computeRocketVolatility({ lookbackDays, launches, updates });
  return NextResponse.json({ volatility });
}

