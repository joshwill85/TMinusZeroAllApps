'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { getBrowserClient } from '@/lib/api/supabase';
import { withAuthQuery } from '@/lib/utils/returnTo';

const FEATURES = [
  'Live updates every 15 seconds',
  'Full change log (see what changed)',
  'Watchlists (“My Launches”) + saved presets',
  'Alerts (email + browser notifications)',
  'Calendar exports + subscriptions (.ics) with filters and optional reminders',
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

export function UpgradePageContent() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnToPath(searchParams.get('return_to'), '/account');
  const canceled = searchParams.get('checkout') === 'cancel';
  const succeeded = searchParams.get('checkout') === 'success';
  const autostart = searchParams.get('autostart') === '1';
  const [authStatus, setAuthStatus] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [subscriptionState, setSubscriptionState] = useState<'idle' | 'checking' | 'paid' | 'unpaid'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autostarted, setAutostarted] = useState(false);
  const signInHref = withAuthQuery('/auth/sign-in', { returnTo, intent: 'upgrade' });
  const signUpHref = withAuthQuery('/auth/sign-up', { returnTo, intent: 'upgrade' });
  const successReturnTo = isAccountReturnPath(returnTo) ? appendPremiumStatus(returnTo, 'welcome') : returnTo;
  const paymentIssueReturnTo = appendPremiumStatus('/account', 'payment_issue');

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setAuthStatus('guest');
      return;
    }
    let active = true;
    supabase.auth
      .getUser()
      .then((result: any) => {
        if (!active) return;
        setAuthStatus(result?.data?.user ? 'authed' : 'guest');
      })
      .catch(() => {
        if (!active) return;
        setAuthStatus('guest');
      });
    return () => {
      active = false;
    };
  }, []);

  const startCheckout = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.url) {
        window.location.href = json.url;
        return;
      }
      if (json?.error === 'already_subscribed') {
        window.location.replace(json?.returnTo || returnTo);
        return;
      }
      if (json?.error === 'payment_issue') {
        window.location.replace(paymentIssueReturnTo);
        return;
      }
      throw new Error(json?.error || 'checkout_failed');
    } catch (err) {
      console.error('checkout error', err);
      setError('Unable to start checkout.');
    } finally {
      setBusy(false);
    }
  }, [busy, paymentIssueReturnTo, returnTo]);

  useEffect(() => {
    if (authStatus !== 'authed') {
      setSubscriptionState('idle');
      return;
    }

    let active = true;
    let timeoutId: number | null = null;
    let attempts = 0;

    const checkSubscription = async () => {
      if (!active) return;
      setSubscriptionState('checking');

      try {
        const res = await fetch('/api/me/subscription', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;

        if (res.ok && json?.isPaid) {
          setSubscriptionState('paid');
          window.location.replace(succeeded ? successReturnTo : returnTo);
          return;
        }
      } catch (err) {
        if (!active) return;
        console.warn('subscription check warning', err);
      }

      attempts += 1;
      if (succeeded && attempts < SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(checkSubscription, SUBSCRIPTION_CONFIRMATION_RETRY_MS);
        return;
      }

      setSubscriptionState('unpaid');
    };

    checkSubscription().catch(() => undefined);

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [authStatus, returnTo, succeeded, successReturnTo]);

  useEffect(() => {
    if (!autostart || autostarted) return;
    if (canceled || succeeded) return;
    if (authStatus !== 'authed' || subscriptionState !== 'unpaid') return;
    setAutostarted(true);

    startCheckout().catch(() => undefined);
  }, [authStatus, autostart, autostarted, canceled, startCheckout, subscriptionState, succeeded]);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col gap-6 px-4 py-12 md:px-6">
      <div>
        <h1 className="text-3xl font-semibold text-text1">Upgrade to Premium</h1>
        <p className="mt-1 text-text2">Unlock live data, alerts, watchlists, and feed integrations (calendar + RSS/Atom).</p>
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
          <div className="mt-2 text-3xl font-semibold text-text1">$3.99<span className="text-base text-text3">/mo</span></div>
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
            <Link className="text-primary hover:underline" href="/account">
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
          <div className="mt-5 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text3">
            You can upgrade anytime.
          </div>
        </div>
      </div>
    </div>
  );
}
