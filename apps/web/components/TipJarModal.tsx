'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { BRAND_NAME } from '@/lib/brand';
import { getStripePublishableKey } from '@/lib/env/public';

const PRESET_AMOUNTS = [3, 5, 10, 25];
const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 50_000;

const publishableKey = getStripePublishableKey();
let cachedStripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
  if (!publishableKey) return null;
  if (!cachedStripePromise) cachedStripePromise = loadStripe(publishableKey);
  return cachedStripePromise;
}

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

export function TipJarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [mode, setMode] = useState<'one_time' | 'monthly'>('one_time');
  const [custom, setCustom] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const customAmountId = useId();

  const customAmount = useMemo(() => {
    if (!custom) return null;
    const value = Number(custom);
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }, [custom]);

  const customAmountValid = customAmount != null && customAmount >= MIN_TIP_CENTS && customAmount <= MAX_TIP_CENTS;
  const activeAmount = customAmountValid ? customAmount : selectedPreset;
  const amountLabel = activeAmount ? formatUsd(activeAmount) : '$';
  const stripeConfigured = Boolean(publishableKey);

  useEffect(() => {
    if (!open || !stripeConfigured) return;
    setStripePromise((prev) => prev ?? getStripePromise());
  }, [open, stripeConfigured]);

  useEffect(() => {
    if (open) return;
    setMode('one_time');
    setCustom('');
    setSelectedPreset(null);
    setClientSecret(null);
    setLoadingIntent(false);
    setError(null);
    setSuccess(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  async function createIntent(amount: number) {
    if (!stripeConfigured) {
      setError('stripe_not_configured');
      return;
    }
    setLoadingIntent(true);
    setError(null);
    try {
      const res = await fetch('/api/tipjar/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.clientSecret) {
        setError(json?.error || 'checkout_failed');
        return;
      }
      setClientSecret(json.clientSecret);
    } catch (err) {
      console.error('tip jar intent error', err);
      setError('checkout_failed');
    } finally {
      setLoadingIntent(false);
    }
  }

  async function startMonthlyCheckout(amount: number) {
    if (!stripeConfigured) {
      setError('stripe_not_configured');
      return;
    }
    setLoadingIntent(true);
    setError(null);
    try {
      const res = await fetch('/api/tipjar/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        setError(json?.error || 'checkout_failed');
        return;
      }
      window.location.href = json.url;
    } catch (err) {
      console.error('tip jar monthly checkout error', err);
      setError('checkout_failed');
    } finally {
      setLoadingIntent(false);
    }
  }

  const onContinue = async () => {
    if (!activeAmount) {
      setError('invalid_amount');
      return;
    }
    if (activeAmount < MIN_TIP_CENTS || activeAmount > MAX_TIP_CENTS) {
      setError('amount_out_of_range');
      return;
    }
    if (mode === 'monthly') {
      await startMonthlyCheckout(activeAmount);
      return;
    }
    await createIntent(activeAmount);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close tip jar"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Tip jar</div>
            <div className="text-base font-semibold text-text1">Support {BRAND_NAME}</div>
            <div className="mt-1 text-xs text-text3">
              Secure Stripe payment • {mode === 'monthly' ? 'Monthly tip (recurring)' : 'One-time tip'}
            </div>
          </div>
          <button className="text-sm text-text3 hover:text-text1" onClick={onClose}>
            Close
          </button>
        </div>

        {!stripeConfigured && <div className="mt-4 text-xs text-text3">Tips are not available yet.</div>}

        {stripeConfigured && !clientSecret && !success && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-stroke bg-surface-0 p-1">
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  mode === 'one_time' ? 'bg-[rgba(34,211,238,0.12)] text-text1' : 'text-text3 hover:text-text1'
                }`}
                onClick={() => {
                  setMode('one_time');
                  setClientSecret(null);
                  setSuccess(false);
                  setError(null);
                }}
                disabled={loadingIntent}
              >
                One-time
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  mode === 'monthly' ? 'bg-[rgba(34,211,238,0.12)] text-text1' : 'text-text3 hover:text-text1'
                }`}
                onClick={() => {
                  setMode('monthly');
                  setClientSecret(null);
                  setSuccess(false);
                  setError(null);
                }}
                disabled={loadingIntent}
              >
                Monthly
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-left text-sm text-text1 transition ${
                    selectedPreset === amount * 100 && !customAmountValid
                      ? 'border-primary bg-[rgba(34,211,238,0.12)]'
                      : 'border-stroke bg-surface-0 hover:border-primary'
                  }`}
                  onClick={() => {
                    setSelectedPreset(amount * 100);
                    setCustom('');
                  }}
                  disabled={loadingIntent}
                >
                  ${amount}
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <label htmlFor={customAmountId} className="text-[11px] uppercase tracking-[0.08em] text-text3">
                Custom amount
              </label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-text2">$</span>
                <input
                  id={customAmountId}
                  inputMode="decimal"
                  placeholder="12"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="w-full bg-transparent text-sm text-text1 outline-none"
                />
              </div>
              <div className="mt-1 text-[11px] text-text3">Minimum $1.00 • Max $500</div>
            </div>

            <button
              type="button"
              className="btn w-full rounded-lg px-3 py-2 text-sm"
              onClick={onContinue}
              disabled={loadingIntent}
            >
              {loadingIntent
                ? mode === 'monthly'
                  ? 'Starting monthly tip…'
                  : 'Preparing payment…'
                : `Continue ${amountLabel}${mode === 'monthly' ? '/mo' : ''}`}
            </button>

            {error && <div className="text-xs text-danger">{formatTipError(error)}</div>}
            {mode === 'monthly' && error === 'unauthorized' && (
              <button
                type="button"
                className="text-left text-xs text-primary hover:underline"
                onClick={() => {
                  const next = typeof window !== 'undefined' ? window.location.pathname : '/';
                  window.location.href = `/auth/sign-in?next=${encodeURIComponent(next)}`;
                }}
              >
                Sign in to continue
              </button>
            )}
            {mode === 'monthly' && !error && (
              <div className="text-xs text-text3">
                Charged monthly until you cancel (manage/cancel from your Account page). Does not unlock Premium features.
              </div>
            )}
          </div>
        )}

        {stripeConfigured && mode === 'one_time' && clientSecret && !success && stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <TipJarPaymentForm
              amountLabel={amountLabel}
              onBack={() => setClientSecret(null)}
              onSuccess={() => setSuccess(true)}
            />
          </Elements>
        )}

        {success && (
          <div className="mt-4 space-y-2">
            <div className="text-base font-semibold text-text1">Thank you for supporting {BRAND_NAME}.</div>
            <div className="text-sm text-text3">Your tip keeps the schedule fast and clean.</div>
            <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TipJarPaymentForm({
  amountLabel,
  onBack,
  onSuccess
}: {
  amountLabel: string;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setMessage(null);

    const returnUrl = typeof window !== 'undefined' ? `${window.location.origin}/?tip=success` : undefined;
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: returnUrl ? { return_url: returnUrl } : undefined,
      redirect: 'if_required'
    });

    if (result.error) {
      setMessage(result.error.message || 'Payment failed.');
      setSubmitting(false);
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing') {
      onSuccess();
      return;
    }

    setMessage('Payment requires additional action.');
    setSubmitting(false);
  };

  return (
    <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex items-center justify-between">
        <button type="button" className="text-xs text-text3 hover:text-text1" onClick={onBack}>
          Change amount
        </button>
        <button type="submit" className="btn rounded-lg px-4 py-2 text-sm" disabled={!stripe || submitting}>
          {submitting ? 'Processing…' : `Tip ${amountLabel}`}
        </button>
      </div>
      {message && <div className="text-xs text-danger">{message}</div>}
    </form>
  );
}

function formatTipError(code: string) {
  if (code === 'stripe_not_configured') return 'Tips are not available yet.';
  if (code === 'unauthorized') return 'Sign in to start a monthly tip (so you can manage or cancel it).';
  if (code === 'amount_out_of_range') return 'Tip must be between $1 and $500.';
  if (code === 'invalid_amount') return 'Enter a valid amount.';
  return 'Payment setup failed. Try again.';
}

function formatUsd(amountCents: number) {
  const dollars = (amountCents / 100).toFixed(2);
  return `$${dollars.replace(/\.00$/, '')}`;
}
