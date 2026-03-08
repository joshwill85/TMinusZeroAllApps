import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIN_TIME_TO_SUBMIT_MS = 2500;
const RATE_LIMIT_PER_HOUR = 12;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(320),
    message: z.string().trim().min(5).max(5000),
    pagePath: z.string().trim().min(1).max(300).optional(),
    page_path: z.string().trim().min(1).max(300).optional(),
    source: z.enum(['launch_card', 'launch_details']).optional(),
    launchId: z.string().trim().min(1).max(128).optional().nullable(),
    launch_id: z.string().trim().min(1).max(128).optional().nullable(),
    startedAtMs: z.coerce.number().int().nonnegative().optional(),
    started_at_ms: z.coerce.number().int().nonnegative().optional(),
    company: z.string().trim().max(80).optional()
  })
  .passthrough();

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    console.warn('feedback invalid body', parsed.error.flatten());
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const pagePath = parsed.data.pagePath || parsed.data.page_path || '';
  const source =
    parsed.data.source ||
    (pagePath.startsWith('/launches/') ? ('launch_details' as const) : ('launch_card' as const));
  const launchId = parsed.data.launchId || parsed.data.launch_id || undefined;
  const startedAtMs = parsed.data.startedAtMs ?? parsed.data.started_at_ms;

  if (!pagePath) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (startedAtMs != null && Date.now() - startedAtMs < MIN_TIME_TO_SUBMIT_MS) {
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (parsed.data.company) {
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const ip = readClientIp(request.headers);
  const rateLimitKey = buildRateLimitKey(ip);
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const admin = createSupabaseAdminClient();
  const { data: allowed, error: rateError } = await admin.rpc('try_increment_api_rate', {
    provider_name: rateLimitKey,
    window_start_in: windowStart.toISOString(),
    window_seconds_in: RATE_LIMIT_WINDOW_SECONDS,
    limit_in: RATE_LIMIT_PER_HOUR
  });

  if (rateError) {
    console.error('feedback rate limit error', rateError);
    return NextResponse.json({ error: 'failed_to_submit' }, { status: 500 });
  }
  if (allowed === false) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const payload = {
    user_id: user?.id ?? null,
    name: parsed.data.name ?? null,
    email: parsed.data.email.toLowerCase(),
    message: parsed.data.message,
    page_path: pagePath,
    source,
    launch_id: launchId ?? null
  };

  const { error } = await admin.from('feedback_submissions').insert(payload);
  if (error) {
    console.error('feedback submission insert error', error);
    return NextResponse.json({ error: 'failed_to_submit' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

function readClientIp(headers: Headers) {
  const forwardedFor = headers.get('x-forwarded-for')?.trim();
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}

function buildRateLimitKey(ip: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'feedback_rate_limit';
  const hash = crypto.createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 32);
  return `feedback_submit:${hash}`;
}
