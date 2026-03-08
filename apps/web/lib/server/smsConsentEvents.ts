import { isIP } from 'node:net';
import { SMS_CONSENT_VERSION } from '@/lib/notifications/smsProgram';

export type SmsConsentAction =
  | 'web_opt_in'
  | 'web_opt_out'
  | 'verify_requested'
  | 'verify_approved'
  | 'keyword_stop'
  | 'keyword_start'
  | 'keyword_help'
  | 'twilio_opt_out_error';

function getClientIp(request: Request) {
  const header = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  const first = header.split(',')[0]?.trim() || '';
  if (!first) return null;
  return isIP(first) ? first : null;
}

function getUserAgent(request: Request) {
  const ua = request.headers.get('user-agent')?.trim();
  return ua ? ua.slice(0, 500) : null;
}

export async function logSmsConsentEvent(
  supabase: any,
  {
    userId,
    phoneE164,
    action,
    request,
    source,
    consentVersion = SMS_CONSENT_VERSION,
    meta
  }: {
    userId?: string | null;
    phoneE164: string;
    action: SmsConsentAction;
    request?: Request;
    source?: string | null;
    consentVersion?: string | null;
    meta?: Record<string, unknown> | null;
  }
) {
  try {
    const ip = request ? getClientIp(request) : null;
    const userAgent = request ? getUserAgent(request) : null;
    const requestUrl = request?.url ? String(request.url).slice(0, 500) : null;
    const payload = {
      user_id: userId ?? null,
      phone_e164: phoneE164,
      action,
      source: source ?? null,
      consent_version: consentVersion ?? null,
      ip: ip ?? null,
      user_agent: userAgent ?? null,
      request_url: requestUrl ?? null,
      meta: meta ?? null
    };

    const { error } = await supabase.from('sms_consent_events').insert(payload);
    if (error) console.warn('sms_consent_events insert warning', error.message);
  } catch (err) {
    console.warn('sms_consent_events insert warning', err);
  }
}

