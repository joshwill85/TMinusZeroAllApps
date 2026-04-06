import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;

  const { supabase } = gate.context;
  const { data: settingsRows, error: settingsError } = await supabase
    .from('system_settings')
    .select('key,value')
    .in('key', ['jobs_base_url', 'jobs_auth_token', 'jobs_apikey']);
  if (settingsError) {
    console.error('ws45 monitor settings error', settingsError);
    return NextResponse.json({ error: 'failed_to_load_job_settings' }, { status: 500 });
  }

  const settings: Record<string, unknown> = {};
  (settingsRows || []).forEach((row) => {
    settings[row.key] = row.value;
  });

  const jobToken = readStringSetting(settings.jobs_auth_token);
  if (!jobToken) return NextResponse.json({ error: 'jobs_auth_token_not_set' }, { status: 409 });

  const apiKey = readStringSetting(settings.jobs_apikey) || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'jobs_apikey_not_set' }, { status: 409 });

  const baseUrl =
    readStringSetting(settings.jobs_base_url) ||
    [process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, 'functions', 'v1'].filter(Boolean).join('/');
  if (!baseUrl) return NextResponse.json({ error: 'jobs_base_url_not_set' }, { status: 409 });

  const url = `${baseUrl.replace(/\/+$/, '')}/monitoring-check`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-job-token': jobToken,
      apikey: apiKey
    },
    body: JSON.stringify({})
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('ws45 monitor job error', { status: res.status, body });
    return NextResponse.json({ error: 'job_failed', status: res.status, body }, { status: 502 });
  }

  return NextResponse.json({ ok: true, triggered: 'monitoring_check', job: 'monitoring-check', result: body });
}

function readStringSetting(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}
