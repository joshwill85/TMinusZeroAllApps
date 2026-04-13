'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PremiumClaimV1 } from '@tminuszero/api-client';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { browserApiClient } from '@/lib/api/client';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';
import { WebBillingAdapterError } from '@/lib/api/webBillingAdapters';
import {
  useBillingCatalogQuery,
  useStartBillingCheckoutMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';

const CTA_LABEL = 'Upgrade to Premium';
const PRICE_LABEL = '$3.99/mo';
const PRODUCT_SCREENSHOT_SRC =
  '/assets/images/upgrade/premium-launch-detail-screenshot.png';

const HERO_BULLETS = [
  'See launch changes in seconds, not hours',
  'Get native mobile alerts for launches you follow',
  'Keep watchlists, presets, calendar feeds, RSS feeds, and widgets in one place'
] as const;

const BENEFIT_BLOCKS = [
  {
    title: 'Be first when plans move',
    body: 'Free browsing is right for checking the manifest. Premium is for the launches you are actually planning around, with 15-second refreshes and a full change log that shows what moved instead of making you guess.',
    detail:
      'Best for launch-day tracking, NET shifts, HOLD/SCRUB follow-up, and live timeline awareness.'
  },
  {
    title: 'Get alerts that matter',
    body: 'Premium expands the alert system where it actually lives today: the native iPhone and Android apps. Follow the launches and contexts you care about, then use premium reminder windows, status-change alerts, and NET-change alerts to stop checking back all day.',
    detail:
      'Important repo truth: web no longer manages push alerts directly; Premium adds deeper native mobile alert control.'
  },
  {
    title: 'Build your own mission control',
    body: 'Save watchlists and filter presets, keep recurring calendar and RSS/Atom feeds running, and manage embeddable widgets from the same Premium workflow so the launches you care about stay in front of you.',
    detail:
      'This is where the marketer direction is right, but the repo is ahead of the draft: widgets already exist and should be sold as live, not “coming soon.”'
  }
] as const;

const INCLUDED_GROUPS = [
  {
    title: 'Live launch intelligence',
    items: [
      '15-second refresh cadence during active launch windows',
      'Launch detail refresh with live status context',
      'Full launch change log and timing history'
    ]
  },
  {
    title: 'Saved workflows',
    items: [
      'Watchlists and saved filter presets',
      'Durable follows and My Launches workflow',
      'Expanded saved-item limits across your account'
    ]
  },
  {
    title: 'Alerts and automation',
    items: [
      'Premium follow-based alerts on registered mobile devices',
      'Status-change and NET-change alerts',
      'Recurring calendar feeds plus private RSS/Atom feeds'
    ]
  },
  {
    title: 'Advanced tools',
    items: [
      'Embeddable next-launch widgets',
      'Enhanced forecast insights where available',
      'AR trajectory and rocket volatility tools where supported'
    ]
  }
] as const;

const FAQ_ITEMS = [
  {
    question: 'Is free still useful?',
    answer:
      'Yes. Public browsing, search, filters, launch calendar browsing, and one-off add-to-calendar stay valuable. Premium is the live layer for tracking, automation, and saved workflows.'
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes. Web subscriptions renew monthly until canceled, and you can cancel from Account at any time. Access stays active until the end of the current billing period.'
  },
  {
    question: 'Do I need Premium to add one launch to my calendar?',
    answer:
      'No. One-off add-to-calendar stays available. Premium is for recurring calendar feeds, private RSS/Atom feeds, and the broader saved workflow.'
  },
  {
    question: 'Are widgets available now?',
    answer:
      'Yes. The current repo already supports embeddable next-launch widgets for Premium accounts, so the upgrade page should position widgets as live rather than “coming soon.”'
  }
] as const;

const SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS = 20;
const SUBSCRIPTION_CONFIRMATION_RETRY_MS = 1500;

function appendPremiumStatus(
  path: string,
  status: 'welcome' | 'payment_issue'
) {
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

function buildUpgradeCheckoutReturnTo(path: string) {
  const safePath = sanitizeReturnToPath(path, '/account');
  return `/upgrade?${new URLSearchParams({
    autostart: '1',
    return_to: safePath
  }).toString()}`;
}

function buildPremiumOnboardingLegalHref(
  returnTo: string,
  intentId?: string | null
) {
  const params = new URLSearchParams({
    return_to: returnTo
  });
  if (intentId) {
    params.set('intent_id', intentId);
  }
  return `/premium-onboarding/legal?${params.toString()}`;
}

export function UpgradePageContent() {
  const searchParams = useSafeSearchParams();
  const { data: viewerSession, isPending: viewerSessionPending } =
    useViewerSessionQuery();
  const {
    data: entitlements,
    isPending: entitlementsPending,
    refetch: refetchEntitlements
  } = useViewerEntitlementsQuery();
  const billingCatalogQuery = useBillingCatalogQuery('web');
  const startBillingCheckoutMutation = useStartBillingCheckoutMutation();
  const returnTo = sanitizeReturnToPath(
    searchParams.get('return_to'),
    '/account'
  );
  const canceled = searchParams.get('checkout') === 'cancel';
  const succeeded = searchParams.get('checkout') === 'success';
  const autostart = searchParams.get('autostart') === '1';
  const claimToken =
    String(searchParams.get('claim_token') || '').trim() || null;
  const [subscriptionState, setSubscriptionState] = useState<
    'idle' | 'checking' | 'paid' | 'unpaid'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [autostarted, setAutostarted] = useState(false);
  const [claim, setClaim] = useState<PremiumClaimV1 | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(Boolean(claimToken));
  const [attachingClaim, setAttachingClaim] = useState(false);
  const [premiumOnboardingIntentId, setPremiumOnboardingIntentId] = useState<
    string | null
  >(null);
  const [premiumLegalRequired, setPremiumLegalRequired] = useState(false);
  const postAuthUpgradeReturnTo = useMemo(
    () => buildUpgradeCheckoutReturnTo(returnTo),
    [returnTo]
  );
  const signInHref = buildAuthHref('sign-in', {
    returnTo: postAuthUpgradeReturnTo,
    intent: 'upgrade'
  });
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
  const successReturnTo = isAccountReturnPath(returnTo)
    ? appendPremiumStatus(returnTo, 'welcome')
    : returnTo;
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
      setClaimError(
        err instanceof Error
          ? err.message
          : 'Unable to check your Premium claim.'
      );
      return null;
    } finally {
      setClaimLoading(false);
    }
  }, [claimToken]);

  const startCheckout = useCallback(
    async (promotionCode?: string | null) => {
      if (busy) return;
      setError(null);

      if (premiumLegalRequired) {
        window.location.assign(
          buildPremiumOnboardingLegalHref(
            postAuthUpgradeReturnTo,
            premiumOnboardingIntentId
          )
        );
        return;
      }

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
          if (err.code === 'auth_required') {
            window.location.assign(signInHref);
            return;
          }
          if (err.code === 'legal_acceptance_required') {
            window.location.assign(
              buildPremiumOnboardingLegalHref(
                postAuthUpgradeReturnTo,
                premiumOnboardingIntentId
              )
            );
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
    },
    [
      busy,
      paymentIssueReturnTo,
      postAuthUpgradeReturnTo,
      premiumLegalRequired,
      premiumOnboardingIntentId,
      returnTo,
      signInHref,
      startBillingCheckoutMutation
    ]
  );

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
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to attach this Premium purchase.'
      );
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

      if (
        nextClaim.status === 'pending' &&
        attempts < SUBSCRIPTION_CONFIRMATION_MAX_ATTEMPTS
      ) {
        attempts += 1;
        timeoutId = window.setTimeout(
          pollClaim,
          SUBSCRIPTION_CONFIRMATION_RETRY_MS
        );
      }
    };

    void pollClaim();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [claimToken, refreshClaim, succeeded]);

  useEffect(() => {
    if (authStatus !== 'authed' || claimToken) {
      setPremiumOnboardingIntentId(null);
      setPremiumLegalRequired(false);
      return;
    }

    let cancelled = false;
    void browserApiClient
      .createOrResumePremiumOnboardingIntent({
        platform: 'web',
        returnTo
      })
      .then((payload) => {
        if (cancelled) return;
        setPremiumOnboardingIntentId(payload.intent.intentId);
        setPremiumLegalRequired(payload.legal.requiresAcceptance);
      })
      .catch(() => {
        if (cancelled) return;
        setPremiumOnboardingIntentId(null);
        setPremiumLegalRequired(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authStatus, claimToken, returnTo]);

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
      setSubscriptionState(
        entitlementsPending && !entitlements ? 'checking' : 'unpaid'
      );
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
        timeoutId = window.setTimeout(
          checkEntitlements,
          SUBSCRIPTION_CONFIRMATION_RETRY_MS
        );
        return;
      }

      setSubscriptionState('unpaid');
    };

    void checkEntitlements();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [
    authStatus,
    entitlements,
    entitlementsPending,
    isPaid,
    refetchEntitlements,
    succeeded,
    successReturnTo
  ]);

  useEffect(() => {
    if (!autostart || autostarted) return;
    if (canceled || succeeded) return;
    if (claimToken) return;
    if (authStatus === 'loading') return;
    if (authStatus === 'authed' && subscriptionState === 'paid') return;
    if (authStatus === 'authed' && premiumLegalRequired) {
      setAutostarted(true);
      window.location.replace(
        buildPremiumOnboardingLegalHref(
          postAuthUpgradeReturnTo,
          premiumOnboardingIntentId
        )
      );
      return;
    }
    setAutostarted(true);

    void startCheckout();
  }, [
    authStatus,
    autostart,
    autostarted,
    canceled,
    claimToken,
    postAuthUpgradeReturnTo,
    premiumLegalRequired,
    premiumOnboardingIntentId,
    startCheckout,
    subscriptionState,
    succeeded
  ]);

  const showVerifiedGuestClaim =
    claim?.status === 'verified' && authStatus === 'guest';
  const showVerifiedAuthedClaim =
    claim?.status === 'verified' && authStatus === 'authed' && !isPaid;
  const showClaimedGuestNotice =
    claim?.status === 'claimed' && authStatus === 'guest';
  const showPendingClaimNotice = claim?.status === 'pending';
  const showClaimStatusCard = Boolean(
    claimToken && (claimLoading || claimError || claim || succeeded)
  );
  const offerPromotionCode =
    webOffers.length === 1 ? (webOffers[0]?.promotionCode ?? null) : null;

  function renderPrimaryAction() {
    if (showVerifiedAuthedClaim) {
      return (
        <button
          className="btn w-full rounded-2xl px-6 py-3 text-base sm:w-auto"
          onClick={() => void attachClaim()}
          disabled={attachingClaim}
        >
          {attachingClaim
            ? 'Attaching Premium…'
            : 'Attach Premium to this account'}
        </button>
      );
    }

    if (showVerifiedGuestClaim) {
      return (
        <Link
          className="btn w-full rounded-2xl px-6 py-3 text-base sm:w-auto"
          href={claimSignInHref}
        >
          Sign in to claim Premium
        </Link>
      );
    }

    if (authStatus === 'authed' && subscriptionState === 'paid') {
      return (
        <Link
          className="btn w-full rounded-2xl px-6 py-3 text-base sm:w-auto"
          href={returnTo}
        >
          Continue to your destination
        </Link>
      );
    }

    return (
      <button
        className="btn w-full rounded-2xl px-6 py-3 text-base sm:w-auto"
        onClick={() => void startCheckout(offerPromotionCode)}
        disabled={busy || subscriptionState === 'checking'}
      >
        {subscriptionState === 'checking'
          ? 'Checking plan…'
          : busy
            ? 'Starting checkout…'
            : CTA_LABEL}
      </button>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-20 pt-6 md:px-8 md:pt-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-3 text-sm font-semibold text-text1 transition hover:text-primary"
        >
          <Image
            src="/rocket.svg"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
            priority
          />
          <span>T-Minus Zero</span>
        </Link>
        <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
          Premium
        </div>
      </div>

      {showClaimStatusCard ? (
        <section className="rounded-[28px] border border-stroke bg-[rgba(11,16,35,0.86)] px-5 py-4 shadow-glow backdrop-blur-xl">
          <div className="text-xs uppercase tracking-[0.14em] text-text3">
            Checkout status
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text2">
            {claimLoading
              ? 'Checking your Premium claim…'
              : claimError
                ? claimError
                : showPendingClaimNotice
                  ? 'Checkout completed. We are still verifying your Premium purchase and this page will refresh automatically for a short time.'
                  : showVerifiedGuestClaim
                    ? 'Premium is verified. Sign in to an existing account or create one now to claim it.'
                    : showVerifiedAuthedClaim
                      ? 'Premium is verified for this purchase. Attach it to the account currently signed in here.'
                      : showClaimedGuestNotice
                        ? 'This Premium purchase is already attached to an account. Sign in to manage it.'
                        : claim?.status === 'claimed'
                          ? 'Premium is already attached. Redirecting you back now if billing is active.'
                          : 'Premium checkout completed.'}
          </p>
          {showVerifiedGuestClaim ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                className="btn rounded-2xl px-5 py-3 text-sm"
                href={claimSignInHref}
              >
                Sign in to claim Premium
              </Link>
              {claimSignUpHref ? (
                <Link
                  className="btn-secondary rounded-2xl px-5 py-3 text-sm"
                  href={claimSignUpHref}
                >
                  Create account to claim Premium
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {!claimToken && succeeded ? (
        <section className="rounded-[28px] border border-stroke bg-[rgba(11,16,35,0.86)] px-5 py-4 text-sm text-text2 shadow-glow backdrop-blur-xl">
          {subscriptionState === 'unpaid'
            ? 'Checkout completed. We are still confirming your subscription. Refresh this page in a moment if you are not redirected.'
            : 'Subscription active. Redirecting you back now.'}
        </section>
      ) : null}

      {canceled ? (
        <section className="rounded-[28px] border border-stroke bg-[rgba(11,16,35,0.86)] px-5 py-4 text-sm text-text2 shadow-glow backdrop-blur-xl">
          Checkout canceled. You can resume anytime.
        </section>
      ) : null}

      {authStatus === 'authed' && subscriptionState === 'paid' ? (
        <section className="rounded-[28px] border border-primary/30 bg-[rgba(34,211,238,0.08)] px-5 py-4 text-sm text-text2 shadow-glow">
          Premium is already active on this account. You can continue to{' '}
          <Link className="text-primary hover:underline" href={returnTo}>
            your destination
          </Link>{' '}
          or manage billing from{' '}
          <Link
            className="text-primary hover:underline"
            href={buildProfileHref()}
          >
            Account
          </Link>
          .
        </section>
      ) : null}

      <section className="max-w-3xl">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-text3">
            Premium
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-text1 sm:text-5xl md:text-6xl">
            See launch changes in seconds, not hours.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-text2 sm:text-lg">
            T-Minus Zero Premium is the live layer for people who actually plan
            around launches. Get 15-second updates, full change history, native
            mobile alert control, saved watchlists, recurring calendar feeds,
            RSS/Atom feeds, and widgets without turning browsing into a paywall.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="text-4xl font-semibold tracking-[-0.03em] text-text1">
              {PRICE_LABEL}
            </div>
            {renderPrimaryAction()}
          </div>
          <ul className="mt-8 grid gap-3 text-sm text-text2 sm:grid-cols-3">
            {HERO_BULLETS.map((item) => (
              <li
                key={item}
                className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.03)] px-4 py-3 leading-6"
              >
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-2xl text-xs leading-6 text-text3">
            $3.99/mo billed monthly until canceled. Cancel anytime from{' '}
            <Link
              className="text-primary hover:underline"
              href={buildProfileHref()}
            >
              Account
            </Link>
            . Browsing stays free. By continuing, you agree to the{' '}
            <Link className="text-primary hover:underline" href="/legal/terms">
              Terms
            </Link>{' '}
            and{' '}
            <Link
              className="text-primary hover:underline"
              href="/legal/privacy"
            >
              Privacy Policy
            </Link>
            .
          </p>
          {premiumLegalRequired && authStatus === 'authed' ? (
            <p className="mt-3 text-xs leading-6 text-text3">
              Your account needs the latest Terms and Privacy acceptance before
              checkout starts.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.75fr)] lg:items-end">
        <div className="overflow-hidden rounded-[32px] border border-stroke bg-[rgba(7,9,19,0.92)] shadow-[0_28px_100px_rgba(0,0,0,0.45)]">
          <div className="border-b border-stroke px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-text3">
            Product in use
          </div>
          <Image
            src={PRODUCT_SCREENSHOT_SRC}
            alt="T-Minus Zero launch detail screen showing countdown context, launch status, and the mission timeline workspace."
            width={1200}
            height={1200}
            className="h-auto w-full object-cover"
            priority
          />
        </div>
        <div className="max-w-md">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
            What the image proves
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-text1">
            This is the product, not launch wallpaper.
          </h2>
          <p className="mt-4 text-sm leading-6 text-text2">
            The strongest image for this page is a real working screen with
            countdown context and decision-ready launch data in view. That keeps
            the premium promise concrete: faster launch detail, clearer
            tracking, and fewer refresh loops.
          </p>
        </div>
      </section>

      <section className="max-w-3xl border-t border-stroke pt-10">
        <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
          Why people upgrade
        </div>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-text1">
          Premium is for the people who do not want to miss the moment.
        </h2>
        <p className="mt-4 text-sm leading-7 text-text2">
          It is for tracking Starship, watching for a NET shift, waiting on a
          status change, planning a trip to watch a launch, or just getting
          tired of checking back to see what moved.
        </p>
        <p className="mt-4 text-sm leading-6 text-text3">
          Public browsing stays useful. Premium changes the workflow once
          timing, follow-up, and automation actually matter.
        </p>
      </section>

      <section className="border-t border-stroke pt-10">
        <div className="max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
            What Premium changes
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-text1">
            A focused upgrade path beats a feature pile.
          </h2>
          <p className="mt-4 text-sm leading-6 text-text2">
            The marketer’s strongest instinct is the right one for this repo:
            sell the live workflow first, keep the niche tools below the fold,
            and translate every feature into an outcome people can understand in
            one scan.
          </p>
        </div>
        <div className="mt-8 space-y-6">
          {BENEFIT_BLOCKS.map((block) => (
            <article
              key={block.title}
              className="grid gap-4 border-t border-stroke pt-6 md:grid-cols-[240px_minmax(0,1fr)]"
            >
              <div className="text-[22px] font-semibold tracking-[-0.02em] text-text1">
                {block.title}
              </div>
              <div>
                <p className="text-sm leading-7 text-text2">{block.body}</p>
                <p className="mt-3 text-sm leading-6 text-text3">
                  {block.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-8">
          {authStatus === 'authed' && subscriptionState === 'paid'
            ? null
            : renderPrimaryAction()}
        </div>
      </section>

      <section className="grid gap-6 border-t border-stroke pt-10 lg:grid-cols-2">
        <div className="rounded-[28px] border border-stroke bg-[rgba(255,255,255,0.03)] p-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
            Free
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-text1">
            Public browsing stays strong.
          </h2>
          <p className="mt-4 text-sm leading-7 text-text2">
            Search, filters, launch calendar browsing, launch detail pages, and
            one-off add-to-calendar stay available when you just want to keep an
            eye on a mission.
          </p>
        </div>
        <div className="rounded-[28px] border border-primary/25 bg-[rgba(34,211,238,0.08)] p-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
            Premium
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-text1">
            Premium adds the live layer.
          </h2>
          <p className="mt-4 text-sm leading-7 text-text2">
            You get live 15-second data, the full change log, saved workflows,
            recurring integrations, embeddable widgets, enhanced forecast
            context where available, and the advanced launch-planning tools that
            matter to power users.
          </p>
        </div>
      </section>

      <section className="space-y-4 border-t border-stroke pt-10">
        <details
          className="group overflow-hidden rounded-[28px] border border-stroke bg-[rgba(255,255,255,0.03)] p-6"
          open
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
                Everything Premium includes
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-text1">
                Progressive disclosure for the power-user layer.
              </h2>
            </div>
            <span className="text-sm text-text3">+</span>
          </summary>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {INCLUDED_GROUPS.map((group) => (
              <div
                key={group.title}
                className="rounded-2xl border border-stroke bg-[rgba(7,9,19,0.45)] p-4"
              >
                <div className="text-sm font-semibold text-text1">
                  {group.title}
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-text2">
                  {group.items.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {webOffers.length > 0 ? (
            <details className="mt-6 rounded-2xl border border-stroke bg-[rgba(7,9,19,0.45)] p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-text1">
                Available web offers
              </summary>
              <div className="mt-4 space-y-3 text-sm text-text2">
                {webOffers.map((offer) => (
                  <div
                    key={offer.offerKey}
                    className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.03)] p-4"
                  >
                    <div className="text-text1">{offer.label}</div>
                    {offer.eligibilityHint ? (
                      <div className="mt-1 text-xs text-text3">
                        {offer.eligibilityHint}
                      </div>
                    ) : null}
                    {offer.promotionCode ? (
                      <div className="mt-1 font-mono text-xs text-text3">
                        Code: {offer.promotionCode}
                      </div>
                    ) : null}
                    <button
                      className="btn mt-4 rounded-xl px-4 py-2 text-sm"
                      onClick={() => void startCheckout(offer.promotionCode)}
                      disabled={
                        busy ||
                        subscriptionState === 'checking' ||
                        subscriptionState === 'paid'
                      }
                    >
                      {busy ? 'Starting checkout…' : CTA_LABEL}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </details>

        <div className="grid gap-4 md:grid-cols-2">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.question}
              className="rounded-[24px] border border-stroke bg-[rgba(255,255,255,0.03)] p-5"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-text1">
                {item.question}
              </summary>
              <p className="mt-3 text-sm leading-6 text-text2">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-[32px] border border-stroke bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(255,255,255,0.02))] px-6 py-10 shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
        <div className="max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">
            Final call
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-text1">
            More launches watched. Fewer changes missed.
          </h2>
          <p className="mt-4 text-sm leading-7 text-text2">
            Premium helps you catch more of the moments worth looking up for,
            with one clear upgrade path instead of a scattered set of
            half-explained perks.
          </p>
          <div className="mt-6">
            {authStatus === 'authed' && subscriptionState === 'paid' ? (
              <Link
                className="btn rounded-2xl px-6 py-3 text-base"
                href={returnTo}
              >
                Continue to your destination
              </Link>
            ) : (
              renderPrimaryAction()
            )}
          </div>
          <p className="mt-4 text-xs leading-6 text-text3">
            Cancel anytime. Browsing stays free. Prefer to keep exploring first?{' '}
            <Link
              className="text-primary hover:underline"
              href={returnTo || '/'}
            >
              Return to public browsing
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
