import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { BillingApiRouteError, processAppleBillingNotification, verifyAppleBillingNotification } from '@/lib/server/billingCore';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import {
  createOrGetWebhookEventRecord,
  logWebhookEventFailure,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  wasWebhookEventProcessed
} from '@/lib/server/webhookEvents';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }

  const rawBody = await request.text();
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const admin = createSupabaseAdminClient();

  let parsedBody: { signedPayload?: unknown } | null = null;
  try {
    parsedBody = JSON.parse(rawBody) as { signedPayload?: unknown };
  } catch {
    await logWebhookEventFailure(admin, {
      source: 'apple_app_store',
      payloadHash,
      error: 'invalid_json'
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const signedPayload = typeof parsedBody?.signedPayload === 'string' ? parsedBody.signedPayload.trim() : '';
  if (!signedPayload) {
    await logWebhookEventFailure(admin, {
      source: 'apple_app_store',
      payloadHash,
      error: 'missing_signed_payload'
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  let verifiedNotification: Awaited<ReturnType<typeof verifyAppleBillingNotification>>;
  try {
    verifiedNotification = await verifyAppleBillingNotification(signedPayload);
  } catch (error) {
    await logWebhookEventFailure(admin, {
      source: 'apple_app_store',
      payloadHash,
      error: error instanceof Error ? error.message : 'invalid_signed_payload'
    });
    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const webhookEvent = await createOrGetWebhookEventRecord(admin, {
    source: 'apple_app_store',
    eventId: verifiedNotification.providerEventId,
    payloadHash
  });

  if (!webhookEvent.id) {
    return NextResponse.json({ error: 'failed_to_log_webhook_event' }, { status: 500 });
  }

  if (webhookEvent.supportsEventId) {
    const existingProcessed = await wasWebhookEventProcessed(admin, {
      source: 'apple_app_store',
      eventId: verifiedNotification.providerEventId
    });
    if (existingProcessed) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    const result = await processAppleBillingNotification({
      environment: verifiedNotification.environment,
      notification: verifiedNotification.notification,
      providerEventId: verifiedNotification.providerEventId
    });
    await markWebhookEventProcessed(admin, { id: webhookEvent.id });
    return NextResponse.json({
      received: true,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {})
    });
  } catch (error) {
    await markWebhookEventFailed(admin, {
      id: webhookEvent.id,
      error: error instanceof Error ? error.message : 'processing_failed'
    });

    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }

    console.error('apple billing webhook processing error', error);
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
