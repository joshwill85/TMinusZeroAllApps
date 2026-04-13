import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { buildIndexQualityNoIndexRobots } from '@/lib/server/indexing';
import { PrivacyChoicesClient } from './privacy-choices-client';

export const metadata: Metadata = {
  title: `Privacy Choices | ${BRAND_NAME}`,
  description: `Manage account export, account deletion, and media-loading preferences for ${BRAND_NAME}.`,
  alternates: { canonical: '/legal/privacy-choices' },
  robots: buildIndexQualityNoIndexRobots()
};

export default function PrivacyChoicesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <h1 className="text-3xl font-semibold text-text1">Privacy Choices</h1>
      <p className="mt-3 text-text3">
        Use this page to manage account export, account deletion, and the one optional browser preference that changes current runtime behavior: whether third-party media stays external-only.
      </p>

      <div className="mt-6">
        <PrivacyChoicesClient />
      </div>
    </div>
  );
}
