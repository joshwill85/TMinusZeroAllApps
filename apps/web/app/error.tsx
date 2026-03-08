'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { SUPPORT_EMAIL } from '@/lib/brand';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('route error boundary', error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Error</p>
        <h1 className="text-3xl font-semibold text-text1">Something went wrong</h1>
        <p className="max-w-prose text-sm text-text2">
          Refresh and try again. If it keeps happening, email{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        {error.digest ? (
          <p className="text-xs text-text3">
            Error ID: <span className="font-mono text-text2">{error.digest}</span>
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn rounded-lg px-4 py-2 text-sm" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/#schedule" className="btn-secondary rounded-lg px-4 py-2 text-sm">
          Back to schedule
        </Link>
      </div>
    </div>
  );
}

