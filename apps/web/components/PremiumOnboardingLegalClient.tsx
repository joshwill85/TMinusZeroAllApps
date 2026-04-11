'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PREMIUM_PRIVACY_LAST_UPDATED_LABEL, PREMIUM_PRIVACY_VERSION, PREMIUM_TERMS_LAST_UPDATED_LABEL, PREMIUM_TERMS_VERSION } from '@tminuszero/domain';
import { buildAuthHref, readReturnTo } from '@tminuszero/navigation';
import { browserApiClient } from '@/lib/api/client';
import { useViewerSessionQuery } from '@/lib/api/queries';

export function PremiumOnboardingLegalClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: viewerSession, isPending } = useViewerSessionQuery();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const returnTo = useMemo(() => readReturnTo(searchParams), [searchParams]);
  const intentId = useMemo(() => String(searchParams.get('intent_id') || '').trim() || null, [searchParams]);
  const signInHref = useMemo(() => buildAuthHref('sign-in', { returnTo, intent: 'upgrade' }), [returnTo]);

  async function handleContinue() {
    if (!accepted || submitting) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const payload = await browserApiClient.recordPremiumOnboardingLegalAcceptance({
        intentId,
        platform: 'web',
        flow: 'premium_onboarding',
        termsVersion: PREMIUM_TERMS_VERSION,
        privacyVersion: PREMIUM_PRIVACY_VERSION,
        returnTo
      });
      router.replace(payload.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record legal acceptance.');
      setSubmitting(false);
    }
  }

  if (isPending) {
    return <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text3">Loading premium onboarding…</div>;
  }

  if (!viewerSession?.viewerId) {
    return (
      <div className="space-y-4 rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
        <p>Sign in or create your account before reviewing the Premium legal step.</p>
        <Link href={signInHref} className="btn inline-flex rounded-lg px-4 py-2 text-sm">
          Sign in to continue
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-stroke bg-surface-1 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Premium Onboarding</p>
        <h1 className="mt-1 text-3xl font-semibold text-text1">Review Terms Before Checkout</h1>
        <p className="mt-2 text-sm text-text2">
          Premium checkout starts only after you confirm the latest Terms of Service and Privacy Notice for this account.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-sm font-semibold text-text1">Terms of Service</div>
          <div className="mt-1 text-xs text-text3">Last updated: {PREMIUM_TERMS_LAST_UPDATED_LABEL}</div>
          <p className="mt-3 text-sm text-text2">Subscription terms, account obligations, acceptable use, and billing expectations.</p>
          <Link href="/legal/terms" className="mt-4 inline-flex text-sm text-primary hover:text-primary/80">
            Open Terms
          </Link>
        </div>

        <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-sm font-semibold text-text1">Privacy Notice</div>
          <div className="mt-1 text-xs text-text3">Last updated: {PREMIUM_PRIVACY_LAST_UPDATED_LABEL}</div>
          <p className="mt-3 text-sm text-text2">How account, billing, auth, notification, and support data are collected and used.</p>
          <Link href="/legal/privacy" className="mt-4 inline-flex text-sm text-primary hover:text-primary/80">
            Open Privacy Notice
          </Link>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-text2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-stroke bg-surface-0"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>I have reviewed and agree to the current Terms of Service and acknowledge the current Privacy Notice for Premium access.</span>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button className="btn rounded-lg px-4 py-2 text-sm" disabled={!accepted || submitting} onClick={() => void handleContinue()}>
          {submitting ? 'Saving acceptance…' : 'Continue to Premium'}
        </button>
        <Link href={returnTo || '/account'} className="btn-secondary rounded-lg px-4 py-2 text-sm text-center">
          Not now
        </Link>
      </div>

      {message ? <div className="text-sm text-danger">{message}</div> : null}
    </div>
  );
}

