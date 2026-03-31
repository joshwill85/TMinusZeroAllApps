import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `About | ${BRAND_NAME}`,
  description: `What ${BRAND_NAME} is and why it exists.`,
  alternates: { canonical: '/docs/about' }
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">About</p>
      <h1 className="text-3xl font-semibold text-text1">Why T-Minus Zero?</h1>
      <p className="mt-3 text-sm text-text2">
        Built for launch fans and operators who want a fast, trustworthy signal on what is happening across launches and related reference data. The native mobile app is now the place for push
        alerts and device-level notification management.
      </p>
    </div>
  );
}
