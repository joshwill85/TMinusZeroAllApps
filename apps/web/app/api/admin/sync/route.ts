import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { ingestWs45LaunchForecasts } from '@/lib/server/ws45ForecastIngest';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JOBS = {
  sync_ll2: { slug: 'll2-incremental' },
  refresh_public_cache: { slug: 'ingestion-cycle' },
  dispatch_notifications: { slug: 'notifications-dispatch' },
  ws45_forecasts_ingest: { slug: 'ws45-forecast-ingest' },
  nws_refresh: { slug: 'nws-refresh' },
  billing_reconcile: { slug: 'billing-reconcile' },

  celestrak_gp_groups_sync: { slug: 'celestrak-gp-groups-sync' },
  celestrak_ingest: { slug: 'celestrak-ingest' },
  celestrak_retention_cleanup: { slug: 'celestrak-retention-cleanup' },

  spacex_infographics_ingest: { slug: 'spacex-infographics-ingest' },
  spacex_x_post_snapshot: { slug: 'spacex-x-post-snapshot' },
  launch_social_refresh: { slug: 'launch-social-refresh' },
  launch_social_link_backfill: { slug: 'launch-social-link-backfill' },

  ll2_backfill: { slug: 'll2-backfill' },
  ll2_payload_backfill: { slug: 'll2-payload-backfill' },
  ll2_catalog_agencies: { slug: 'll2-catalog-agencies' },
  rocket_media_backfill: { slug: 'rocket-media-backfill' },

  trajectory_orbit_ingest: { slug: 'trajectory-orbit-ingest' },
  trajectory_constraints_ingest: { slug: 'trajectory-constraints-ingest' },
  trajectory_products_generate: { slug: 'trajectory-products-generate' },
  jep_score_refresh: { slug: 'jep-score-refresh' },
  trajectory_templates_generate: { slug: 'trajectory-templates-generate' },

  artemis_bootstrap: { slug: 'artemis-bootstrap' },
  artemis_nasa_ingest: { slug: 'artemis-nasa-ingest' },
  artemis_oversight_ingest: { slug: 'artemis-oversight-ingest' },
  artemis_budget_ingest: { slug: 'artemis-budget-ingest' },
  artemis_procurement_ingest: { slug: 'artemis-procurement-ingest' },
  artemis_contracts_ingest: { slug: 'artemis-contracts-ingest' },
  program_contract_story_sync: { slug: 'program-contract-story-sync' },
  artemis_snapshot_build: { slug: 'artemis-snapshot-build' },
  artemis_content_ingest: { slug: 'artemis-content-ingest' },

  notifications_send: { slug: 'notifications-send' },
  monitoring_check: { slug: 'monitoring-check' }
} as const;

const FORCE_BODY_JOBS = new Set(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill', 'artemis_bootstrap']);

const schema = z.object({
  job: z.enum([
    'sync_ll2',
    'refresh_public_cache',
    'dispatch_notifications',
    'ws45_forecasts_ingest',
    'nws_refresh',
    'billing_reconcile',

    'celestrak_gp_groups_sync',
    'celestrak_ingest',
    'celestrak_retention_cleanup',

    'spacex_infographics_ingest',
    'spacex_x_post_snapshot',
    'launch_social_refresh',
    'launch_social_link_backfill',

    'll2_backfill',
    'll2_payload_backfill',
    'll2_catalog_agencies',
    'rocket_media_backfill',

    'trajectory_orbit_ingest',
    'trajectory_constraints_ingest',
    'trajectory_products_generate',
    'jep_score_refresh',
    'trajectory_templates_generate',

    'artemis_bootstrap',
    'artemis_nasa_ingest',
    'artemis_oversight_ingest',
    'artemis_budget_ingest',
    'artemis_procurement_ingest',
    'artemis_contracts_ingest',
    'program_contract_story_sync',
    'artemis_snapshot_build',
    'artemis_content_ingest',

    'notifications_send',
    'monitoring_check'
  ])
});

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

  const jobName = parsed.data.job;

  if (jobName === 'ws45_forecasts_ingest') {
    try {
      const admin = createSupabaseAdminClient();
      const result = await ingestWs45LaunchForecasts({ supabaseAdmin: admin });
      if (!result.ok) {
        return NextResponse.json({ error: 'ws45_ingest_failed', result }, { status: 502 });
      }
      return NextResponse.json({ triggered: jobName, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: 'ws45_ingest_failed', message }, { status: 502 });
    }
  }

  const job = JOBS[jobName];
  if (!job) return NextResponse.json({ error: 'unknown_job' }, { status: 400 });

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

  const apiKey = readStringSetting(settings.jobs_apikey) || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'jobs_apikey_not_set' }, { status: 409 });

  const baseUrl =
    readStringSetting(settings.jobs_base_url) ||
    [process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, 'functions', 'v1'].filter(Boolean).join('/');
  if (!baseUrl) return NextResponse.json({ error: 'jobs_base_url_not_set' }, { status: 409 });

  const url = `${baseUrl.replace(/\/+$/, '')}/${job.slug}`;
  const bodyPayload = FORCE_BODY_JOBS.has(jobName) ? { force: true } : {};
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

  return NextResponse.json({ triggered: jobName, job: job.slug, result: body });
}

function readStringSetting(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}
