'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { BRAND_NAME } from '@/lib/brand';
import { getStripePublishableKey } from '@/lib/env/public';

const PRESET_AMOUNTS = [3, 5, 10, 25];
const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 50_000;
const THANKS_ROTATE_INTERVAL_MS = 6000;
const THANKS_FLIP_DURATION_MS = 500;

const FOOTER_LINKS = [
  { label: 'Terms', href: '/legal/terms' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Privacy Choices', href: '/legal/privacy-choices' },
  { label: 'Data Use', href: '/legal/data' },
  { label: 'About', href: '/about' },
  { label: 'FAQ', href: '/docs/faq' },
  { label: 'Jellyfish Guide', href: '/jellyfish-effect' }
] as const;

const THANKS_MESSAGES = ['Primary launch schedule data: The Space Devs - Launch Library 2'] as const;

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

export function TipJarFooter() {
  const [tipOpen, setTipOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<'one_time' | 'monthly'>('one_time');
  const [custom, setCustom] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [thanksIndex, setThanksIndex] = useState(0);
  const [thanksFlipping, setThanksFlipping] = useState(false);
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
  const thanksMessage = THANKS_MESSAGES[thanksIndex % THANKS_MESSAGES.length] || '';

  const resetState = () => {
    setMode('one_time');
    setCustom('');
    setSelectedPreset(null);
    setClientSecret(null);
    setLoadingIntent(false);
    setError(null);
    setSuccess(false);
  };

  const closeTipJar = () => {
    setTipOpen(false);
    resetState();
  };

  const openTipJar = () => {
    setDrawerOpen(false);
    setTipOpen(true);
  };

  const closeDrawer = () => setDrawerOpen(false);

  useEffect(() => {
    if (THANKS_MESSAGES.length < 2) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const intervalId = setInterval(() => {
      setThanksFlipping(true);
      timeoutId = setTimeout(() => {
        setThanksIndex((prev) => (prev + 1) % THANKS_MESSAGES.length);
        setThanksFlipping(false);
      }, THANKS_FLIP_DURATION_MS);
    }, THANKS_ROTATE_INTERVAL_MS);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);

  async function createIntent(amount: number) {
    if (!stripePromise) {
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
    if (!stripePromise) {
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

  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 flex w-full flex-col items-center gap-2 px-4">
        {thanksMessage && (
          <div className="flex w-full max-w-5xl items-center justify-center rounded-full border border-stroke bg-[rgba(7,9,19,0.72)] px-4 py-1 text-[11px] text-text3 shadow-glow backdrop-blur-xl [perspective:600px]">
            <span
              className={`block transition-[transform,opacity] duration-500 ease-out [transform-style:preserve-3d] ${
                thanksFlipping ? 'opacity-0 [transform:rotateX(90deg)]' : 'opacity-100 [transform:rotateX(0deg)]'
              } motion-reduce:transition-none motion-reduce:transform-none motion-reduce:opacity-100`}
            >
              {thanksMessage}
            </span>
          </div>
        )}
        <div className="flex w-full items-center justify-end md:justify-center">
          <div className="hidden w-full max-w-5xl items-center justify-between gap-4 rounded-2xl border border-stroke bg-[rgba(7,9,19,0.92)] px-4 py-2.5 text-xs text-text3 shadow-glow backdrop-blur-xl md:flex">
            <div className="flex items-center gap-3 text-text2">
              <div className="text-[10px] uppercase tracking-[0.28em] text-text4">{BRAND_NAME}</div>
              <div className="hidden text-xs text-text3 lg:block">Primary launch schedule data: The Space Devs - Launch Library 2</div>
            </div>
            <nav className="flex items-center gap-3 text-[11px] text-text3" aria-label="Footer">
              {FOOTER_LINKS.map((link) => (
                <a key={link.href} className="hover:text-text1" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
            <button type="button" className="btn rounded-xl px-3 py-2 text-xs" onClick={openTipJar}>
              <TipJarIcon className="h-4 w-4" />
              Tip jar
            </button>
          </div>
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-stroke bg-[rgba(7,9,19,0.92)] text-text2 shadow-glow backdrop-blur-xl transition hover:border-primary hover:text-text1 md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open site info"
          >
            <InfoIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex items-end md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
            onClick={closeDrawer}
            aria-label="Close footer drawer"
          />
          <div className="relative w-full rounded-t-2xl border border-stroke bg-surface-1 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-glow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-text4">{BRAND_NAME}</div>
                <div className="text-sm font-semibold text-text1">Primary launch schedule data: The Space Devs - Launch Library 2</div>
              </div>
              <button className="text-xs text-text3 hover:text-text1" onClick={closeDrawer}>
                Close
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-stroke bg-[rgba(7,9,19,0.7)] p-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-stroke bg-surface-0 text-text2">
                <TipJarIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-text4">Tip jar</div>
                <div className="text-sm font-semibold text-text1">Fuel the next launch window</div>
                <div className="text-xs text-text3">Support {BRAND_NAME}</div>
              </div>
              <button type="button" className="btn rounded-xl px-3 py-2 text-xs" onClick={openTipJar}>
                Tip
              </button>
            </div>

            <nav className="mt-4 grid grid-cols-2 gap-2 text-sm text-text3" aria-label="Footer">
              {FOOTER_LINKS.map((link) => (
                <a key={link.href} className="hover:text-text1" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}

      {tipOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(0,0,0,0.55)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Tip jar</div>
                <div className="text-base font-semibold text-text1">Support {BRAND_NAME}</div>
                <div className="mt-1 text-xs text-text3">
                  Secure Stripe payment • {mode === 'monthly' ? 'Monthly tip (recurring)' : 'One-time tip'}
                </div>
              </div>
              <button className="text-sm text-text3 hover:text-text1" onClick={closeTipJar}>
                Close
              </button>
            </div>

            {!stripePromise && <div className="mt-4 text-xs text-text3">Tips are not available yet.</div>}

            {stripePromise && !clientSecret && !success && (
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

            {stripePromise && mode === 'one_time' && clientSecret && !success && (
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
                <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={closeTipJar}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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

function TipJarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 9h10l-1 10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 9V7a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="6.6" y="9" width="7" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14.6" y="9" width="2.8" height="3.6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14.6" y="13.4" width="2.8" height="3.6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10.1" cy="12.6" r="0.9" fill="currentColor" opacity="0.6" />
    </svg>
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
