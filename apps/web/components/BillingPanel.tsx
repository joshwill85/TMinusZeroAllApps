'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { isPaidSubscriptionStatus, normalizeSubscriptionStatus } from '@/lib/billing/shared';
import { WebBillingAdapterError } from '@/lib/api/webBillingAdapters';
import {
  useBillingCatalogQuery,
  useBillingSummaryQuery,
  useCancelBillingSubscriptionMutation,
  useOpenBillingPortalMutation,
  useResumeBillingSubscriptionMutation,
  useStartBillingCheckoutMutation,
  useStartBillingSetupIntentMutation,
  useUpdateDefaultPaymentMethodMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';
import { getStripePublishableKey } from '@/lib/env/public';

const publishableKey = getStripePublishableKey();
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#22D3EE',
    colorBackground: '#0B1023',
    colorText: '#EAF0FF',
    colorTextSecondary: '#B9C6E8',
    colorDanger: '#FB7185',
    fontFamily: 'var(--font-sans), system-ui, sans-serif',
    spacingUnit: '4px'
  },
  rules: {
    '.Input': {
      backgroundColor: '#070913',
      borderColor: 'rgba(234,240,255,0.08)',
      color: '#EAF0FF'
    },
    '.Label': {
      color: '#B9C6E8'
    }
  }
} as const;

const guestBillingSummary = {
  provider: 'none',
  productKey: null,
  status: 'none',
  isPaid: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  managementMode: 'none',
  managementUrl: null,
  providerMessage: null,
  providerProductId: null
} as const;

function readCheckoutParam() {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('checkout');
}

export function BillingPanel() {
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const billingSummaryQuery = useBillingSummaryQuery();
  const billingCatalogQuery = useBillingCatalogQuery('web');
  const startBillingCheckoutMutation = useStartBillingCheckoutMutation();
  const openBillingPortalMutation = useOpenBillingPortalMutation();
  const startBillingSetupIntentMutation = useStartBillingSetupIntentMutation();
  const updateDefaultPaymentMethodMutation = useUpdateDefaultPaymentMethodMutation();
  const cancelBillingSubscriptionMutation = useCancelBillingSubscriptionMutation();
  const resumeBillingSubscriptionMutation = useResumeBillingSubscriptionMutation();

  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'checkout' | 'cancel' | 'resume' | 'portal' | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState(false);

  useEffect(() => {
    const checkout = readCheckoutParam();
    if (checkout === 'success') setNotice('Membership active.');
    if (checkout === 'cancel') setNotice('Checkout canceled. You can resume anytime.');
  }, []);

  const isGuestViewer = !viewerSessionQuery.isPending && !viewerSessionQuery.data?.viewerId;
  const summary = isGuestViewer ? guestBillingSummary : billingSummaryQuery.data ?? null;
  const status: 'loading' | 'ready' | 'error' =
    viewerSessionQuery.isPending || (!isGuestViewer && billingSummaryQuery.isPending)
      ? 'loading'
      : !isGuestViewer && billingSummaryQuery.isError
      ? 'error'
      : 'ready';

  const subscriptionStatus = normalizeSubscriptionStatus(summary?.status);
  const provider = summary?.provider ?? 'none';
  const hasBilling = subscriptionStatus !== 'none' && subscriptionStatus !== 'stub';
  const isPaid = Boolean(summary?.isPaid) || isPaidSubscriptionStatus(subscriptionStatus);
  const isCanceled = subscriptionStatus === 'canceled' || subscriptionStatus === 'incomplete_expired' || subscriptionStatus === 'expired';
  const hasBillingIssue = subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'incomplete';
  const cancelAtPeriodEnd = summary?.cancelAtPeriodEnd ?? false;
  const currentPeriodEnd = summary?.currentPeriodEnd ? new Date(summary.currentPeriodEnd) : null;
  const renewalLabel = currentPeriodEnd ? formatDate(currentPeriodEnd) : 'Next period end';
  const isExternalProvider = provider === 'apple_app_store' || provider === 'google_play';
  const canManageStripeBilling = summary?.managementMode === 'stripe_portal';
  const webOffers = (billingCatalogQuery.data?.products[0]?.offers ?? []).filter(
    (offer) => offer.provider === 'stripe' && Boolean(offer.promotionCode)
  );
  const accessTier = entitlementsQuery.data?.tier ?? (isPaid ? 'premium' : 'anon');
  const hasPremiumAccess = accessTier === 'premium';
  const membershipTitle = hasPremiumAccess ? 'Membership' : 'Public access';
  const membershipStatusLabel = hasBillingIssue
    ? 'Billing issue'
    : hasPremiumAccess
      ? cancelAtPeriodEnd
        ? 'Cancels at period end'
        : summary?.status
          ? formatStatus(summary.status)
          : 'Active'
      : isGuestViewer
        ? 'Guest session'
        : 'Public';
  const membershipDescription = hasBilling
    ? hasBillingIssue
      ? 'Payment issue detected. Update your payment method or manage billing.'
      : isCanceled
        ? 'Subscription canceled'
        : cancelAtPeriodEnd
          ? `Cancels on ${renewalLabel}`
          : currentPeriodEnd
            ? `Renews on ${renewalLabel}`
            : 'Subscription active'
    : hasPremiumAccess
      ? 'Full access is active on this account. Billing records may appear separately from this access state.'
      : isGuestViewer
        ? 'Public access is active. Sign in if you need account management, then upgrade when you want live data, alerts, and saved tools.'
        : 'This account currently uses public access. Premium unlocks live data, alerts, and saved tools.';

  function renderBillingManagementActions() {
    if (isExternalProvider) {
      return summary?.managementUrl ? (
        <a className="btn-secondary rounded-lg px-3 py-2 text-xs" href={summary.managementUrl} target="_blank" rel="noreferrer">
          {provider === 'apple_app_store' ? 'Manage in App Store' : 'Manage in Google Play'}
        </a>
      ) : null;
    }

    return (
      <>
        <button
          className="btn-secondary rounded-lg px-3 py-2 text-xs"
          onClick={startSetupIntent}
          disabled={!stripePromise || Boolean(setupClientSecret) || startBillingSetupIntentMutation.isPending}
        >
          {startBillingSetupIntentMutation.isPending ? 'Starting…' : 'Update payment method'}
        </button>
        {!isCanceled && !cancelAtPeriodEnd ? (
          <button className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={cancelSubscription} disabled={busyAction === 'cancel'}>
            {busyAction === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
          </button>
        ) : !isCanceled ? (
          <button className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={resumeSubscription} disabled={busyAction === 'resume'}>
            {busyAction === 'resume' ? 'Resuming…' : 'Resume subscription'}
          </button>
        ) : null}
        {canManageStripeBilling && (
          <button className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={openPortal} disabled={busyAction === 'portal'}>
            {busyAction === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </>
    );
  }

  async function refreshBilling() {
    await billingSummaryQuery.refetch();
  }

  const startCheckout = async (promotionCode?: string | null) => {
    setBusyAction('checkout');
    setNotice(null);
    try {
      const payload = await startBillingCheckoutMutation.mutateAsync({
        returnTo: '/account',
        promotionCode: promotionCode ?? undefined
      });
      if (!payload?.url) {
        throw new Error('checkout_failed');
      }
      window.location.href = payload.url;
    } catch (err) {
      if (err instanceof WebBillingAdapterError) {
        if (err.code === 'already_subscribed') {
          await refreshBilling();
          setNotice('Access is already active.');
          return;
        }
        if (err.code === 'payment_issue') {
          await refreshBilling();
          setNotice('Your subscription needs attention. Update your payment method or manage billing.');
          return;
        }
      }
      console.error('checkout error', err);
      setNotice('Unable to start checkout.');
    } finally {
      setBusyAction(null);
    }
  };

  const openPortal = async () => {
    setBusyAction('portal');
    try {
      const payload = await openBillingPortalMutation.mutateAsync();
      if (!payload?.url) {
        throw new Error('portal_failed');
      }
      window.location.href = payload.url;
    } catch (err) {
      console.error('portal error', err);
      setNotice('Unable to open the billing portal.');
    } finally {
      setBusyAction(null);
    }
  };

  const startSetupIntent = async () => {
    if (!stripePromise) {
      setSetupError('Stripe is not configured.');
      return;
    }
    setSetupError(null);
    setSetupSuccess(false);
    try {
      const payload = await startBillingSetupIntentMutation.mutateAsync();
      setSetupClientSecret(payload.clientSecret);
    } catch (err) {
      console.error('setup intent error', err);
      setSetupError('Unable to start payment update.');
    }
  };

  const cancelSubscription = async () => {
    setBusyAction('cancel');
    try {
      const payload = await cancelBillingSubscriptionMutation.mutateAsync();
      const nextPeriodEnd = payload.currentPeriodEnd ? new Date(payload.currentPeriodEnd) : null;
      setNotice(nextPeriodEnd ? `Subscription will cancel on ${formatDate(nextPeriodEnd)}.` : 'Subscription will cancel at period end.');
      await refreshBilling();
    } catch (err) {
      console.error('cancel error', err);
      setNotice('Unable to cancel subscription.');
    } finally {
      setBusyAction(null);
    }
  };

  const resumeSubscription = async () => {
    setBusyAction('resume');
    try {
      const payload = await resumeBillingSubscriptionMutation.mutateAsync();
      const nextPeriodEnd = payload.currentPeriodEnd ? new Date(payload.currentPeriodEnd) : null;
      setNotice(nextPeriodEnd ? `Subscription resumed. Renews on ${formatDate(nextPeriodEnd)}.` : 'Subscription resumed.');
      await refreshBilling();
    } catch (err) {
      console.error('resume error', err);
      setNotice('Unable to resume subscription.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Membership</div>
          <div className="text-lg font-semibold text-text1">{membershipTitle}</div>
          {status === 'ready' && <div className="mt-2 text-xs text-text3">{membershipDescription}</div>}
        </div>
        {status === 'ready' && (
          <span className="whitespace-nowrap rounded-full border border-stroke px-3 py-1 text-xs text-text3">{membershipStatusLabel}</span>
        )}
      </div>

      {status === 'loading' && <div className="mt-3 text-xs text-text3">Loading billing status…</div>}
      {status === 'error' && <div className="mt-3 text-xs text-danger">Unable to load billing status.</div>}
      {notice && <div className="mt-3 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text2">{notice}</div>}

      {status === 'ready' && summary && (
        <div className="mt-3 space-y-3">
          {hasBilling ? (
            <div className="space-y-2">
              {summary.providerMessage && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text2">
                  {summary.providerMessage}
                </div>
              )}

              <div className="flex flex-wrap gap-2">{renderBillingManagementActions()}</div>
            </div>
          ) : hasPremiumAccess ? (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-xs text-text3">
              Billing records may appear separately from the current access state on this account.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-text3">
                {isGuestViewer
                  ? 'Public access is active. Sign in if you need account management, then upgrade when you want live data, alerts, and saved tools.'
                  : 'This account currently uses public access. Premium unlocks live data, alerts, and saved tools.'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn rounded-lg px-3 py-2 text-xs"
                  onClick={() => void startCheckout(webOffers.length === 1 ? webOffers[0]?.promotionCode ?? null : null)}
                  disabled={busyAction === 'checkout'}
                >
                  {busyAction === 'checkout' ? 'Starting…' : 'Upgrade to Premium'}
                </button>
                {webOffers.map((offer) => (
                  <button
                    key={offer.offerKey}
                    className="btn-secondary rounded-lg px-3 py-2 text-xs"
                    onClick={() => void startCheckout(offer.promotionCode)}
                    disabled={busyAction === 'checkout'}
                  >
                    {busyAction === 'checkout' ? 'Starting…' : `Use ${offer.promotionCode}`}
                  </button>
                ))}
              </div>
              {webOffers.length > 0 ? (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text2">
                  <div className="text-text1">Active web offers</div>
                  <div className="mt-1 space-y-1">
                    {webOffers.map((offer) => (
                      <div key={offer.offerKey}>
                        <span>{offer.label}</span>
                        {offer.eligibilityHint ? <span className="text-text3"> · {offer.eligibilityHint}</span> : null}
                        {offer.promotionCode ? <span className="font-mono text-text3"> · {offer.promotionCode}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {setupClientSecret && stripePromise && !isExternalProvider && (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Update payment method</div>
              <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance }}>
                <PaymentMethodForm
                  amountLabel={isPaid ? 'default payment method' : 'payment method'}
                  onClose={() => setSetupClientSecret(null)}
                  onSuccess={async () => {
                    setSetupSuccess(true);
                    setSetupClientSecret(null);
                    await refreshBilling();
                  }}
                  onError={(message) => setSetupError(message)}
                  onSubmitPaymentMethod={(paymentMethod) => updateDefaultPaymentMethodMutation.mutateAsync(paymentMethod)}
                />
              </Elements>
              {setupError && <div className="mt-2 text-xs text-danger">{setupError}</div>}
              {setupSuccess && <div className="mt-2 text-xs text-success">Payment method updated.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentMethodForm({
  amountLabel,
  onClose,
  onSuccess,
  onError,
  onSubmitPaymentMethod
}: {
  amountLabel: string;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  onError: (message: string) => void;
  onSubmitPaymentMethod: (paymentMethod: string) => Promise<unknown>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    onError('');

    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required'
    });

    if (result.error) {
      onError(result.error.message || 'Unable to update payment method.');
      setSubmitting(false);
      return;
    }

    const paymentMethodValue = result.setupIntent?.payment_method;
    const paymentMethod =
      typeof paymentMethodValue === 'string' ? paymentMethodValue : paymentMethodValue?.id;
    if (!paymentMethod) {
      onError('Payment method missing.');
      setSubmitting(false);
      return;
    }

    try {
      await onSubmitPaymentMethod(paymentMethod);
      await onSuccess();
    } catch {
      onError('Unable to save payment method.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex items-center justify-between">
        <button type="button" className="text-xs text-text3 hover:text-text1" onClick={onClose}>
          Close
        </button>
        <button type="submit" className="btn rounded-lg px-4 py-2 text-xs" disabled={!stripe || submitting}>
          {submitting ? 'Updating…' : `Update ${amountLabel}`}
        </button>
      </div>
    </form>
  );
}

function formatStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'none') return 'None';
  if (normalized === 'stub') return 'Unavailable';
  if (normalized === 'active') return 'Active';
  if (normalized === 'trialing') return 'Trial';
  if (normalized === 'past_due') return 'Past due';
  if (normalized === 'unpaid') return 'Unpaid';
  if (normalized === 'canceled') return 'Canceled';
  if (normalized === 'incomplete') return 'Incomplete';
  if (normalized === 'incomplete_expired') return 'Expired';
  if (normalized === 'paused') return 'Paused';
  if (normalized === 'expired') return 'Expired';
  if (normalized === 'revoked') return 'Revoked';
  if (normalized === 'pending') return 'Pending';
  if (normalized === 'on_hold') return 'On hold';
  return status;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
