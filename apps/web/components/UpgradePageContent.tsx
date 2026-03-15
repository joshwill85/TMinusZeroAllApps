'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { WebBillingAdapterError } from '@/lib/api/webBillingAdapters';
import { useStartBillingCheckoutMutation, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/lib/api/queries';

const FEATURES = [
  'Live updates every 15 seconds',
  'Full change log (see what changed)',
  'Saved/default filters + follows (“My Launches”)',
  'Advanced alerts + browser notifications',
  'Recurring calendar feeds (.ics) from presets, follows, or all future launches',
  'RSS + Atom feeds for any filtered feed',
  'Embeddable “Next launch” widget (token link)',
  'Enhanced forecast insights (select launches)',
  'Launch-day email + AR trajectory overlay'
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

export function UpgradePageContent() {
  const searchParams = useSearchParams();
  const { data: viewerSession, isPending: viewerSessionPending } = useViewerSessionQuery();
  const {
    data: entitlements,
    isPending: entitlementsPending,
    refetch: refetchEntitlements
  } = useViewerEntitlementsQuery();
  const startBillingCheckoutMutation = useStartBillingCheckoutMutation();
  const returnTo = sanitizeReturnToPath(searchParams.get('return_to'), '/account');
  const canceled = searchParams.get('checkout') === 'cancel';
  const succeeded = searchParams.get('checkout') === 'success';
  const autostart = searchParams.get('autostart') === '1';
  const [subscriptionState, setSubscriptionState] = useState<'idle' | 'checking' | 'paid' | 'unpaid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [autostarted, setAutostarted] = useState(false);
  const signInHref = buildAuthHref('sign-in', { returnTo, intent: 'upgrade' });
  const signUpHref = buildAuthHref('sign-up', { returnTo, intent: 'upgrade' });
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

  const startCheckout = useCallback(async () => {
    if (busy) return;
    setError(null);

    try {
      const payload = await startBillingCheckoutMutation.mutateAsync(returnTo);
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
    if (authStatus !== 'authed' || subscriptionState !== 'unpaid') return;
    setAutostarted(true);

    void startCheckout();
  }, [authStatus, autostart, autostarted, canceled, startCheckout, subscriptionState, succeeded]);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col gap-6 px-4 py-12 md:px-6">
      <div>
        <h1 className="text-3xl font-semibold text-text1">Upgrade to Premium</h1>
        <p className="mt-1 text-text2">Unlock live data, saved filters/follows, browser alerts, and recurring feed integrations.</p>
      </div>

      {succeeded && (
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
          {authStatus === 'authed' ? (
            <button
              className="btn mt-5 w-full rounded-lg"
              onClick={startCheckout}
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
              <Link className="btn w-full rounded-lg px-4 py-2 text-sm" href={signInHref}>
                Sign in
              </Link>
              <Link className="btn-secondary w-full rounded-lg px-4 py-2 text-sm" href={signUpHref}>
                Create free account
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
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Free</div>
          <div className="mt-2 text-3xl font-semibold text-text1">$0</div>
          <ul className="mt-4 space-y-2 text-sm text-text2">
            <li>• Cached launch schedule (15 minute updates)</li>
            <li>• Basic filters</li>
            <li>• Weather forecast (NWS, when available)</li>
          </ul>
          <p className="mt-5 text-sm text-text3">
            Keep browsing for free. Upgrade when you want live data, saved/default filters, follows, browser alerts, and recurring integrations.
          </p>
        </div>
      </div>
    </div>
  );
}
