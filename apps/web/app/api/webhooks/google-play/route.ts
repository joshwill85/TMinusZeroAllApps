import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { BillingApiRouteError, processGoogleBillingNotification, verifyGoogleBillingNotificationRequest } from '@/lib/server/billingCore';
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

type GooglePubSubPushEnvelope = {
  message?: {
    data?: string;
    messageId?: string;
  } | null;
};

function decodePubSubMessage(data: string) {
  const decoded = Buffer.from(data, 'base64').toString('utf8');
  return JSON.parse(decoded) as {
    version?: string;
    packageName?: string;
    eventTimeMillis?: string;
    subscriptionNotification?: {
      version?: string;
      notificationType?: number;
      purchaseToken?: string;
      subscriptionId?: string;
    } | null;
    testNotification?: Record<string, unknown> | null;
  };
}

export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }

  const rawBody = await request.text();
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const admin = createSupabaseAdminClient();

  let envelope: GooglePubSubPushEnvelope | null = null;
  try {
    envelope = JSON.parse(rawBody) as GooglePubSubPushEnvelope;
  } catch {
    await logWebhookEventFailure(admin, {
      source: 'google_play',
      payloadHash,
      error: 'invalid_json'
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const messageId = typeof envelope?.message?.messageId === 'string' ? envelope.message.messageId.trim() : '';
  if (!messageId) {
    await logWebhookEventFailure(admin, {
      source: 'google_play',
      payloadHash,
      error: 'missing_event_id'
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    await verifyGoogleBillingNotificationRequest(request);
  } catch (error) {
    await logWebhookEventFailure(admin, {
      source: 'google_play',
      payloadHash,
      error: error instanceof Error ? error.message : 'invalid_push_auth',
      eventId: messageId
    });

    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }

    return NextResponse.json({ error: 'invalid_push_auth' }, { status: 401 });
  }

  const encodedMessageData = typeof envelope?.message?.data === 'string' ? envelope.message.data.trim() : '';
  if (!encodedMessageData) {
    await logWebhookEventFailure(admin, {
      source: 'google_play',
      payloadHash,
      error: 'missing_message_data',
      eventId: messageId
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  let notification: ReturnType<typeof decodePubSubMessage>;
  try {
    notification = decodePubSubMessage(encodedMessageData);
  } catch (error) {
    await logWebhookEventFailure(admin, {
      source: 'google_play',
      payloadHash,
      error: error instanceof Error ? error.message : 'invalid_message_data',
      eventId: messageId
    });
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const webhookEvent = await createOrGetWebhookEventRecord(admin, {
    source: 'google_play',
    eventId: messageId,
    payloadHash
  });

  if (!webhookEvent.id) {
    return NextResponse.json({ error: 'failed_to_log_webhook_event' }, { status: 500 });
  }

  if (webhookEvent.supportsEventId) {
    const existingProcessed = await wasWebhookEventProcessed(admin, {
      source: 'google_play',
      eventId: messageId
    });
    if (existingProcessed) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    const result = await processGoogleBillingNotification({
      notification,
      providerEventId: messageId
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

    console.error('google billing webhook processing error', error);
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
