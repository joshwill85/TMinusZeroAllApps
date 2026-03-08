'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { isPaidSubscriptionStatus, normalizeSubscriptionStatus } from '@/lib/billing/shared';
import { getStripePublishableKey } from '@/lib/env/public';

type SubscriptionState = {
  status: string;
  isPaid: boolean;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  stripePriceId?: string | null;
  source?: string;
};

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

function readCheckoutParam() {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('checkout');
}

export function BillingPanel() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'checkout' | 'cancel' | 'resume' | 'portal' | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState(false);

  useEffect(() => {
    const checkout = readCheckoutParam();
    if (checkout === 'success') setNotice('Subscription active. Welcome to Premium.');
    if (checkout === 'cancel') setNotice('Checkout canceled. You can resume anytime.');
  }, []);

  const fetchSubscription = async () => {
    try {
      const res = await fetch('/api/me/subscription', { cache: 'no-store' });
      if (res.status === 401) {
        setSubscription({ status: 'none', isPaid: false, source: 'guest' });
        setStatus('ready');
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'failed_to_load');
      setSubscription(json);
      setStatus('ready');
    } catch (err) {
      console.error('subscription fetch error', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  const subscriptionStatus = normalizeSubscriptionStatus(subscription?.status);
  const hasBilling = subscriptionStatus !== 'none' && subscriptionStatus !== 'stub';
  const isPaid = Boolean(subscription?.isPaid) || isPaidSubscriptionStatus(subscriptionStatus);
  const isCanceled = subscriptionStatus === 'canceled' || subscriptionStatus === 'incomplete_expired';
  const hasBillingIssue = subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'incomplete';
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd;
  const currentPeriodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const renewalLabel = currentPeriodEnd ? formatDate(currentPeriodEnd) : 'Next period end';
  const canManageBilling = hasBilling;

  const startCheckout = async () => {
    setBusyAction('checkout');
    setNotice(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: '/account' })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.url) {
        window.location.href = json.url;
        return;
      }
      if (json?.error === 'already_subscribed') {
        await fetchSubscription();
        setNotice('Premium is already active.');
        return;
      }
      if (json?.error === 'payment_issue') {
        await fetchSubscription();
        setNotice('Your subscription needs attention. Update your payment method or manage billing.');
        return;
      }
      throw new Error(json?.error || 'checkout_failed');
    } catch (err) {
      console.error('checkout error', err);
      setNotice('Unable to start checkout.');
    } finally {
      setBusyAction(null);
    }
  };

  const openPortal = async () => {
    setBusyAction('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) throw new Error(json?.error || 'portal_failed');
      window.location.href = json.url;
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
      const res = await fetch('/api/billing/setup-intent', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.clientSecret) throw new Error(json?.error || 'setup_failed');
      setSetupClientSecret(json.clientSecret);
    } catch (err) {
      console.error('setup intent error', err);
      setSetupError('Unable to start payment update.');
    }
  };

  const cancelSubscription = async () => {
    setBusyAction('cancel');
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'cancel_failed');
      const nextPeriodEnd = json.currentPeriodEnd ? new Date(json.currentPeriodEnd) : null;
      setSubscription((prev) =>
        prev
          ? {
              ...prev,
              status: json.status ?? prev.status,
              cancelAtPeriodEnd: true,
              currentPeriodEnd: json.currentPeriodEnd ?? prev.currentPeriodEnd
            }
          : prev
      );
      setNotice(nextPeriodEnd ? `Subscription will cancel on ${formatDate(nextPeriodEnd)}.` : 'Subscription will cancel at period end.');
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
      const res = await fetch('/api/billing/resume', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'resume_failed');
      const nextPeriodEnd = json.currentPeriodEnd ? new Date(json.currentPeriodEnd) : null;
      setSubscription((prev) =>
        prev
          ? {
              ...prev,
              status: json.status ?? prev.status,
              cancelAtPeriodEnd: false,
              currentPeriodEnd: json.currentPeriodEnd ?? prev.currentPeriodEnd
            }
          : prev
      );
      setNotice(nextPeriodEnd ? `Subscription resumed. Renews on ${formatDate(nextPeriodEnd)}.` : 'Subscription resumed.');
    } catch (err) {
      console.error('resume error', err);
      setNotice('Unable to resume subscription.');
    } finally {
      setBusyAction(null);
    }
  };

  const planTitle = isPaid ? 'Premium plan' : hasBillingIssue ? 'Billing issue' : 'Free plan';
  const statusLabel = subscription?.status ? formatStatus(subscription.status) : 'Unknown';

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Billing & subscription</div>
          <div className="text-lg font-semibold text-text1">{planTitle}</div>
        </div>
        {status === 'ready' && (
          <span className="rounded-full border border-stroke px-3 py-1 text-xs text-text3">{statusLabel}</span>
        )}
      </div>

      {status === 'loading' && <div className="mt-3 text-xs text-text3">Loading billing status…</div>}
      {status === 'error' && <div className="mt-3 text-xs text-danger">Unable to load billing status.</div>}
      {notice && <div className="mt-3 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text2">{notice}</div>}

      {status === 'ready' && (
        <div className="mt-3 space-y-3">
          {hasBilling ? (
            <div className="space-y-2">
              <div className="text-xs text-text3">
                {hasBillingIssue
                  ? 'Payment issue detected. Update your payment method or manage billing.'
                  : isCanceled
                  ? 'Subscription canceled'
                  : cancelAtPeriodEnd
                    ? `Cancels on ${renewalLabel}`
                    : currentPeriodEnd
                      ? `Renews on ${renewalLabel}`
                      : 'Subscription active'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary rounded-lg px-3 py-2 text-xs"
                  onClick={startSetupIntent}
                  disabled={!stripePromise || Boolean(setupClientSecret)}
                >
                  Update payment method
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
                {canManageBilling && (
                  <button className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={openPortal} disabled={busyAction === 'portal'}>
                    {busyAction === 'portal' ? 'Opening…' : 'Manage billing'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-text3">Upgrade to Premium for live data and alerts.</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn rounded-lg px-3 py-2 text-xs" onClick={startCheckout} disabled={busyAction === 'checkout'}>
                  {busyAction === 'checkout' ? 'Starting…' : 'Upgrade to Premium'}
                </button>
              </div>
            </div>
          )}

          {setupClientSecret && stripePromise && (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Update payment method</div>
              <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance }}>
                <PaymentMethodForm
                  amountLabel={isPaid ? 'Premium payment method' : 'payment method'}
                  onClose={() => setSetupClientSecret(null)}
                  onSuccess={() => {
                    setSetupSuccess(true);
                    setSetupClientSecret(null);
                  }}
                  onError={(message) => setSetupError(message)}
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
  onError
}: {
  amountLabel: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
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

    const res = await fetch('/api/billing/default-payment-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod })
    });

    if (!res.ok) {
      onError('Unable to save payment method.');
      setSubmitting(false);
      return;
    }

    onSuccess();
    setSubmitting(false);
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
  return status;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
