import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_MAX_AGE_MINUTES = 6 * 60;
const DEFAULT_LIMIT = 100;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'billing_reconcile');
  let stage: string = 'init';

  const stats: Record<string, unknown> = {
    processed: 0,
    updated: 0,
    skippedRecent: 0,
    missingSubscription: 0,
    errors: 0
  };

  try {
    stage = 'config';
    const stripeKey = readStripeSecretKey();
    const body = await req.json().catch(() => ({}));
    const limit = clampInt((body as any)?.limit, DEFAULT_LIMIT, 1, 500);
    const maxAgeMinutes = clampInt((body as any)?.maxAgeMinutes, DEFAULT_MAX_AGE_MINUTES, 5, 7 * 24 * 60);

    const now = new Date();
    const cutoffIso = new Date(now.getTime() - maxAgeMinutes * 60 * 1000).toISOString();

    stage = 'load_customers';
    const { data: customers, error } = await supabase
      .from('stripe_customers')
      .select('user_id,stripe_customer_id,last_subscription_sync_at,created_at')
      .or(`last_subscription_sync_at.is.null,last_subscription_sync_at.lt.${cutoffIso}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    const rows = Array.isArray(customers) ? customers : [];
    for (const row of rows) {
      stats.processed = (stats.processed as number) + 1;

      const userId = String((row as any)?.user_id || '').trim();
      const stripeCustomerId = String((row as any)?.stripe_customer_id || '').trim();
      if (!userId || !stripeCustomerId) {
        stats.errors = (stats.errors as number) + 1;
        continue;
      }

      try {
        stage = 'fetch_stripe_subscriptions';
        const result = await fetchStripeSubscriptions(stripeKey, stripeCustomerId);
        const subscription = pickBestSubscription(result);
        const nowIso = now.toISOString();

        if (!subscription) {
          stats.missingSubscription = (stats.missingSubscription as number) + 1;
          await supabase
            .from('stripe_customers')
            .update({ last_subscription_sync_at: nowIso })
            .eq('user_id', userId);
          continue;
        }

        const priceId = readSubscriptionPriceId(subscription) || 'unknown';
        const currentPeriodEndIso = subscription.current_period_end
          ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
          : null;

        const upsertRes = await supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            status: subscription.status || 'unknown',
            current_period_end: currentPeriodEndIso,
            cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
            updated_at: nowIso
          },
          { onConflict: 'user_id' }
        );

        if (upsertRes.error) {
          throw new Error(upsertRes.error.message);
        }

        stage = 'update_sync_marker';
        await supabase
          .from('stripe_customers')
          .update({ last_subscription_sync_at: nowIso })
          .eq('user_id', userId);

        stats.updated = (stats.updated as number) + 1;
      } catch (err) {
        stats.errors = (stats.errors as number) + 1;
        console.warn('billing-reconcile per-customer error', { error: stringifyError(err) });
        await upsertAlert(supabase, {
          key: 'billing_reconcile_error',
          severity: 'warning',
          message: 'Billing reconciliation encountered errors.',
          details: { error: stringifyError(err) }
        });
      }
    }

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    console.error('billing-reconcile failed', { stage, error: message });
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message, elapsedMs: Date.now() - startedAt }, message);
    await upsertAlert(supabase, {
      key: 'billing_reconcile_failed',
      severity: 'critical',
      message: 'Billing reconciliation failed.',
      details: { error: message }
    });
    return jsonResponse({ ok: false, stage, error: message }, 500);
  }
});

function readStripeSecretKey() {
  const key =
    Deno.env.get('STRIPE_SECRET_KEY') ||
    Deno.env.get('STRIPE_SECRET') ||
    Deno.env.get('STRIPE_API_KEY') ||
    '';
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Missing STRIPE_SECRET_KEY/STRIPE_SECRET/STRIPE_API_KEY for billing reconciliation job.');
  return trimmed;
}

async function fetchStripeSubscriptions(stripeKey: string, customerId: string) {
  const url = new URL(`${STRIPE_API_BASE}/subscriptions`);
  url.searchParams.set('customer', customerId);
  url.searchParams.set('status', 'all');
  url.searchParams.set('limit', '10');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${stripeKey}`
    }
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message = typeof json?.error?.message === 'string' ? json.error.message : `Stripe API error: ${res.status}`;
    throw new Error(message);
  }

  return json;
}

function pickBestSubscription(payload: any): any | null {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  if (!list.length) return null;

  const statusScore = (status: unknown) => {
    const s = String(status || '').toLowerCase();
    if (s === 'active') return 3;
    if (s === 'trialing') return 2;
    return 1;
  };

  const sorted = [...list].sort((a, b) => {
    const aScore = statusScore(a?.status);
    const bScore = statusScore(b?.status);
    if (bScore !== aScore) return bScore - aScore;
    const aCreated = Number(a?.created || 0);
    const bCreated = Number(b?.created || 0);
    return bCreated - aCreated;
  });

  return sorted[0] || null;
}

function readSubscriptionPriceId(subscription: any): string | null {
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  return typeof priceId === 'string' && priceId.trim() ? priceId.trim() : null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function startIngestionRun(supabase: any, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: any,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
}

async function upsertAlert(
  supabase: any,
  {
    key,
    severity,
    message,
    details
  }: { key: string; severity: 'info' | 'warning' | 'critical'; message: string; details?: Record<string, unknown> }
) {
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase.from('ops_alerts').select('id,occurrences,resolved').eq('key', key).maybeSingle();

  if (!existing) {
    await supabase.from('ops_alerts').insert({
      key,
      severity,
      message,
      details: details ?? null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      occurrences: 1,
      resolved: false
    });
    return;
  }

  await supabase
    .from('ops_alerts')
    .update({
      severity,
      message,
      details: details ?? null,
      last_seen_at: nowIso,
      occurrences: Number(existing.occurrences || 0) + 1,
      resolved: false,
      resolved_at: null
    })
    .eq('id', existing.id);
}
