'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { buildAuthHref, readAuthIntent, readReturnTo } from '@tminuszero/navigation';
import { AuthForm } from '@/components/AuthForm';

export function SignUpPanel() {
  const searchParams = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const authIntent = readAuthIntent(searchParams);
  const isUpgradeIntent = authIntent === 'upgrade';
  const signInHref = buildAuthHref('sign-in', { returnTo, intent: authIntent });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end text-sm text-text3">
        <span>Already have an account?</span>
        <Link href={signInHref} className="ml-1 font-medium text-primary hover:text-primary/80">
          Sign in
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-text1">Create free account</h1>
        <p className="mt-1 text-sm text-text3">
          Unlock signed-in filters, the launch calendar, one-off calendar adds, and faster refreshes across your devices.
        </p>
      </div>

      {isUpgradeIntent ? (
        <div className="rounded-2xl border border-primary/30 bg-[rgba(34,211,238,0.08)] px-4 py-3 text-sm text-text2">
          Create your free account first. If you still want Premium afterward, we&apos;ll take you back to the feature you were trying to unlock.
        </div>
      ) : null}

      <AuthForm mode="sign-up" />
    </div>
  );
}
