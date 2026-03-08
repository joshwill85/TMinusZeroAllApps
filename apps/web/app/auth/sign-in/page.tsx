import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { BRAND_NAME } from '@/lib/brand';
import { buildAuthQuery, readAuthIntent, readReturnTo } from '@/lib/utils/returnTo';

export const metadata: Metadata = {
  title: `Sign in | ${BRAND_NAME}`,
  description: `Sign in to access your ${BRAND_NAME} account.`,
  alternates: { canonical: '/auth/sign-in' }
};

export default function SignInPage({
  searchParams
}: {
  searchParams?: { next?: string | string[]; return_to?: string | string[]; intent?: string | string[] };
}) {
  const reader = {
    get(key: string) {
      const value = searchParams?.[key as keyof typeof searchParams];
      if (typeof value === 'string') return value;
      return Array.isArray(value) ? value[0] || null : null;
    }
  };
  const signUpQuery = buildAuthQuery({
    returnTo: readReturnTo(reader),
    intent: readAuthIntent(reader)
  });
  const signUpHref = signUpQuery ? `/auth/sign-up?${signUpQuery}` : '/auth/sign-up';

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Auth</p>
        <h1 className="text-3xl font-semibold text-text1">Sign in</h1>
        <p className="text-sm text-text2">Access your account and notifications.</p>
      </div>
      <Suspense fallback={<div className="text-sm text-text3">Loading sign-in…</div>}>
        <AuthForm mode="sign-in" />
      </Suspense>
      <p className="text-sm text-text3">
        Don&apos;t have an account?{' '}
        <Link href={signUpHref} className="text-primary">
          Sign up
        </Link>
      </p>
    </div>
  );
}
