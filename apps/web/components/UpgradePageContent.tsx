'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { PremiumClaimV1 } from '@tminuszero/api-client';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { browserApiClient } from '@/lib/api/client';
import { WebBillingAdapterError } from '@/lib/api/webBillingAdapters';
import { useBillingCatalogQuery, useStartBillingCheckoutMutation, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/lib/api/queries';

const FEATURES = [
  'Adaptive live updates',
  'Full change log (see what changed)',
  'Saved/default filters + follows (“My Launches”)',
  'Advanced alerts + native push notifications',
  'Recurring calendar feeds (.ics) from presets, follows, or all future launches',
  'RSS + Atom feeds for any filtered feed',
  'Embeddable “Next launch” widget (token link)',
  'Enhanced forecast insights (select launches)',
  'AR trajectory overlay'
];

const SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS = 20;
const SUBSCRIPTION_CONFIRMATION_RETRY_MS = 1500;

function appendPremiumStatus(path: string, status: 'welcome' | 'payment_issue') {
  const safePath = sanitizeReturnToPath(path, '/account');

  try {
    const url = new URL(safePath, 'https://upgrade.local');
    url.searchParams.set('premium', status);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/account?premium=${status}`;
  }
}

function isAccountReturnPath(path: string) {
  const safePath = sanitizeReturnToPath(path, '/account');
  try {
    const url = new URL(safePath, 'https://upgrade.local');
    return url.pathname === '/account';
  } catch {
    return safePath === '/account';
  }
}

function appendClaimToken(href: string, claimToken: string | null) {
  if (!claimToken) {
    return href;
  }

  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}claim_token=${encodeURIComponent(claimToken)}`;
}

export function UpgradePageContent() {
  const searchParams = useSearchParams();
  const { data: viewerSession, isPending: viewerSessionPending } = useViewerSessionQuery();
  const {
    data: entitlements,
    isPending: entitlementsPending,
    refetch: refetchEntitlements
  } = useViewerEntitlementsQuery();
  const billingCatalogQuery = useBillingCatalogQuery('web');
  const startBillingCheckoutMutation = useStartBillingCheckoutMutation();
  const returnTo = sanitizeReturnToPath(searchParams.get('return_to'), '/account');
  const canceled = searchParams.get('checkout') === 'cancel';
  const succeeded = searchParams.get('checkout') === 'success';
  const autostart = searchParams.get('autostart') === '1';
  const claimToken = String(searchParams.get('claim_token') || '').trim() || null;
  const [subscriptionState, setSubscriptionState] = useState<'idle' | 'checking' | 'paid' | 'unpaid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [autostarted, setAutostarted] = useState(false);
  const [claim, setClaim] = useState<PremiumClaimV1 | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(Boolean(claimToken));
  const [attachingClaim, setAttachingClaim] = useState(false);
  const signInHref = buildAuthHref('sign-in', { returnTo, intent: 'upgrade' });
  const claimSignInHref = useMemo(
    () =>
      appendClaimToken(
        buildAuthHref('sign-in', {
          returnTo,
          intent: 'upgrade'
        }),
        claimToken
      ),
    [claimToken, returnTo]
  );
  const claimSignUpHref = claimToken
    ? `/auth/sign-up?${new URLSearchParams({
        claim_token: claimToken,
        return_to: returnTo,
        intent: 'upgrade'
      }).toString()}`
    : null;
  const successReturnTo = isAccountReturnPath(returnTo) ? appendPremiumStatus(returnTo, 'welcome') : returnTo;
  const paymentIssueReturnTo = appendPremiumStatus('/account', 'payment_issue');
  const authStatus: 'loading' | 'authed' | 'guest' =
    viewerSessionPending && !viewerSession
      ? 'loading'
      : viewerSession?.viewerId
        ? 'authed'
        : 'guest';
  const isPaid = entitlements?.isPaid === true;
  const busy = startBillingCheckoutMutation.isPending;
  const webOffers = useMemo(
    () =>
      (billingCatalogQuery.data?.products[0]?.offers ?? []).filter(
        (offer) => offer.provider === 'stripe' && Boolean(offer.promotionCode)
      ),
    [billingCatalogQuery.data]
  );

  const refreshClaim = useCallback(async () => {
    if (!claimToken) {
      setClaim(null);
      setClaimError(null);
      setClaimLoading(false);
      return null;
    }

    setClaimLoading(true);
    try {
      const payload = await browserApiClient.getPremiumClaim(claimToken);
      setClaim(payload.claim);
      setClaimError(null);
      return payload.claim;
    } catch (err) {
      console.error('premium claim lookup error', err);
      setClaimError(err instanceof Error ? err.message : 'Unable to check your Premium claim.');
      return null;
    } finally {
      setClaimLoading(false);
    }
  }, [claimToken]);

  const startCheckout = useCallback(async (promotionCode?: string | null) => {
    if (busy) return;
    setError(null);

    try {
      const payload = await startBillingCheckoutMutation.mutateAsync({
        returnTo,
        promotionCode: promotionCode ?? undefined
      });
      if (!payload?.url) {
        throw new Error('checkout_failed');
      }
      window.location.href = payload.url;
    } catch (err) {
      if (err instanceof WebBillingAdapterError) {
        if (err.code === 'already_subscribed') {
          window.location.replace(err.returnTo || returnTo);
          return;
        }
        if (err.code === 'payment_issue') {
          window.location.replace(paymentIssueReturnTo);
          return;
        }
      }

      console.error('checkout error', err);
      setError('Unable to start checkout.');
    }
  }, [busy, paymentIssueReturnTo, returnTo, startBillingCheckoutMutation]);

  const attachClaim = useCallback(async () => {
    if (!claimToken || attachingClaim) return;
    setError(null);
    setAttachingClaim(true);

    try {
      const payload = await browserApiClient.attachPremiumClaim(claimToken);
      setClaim(payload.claim);
      await refetchEntitlements();
      window.location.replace(payload.returnTo);
    } catch (err) {
      console.error('premium claim attach error', err);
      setError(err instanceof Error ? err.message : 'Unable to attach this Premium purchase.');
    } finally {
      setAttachingClaim(false);
    }
  }, [attachingClaim, claimToken, refetchEntitlements]);

  useEffect(() => {
    if (!claimToken) {
      setClaim(null);
      setClaimError(null);
      setClaimLoading(false);
      return;
    }

    let active = true;
    let timeoutId: number | null = null;
    let attempts = 0;

    const pollClaim = async () => {
      if (!active) return;
      const nextClaim = await refreshClaim();
      if (!active || !nextClaim) return;

      if (nextClaim.status === 'pending' && attempts < SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS) {
        attempts += 1;
        timeoutId = window.setTimeout(pollClaim, SUBSCRIPTION_CONFIRMATION_RETRY_MS);
      }
    };

    void pollClaim();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [claimToken, refreshClaim, succeeded]);

  useEffect(() => {
    if (authStatus !== 'authed') {
      setSubscriptionState('idle');
      return;
    }

    if (isPaid) {
      setSubscriptionState('paid');
      if (succeeded) {
        window.location.replace(successReturnTo);
      }
      return;
    }

    if (!succeeded) {
      setSubscriptionState(entitlementsPending && !entitlements ? 'checking' : 'unpaid');
      return;
    }

    let active = true;
    let timeoutId: number | null = null;
    let attempts = 0;

    const checkEntitlements = async () => {
      if (!active) return;
      setSubscriptionState('checking');

      try {
        const result = await refetchEntitlements();
        if (!active) return;

        if (result.data?.isPaid === true) {
          setSubscriptionState('paid');
          window.location.replace(successReturnTo);
          return;
        }
      } catch (err) {
        if (!active) return;
        console.warn('entitlement check warning', err);
      }

      attempts += 1;
      if (attempts < SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(checkEntitlements, SUBSCRIPTION_CONFIRMATION_RETRY_MS);
        return;
      }

      setSubscriptionState('unpaid');
    };

    void checkEntitlements();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [authStatus, entitlements, entitlementsPending, isPaid, refetchEntitlements, succeeded, successReturnTo]);

  useEffect(() => {
    if (!autostart || autostarted) return;
    if (canceled || succeeded) return;
    if (claimToken) return;
    if (authStatus === 'loading') return;
    if (authStatus === 'authed' && subscriptionState === 'paid') return;
    setAutostarted(true);

    void startCheckout();
  }, [authStatus, autostart, autostarted, canceled, claimToken, startCheckout, subscriptionState, succeeded]);

  const showVerifiedGuestClaim = claim?.status === 'verified' && authStatus === 'guest';
  const showVerifiedAuthedClaim = claim?.status === 'verified' && authStatus === 'authed' && !isPaid;
  const showClaimedGuestNotice = claim?.status === 'claimed' && authStatus === 'guest';
  const showPendingClaimNotice = claim?.status === 'pending';
  const showClaimStatusCard = Boolean(claimToken && (claimLoading || claimError || claim || succeeded));

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col gap-6 px-4 py-12 md:px-6">
      <div>
        <h1 className="text-3xl font-semibold text-text1">Upgrade to Premium</h1>
        <p className="mt-1 text-text2">Unlock live data, saved filters and follows, advanced alerts, and recurring feed integrations.</p>
      </div>

      {showClaimStatusCard ? (
        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-text2">
          {claimLoading
            ? 'Checking your Premium claim…'
            : claimError
              ? claimError
              : showPendingClaimNotice
                ? 'Checkout completed. We are still verifying your Premium purchase. This page will refresh automatically for a short time.'
                : showVerifiedGuestClaim
                  ? 'Premium is verified. Sign in to an existing account or create one now to claim it.'
                  : showVerifiedAuthedClaim
                    ? 'Premium is verified for this purchase. Attach it to the account currently signed in here.'
                    : showClaimedGuestNotice
                      ? 'This Premium purchase is already attached to an account. Sign in to manage it.'
                      : claim?.status === 'claimed'
                        ? 'Premium is already attached. Redirecting you back now if billing is active.'
                        : 'Premium checkout completed.'}
          {showVerifiedGuestClaim ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Link className="btn rounded-lg px-4 py-2 text-sm" href={claimSignInHref}>
                Sign in to claim Premium
              </Link>
              {claimSignUpHref ? (
                <Link className="btn-secondary rounded-lg px-4 py-2 text-sm" href={claimSignUpHref}>
                  Create account to claim Premium
                </Link>
              ) : null}
            </div>
          ) : null}
          {showVerifiedAuthedClaim ? (
            <div className="mt-3">
              <button className="btn rounded-lg px-4 py-2 text-sm" onClick={() => void attachClaim()} disabled={attachingClaim}>
                {attachingClaim ? 'Attaching Premium…' : 'Attach Premium to this account'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!claimToken && succeeded && (
        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-text2">
          {subscriptionState === 'unpaid'
            ? 'Checkout completed. We are still confirming your subscription. Refresh this page in a moment if you are not redirected.'
            : 'Subscription active. Redirecting you back now.'}
        </div>
      )}

      {canceled && (
        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-text2">
          Checkout canceled. You can resume anytime.
        </div>
      )}

      {authStatus === 'authed' && subscriptionState === 'paid' && (
        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-text2">
          Premium is already active. Continue to{' '}
          <Link className="text-primary hover:underline" href={returnTo}>
            your destination
          </Link>
          .
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-5">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Premium</div>
          <div className="mt-2 text-3xl font-semibold text-text1">
            $3.99<span className="text-base text-text3">/mo</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-text2">
            {FEATURES.map((feature) => (
              <li key={feature}>• {feature}</li>
            ))}
          </ul>
          {webOffers.length > 0 ? (
            <div className="mt-4 space-y-2 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Active web offers</div>
              {webOffers.map((offer) => (
                <div key={offer.offerKey} className="rounded-lg border border-stroke bg-surface-1 px-3 py-3 text-sm text-text2">
                  <div className="text-text1">{offer.label}</div>
                  {offer.eligibilityHint ? <div className="mt-1 text-xs text-text3">{offer.eligibilityHint}</div> : null}
                  {offer.promotionCode ? <div className="mt-1 font-mono text-xs text-text3">Code: {offer.promotionCode}</div> : null}
                  <button
                    className="btn-secondary mt-3 rounded-lg px-3 py-2 text-xs"
                    onClick={() => void startCheckout(offer.promotionCode)}
                    disabled={busy || subscriptionState === 'checking' || subscriptionState === 'paid'}
                  >
                    {busy ? 'Starting checkout…' : 'Start with this offer'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {authStatus === 'authed' ? (
            <button
              className="btn mt-5 w-full rounded-lg"
              onClick={() => void startCheckout(webOffers.length === 1 ? webOffers[0]?.promotionCode ?? null : null)}
              disabled={busy || subscriptionState === 'checking' || subscriptionState === 'paid'}
            >
              {subscriptionState === 'checking'
                ? 'Checking plan…'
                : busy
                  ? 'Starting checkout…'
                  : subscriptionState === 'paid'
                    ? 'Premium active'
                  : 'Start Premium'}
            </button>
          ) : (
            <div className="mt-5 flex flex-col gap-2">
              <button
                className="btn w-full rounded-lg px-4 py-2 text-sm"
                onClick={() => void startCheckout(webOffers.length === 1 ? webOffers[0]?.promotionCode ?? null : null)}
                disabled={busy}
              >
                {busy ? 'Starting checkout…' : 'Start Premium'}
              </button>
              <Link className="btn-secondary w-full rounded-lg px-4 py-2 text-sm" href={signInHref}>
                Sign in to existing account
              </Link>
            </div>
          )}
          <p className="mt-3 text-xs text-text3">
            Renews monthly until canceled. Cancel anytime from{' '}
            <Link className="text-primary hover:underline" href={buildProfileHref()}>
              Account
            </Link>
            . By subscribing, you agree to the{' '}
            <Link className="text-primary hover:underline" href="/legal/terms">
              Terms
            </Link>{' '}
            and{' '}
            <Link className="text-primary hover:underline" href="/legal/privacy">
              Privacy Policy
            </Link>
            .
          </p>
          {error && <div className="mt-3 text-xs text-danger">{error}</div>}
        </div>
        <div className="rounded-2xl border border-stroke bg-surface-1 p-5">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Public access</div>
          <div className="mt-2 text-3xl font-semibold text-text1">$0</div>
          <ul className="mt-4 space-y-2 text-sm text-text2">
            <li>• Public launch schedule browsing</li>
            <li>• Public filters and calendar browsing</li>
            <li>• Weather forecast (NWS, when available)</li>
          </ul>
          <p className="mt-5 text-sm text-text3">
            Keep browsing without an account. Sign in later for account ownership and billing access, or upgrade when you want Premium features.
          </p>
        </div>
      </div>
    </div>
  );
}
