import type { Metadata } from 'next';
import { PremiumOnboardingLegalClient } from '@/components/PremiumOnboardingLegalClient';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Premium Legal Review | ${BRAND_NAME}`,
  description: `Review the latest Terms and Privacy notice before starting ${BRAND_NAME} Premium.`,
  alternates: { canonical: '/premium-onboarding/legal' }
};

export default function PremiumOnboardingLegalPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <PremiumOnboardingLegalClient />
    </div>
  );
}
