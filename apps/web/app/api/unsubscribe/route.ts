import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readToken(request: Request) {
  const { searchParams } = new URL(request.url);
  const queryToken = (searchParams.get('token') || '').trim();
  if (queryToken) return queryToken;

  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => undefined);
    return typeof body?.token === 'string' ? body.token.trim() : '';
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData().catch(() => undefined);
    const token = formData?.get('token');
    return typeof token === 'string' ? token.trim() : '';
  }

  return '';
}

async function handleUnsubscribe(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });

  const token = await readToken(request);
  if (!token || !isUuid(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc('unsubscribe_marketing_emails', { token_in: token });
  if (error) {
    console.error('marketing unsubscribe error', error);
    return NextResponse.json({ error: 'failed_to_unsubscribe' }, { status: 500 });
  }

  if (data !== true) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ unsubscribed: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  return NextResponse.json(
    { error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  return handleUnsubscribe(request);
}
