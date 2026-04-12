'use client';

import Link from 'next/link';

export function AccountRecoveryOnlyNotice({
  title,
  description,
  actionHref = '/account',
  actionLabel = 'Open membership & billing'
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
      <div className="text-xs uppercase tracking-[0.1em] text-text3">Billing recovery only</div>
      <div className="mt-1 text-base font-semibold text-text1">{title}</div>
      <p className="mt-2 text-text3">{description}</p>
      <p className="mt-2 text-xs text-text3">
        This signed-in account currently has free access. Billing recovery, restore, support, privacy, and account deletion stay
        available until Premium is active again.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link className="btn rounded-lg px-4 py-2 text-xs" href={actionHref}>
          {actionLabel}
        </Link>
        <Link className="btn-secondary rounded-lg px-4 py-2 text-xs" href="/legal/privacy-choices">
          Privacy & data
        </Link>
        <Link className="btn-secondary rounded-lg px-4 py-2 text-xs" href="/support">
          Support
        </Link>
      </div>
    </div>
  );
}
