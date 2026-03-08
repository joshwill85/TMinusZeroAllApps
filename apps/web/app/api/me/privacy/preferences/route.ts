import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    opt_out_sale_share: z.boolean().optional(),
    limit_sensitive: z.boolean().optional(),
    block_third_party_embeds: z.boolean().optional(),
    gpc_enabled: z.boolean().optional()
  })
  .strict();

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('privacy_preferences')
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('privacy preferences fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ preferences: data ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const updates = { ...parsed.data };
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 });
  }

  if (updates.gpc_enabled) {
    updates.opt_out_sale_share = true;
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();
  const payload = {
    user_id: user.id,
    updated_at: now,
    ...updates
  };

  const { data, error } = await supabase
    .from('privacy_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .single();

  if (error) {
    console.error('privacy preferences update error', error);
    return NextResponse.json({ error: 'failed_to_update' }, { status: 500 });
  }

  return NextResponse.json({ preferences: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
