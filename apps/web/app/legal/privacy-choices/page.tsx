import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { PrivacyChoicesClient } from './privacy-choices-client';

export const metadata: Metadata = {
  title: `Privacy Choices | ${BRAND_NAME}`,
  description: `Manage privacy preferences and exercise available consumer privacy rights for ${BRAND_NAME}.`,
  alternates: { canonical: '/legal/privacy-choices' }
};

export default function PrivacyChoicesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <h1 className="text-3xl font-semibold text-text1">Privacy Choices</h1>
      <p className="mt-3 text-text3">
        Use this page to manage privacy preferences and exercise available consumer privacy rights (access/export, correction, deletion, and opt‑outs such as “Do Not Sell or Share”).
      </p>

      <div className="mt-6">
        <PrivacyChoicesClient />
      </div>
    </div>
  );
}
