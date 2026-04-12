import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UpgradePageContent } from '@/components/UpgradePageContent';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Upgrade to Premium | Live Rocket Launch Tracking | ${BRAND_NAME}`,
  description:
    'See launch changes every 15 seconds with T-Minus Zero Premium. Get native mobile alerts, watchlists, widgets, and recurring calendar/RSS feeds for $3.99/mo. Cancel anytime.',
  alternates: { canonical: '/upgrade' }
};

export default function UpgradePage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-text2">Loading upgrade options...</p>
      }
    >
      <UpgradePageContent />
    </Suspense>
  );
}
