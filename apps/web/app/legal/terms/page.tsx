import type { Metadata } from 'next';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Terms of Service | ${BRAND_NAME}`,
  description: `Terms that govern your use of ${BRAND_NAME}.`,
  alternates: { canonical: '/legal/terms' }
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <h1 className="text-3xl font-semibold text-text1">Terms of Service</h1>
      <p className="mt-3 text-text3">Last updated: March 19, 2026</p>

      <section className="mt-6 space-y-4">
        <p>
          These Terms of Service govern your use of {BRAND_NAME}. By accessing or using the Service, you agree to these Terms. If you do not agree, do not use the Service.
        </p>

        <h2 className="text-xl font-semibold text-text1">About the Service</h2>
        <p>
          The Service provides launch schedule information, related content, and optional push notifications through the native mobile app. Launch times, status, and other details can change
          quickly and may be incomplete or inaccurate.
        </p>

        <h2 className="text-xl font-semibold text-text1">Accounts</h2>
        <p>You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.</p>

        <h2 className="text-xl font-semibold text-text1">Privacy</h2>
        <p>
          Our{' '}
          <a className="text-primary hover:underline" href="/legal/privacy">
            Privacy Notice
          </a>{' '}
          explains how we collect, use, and disclose information when you use the Service.
        </p>

        <h2 className="text-xl font-semibold text-text1">Subscriptions</h2>
        <p>Some parts of the Service require a paid subscription. Pricing and plan details are shown before you check out.</p>
        <p>Subscriptions renew automatically each billing period until canceled.</p>

        <h2 className="text-xl font-semibold text-text1">Acceptable Use</h2>
        <p>You agree not to misuse the Service.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Do not scrape, crawl, or exceed reasonable rate limits.</li>
          <li>Do not reverse engineer or bypass entitlements or security features.</li>
          <li>Do not use the Service for unlawful, harmful, or abusive activities.</li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">Contact</h2>
        <p>
          For questions, contact:{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
