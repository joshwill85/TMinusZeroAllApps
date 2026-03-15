import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { buildAuthHref, readAuthIntent, readReturnTo } from '@tminuszero/navigation';
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
  searchParams?: { next?: string | string[]; return_to?: string | string[]; intent?: string | string[] };
}) {
  const reader = {
    get(key: string) {
      const value = searchParams?.[key as keyof typeof searchParams];
      if (typeof value === 'string') return value;
      return Array.isArray(value) ? value[0] || null : null;
    }
  };
  const signUpHref = buildAuthHref('sign-up', {
    returnTo: readReturnTo(reader),
    intent: readAuthIntent(reader)
  });

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
