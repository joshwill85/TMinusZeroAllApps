import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { readAuthIntent, readReturnTo } from '@tminuszero/navigation';
import { AuthForm } from '@/components/AuthForm';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Sign in | ${BRAND_NAME}`,
  description: `Sign in to access your ${BRAND_NAME} account.`,
  alternates: { canonical: '/auth/sign-in' }
};

export default function SignInPage({
  searchParams
}: {
  searchParams?: { next?: string | string[]; return_to?: string | string[]; intent?: string | string[]; claim_token?: string | string[] };
}) {
  const reader = {
    get(key: string) {
      const value = searchParams?.[key as keyof typeof searchParams];
      if (typeof value === 'string') return value;
      return Array.isArray(value) ? value[0] || null : null;
    }
  };
  const returnTo = readReturnTo(reader);
  const authIntent = readAuthIntent(reader);
  const claimToken = reader.get('claim_token');
  const signUpHref =
    claimToken && claimToken.trim()
      ? `/auth/sign-up?${new URLSearchParams({
          claim_token: claimToken,
          return_to: returnTo,
          ...(authIntent ? { intent: authIntent } : {})
        }).toString()}`
      : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Auth</p>
        <h1 className="text-3xl font-semibold text-text1">Sign in</h1>
        <p className="text-sm text-text2">
          {authIntent === 'upgrade'
            ? 'Sign in to an existing account to upgrade, or return to Premium checkout if you need a new account.'
            : 'Access your account for ownership, recovery, billing, and Premium attach flows.'}
        </p>
      </div>
      <Suspense fallback={<div className="text-sm text-text3">Loading sign-in…</div>}>
        <AuthForm mode="sign-in" claimToken={claimToken} />
      </Suspense>
      {signUpHref ? (
        <p className="text-sm text-text3">
          Need an account for this Premium purchase?{' '}
          <Link href={signUpHref} className="text-primary">
            Create one to claim Premium
          </Link>
        </p>
      ) : null}
    </div>
  );
}
