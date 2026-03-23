'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { buildAuthHref, buildUpgradeHref } from '@tminuszero/navigation';
import { BRAND_NAME } from '@/lib/brand';

const PREMIUM_PRICE_LABEL = '$3.99/mo';

const PREMIUM_FEATURES = [
  'Live updates every 15 seconds',
  'Full change log (see what changed)',
  'Saved/default filters + follows (“My Launches”)',
  'Advanced alerts + browser notifications',
  'Recurring calendar feeds (.ics) from presets, follows, or all future launches',
  'RSS + Atom feeds for any filtered feed',
  'Embeddable “Next launch” widget (token link)',
  'Enhanced forecast insights (select launches)',
  'Launch-day email + AR trajectory overlay'
];

export function PremiumUpsellModal({
  open,
  onClose,
  isAuthed,
  featureLabel
}: {
  open: boolean;
  onClose: () => void;
  isAuthed: boolean;
  featureLabel?: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const returnTo = pathname || '/';
  const signInHref = buildAuthHref('sign-in', { returnTo, intent: 'upgrade' });
  const upgradeHref = buildUpgradeHref({ returnTo: pathname || null });

  const title = featureLabel ? `Unlock ${featureLabel}` : 'Unlock Premium';

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center p-4 md:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close premium upsell"
      />
      <div className="relative w-full max-w-md overflow-y-auto rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow md:max-h-[90vh]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Premium</div>
            <div className="text-base font-semibold text-text1">{title}</div>
            <div className="mt-1 text-xs text-text3">Live updates, saved filters/follows, browser alerts, and recurring feed integrations.</div>
          </div>
          <button className="text-sm text-text3 hover:text-text1" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-text1">{BRAND_NAME} Premium</div>
              <div className="mt-1 text-xs text-text3">Faster data, more context, recurring automation.</div>
            </div>
            <div className="text-sm text-text2">{PREMIUM_PRICE_LABEL}</div>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-text2">
            {PREMIUM_FEATURES.slice(0, 3).map((feature) => (
              <li key={feature}>• {feature}</li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Link href={upgradeHref} className="btn w-full rounded-lg px-4 py-2 text-sm" onClick={onClose}>
            {isAuthed ? 'See Premium' : 'Start Premium'}
          </Link>
          {!isAuthed ? (
            <Link href={signInHref} className="btn-secondary w-full rounded-lg px-4 py-2 text-sm" onClick={onClose}>
              Sign in to existing account
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
