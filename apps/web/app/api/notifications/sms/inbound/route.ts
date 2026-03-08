import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { buildSmsHelpMessage, buildSmsStartMessage, buildSmsStopMessage } from '@/lib/notifications/smsProgram';
import { logSmsConsentEvent } from '@/lib/server/smsConsentEvents';
import { normalizeSmsKeyword, SMS_HELP_KEYWORDS, SMS_START_KEYWORDS, SMS_STOP_KEYWORDS } from '@/lib/notifications/smsKeywords';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STOP_KEYWORDS = new Set(SMS_STOP_KEYWORDS);
const START_KEYWORDS = new Set(SMS_START_KEYWORDS);
const HELP_KEYWORDS = new Set(SMS_HELP_KEYWORDS);
const OPT_OUT_MODE = (process.env.TWILIO_OPT_OUT_MODE || 'twilio').trim().toLowerCase();
const SHOULD_REPLY = OPT_OUT_MODE === 'app';

function buildTwiml(message?: string) {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

function getTwilioSignatureUrl(request: Request) {
  try {
    const url = new URL(request.url);
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.split(',')[0]?.trim();
    if (proto && host) return `${proto}://${host}${url.pathname}${url.search}`;
  } catch {
    // ignore
  }
  return request.url;
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!authToken) return NextResponse.json({ error: 'twilio_not_configured' }, { status: 501 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    params[key] = typeof value === 'string' ? value : '';
  }

  const valid = twilio.validateRequest(authToken, signature, getTwilioSignatureUrl(request), params);
  if (!valid) return NextResponse.json({ error: 'invalid_signature' }, { status: 403 });

  const from = (params.From || '').trim();
  const body = (params.Body || '').trim();
  const keyword = normalizeSmsKeyword(body);
  const optOutTypeRaw = (params.OptOutType || '').trim().toUpperCase();
  const optOutType = optOutTypeRaw === 'STOP' || optOutTypeRaw === 'START' || optOutTypeRaw === 'HELP' ? optOutTypeRaw : '';

  if (!from) {
    return new Response(buildTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  if (optOutType === 'STOP' || STOP_KEYWORDS.has(keyword)) {
    const updateRes = await admin
      .from('notification_preferences')
      .update({ sms_enabled: false, sms_opt_out_at: now, updated_at: now })
      .eq('sms_phone_e164', from)
      .select('user_id');
    if (updateRes.error) console.warn('sms inbound stop update warning', updateRes.error.message);

    const userIds = (updateRes.data || []).map((row: any) => String(row.user_id || '')).filter(Boolean);
    if (userIds.length) {
      for (const userId of userIds) {
        await logSmsConsentEvent(admin, { userId, phoneE164: from, action: 'keyword_stop', request, source: 'sms_inbound', meta: { keyword, optOutType } });
      }
    } else {
      await logSmsConsentEvent(admin, { userId: null, phoneE164: from, action: 'keyword_stop', request, source: 'sms_inbound', meta: { keyword, optOutType } });
    }
    return new Response(buildTwiml(SHOULD_REPLY ? buildSmsStopMessage() : undefined), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });
  }

  if (optOutType === 'START' || START_KEYWORDS.has(keyword)) {
    const updateRes = await admin
      .from('notification_preferences')
      .update({ sms_enabled: true, sms_opt_in_at: now, sms_opt_out_at: null, updated_at: now })
      .eq('sms_phone_e164', from)
      .select('user_id');
    if (updateRes.error) console.warn('sms inbound start update warning', updateRes.error.message);

    const userIds = (updateRes.data || []).map((row: any) => String(row.user_id || '')).filter(Boolean);
    if (userIds.length) {
      for (const userId of userIds) {
        await logSmsConsentEvent(admin, { userId, phoneE164: from, action: 'keyword_start', request, source: 'sms_inbound', meta: { keyword, optOutType } });
      }
    } else {
      await logSmsConsentEvent(admin, { userId: null, phoneE164: from, action: 'keyword_start', request, source: 'sms_inbound', meta: { keyword, optOutType } });
    }
    return new Response(buildTwiml(SHOULD_REPLY ? buildSmsStartMessage() : undefined), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });
  }

  if (optOutType === 'HELP' || HELP_KEYWORDS.has(keyword)) {
    const lookupRes = await admin.from('notification_preferences').select('user_id').eq('sms_phone_e164', from);
    if (lookupRes.error) console.warn('sms inbound help lookup warning', lookupRes.error.message);

    const userIds = (lookupRes.data || []).map((row: any) => String(row.user_id || '')).filter(Boolean);
    if (userIds.length) {
      for (const userId of userIds) {
        await logSmsConsentEvent(admin, { userId, phoneE164: from, action: 'keyword_help', request, source: 'sms_inbound', meta: { keyword, optOutType } });
      }
    } else {
      await logSmsConsentEvent(admin, { userId: null, phoneE164: from, action: 'keyword_help', request, source: 'sms_inbound', meta: { keyword, optOutType } });
    }
    return new Response(
      buildTwiml(SHOULD_REPLY ? buildSmsHelpMessage() : undefined),
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }

  return new Response(buildTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
