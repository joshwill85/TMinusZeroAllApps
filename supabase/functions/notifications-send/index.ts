import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting } from '../_shared/settings.ts';

type OutboxRowV2 = {
  id: number;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id?: string | null;
  launch_id?: string | null;
  channel: string;
  event_type?: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  scheduled_for: string;
};

type SubRow = {
  user_id: string;
  status: string | null;
};

type ProfileRow = {
  user_id: string;
  role: string | null;
  email: string | null;
};

type AdminAccessOverrideRow = {
  user_id: string;
  effective_tier_override: string | null;
};

function isMissingAdminAccessOverrideRelationCode(code: string | null | undefined) {
  return code === '42P01' || code === 'PGRST205';
}

const DEFAULT_BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const LOCK_TIMEOUT_MINUTES = 10;
const CONCURRENCY = 5;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'notifications_send');

  try {
    const result = await sendNotifications(supabase);
    await finishIngestionRun(supabase, runId, true, result);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, result });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

async function sendNotifications(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const settings = await getSettings(supabase, ['push_enabled']);
  const pushEnabled = readBooleanSetting(settings.push_enabled, true);
  await releaseStaleLocks(supabase);

  const resendConfig = getResendConfig();
  const emailStats = resendConfig.enabled
    ? await sendEmailNotifications(supabase, resendConfig)
    : await reportResendNotConfigured(supabase, resendConfig);
  const pushStats = await sendPushNotifications(supabase);
  const mobilePushV2Stats = pushEnabled
    ? await sendMobilePushNotificationsV2(supabase)
    : { processed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0, reason: 'push_disabled' };

  return {
    processed: emailStats.processed + pushStats.processed + mobilePushV2Stats.processed,
    sent: emailStats.sent + pushStats.sent + mobilePushV2Stats.sent,
    skipped: emailStats.skipped + pushStats.skipped + mobilePushV2Stats.skipped,
    failed: emailStats.failed + pushStats.failed + mobilePushV2Stats.failed,
    requeued: emailStats.requeued + pushStats.requeued + mobilePushV2Stats.requeued,
    email: emailStats,
    push: pushStats,
    mobilePushV2: mobilePushV2Stats
  };
}

function getPushBrandName() {
  return String(Deno.env.get('BRAND_NAME') || 'T-Minus Zero').trim() || 'T-Minus Zero';
}

function computePushTtlSeconds(eventType: string | null | undefined) {
  const t = String(eventType || '').trim();
  if (t === 'test') return 60;
  if (t.startsWith('t_minus_') || t.startsWith('local_time_')) return 60 * 60;
  return 10 * 60;
}

type ExpoPushDevice = {
  id: string;
  installationId: string;
  token: string;
  platform: string;
};

type ExpoPushDeviceV2 = {
  id: string;
  ownerKind: 'guest' | 'user';
  userId: string | null;
  installationId: string;
  token: string;
  platform: string;
};

type ExpoPushReceipt = {
  ticketId: string | null;
  receiptStatus: 'ok' | 'error' | 'pending';
  failureReason: string | null;
  disableDevice: boolean;
  retryable: boolean;
};

function isExpoPushToken(token: string) {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

function shouldDisableExpoDevice(reason: string | null) {
  const normalized = String(reason || '').trim();
  return normalized === 'DeviceNotRegistered' || normalized === 'invalid_expo_push_token';
}

async function updateExpoPushDeviceStatus(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  deviceId: string,
  updates: Record<string, unknown>
) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('notification_push_devices').update(payload).eq('id', deviceId);
  if (error) console.warn('notification push device update warning', error.message);
}

async function updateExpoPushDeviceStatusV2(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  deviceId: string,
  updates: Record<string, unknown>
) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('notification_push_destinations_v3').update(payload).eq('id', deviceId);
  if (error) console.warn('mobile push device v2 update warning', error.message);
}

async function sendExpoPushMessage({
  token,
  title,
  message,
  url,
  launchId,
  eventType,
  ttlSeconds
}: {
  token: string;
  title: string;
  message: string;
  url: string;
  launchId: string | null | undefined;
  eventType: string | null | undefined;
  ttlSeconds: number;
}): Promise<ExpoPushReceipt> {
  if (!isExpoPushToken(token)) {
    return {
      ticketId: null,
      receiptStatus: 'error',
      failureReason: 'invalid_expo_push_token',
      disableDevice: true,
      retryable: false
    };
  }

  const sendResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      to: token,
      title,
      body: message,
      sound: 'default',
      ttl: ttlSeconds,
      data: {
        url,
        launchId: launchId ?? null,
        eventType: eventType ?? null
      }
    })
  });

  const sendJson = await sendResponse.json().catch(() => null);
  if (!sendResponse.ok) {
    const status = sendResponse.status;
    return {
      ticketId: null,
      receiptStatus: 'error',
      failureReason: `expo_push_http_${status}`,
      disableDevice: false,
      retryable: status === 429 || status >= 500
    };
  }

  const ticket = sendJson?.data && !Array.isArray(sendJson.data) ? sendJson.data : Array.isArray(sendJson?.data) ? sendJson.data[0] : null;
  if (ticket?.status === 'error') {
    const failureReason = typeof ticket?.details?.error === 'string' ? ticket.details.error : typeof ticket?.message === 'string' ? ticket.message : 'expo_push_ticket_error';
    return {
      ticketId: null,
      receiptStatus: 'error',
      failureReason,
      disableDevice: shouldDisableExpoDevice(failureReason),
      retryable: false
    };
  }

  const ticketId = typeof ticket?.id === 'string' ? ticket.id : null;
  if (!ticketId) {
    return {
      ticketId: null,
      receiptStatus: 'pending',
      failureReason: null,
      disableDevice: false,
      retryable: false
    };
  }

  const receiptResponse = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ ids: [ticketId] })
  });

  const receiptJson = await receiptResponse.json().catch(() => null);
  if (!receiptResponse.ok) {
    const status = receiptResponse.status;
    return {
      ticketId,
      receiptStatus: 'pending',
      failureReason: `expo_receipt_http_${status}`,
      disableDevice: false,
      retryable: status === 429 || status >= 500
    };
  }

  const receipt = receiptJson?.data?.[ticketId];
  if (!receipt) {
    return {
      ticketId,
      receiptStatus: 'pending',
      failureReason: null,
      disableDevice: false,
      retryable: false
    };
  }

  if (receipt.status === 'ok') {
    return {
      ticketId,
      receiptStatus: 'ok',
      failureReason: null,
      disableDevice: false,
      retryable: false
    };
  }

  const failureReason =
    typeof receipt?.details?.error === 'string'
      ? receipt.details.error
      : typeof receipt?.message === 'string'
        ? receipt.message
        : 'expo_push_receipt_error';

  return {
    ticketId,
    receiptStatus: 'error',
    failureReason,
    disableDevice: shouldDisableExpoDevice(failureReason),
    retryable: false
  };
}

async function sendPushNotifications(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  return retireLegacyNotificationOutboxChannel(supabase, 'push');
}

async function sendMobilePushNotificationsV2(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data: batch, error: claimError } = await supabase.rpc('claim_mobile_push_outbox_v2', {
    batch_size: DEFAULT_BATCH_SIZE,
    max_attempts: MAX_ATTEMPTS
  });
  if (claimError) throw claimError;

  const rows = (batch || []) as OutboxRowV2[];
  if (!rows.length) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0 };
  }

  const guestInstallationIds = Array.from(
    new Set(rows.filter((row) => row.owner_kind === 'guest').map((row) => String(row.installation_id || '').trim()).filter(Boolean))
  );
  const userIds = Array.from(
    new Set(rows.filter((row) => row.owner_kind === 'user').map((row) => String(row.user_id || '').trim()).filter(Boolean))
  );

  const [guestInstallationsRes, userInstallationsRes, subsRes, profilesRes, adminOverridesRes] = await Promise.all([
    guestInstallationIds.length
      ? supabase
          .from('notification_push_destinations_v3')
          .select('id, owner_kind, user_id, installation_id, token, platform')
          .eq('owner_kind', 'guest')
          .eq('delivery_kind', 'mobile_push')
          .eq('is_active', true)
          .in('installation_id', guestInstallationIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase
          .from('notification_push_destinations_v3')
          .select('id, owner_kind, user_id, installation_id, token, platform')
          .eq('owner_kind', 'user')
          .eq('delivery_kind', 'mobile_push')
          .eq('is_active', true)
          .in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from('subscriptions').select('user_id, status').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from('profiles').select('user_id, role').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from('admin_access_overrides').select('user_id, effective_tier_override').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (guestInstallationsRes.error) throw guestInstallationsRes.error;
  if (userInstallationsRes.error) throw userInstallationsRes.error;
  if (subsRes.error) throw subsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  if (adminOverridesRes.error) {
    const code = typeof adminOverridesRes.error.code === 'string' ? adminOverridesRes.error.code : '';
    if (isMissingAdminAccessOverrideRelationCode(code)) {
      console.warn('admin_access_overrides table unavailable; continuing without admin access overrides');
    } else {
      throw adminOverridesRes.error;
    }
  }

  const guestDevicesByInstallation = new Map<string, ExpoPushDeviceV2[]>();
  const userDevicesByUser = new Map<string, ExpoPushDeviceV2[]>();
  const deviceRows = [...((guestInstallationsRes.data || []) as any[]), ...((userInstallationsRes.data || []) as any[])];
  deviceRows.forEach((row) => {
    const id = String(row.id || '').trim();
    const ownerKind = row.owner_kind === 'user' ? 'user' : 'guest';
    const userId = typeof row.user_id === 'string' && row.user_id.trim() ? row.user_id.trim() : null;
    const installationId = String(row.installation_id || '').trim();
    const token = String(row.token || '').trim();
    const platform = String(row.platform || '').trim();
    if (!id || !installationId || !token || !platform) return;

    const device: ExpoPushDeviceV2 = {
      id,
      ownerKind,
      userId,
      installationId,
      token,
      platform
    };

    if (ownerKind === 'guest') {
      const list = guestDevicesByInstallation.get(installationId) || [];
      list.push(device);
      guestDevicesByInstallation.set(installationId, list);
      return;
    }

    if (!userId) return;
    const list = userDevicesByUser.get(userId) || [];
    list.push(device);
    userDevicesByUser.set(userId, list);
  });

  const subsByUser = new Map<string, SubRow>();
  (subsRes.data || []).forEach((row: SubRow) => subsByUser.set(row.user_id, row));
  const rolesByUser = new Map<string, string | null>();
  (profilesRes.data || []).forEach((row: { user_id: string; role: string | null }) => rolesByUser.set(row.user_id, row.role ?? null));
  const adminAccessOverridesByUser = new Map<string, 'anon' | 'premium' | null>();
  const adminOverrideRows = adminOverridesRes.error ? [] : (adminOverridesRes.data || []);
  adminOverrideRows.forEach((row: AdminAccessOverrideRow) => {
    const override = String(row.effective_tier_override || '').trim().toLowerCase();
    adminAccessOverridesByUser.set(row.user_id, override === 'anon' || override === 'premium' ? (override as 'anon' | 'premium') : null);
  });

  const stats = {
    processed: rows.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    requeued: 0
  };

  const brandName = getPushBrandName();

  await runWithConcurrency(rows, CONCURRENCY, async (row) => {
    if (row.channel !== 'push') {
      await markMobilePushSkippedV2(supabase, row.id, 'unsupported_channel');
      stats.skipped += 1;
      return;
    }

    const message = normalizeMessage(row.payload);
    if (!message) {
      await markMobilePushFailedV2(supabase, row.id, 'empty_message');
      stats.failed += 1;
      return;
    }

    let devices: ExpoPushDeviceV2[] = [];
    if (row.owner_kind === 'guest') {
      const installationId = String(row.installation_id || '').trim();
      devices = installationId ? guestDevicesByInstallation.get(installationId) || [] : [];
    } else {
      const userId = String(row.user_id || '').trim();
      const sub = subsByUser.get(userId);
      const isAdmin = rolesByUser.get(userId) === 'admin';
      const adminAccessOverride = adminAccessOverridesByUser.get(userId) ?? null;
      const hasPremiumAccess =
        adminAccessOverride != null ? adminAccessOverride === 'premium' : isAdmin || isSubscriptionActiveStatus(sub?.status);
      if (!hasPremiumAccess) {
        await markMobilePushSkippedV2(supabase, row.id, 'subscription_inactive');
        stats.skipped += 1;
        return;
      }
      devices = userId ? userDevicesByUser.get(userId) || [] : [];
    }

    if (!devices.length) {
      await markMobilePushSkippedV2(supabase, row.id, 'push_not_registered');
      stats.skipped += 1;
      return;
    }

    const rawTitle = typeof row.payload?.title === 'string' ? String(row.payload.title).trim() : '';
    const rawUrl = typeof row.payload?.url === 'string' ? String(row.payload.url).trim() : '';
    const title = rawTitle || brandName;
    const url = rawUrl || (row.launch_id ? `/launches/${row.launch_id}` : '/');

    let anySuccess = false;
    let retryableFailure = false;
    let lastErrorMessage = '';
    let providerId = '';

    for (const device of devices) {
      try {
        const receipt = await sendExpoPushMessage({
          token: device.token,
          title,
          message,
          url,
          launchId: row.launch_id,
          eventType: row.event_type,
          ttlSeconds: computePushTtlSeconds(row.event_type)
        });

        if (receipt.receiptStatus === 'ok' || receipt.receiptStatus === 'pending') {
          anySuccess = true;
          providerId = providerId || (receipt.ticketId ? `expo:${receipt.ticketId}` : 'expo_push');
          await updateExpoPushDeviceStatusV2(supabase, device.id, {
            last_sent_at: new Date().toISOString(),
            last_receipt_at: receipt.receiptStatus === 'ok' ? new Date().toISOString() : null,
            last_failure_reason: receipt.failureReason
          });
          continue;
        }

        lastErrorMessage = receipt.failureReason || 'expo_push_delivery_failed';
        if (receipt.disableDevice) {
          await updateExpoPushDeviceStatusV2(supabase, device.id, {
            is_active: false,
            disabled_at: new Date().toISOString(),
            last_receipt_at: new Date().toISOString(),
            last_failure_reason: lastErrorMessage
          });
          continue;
        }

        await updateExpoPushDeviceStatusV2(supabase, device.id, {
          last_receipt_at: new Date().toISOString(),
          last_failure_reason: lastErrorMessage
        });
        if (receipt.retryable) retryableFailure = true;
      } catch (err) {
        const { retryable, message: errorMessage } = normalizeSendError(err);
        lastErrorMessage = errorMessage;
        await updateExpoPushDeviceStatusV2(supabase, device.id, {
          last_failure_reason: errorMessage
        });
        if (retryable) retryableFailure = true;
      }
    }

    if (anySuccess) {
      await markMobilePushSentV2(supabase, row.id, providerId || 'push');
      stats.sent += 1;
      return;
    }

    if (retryableFailure && row.attempts < MAX_ATTEMPTS) {
      const nextAttemptAt = new Date(Date.now() + computeBackoffMs(row.attempts)).toISOString();
      await requeueMobilePushRowV2(supabase, row.id, lastErrorMessage || 'push_retry', nextAttemptAt);
      stats.requeued += 1;
      return;
    }

    await markMobilePushFailedV2(supabase, row.id, lastErrorMessage || 'push_delivery_failed');
    stats.failed += 1;
  });

  return stats;
}

type ResendConfig = {
  enabled: boolean;
  apiKey: string;
  from: string;
  replyTo: string | null;
};

function getResendConfig(): ResendConfig {
  const apiKey = String(Deno.env.get('RESEND_API_KEY') || '').trim();
  const from = String(Deno.env.get('NOTIFICATIONS_EMAIL_FROM') || Deno.env.get('BILLING_EMAIL_FROM') || '').trim();
  const replyTo = String(Deno.env.get('NOTIFICATIONS_EMAIL_REPLY_TO') || Deno.env.get('BILLING_EMAIL_REPLY_TO') || '').trim();
  return {
    enabled: Boolean(apiKey && from),
    apiKey,
    from,
    replyTo: replyTo || null
  };
}

async function reportResendNotConfigured(supabase: ReturnType<typeof createSupabaseAdminClient>, config: ResendConfig) {
  void config;
  await resolveOpsAlert(supabase, 'resend_email_not_configured');
  return retireLegacyNotificationOutboxChannel(supabase, 'email');
}

async function sendEmailNotifications(supabase: ReturnType<typeof createSupabaseAdminClient>, config: ResendConfig) {
  void config;
  await resolveOpsAlert(supabase, 'resend_email_not_configured');
  return retireLegacyNotificationOutboxChannel(supabase, 'email');
}

async function retireLegacyNotificationOutboxChannel(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  channel: 'email' | 'push'
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('notifications_outbox')
    .update({
      status: 'skipped',
      provider_message_id: null,
      error: 'retired_native_mobile_push_only',
      processed_at: now,
      locked_at: null
    })
    .eq('channel', channel)
    .in('status', ['queued', 'sending'])
    .select('id');

  if (error) throw error;

  const processed = Array.isArray(data) ? data.length : 0;
  return {
    processed,
    sent: 0,
    skipped: processed,
    failed: 0,
    requeued: 0,
    reason: 'retired_native_mobile_push_only'
  };
}

async function sendResendEmail(
  config: ResendConfig,
  {
    to,
    subject,
    text,
    html
  }: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }
) {
  const payload: Record<string, unknown> = {
    from: config.from,
    to: [to],
    subject
  };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (config.replyTo) payload.reply_to = config.replyTo;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : `resend_error_${response.status}`;
      const error = new Error(message);
      (error as any).status = response.status;
      throw error;
    }

    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id) throw new Error('resend_missing_message_id');
    return { id };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function releaseStaleLocks(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { error: failError } = await supabase
    .from('notifications_outbox')
    .update({ status: 'failed', locked_at: null, processed_at: now, error: 'stale_send' })
    .eq('status', 'sending')
    .gte('attempts', MAX_ATTEMPTS)
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`);
  if (failError) console.warn('releaseStaleLocks fail warning', failError.message);

  const { error: requeueError } = await supabase
    .from('notifications_outbox')
    .update({ status: 'queued', locked_at: null })
    .eq('status', 'sending')
    .lt('attempts', MAX_ATTEMPTS)
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`);
  if (requeueError) console.warn('releaseStaleLocks requeue warning', requeueError.message);

  const { error: mobileFailError } = await supabase
    .from('mobile_push_outbox_v2')
    .update({ status: 'failed', locked_at: null, processed_at: now, error: 'stale_send' })
    .eq('status', 'sending')
    .gte('attempts', MAX_ATTEMPTS)
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`);
  if (mobileFailError) console.warn('releaseStaleLocks mobile fail warning', mobileFailError.message);

  const { error: mobileRequeueError } = await supabase
    .from('mobile_push_outbox_v2')
    .update({ status: 'queued', locked_at: null })
    .eq('status', 'sending')
    .lt('attempts', MAX_ATTEMPTS)
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`);
  if (mobileRequeueError) console.warn('releaseStaleLocks mobile requeue warning', mobileRequeueError.message);
}

function normalizeSendError(err: unknown) {
  const message = truncateError(stringifyError(err));
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : null;
  const retryable = status == null || status === 429 || status >= 500;
  return { message, retryable };
}

function computeBackoffMs(attempts: number) {
  const baseMinutes = Math.min(60, Math.pow(2, Math.max(1, attempts)));
  const jitter = Math.floor(Math.random() * 3);
  return (baseMinutes + jitter) * 60 * 1000;
}

async function markSent(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, providerId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications_outbox')
    .update({
      status: 'sent',
      provider_message_id: providerId,
      error: null,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markSent warning', error.message);
}

async function markFailed(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, reason: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications_outbox')
    .update({
      status: 'failed',
      provider_message_id: null,
      error: reason,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markFailed warning', error.message);
}

async function markSkipped(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, reason: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications_outbox')
    .update({
      status: 'skipped',
      provider_message_id: null,
      error: reason,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markSkipped warning', error.message);
}

async function requeueRow(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, reason: string, nextAttemptAt: string) {
  const { error } = await supabase
    .from('notifications_outbox')
    .update({
      status: 'queued',
      provider_message_id: null,
      error: reason,
      scheduled_for: nextAttemptAt,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('requeueRow warning', error.message);
}

async function markMobilePushSentV2(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, providerId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('mobile_push_outbox_v2')
    .update({
      status: 'sent',
      provider_message_id: providerId,
      error: null,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markMobilePushSentV2 warning', error.message);
}

async function markMobilePushFailedV2(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, reason: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('mobile_push_outbox_v2')
    .update({
      status: 'failed',
      provider_message_id: null,
      error: reason,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markMobilePushFailedV2 warning', error.message);
}

async function markMobilePushSkippedV2(supabase: ReturnType<typeof createSupabaseAdminClient>, id: number, reason: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('mobile_push_outbox_v2')
    .update({
      status: 'skipped',
      provider_message_id: null,
      error: reason,
      processed_at: now,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('markMobilePushSkippedV2 warning', error.message);
}

async function requeueMobilePushRowV2(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: number,
  reason: string,
  nextAttemptAt: string
) {
  const { error } = await supabase
    .from('mobile_push_outbox_v2')
    .update({
      status: 'queued',
      provider_message_id: null,
      error: reason,
      scheduled_for: nextAttemptAt,
      locked_at: null
    })
    .eq('id', id);
  if (error) console.warn('requeueMobilePushRowV2 warning', error.message);
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function truncateError(message: string) {
  if (message.length <= 240) return message;
  return message.slice(0, 237) + '...';
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isSubscriptionActiveStatus(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'trialing';
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function upsertOpsAlert(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    key,
    severity,
    message,
    details
  }: {
    key: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  }
) {
  const now = new Date().toISOString();
  const { data, error: fetchError } = await supabase.from('ops_alerts').select('id, occurrences').eq('key', key).maybeSingle();
  if (fetchError) {
    console.warn('ops_alerts fetch warning', fetchError.message);
    return;
  }

  if (!data) {
    const { error } = await supabase.from('ops_alerts').insert({
      key,
      severity,
      message,
      details: details || null,
      first_seen_at: now,
      last_seen_at: now,
      occurrences: 1,
      resolved: false,
      resolved_at: null
    });
    if (error) console.warn('ops_alerts insert warning', error.message);
    return;
  }

  const { error } = await supabase
    .from('ops_alerts')
    .update({
      severity,
      message,
      details: details || null,
      last_seen_at: now,
      occurrences: Number(data.occurrences || 0) + 1,
      resolved: false,
      resolved_at: null
    })
    .eq('id', data.id);
  if (error) console.warn('ops_alerts update warning', error.message);
}

async function resolveOpsAlert(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ops_alerts')
    .update({ resolved: true, resolved_at: now })
    .eq('key', key)
    .eq('resolved', false);
  if (error) console.warn('ops_alerts resolve warning', error.message);
}
