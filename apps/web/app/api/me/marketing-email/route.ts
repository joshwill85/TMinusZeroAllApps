import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

const DEFAULT_PREFS = {
  marketing_email_opt_in: false
};

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ...DEFAULT_PREFS, source: 'stub' }, { status: 200 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('profiles')
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('marketing email prefs fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({
    marketing_email_opt_in: data?.marketing_email_opt_in ?? false,
    updated_at: data?.marketing_email_opt_in_updated_at ?? null,
    source: data ? 'db' : 'default'
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const schema = z.object({
    marketing_email_opt_in: z.boolean()
  });
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('profiles')
    .update({
      marketing_email_opt_in: parsed.data.marketing_email_opt_in,
      marketing_email_opt_in_updated_at: now,
      updated_at: now
    })
    .eq('user_id', user.id)
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .single();

  if (error) {
    console.error('marketing email prefs update error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({
    marketing_email_opt_in: data.marketing_email_opt_in,
    updated_at: data.marketing_email_opt_in_updated_at
  });
}
