import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ profile: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, role, first_name, last_name, timezone, created_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('profile fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const meta = (user.user_metadata || {}) as Record<string, any>;
  const profileBase = data ?? {
    user_id: user.id,
    email: user.email,
    role: 'user',
    first_name: meta.first_name || null,
    last_name: meta.last_name || null,
    timezone: 'America/New_York',
    created_at: user.created_at
  };

  const profile = {
    ...profileBase,
    email_confirmed_at: (user as any).email_confirmed_at ?? null
  };

  return NextResponse.json({ profile }, { headers: { 'Cache-Control': 'private, no-store' } });
}

const updateSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80).optional(),
    last_name: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(100).optional()
  })
  .strict();

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const updates = parsed.data;
  if (!updates.first_name && !updates.last_name && !updates.timezone) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();

  const profilePatch: Record<string, unknown> = { updated_at: now };
  if (updates.first_name) profilePatch.first_name = updates.first_name;
  if (updates.last_name) profilePatch.last_name = updates.last_name;
  if (updates.timezone) profilePatch.timezone = updates.timezone;

  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update(profilePatch)
    .eq('user_id', user.id)
    .select('user_id, email, role, first_name, last_name, timezone, created_at, updated_at')
    .maybeSingle();

  if (updateError) {
    console.error('profile update error', updateError);
    return NextResponse.json({ error: 'failed_to_update' }, { status: 500 });
  }

  if (updates.first_name || updates.last_name) {
    const meta: Record<string, string> = {};
    if (updates.first_name) meta.first_name = updates.first_name;
    if (updates.last_name) meta.last_name = updates.last_name;
    await supabase.auth.updateUser({
      data: meta
    });
  }

  return NextResponse.json({ profile: profile ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
