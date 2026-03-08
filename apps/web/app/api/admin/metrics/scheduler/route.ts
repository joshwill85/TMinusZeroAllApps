import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  const auth = await requireAdminRequest();
  if (!auth.ok) return auth.response;
  const supabase = auth.context.supabase;

  const url = new URL(request.url);
  const windowHours = clampInt(url.searchParams.get('windowHours'), 24, 1, 24 * 7);

  const { data, error } = await supabase.rpc('admin_get_managed_scheduler_stats', { window_hours: windowHours });
  if (error) {
    console.error('admin managed scheduler metrics rpc error', error.message);
    return NextResponse.json({ error: 'failed_to_load_scheduler_metrics' }, { status: 500 });
  }

  const payload = asObject(data);
  const summaryRaw = asObject(payload.summary);
  const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs : [];

  const jobs = jobsRaw.map((item) => {
    const row = asObject(item);
    return {
      cronJobName: String(row.cronJobName || ''),
      edgeJobSlug: String(row.edgeJobSlug || ''),
      enabled: Boolean(row.enabled),
      nextRunAt: typeof row.nextRunAt === 'string' ? row.nextRunAt : null,
      lastEnqueuedAt: typeof row.lastEnqueuedAt === 'string' ? row.lastEnqueuedAt : null,
      lastDispatchedAt: typeof row.lastDispatchedAt === 'string' ? row.lastDispatchedAt : null,
      lastError: typeof row.lastError === 'string' && row.lastError.trim() ? row.lastError : null,
      queued: toNumber(row.queued),
      sending: toNumber(row.sending),
      sentWindow: toNumber(row.sentWindow),
      failedWindow: toNumber(row.failedWindow)
    };
  });

  return NextResponse.json(
    {
      mode: 'db',
      windowHours,
      summary: {
        jobsTotal: toNumber(summaryRaw.jobsTotal),
        jobsEnabled: toNumber(summaryRaw.jobsEnabled),
        queued: toNumber(summaryRaw.queued),
        sending: toNumber(summaryRaw.sending),
        sentWindow: toNumber(summaryRaw.sentWindow),
        failedWindow: toNumber(summaryRaw.failedWindow),
        sentTotal: toNumber(summaryRaw.sentTotal),
        failedTotal: toNumber(summaryRaw.failedTotal),
        oldestQueuedAt: typeof summaryRaw.oldestQueuedAt === 'string' ? summaryRaw.oldestQueuedAt : null,
        avgLagSeconds:
          typeof summaryRaw.avgLagSeconds === 'number' && Number.isFinite(summaryRaw.avgLagSeconds)
            ? summaryRaw.avgLagSeconds
            : null,
        p95LagSeconds:
          typeof summaryRaw.p95LagSeconds === 'number' && Number.isFinite(summaryRaw.p95LagSeconds)
            ? summaryRaw.p95LagSeconds
            : null
      },
      jobs
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
