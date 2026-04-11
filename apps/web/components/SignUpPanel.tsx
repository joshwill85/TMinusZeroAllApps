'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildAuthHref, readAuthIntent, readReturnTo } from '@tminuszero/navigation';
import type { PremiumClaimV1 } from '@tminuszero/api-client';
import { AuthForm } from '@/components/AuthForm';
import { browserApiClient } from '@/lib/api/client';

function appendClaimToken(href: string, claimToken: string | null) {
  if (!claimToken) {
    return href;
  }

  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}claim_token=${encodeURIComponent(claimToken)}`;
}

export function SignUpPanel() {
  const searchParams = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const authIntent = readAuthIntent(searchParams);
  const claimToken = String(searchParams.get('claim_token') || '').trim() || null;
  const signInHref = useMemo(
    () =>
      appendClaimToken(
        buildAuthHref('sign-in', {
          returnTo,
          intent: authIntent ?? (claimToken ? 'upgrade' : null)
        }),
        claimToken
      ),
    [authIntent, claimToken, returnTo]
  );
  const [claim, setClaim] = useState<PremiumClaimV1 | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(Boolean(claimToken));
  const allowPremiumOnboarding = !claimToken && authIntent === 'upgrade';

  useEffect(() => {
    if (!claimToken) {
      setClaim(null);
      setClaimLoading(false);
      setClaimError(null);
      return;
    }

    let cancelled = false;
    setClaimLoading(true);
    setClaimError(null);

    void browserApiClient
      .getPremiumClaim(claimToken)
      .then((payload) => {
        if (cancelled) return;
        setClaim(payload.claim);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setClaimError(error instanceof Error ? error.message : 'Unable to validate this Premium claim.');
      })
      .finally(() => {
        if (!cancelled) {
          setClaimLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [claimToken]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end text-sm text-text3">
        <span>Already have an account?</span>
        <Link href={signInHref} className="ml-1 font-medium text-primary hover:text-primary/80">
          Sign in
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-text1">Create account</h1>
        <p className="mt-1 text-sm text-text3">
          {allowPremiumOnboarding
            ? 'Create an account for Premium onboarding. Terms acceptance and billing still happen after sign-in.'
            : 'Account creation now happens only after a verified Premium purchase. Accounts without Premium stay on the public tier.'}
        </p>
      </div>

      {!claimToken && !allowPremiumOnboarding ? (
        <div className="space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <p>Standalone public sign-up has been removed. Start Premium first, then create an account to claim it.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/upgrade" className="btn rounded-lg px-4 py-2 text-sm">
              Start Premium
            </Link>
            <Link href={buildAuthHref('sign-in', { returnTo, intent: authIntent })} className="btn-secondary rounded-lg px-4 py-2 text-sm">
              Sign in to existing account
            </Link>
          </div>
        </div>
      ) : null}

      {allowPremiumOnboarding ? (
        <>
          <div className="rounded-2xl border border-primary/30 bg-[rgba(34,211,238,0.08)] px-4 py-3 text-sm text-text2">
            Premium onboarding is active. Create your account now, then review the latest Terms and Privacy notice before checkout starts.
          </div>
          <AuthForm mode="sign-up" />
        </>
      ) : null}

      {claimToken && claimLoading ? <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text3">Checking your Premium claim…</div> : null}

      {claimToken && claimError ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {claimError}
        </div>
      ) : null}

      {claimToken && claim?.status === 'pending' ? (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Your Premium purchase is still being verified. Return to Upgrade and try again in a moment.
        </div>
      ) : null}

      {claimToken && claim?.status === 'claimed' ? (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          This Premium purchase is already attached to an account. Sign in to manage it.
        </div>
      ) : null}

      {claimToken && claim?.status === 'verified' ? (
        <>
          <div className="rounded-2xl border border-primary/30 bg-[rgba(34,211,238,0.08)] px-4 py-3 text-sm text-text2">
            Premium is verified. Create an account to claim it now, or sign in if you already have one.
          </div>
          <AuthForm mode="sign-up" claimToken={claimToken} claimEmail={claim.email} />
        </>
      ) : null}
    </div>
  );
}
