import Head from 'next/head';
import type { NextPageContext } from 'next';

import { BRAND_NAME } from '@/lib/brand';

type LegacyErrorPageProps = {
  statusCode?: number;
};

// Next's production export/finalization path still expects a Pages Router _error
// entrypoint even though the app surface is App Router-first.
export default function LegacyErrorPage({
  statusCode
}: LegacyErrorPageProps) {
  const title = statusCode
    ? `${statusCode} | ${BRAND_NAME}`
    : `Application Error | ${BRAND_NAME}`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Error
        </p>
        <h1 className="text-3xl font-semibold text-text1">
          {statusCode ? `Request failed (${statusCode})` : 'Something went wrong'}
        </h1>
        <p className="max-w-xl text-sm text-text2">
          The request could not be completed. Retry the page or return to the
          main launch schedule.
        </p>
        <a
          href="/"
          className="rounded-full border border-stroke px-4 py-2 text-sm font-medium text-text1 transition hover:text-primary"
        >
          Back to schedule
        </a>
      </main>
    </>
  );
}

LegacyErrorPage.getInitialProps = ({
  res,
  err
}: NextPageContext): LegacyErrorPageProps => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 500
});
