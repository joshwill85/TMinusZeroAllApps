import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UpgradePageContent } from '@/components/UpgradePageContent';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Upgrade to Premium | ${BRAND_NAME}`,
  description: 'Unlock live updates, alerts, watchlists, and feed integrations (calendar + RSS/Atom).',
  alternates: { canonical: '/upgrade' }
};

export default function UpgradePage() {
  return (
    <Suspense fallback={<p className="text-sm text-text2">Loading upgrade options...</p>}>
      <UpgradePageContent />
    </Suspense>
  );
}
