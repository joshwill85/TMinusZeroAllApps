import { BRAND_NAME, CANONICAL_HOST, SUPPORT_EMAIL } from '@/lib/brand';

export const SMS_CONSENT_VERSION = '2026-01-15';

export function prefixSmsWithBrand(body: string) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return `${BRAND_NAME}:`;
  const prefix = `${BRAND_NAME}: `;
  if (trimmed.startsWith(prefix) || trimmed === `${BRAND_NAME}:`) return trimmed;
  return `${prefix}${trimmed}`;
}

export function buildSmsOptInConfirmationMessage() {
  return `${BRAND_NAME} SMS alerts enabled. Msg freq varies. Message and data rates may apply. Reply STOP to cancel, HELP for help. Support: ${SUPPORT_EMAIL}.`;
}

export function buildSmsStopMessage() {
  return `You are unsubscribed from ${BRAND_NAME} alerts. You will not receive any more messages. Reply START to resubscribe.`;
}

export function buildSmsStartMessage() {
  return `${BRAND_NAME} alerts: subscribed. Message and data rates may apply. Reply STOP to cancel, HELP for help. Manage: https://${CANONICAL_HOST}/me/preferences.`;
}

export function buildSmsHelpMessage() {
  return `${BRAND_NAME} alerts. Msg freq varies. Message and data rates may apply. Reply STOP to cancel. Support: ${SUPPORT_EMAIL}.`;
}
