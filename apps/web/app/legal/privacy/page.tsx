import type { Metadata } from 'next';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Privacy Notice | ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, and discloses information.`,
  alternates: { canonical: '/legal/privacy' }
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <h1 className="text-3xl font-semibold text-text1">Privacy Notice</h1>
      <p className="mt-3 text-text3">Last updated: March 19, 2026</p>

      <section className="mt-6 space-y-4">
        <p>
          This Privacy Notice explains how {BRAND_NAME} collects, uses, and discloses information when you use our website, apps, and related services.
        </p>
        <p>
          For privacy choices and self-serve requests, visit{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Privacy Choices
          </a>{' '}
          on web, or use the in-app delete-account flow from the mobile Profile screen if you want to remove your account.
        </p>

        <h2 className="text-xl font-semibold text-text1">Information We Collect</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Account information</span>: name, email address, account identifiers, timezone, and authentication information.
          </li>
          <li>
            <span className="text-text1">Notification information</span>: push registration data such as platform, installation ID, push token, app version, and device name.
          </li>
          <li>
            <span className="text-text1">User preferences</span>: launch alert settings, watchlists, filter presets, alert rules, and related account preferences.
          </li>
          <li>
            <span className="text-text1">Billing information</span>: subscription status and provider transaction, customer, or subscription identifiers from Stripe, the App Store, or Google Play.
          </li>
          <li>
            <span className="text-text1">Communications</span>: feedback you submit and messages you send to our support inbox.
          </li>
          <li>
            <span className="text-text1">Email preferences</span>: whether you opt in or out of marketing emails if offered.
          </li>
          <li>
            <span className="text-text1">Automatic data</span>: IP address, device and browser information, app/build information, usage and diagnostic data, limited feature telemetry, and mobile auth
            risk or attestation events used to secure sign-in.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">How We Use Information</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide and operate the Service.</li>
          <li>Authenticate users, prevent abuse, and secure the Service.</li>
          <li>Process payments and manage subscriptions.</li>
          <li>Send service communications such as verification and account/billing notices.</li>
          <li>If we send marketing emails, we do so only if you opt in and we provide unsubscribe options.</li>
          <li>Respond to feedback and support requests.</li>
          <li>Debug, maintain, and improve reliability.</li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">How We Disclose Information</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Supabase</span> (authentication, database, and related infrastructure).
          </li>
          <li>
            <span className="text-text1">Vercel</span> (web hosting and delivery).
          </li>
          <li>
            <span className="text-text1">Cloudflare</span> (DNS/CDN/security services).
          </li>
          <li>
            <span className="text-text1">Stripe</span> (payment processing and subscription management).
          </li>
          <li>
            <span className="text-text1">Apple</span> and <span className="text-text1">Google</span> for app billing and sign-in where enabled.
          </li>
          <li>
            <span className="text-text1">Resend</span> (email delivery for service emails).
          </li>
          <li>
            <span className="text-text1">Google Workspace</span> (support email inbox and related business tools).
          </li>
          <li>
            <span className="text-text1">Sign-in providers</span> when you choose those login options.
          </li>
          <li>
            <span className="text-text1">CAPTCHA providers</span> if enabled for account protection.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">Contact</h2>
        <p>
          Contact:{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
