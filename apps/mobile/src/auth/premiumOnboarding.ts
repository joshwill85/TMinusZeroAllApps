import { sanitizeReturnTo, withAuthQuery, type AuthRouteMode } from '@tminuszero/navigation';

function normalizeReturnToPath(value: string | null | undefined, fallback: string) {
  return sanitizeReturnTo(value, fallback);
}

export function buildMobilePremiumCheckoutReturnTo(returnTo?: string | null) {
  const safeReturnTo = normalizeReturnToPath(returnTo, '/account/membership');

  try {
    const url = new URL(safeReturnTo, 'https://mobile.local');
    url.searchParams.set('autostart', '1');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/account/membership?autostart=1';
  }
}

export function buildMobilePremiumLegalHref({
  returnTo,
  intentId
}: {
  returnTo?: string | null;
  intentId?: string | null;
}) {
  const safeReturnTo = normalizeReturnToPath(returnTo, '/account/membership');
  const params = new URLSearchParams({
    return_to: safeReturnTo
  });

  const normalizedIntentId = String(intentId || '').trim();
  if (normalizedIntentId) {
    params.set('intent_id', normalizedIntentId);
  }

  return `/premium-onboarding/legal?${params.toString()}`;
}

export function buildMobilePremiumUpgradeAuthHref(
  mode: AuthRouteMode,
  {
    returnTo,
    claimToken
  }: {
    returnTo?: string | null;
    claimToken?: string | null;
  } = {}
) {
  const route = mode === 'sign-up' ? '/sign-up' : '/sign-in';
  return withAuthQuery(route, {
    returnTo: normalizeReturnToPath(returnTo, '/account/membership'),
    intent: 'upgrade',
    claimToken: String(claimToken || '').trim() || null
  });
}
