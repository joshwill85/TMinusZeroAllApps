import type { Metadata } from 'next';
import { PremiumOnboardingLegalClient } from '@/components/PremiumOnboardingLegalClient';
import { BRAND_NAME } from '@/lib/brand';
import { buildPageMetadata } from '@/lib/server/seo';

export const metadata: Metadata = buildPageMetadata({
  title: `Premium Legal Review | ${BRAND_NAME}`,
  description: `Review the latest Terms and Privacy notice before starting ${BRAND_NAME} Premium.`,
  canonical: '/premium-onboarding/legal',
  robots: { index: false, follow: false },
  includeSocial: false
});

export default function PremiumOnboardingLegalPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <PremiumOnboardingLegalClient />
    </div>
  );
}
