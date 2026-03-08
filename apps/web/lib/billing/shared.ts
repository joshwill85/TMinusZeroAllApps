const PAID_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const BILLABLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export function normalizeSubscriptionStatus(status: string | null | undefined) {
  return String(status || '')
    .trim()
    .toLowerCase();
}

export function isPaidSubscriptionStatus(status: string | null | undefined) {
  return PAID_SUBSCRIPTION_STATUSES.has(normalizeSubscriptionStatus(status));
}

export function isBillableSubscriptionStatus(status: string | null | undefined) {
  return BILLABLE_SUBSCRIPTION_STATUSES.has(normalizeSubscriptionStatus(status));
}

export function sanitizeReturnToPath(value: string | null | undefined, fallback = '/account') {
  const trimmed = String(value || '').trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'https://billing.local');
    if (parsed.origin !== 'https://billing.local') {
      return fallback;
    }
    if (parsed.pathname === '/upgrade') {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
