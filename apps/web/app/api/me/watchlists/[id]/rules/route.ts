import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const watchlistIdSchema = z.string().uuid();

const bodySchema = z
  .object({
    rule_type: z.enum(['launch', 'pad', 'provider', 'tier']),
    rule_value: z.string().trim().min(1).max(200)
  })
  .strict();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = watchlistIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_watchlist_id' }, { status: 400 });

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!viewer.capabilities.canUseSavedItems) return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const normalized = normalizeRule(parsedBody.data.rule_type, parsedBody.data.rule_value);
  if (!normalized) return NextResponse.json({ error: 'invalid_rule_value' }, { status: 400 });

  const supabase = createSupabaseServerClient();

  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .maybeSingle();
  if (watchlistError) {
    console.error('watchlist lookup error', watchlistError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
  if (!watchlist) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: existing, error: existingError } = await supabase
    .from('watchlist_rules')
    .select('id, rule_type, rule_value, created_at')
    .eq('watchlist_id', parsedId.data)
    .eq('rule_type', normalized.rule_type)
    .eq('rule_value', normalized.rule_value)
    .maybeSingle();

  if (existingError) {
    console.error('watchlist rule lookup error', existingError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ rule: existing, source: 'existing' }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const ruleLimit = viewer.limits.watchlistRuleLimit;
  const limitScope = 'watchlist';
  const { count, error: countError } = await supabase
    .from('watchlist_rules')
    .select('id', { count: 'exact', head: true })
    .eq('watchlist_id', parsedId.data);

  if (countError) {
    console.error('watchlist rules count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const ruleCount = count ?? 0;

  if (ruleCount >= ruleLimit) {
    return NextResponse.json({ error: 'limit_reached', limit: ruleLimit, scope: limitScope }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('watchlist_rules')
    .insert({
      watchlist_id: parsedId.data,
      rule_type: normalized.rule_type,
      rule_value: normalized.rule_value,
      created_at: now
    })
    .select('id, rule_type, rule_value, created_at')
    .single();

  if (error) {
    console.error('watchlist rule insert error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ rule: data, source: 'created' }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

function normalizeRule(
  ruleType: 'launch' | 'pad' | 'provider' | 'tier',
  ruleValue: string
): { rule_type: 'launch' | 'pad' | 'provider' | 'tier'; rule_value: string } | null {
  const trimmed = ruleValue.trim();
  if (!trimmed) return null;

  if (ruleType === 'launch') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) return null;
    return { rule_type: 'launch', rule_value: trimmed.toLowerCase() };
  }

  if (ruleType === 'pad') {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('ll2:')) {
      const rest = trimmed.slice(4).trim();
      if (!/^\d{1,10}$/.test(rest)) return null;
      return { rule_type: 'pad', rule_value: `ll2:${String(Number(rest))}` };
    }
    if (lower.startsWith('code:')) {
      const rest = trimmed.slice(5).trim();
      if (!rest) return null;
      return { rule_type: 'pad', rule_value: `code:${rest}` };
    }
    if (/^\d{1,10}$/.test(trimmed)) {
      return { rule_type: 'pad', rule_value: `ll2:${String(Number(trimmed))}` };
    }
    return { rule_type: 'pad', rule_value: `code:${trimmed}` };
  }

  if (ruleType === 'tier') {
    const normalized = trimmed.toLowerCase();
    if (!['major', 'notable', 'routine'].includes(normalized)) return null;
    return { rule_type: 'tier', rule_value: normalized };
  }

  return { rule_type: 'provider', rule_value: trimmed };
}
