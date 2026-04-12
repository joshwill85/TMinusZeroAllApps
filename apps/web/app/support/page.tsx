import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';

const SUPPORT_TITLE = `${BRAND_NAME} Support | Billing, Account Help & Privacy Requests`;
const SUPPORT_DESCRIPTION = `Customer support, billing help, privacy requests, and contact details for ${BRAND_NAME}.`;

export const metadata: Metadata = buildPageMetadata({
  title: SUPPORT_TITLE,
  description: SUPPORT_DESCRIPTION,
  canonical: '/support'
});

export default function SupportPage() {
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'Support', item: '/support' }
    ]),
    buildWebPageJsonLd({
      canonical: '/support',
      name: 'T-Minus Zero Support',
      description: SUPPORT_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <JsonLd data={jsonLd} />
      <h1 className="text-3xl font-semibold text-text1">Support</h1>
      <p className="mt-3 text-text3">Last updated: April 3, 2026</p>

      <section className="mt-6 space-y-4">
        <p>
          Use this page for app support, bug reports, account help, billing
          questions, privacy requests, feedback, and feature requests. You can
          always reach us at{' '}
          <a
            className="text-primary hover:underline"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-text1">
          Fastest self-serve paths
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a
              className="text-primary hover:underline"
              href="/legal/privacy-choices"
            >
              Privacy Choices
            </a>{' '}
            for data export, account deletion, external-media preferences, and
            formal privacy requests.
          </li>
          <li>
            Profile or Billing in the mobile app for Premium purchase, restore
            purchases, and store-management links.
          </li>
          <li>
            <a className="text-primary hover:underline" href="/legal/privacy">
              Privacy Notice
            </a>{' '}
            and{' '}
            <a className="text-primary hover:underline" href="/legal/terms">
              Terms of Service
            </a>{' '}
            for current legal and data-handling details.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">
          Billing and subscriptions
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            App Store and Google Play subscriptions are purchased, restored,
            managed, and canceled through the respective store after purchase.
          </li>
          <li>Web-billed subscriptions are managed on the web.</li>
          <li>
            If you want to delete your account, cancel any active store
            subscription first if you do not want renewal to continue.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">
          What to include when you contact us
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>The email address tied to your account, if you have one.</li>
          <li>
            Your device, operating system, browser or app version, and billing
            provider if the issue is purchase-related.
          </li>
          <li>
            Clear reproduction steps, timestamps, screenshots, or screen
            recordings when available.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">Contact</h2>
        <p>
          Email:{' '}
          <a
            className="text-primary hover:underline"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
