import { getSiteUrl } from '@/lib/server/env';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { BRAND_NAME } from '@/lib/brand';
import { sendResendEmail as sendResendEmailApi } from '@/lib/server/resend';

type BillingEventType = 'subscription_cancel_requested' | 'subscription_resumed' | 'subscription_canceled';

type BillingEventInput = {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  email?: string | null;
  eventType: BillingEventType;
  source: 'self_serve' | 'account_delete';
  stripeSubscriptionId?: string | null;
  status?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  sendEmail?: boolean;
};

type EmailResult = {
  attempted: boolean;
  sent: boolean;
  error?: string | null;
};

type ResendConfig = {
  enabled: boolean;
  apiKey: string;
  from: string;
  replyTo: string | null;
};

const BILLING_EMAIL_ENABLED = process.env.BILLING_EMAIL_NOTIFICATIONS_ENABLED === 'true';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BILLING_EMAIL_FROM = process.env.BILLING_EMAIL_FROM || '';
const BILLING_EMAIL_REPLY_TO = process.env.BILLING_EMAIL_REPLY_TO || '';

export async function recordBillingEvent(input: BillingEventInput) {
  const emailResult = await maybeSendBillingEmail(input);
  const metadata = {
    source: input.source,
    stripe_subscription_id: input.stripeSubscriptionId ?? null,
    status: input.status ?? null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? null,
    current_period_end: input.currentPeriodEnd ?? null,
    email: emailResult
  };

  try {
    await input.admin.from('billing_events').insert({
      user_id: input.userId,
      event_type: input.eventType,
      metadata
    });
  } catch (err) {
    console.error('billing event log error', err);
  }
}

function getResendConfig(): ResendConfig {
  const enabled = Boolean(BILLING_EMAIL_ENABLED && RESEND_API_KEY && BILLING_EMAIL_FROM);
  return {
    enabled,
    apiKey: RESEND_API_KEY,
    from: BILLING_EMAIL_FROM,
    replyTo: BILLING_EMAIL_REPLY_TO || null
  };
}

async function maybeSendBillingEmail(input: BillingEventInput): Promise<EmailResult> {
  if (!input.sendEmail) return { attempted: false, sent: false };
  const config = getResendConfig();
  if (!config.enabled) return { attempted: false, sent: false };
  if (!input.email) return { attempted: false, sent: false, error: 'missing_email' };

  const { subject, text } = buildBillingEmailContent(input);
  if (!subject || !text) return { attempted: false, sent: false, error: 'unsupported_event' };

  try {
    const result = await sendResendEmail(config, input.email, subject, text);
    return result;
  } catch (err: any) {
    return { attempted: true, sent: false, error: err?.message || 'send_failed' };
  }
}

function buildBillingEmailContent(input: BillingEventInput) {
  const dateLabel = formatDate(input.currentPeriodEnd);
  const accountUrl = `${getSiteUrl()}/account`;

  if (input.eventType === 'subscription_cancel_requested') {
    const statusLine = dateLabel
      ? `Your access stays active until ${dateLabel}.`
      : 'Your access stays active until the end of your current billing period.';
    return {
      subject: `Your ${BRAND_NAME} subscription will cancel`,
      text: `This confirms your cancellation request.\n\n${statusLine}\n\nManage billing: ${accountUrl}`
    };
  }

  if (input.eventType === 'subscription_resumed') {
    const statusLine = dateLabel ? `Your subscription will renew on ${dateLabel}.` : 'Your subscription is active again.';
    return {
      subject: `Your ${BRAND_NAME} subscription was resumed`,
      text: `${statusLine}\n\nManage billing: ${accountUrl}`
    };
  }

  if (input.eventType === 'subscription_canceled') {
    return {
      subject: `Your ${BRAND_NAME} subscription is canceled`,
      text: `Your subscription is canceled and will not renew.\n\nManage billing: ${accountUrl}`
    };
  }

  return { subject: '', text: '' };
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

async function sendResendEmail(config: ResendConfig, to: string, subject: string, text: string): Promise<EmailResult> {
  try {
    await sendResendEmailApi({
      apiKey: config.apiKey,
      from: config.from,
      to,
      subject,
      text,
      replyTo: config.replyTo
    });
    return { attempted: true, sent: true };
  } catch (err: any) {
    return { attempted: true, sent: false, error: err?.message || 'send_failed' };
  }
}
