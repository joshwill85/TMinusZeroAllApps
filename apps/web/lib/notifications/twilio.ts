import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
const fromNumber = process.env.TWILIO_FROM_NUMBER;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

let cachedClient: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!accountSid || !authToken) return null;
  if (!cachedClient) cachedClient = twilio(accountSid, authToken);
  return cachedClient;
}

export function isTwilioSmsConfigured() {
  return Boolean(accountSid && authToken && (messagingServiceSid || fromNumber));
}

export function isTwilioVerifyConfigured() {
  return Boolean(accountSid && authToken && verifyServiceSid);
}

export async function sendSmsMessage(to: string, body: string) {
  const client = getClient();
  if (!client) throw new Error('twilio_not_configured');

  const payload: { to: string; body: string; messagingServiceSid?: string; from?: string } = { to, body };
  if (messagingServiceSid) payload.messagingServiceSid = messagingServiceSid;
  if (!messagingServiceSid && fromNumber) payload.from = fromNumber;

  if (!payload.messagingServiceSid && !payload.from) {
    throw new Error('twilio_sender_not_configured');
  }

  return client.messages.create(payload);
}

export async function startSmsVerification(to: string) {
  const client = getClient();
  if (!client || !verifyServiceSid) throw new Error('twilio_verify_not_configured');
  return client.verify.v2.services(verifyServiceSid).verifications.create({ to, channel: 'sms' });
}

export async function checkSmsVerification(to: string, code: string) {
  const client = getClient();
  if (!client || !verifyServiceSid) throw new Error('twilio_verify_not_configured');
  return client.verify.v2.services(verifyServiceSid).verificationChecks.create({ to, code });
}
