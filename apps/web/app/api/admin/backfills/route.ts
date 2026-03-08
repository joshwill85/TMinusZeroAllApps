import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKFILL_KEYS = {
  ll2_backfill: 'll2_backfill_job_enabled',
  ll2_payload_backfill: 'll2_payload_backfill_job_enabled',
  rocket_media_backfill: 'rocket_media_backfill_job_enabled'
} as const;

const PAYLOAD_BACKFILL_KEYS = {
  spacecraftOnly: 'll2_payload_backfill_spacecraft_only',
  cursor: 'll2_payload_backfill_cursor',
  offset: 'll2_payload_backfill_offset',
  limit: 'll2_payload_backfill_limit',
  done: 'll2_payload_backfill_done',
  completedAt: 'll2_payload_backfill_completed_at',
  lastError: 'll2_payload_backfill_last_error'
} as const;

const PAYLOAD_BACKFILL_EPOCH = '1960-01-01T00:00:00Z';

type BackfillId = keyof typeof BACKFILL_KEYS;

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_enabled'),
    backfill: z.enum(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill']),
    enabled: z.boolean()
  }),
  z.object({
    action: z.literal('disable_all'),
    // Future-proof: allow client to pass exclusions, but default to none.
    exclude: z.array(z.enum(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill'])).optional()
  }),
  z.object({
    action: z.literal('set_payload_spacecraft_only'),
    spacecraftOnly: z.boolean()
  }),
  z.object({
    action: z.literal('start_payload_spacecraft_only'),
    // Safety: keep page size bounded to protect IO and LL2 rate budgets.
    limit: z.number().int().min(1).max(100).optional()
  })
]);

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const now = new Date().toISOString();
  const admin = createSupabaseAdminClient();

  const updates: Array<{ key: string; value: boolean; updated_at: string; updated_by: string }> = [];
  const miscUpdates: Array<{ key: string; value: unknown; updated_at: string; updated_by: string }> = [];

  if (parsed.data.action === 'set_enabled') {
    const backfill = parsed.data.backfill as BackfillId;
    updates.push({
      key: BACKFILL_KEYS[backfill],
      value: parsed.data.enabled,
      updated_at: now,
      updated_by: user.id
    });
  } else if (parsed.data.action === 'disable_all') {
    const exclude = new Set(parsed.data.exclude ?? []);
    (Object.keys(BACKFILL_KEYS) as BackfillId[]).forEach((backfill) => {
      if (exclude.has(backfill)) return;
      updates.push({
        key: BACKFILL_KEYS[backfill],
        value: false,
        updated_at: now,
        updated_by: user.id
      });
    });
  } else if (parsed.data.action === 'set_payload_spacecraft_only') {
    miscUpdates.push({
      key: PAYLOAD_BACKFILL_KEYS.spacecraftOnly,
      value: parsed.data.spacecraftOnly,
      updated_at: now,
      updated_by: user.id
    });
  } else if (parsed.data.action === 'start_payload_spacecraft_only') {
    const limit = parsed.data.limit ?? 50;
    miscUpdates.push(
      { key: PAYLOAD_BACKFILL_KEYS.spacecraftOnly, value: true, updated_at: now, updated_by: user.id },
      { key: BACKFILL_KEYS.ll2_payload_backfill, value: true, updated_at: now, updated_by: user.id },
      { key: PAYLOAD_BACKFILL_KEYS.done, value: false, updated_at: now, updated_by: user.id },
      // system_settings.value is NOT NULL, so clear with empty string (readStringSetting treats it as unset).
      { key: PAYLOAD_BACKFILL_KEYS.completedAt, value: '', updated_at: now, updated_by: user.id },
      { key: PAYLOAD_BACKFILL_KEYS.cursor, value: PAYLOAD_BACKFILL_EPOCH, updated_at: now, updated_by: user.id },
      { key: PAYLOAD_BACKFILL_KEYS.offset, value: 0, updated_at: now, updated_by: user.id },
      { key: PAYLOAD_BACKFILL_KEYS.limit, value: limit, updated_at: now, updated_by: user.id },
      { key: PAYLOAD_BACKFILL_KEYS.lastError, value: '', updated_at: now, updated_by: user.id }
    );
  }

  const allUpdates = [...updates, ...miscUpdates];
  if (!allUpdates.length) return NextResponse.json({ ok: true, updated: 0 });

  const { error } = await admin.from('system_settings').upsert(allUpdates, { onConflict: 'key' });
  if (error) {
    console.error('admin backfills update error', error);
    return NextResponse.json({ error: 'settings_update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: allUpdates.length, keys: allUpdates.map((u) => u.key) });
}
