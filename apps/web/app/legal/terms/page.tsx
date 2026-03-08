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
      <p className="mt-3 text-text3">Last updated: January 30, 2026</p>

      <section className="mt-6 space-y-4">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of {BRAND_NAME} (the &quot;Service&quot;). By accessing or using the Service, you agree to these Terms. If you do not agree, do
          not use the Service.
        </p>

        <h2 className="text-xl font-semibold text-text1">About the Service</h2>
        <p>
          The Service provides launch schedule information, related content, and optional notifications. Launch times, status, and other details can change quickly and may be incomplete or
          inaccurate.
        </p>
        <p>
          The Service is provided for informational purposes only and is not intended for safety‑critical, emergency, or mission‑critical use. Do not rely on the Service for safety decisions.
        </p>

        <h2 className="text-xl font-semibold text-text1">Eligibility</h2>
        <p>
          You must be at least 13 years old to use the Service. If you are under 18, you may use the Service only with involvement of a parent or legal guardian. You must be at least 18 to
          purchase a paid subscription or make a Tip Jar payment.
        </p>

        <h2 className="text-xl font-semibold text-text1">Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account. If you use a third‑party sign‑in option, your use of that
          provider is also subject to its terms.
        </p>

        <h2 className="text-xl font-semibold text-text1">Privacy</h2>
        <p>
          Our{' '}
          <a className="text-primary hover:underline" href="/legal/privacy">
            Privacy Notice
          </a>{' '}
          explains how we collect, use, and disclose information when you use the Service.
        </p>

        <h2 className="text-xl font-semibold text-text1">Subscriptions</h2>
        <p>
          Some parts of the Service require a paid subscription. Pricing and plan details are shown before you check out.
        </p>
        <p>
          If you purchase a subscription, you authorize us (and our payment processor) to charge your payment method on a recurring basis until you cancel. Subscriptions renew automatically each
          billing period until canceled.
        </p>
        <p>
          You can cancel anytime from your Account page (Billing) or through the billing portal provided by our payment processor. When you cancel, your subscription remains active until the end of
          your then‑current billing period and you will not be charged again unless you resubscribe.
        </p>
        <p>
          Fees are non‑refundable except as required by law or as we may agree in writing. Taxes may apply depending on your location. Promotion codes (if offered) are subject to their terms and may
          not be combined unless stated otherwise.
        </p>

        <h2 className="text-xl font-semibold text-text1">Tip Jar</h2>
        <p>
          We may offer an optional Tip Jar as either a one‑time payment or a recurring contribution to support the Service. Tips are voluntary, do not provide additional features unless we
          explicitly say so, and are non‑refundable except as required by law.
        </p>
        <p>
          If you choose a recurring tip, you authorize us (and our payment processor) to charge your payment method on a recurring basis until you cancel. You can cancel recurring tips through the
          billing portal (if available) or by contacting support.
        </p>

        <h2 id="sms-alerts" className="text-xl font-semibold text-text1">
          SMS Alerts
        </h2>
        <p>
          SMS alerts (if enabled) are optional and require your consent. The SMS program terms below apply if you opt in to receive text messages from {BRAND_NAME}. You can use the Service without
          SMS alerts.
        </p>
        <h3 className="text-base font-semibold text-text1">Program Description</h3>
        <p>
          {BRAND_NAME} sends recurring automated SMS notifications about rocket launches you select, including scheduled reminders (for example, T‑10) and status/timing change alerts for launches
          you follow. The SMS program is currently intended for US phone numbers.
        </p>
        <h3 className="text-base font-semibold text-text1">Opt In</h3>
        <p>
          You opt in through your account by entering your phone number, completing one‑time phone verification, and enabling SMS alerts after agreeing to the on‑screen disclosure.
        </p>
        <h3 className="text-base font-semibold text-text1">Message Frequency and Charges</h3>
        <p>
          Message frequency varies based on the launches you follow and your alert settings. Message and data rates may apply. {BRAND_NAME} does not charge for SMS alerts, but your mobile carrier may.
          Consent is not a condition of purchase.
        </p>
        <h3 className="text-base font-semibold text-text1">Opt Out</h3>
        <p>
          Reply STOP to cancel SMS alerts at any time. After you opt out, you will no longer receive SMS alerts unless you re‑subscribe. Reply START to re‑subscribe.
        </p>
        <h3 className="text-base font-semibold text-text1">Help</h3>
        <p>
          Reply HELP for support, or contact{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <h3 className="text-base font-semibold text-text1">Delivery</h3>
        <p>SMS delivery is best effort and may be delayed or unavailable. Carriers are not liable for delayed or undelivered messages.</p>
        <h3 className="text-base font-semibold text-text1">Your Responsibilities</h3>
        <ul className="list-disc space-y-2 pl-5">
          <li>You represent that you are authorized to enroll the phone number you provide.</li>
          <li>Keep your phone number up to date in your account; alerts may be sent to the most recent number associated with your profile.</li>
          <li>Do not use SMS alerts in a way that violates law or these Terms.</li>
        </ul>
        <h3 className="text-base font-semibold text-text1">Managing Alerts</h3>
        <p>
          Manage your SMS preferences in your account:{' '}
          <a className="text-primary hover:underline" href="/me/preferences">
            /me/preferences
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-text1">Acceptable Use</h2>
        <p>You agree not to misuse the Service. For example, you will not:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Reverse engineer, decompile, or attempt to extract source code from the Service except where prohibited by law.</li>
          <li>Scrape, crawl, or access the Service in a way that exceeds reasonable rate limits or interferes with availability.</li>
          <li>Bypass or attempt to bypass paywalls, entitlements, security features, or access controls.</li>
          <li>Use the Service for unlawful, harmful, or abusive activities.</li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">Feedback</h2>
        <p>
          If you submit feedback or suggestions, you grant us a non‑exclusive, worldwide, royalty‑free right to use, modify, and incorporate your feedback into the Service without compensation.
        </p>

        <h2 className="text-xl font-semibold text-text1">Data Sources</h2>
        <p>
          Launch data and related content are provided by third‑party sources. See{' '}
          <a className="text-primary hover:underline" href="/legal/data">
            Data Use
          </a>{' '}
          for sources and attribution.
        </p>

        <h2 className="text-xl font-semibold text-text1">Third‑Party Services</h2>
        <p>
          The Service may integrate with or rely on third‑party services (for example, sign‑in providers, payment processing, and embedded content). Third‑party services may have their own terms
          and policies, and we are not responsible for third‑party services or their availability.
        </p>

        <h2 className="text-xl font-semibold text-text1">Ownership</h2>
        <p>
          We and our licensors own the Service, including its software, design, and branding. Subject to these Terms, we grant you a limited, non‑exclusive, non‑transferable, revocable license to
          use the Service for your personal or internal business purposes. Third‑party data, trademarks, and other content displayed through the Service remain owned by their respective owners.
        </p>

        <h2 className="text-xl font-semibold text-text1">Disclaimers</h2>
        <p>
          To the extent permitted by law, the Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, whether express, implied, or statutory, including
          implied warranties of merchantability, fitness for a particular purpose, and non‑infringement.
        </p>

        <h2 className="text-xl font-semibold text-text1">Limitation of Liability</h2>
        <p>
          To the extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, use, goodwill, or other intangible
          losses.
        </p>
        <p>
          To the extent permitted by law, our total liability for any claim arising out of or relating to the Service will not exceed the amount you paid to us for the Service during the three (3)
          months before the event giving rise to the claim.
        </p>
        <p>
          Some jurisdictions do not allow certain limitations of liability or warranties, so some of the above may not apply to you.
        </p>

        <h2 className="text-xl font-semibold text-text1">Indemnification</h2>
        <p>
          To the extent permitted by law, you agree to indemnify and hold us harmless from any claims, liabilities, damages, losses, and expenses (including reasonable attorneys&apos; fees) arising
          out of or related to your violation of these Terms or your misuse of the Service.
        </p>

        <h2 className="text-xl font-semibold text-text1">Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate accounts that violate these Terms or abuse the Service. If you delete your account while you have an active
          subscription, we will request cancellation at the end of the current billing period to prevent renewal, but deleting your account may result in losing access immediately.
        </p>

        <h2 className="text-xl font-semibold text-text1">Changes to the Service or Terms</h2>
        <p>
          We may update the Service and these Terms from time to time. When we update these Terms, we will update the &quot;Last updated&quot; date above. By continuing to use the Service after
          changes become effective, you agree to the updated Terms.
        </p>

        <h2 className="text-xl font-semibold text-text1">Miscellaneous</h2>
        <p>
          If any provision of these Terms is found unenforceable, the remaining provisions will remain in effect. We may assign these Terms in connection with a merger, acquisition, or sale of
          assets. We are not responsible for delays or failures caused by events beyond our reasonable control.
        </p>

        <h2 className="text-xl font-semibold text-text1">Governing Law</h2>
        <p>These Terms are governed by the laws of the State of Florida, without regard to conflict of law principles.</p>

        <h2 className="text-xl font-semibold text-text1">Venue</h2>
        <p>
          To the extent permitted by law, you agree that disputes arising out of or relating to these Terms or the Service will be brought in state or federal courts located in Florida, and you
          consent to personal jurisdiction in those courts.
        </p>

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
