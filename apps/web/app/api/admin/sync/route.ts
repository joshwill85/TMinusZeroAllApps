import { NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeEnvText, normalizeEnvUrl } from '@/lib/env/normalize';
import { getAdminJobRegistryEntry, normalizeAdminSyncJobId } from '../../../admin/_lib/jobRegistry';
import { requireAdminRequest } from '../_lib/auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  job: z.string().trim().min(1)
});

export async function POST(request: Request) {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.context;

  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const jobId = normalizeAdminSyncJobId(parsed.data.job);
  if (!jobId) return NextResponse.json({ error: 'unknown_job' }, { status: 400 });

  const job = getAdminJobRegistryEntry(jobId);
  if (!job || !job.manualRunSupported || !job.slug) {
    return NextResponse.json({ error: 'job_not_runnable' }, { status: 400 });
  }

  const { data: settingsRows, error: settingsError } = await supabase
    .from('system_settings')
    .select('key,value')
    .in('key', ['jobs_base_url', 'jobs_auth_token', 'jobs_apikey']);
  if (settingsError) {
    console.error('manual sync settings error', settingsError);
    return NextResponse.json({ error: 'failed_to_load_job_settings' }, { status: 500 });
  }

  const settings: Record<string, unknown> = {};
  (settingsRows || []).forEach((row) => {
    settings[row.key] = row.value;
  });

  const jobToken = readStringSetting(settings.jobs_auth_token);
  if (!jobToken) return NextResponse.json({ error: 'jobs_auth_token_not_set' }, { status: 409 });

  const apiKey = readStringSetting(settings.jobs_apikey) || normalizeEnvText(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || '';
  if (!apiKey) return NextResponse.json({ error: 'jobs_apikey_not_set' }, { status: 409 });

  const baseUrl =
    readStringSetting(settings.jobs_base_url) ||
    [normalizeEnvUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL), 'functions', 'v1'].filter(Boolean).join('/');
  if (!baseUrl) return NextResponse.json({ error: 'jobs_base_url_not_set' }, { status: 409 });

  const url = `${baseUrl.replace(/\/+$/, '')}/${job.slug}`;
  const bodyPayload = job.manualRunForceBody ? { force: true } : {};
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Supabase Edge Functions require a JWT in `Authorization` (anon/service key).
      // We send the private jobs token via `x-job-token` for app-level auth checks.
      Authorization: `Bearer ${apiKey}`,
      'x-job-token': jobToken,
      apikey: apiKey
    },
    body: JSON.stringify(bodyPayload)
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('manual sync job error', { job: job.slug, status: res.status, body });
    return NextResponse.json({ error: 'job_failed', status: res.status, body }, { status: 502 });
  }

  return NextResponse.json({ triggered: jobId, job: job.slug, result: body });
}

function readStringSetting(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}
