import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import { buildSmsOptInConfirmationMessage, buildSmsStartMessage, buildSmsStopMessage, prefixSmsWithBrand } from '@/lib/notifications/smsProgram';

export const metadata: Metadata = {
  title: `SMS Opt-In | ${BRAND_NAME}`,
  description: `How to opt in to ${BRAND_NAME} SMS alerts and required disclosures.`,
  alternates: { canonical: '/docs/sms-opt-in' }
};

const sampleMessages: string[] = [
  prefixSmsWithBrand('Falcon 9 | Starlink 6-98 T-10. Launch at Jan 14, 6:08 PM UTC. Status: go'),
  prefixSmsWithBrand('Falcon 9 | Starlink 6-98 status update: Success (was In Flight). Launch at Jan 14, 6:08 PM UTC.'),
  prefixSmsWithBrand('Falcon 9 | Starlink 6-98 time updated: Jan 14, 6:08 PM UTC (was Jan 14, 6:01 PM UTC). Status: go.'),
  buildSmsOptInConfirmationMessage(),
  buildSmsStartMessage(),
  buildSmsStopMessage()
];

export default function SmsOptInPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Docs</p>
      <h1 className="text-3xl font-semibold text-text1">SMS Opt-In (Call-to-Action)</h1>
      <p className="mt-3 text-sm text-text2">
        This page documents how users opt in to receive SMS alerts from {BRAND_NAME}. It exists to provide a publicly accessible Call-to-Action (CTA) reference for compliance review.
      </p>

      <div className="mt-6 rounded-xl border border-stroke bg-surface-1 p-4">
        <p className="text-sm font-semibold text-text1">Status: Coming soon</p>
        <p className="mt-1 text-sm text-text2">
          SMS alerts are currently unavailable while we complete US A2P 10DLC carrier registration. This page describes the SMS program, consent flow, and required disclosures.
        </p>
      </div>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">Program Summary</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Sender/brand</span>: {BRAND_NAME}
          </li>
          <li>
            <span className="text-text1">Purpose</span>: recurring automated rocket launch alerts you select (scheduled reminders such as T-10 and status/timing updates).
          </li>
          <li>
            <span className="text-text1">Message origin</span>: +1 407 588 8658 (US 10DLC long code; sent via our Twilio Messaging Service).
          </li>
          <li>
            <span className="text-text1">Support</span>:{' '}
            <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">How Users Consent (Opt-In Flow)</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Users create an account and sign in.</li>
          <li>Users can optionally upgrade to Premium. Purchasing Premium is separate from SMS consent, and SMS opt-in is not required to subscribe.</li>
          <li>
            Users open Notifications at{' '}
            <span className="rounded border border-stroke bg-surface-0 px-2 py-0.5 text-xs text-text3">/me/preferences</span>.
          </li>
          <li>Users enter a US phone number.</li>
          <li>Users review the disclosure below and check an unchecked-by-default consent checkbox.</li>
          <li>Users request a one-time verification code and enter it to confirm phone ownership.</li>
          <li>Users enable “SMS alerts” and save preferences to opt in.</li>
        </ol>
      </section>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">Required Disclosures (Shown at Opt-In)</h2>
        <div className="rounded-xl border border-stroke bg-surface-1 p-4">
          <p>
            By enabling SMS alerts, you agree to receive recurring automated text messages from {BRAND_NAME} about rocket launch alerts you select. Message frequency varies. Message and data rates
            may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See{' '}
            <Link className="text-primary hover:underline" href="/legal/terms#sms-alerts">
              Terms
            </Link>{' '}
            (SMS Alerts section) and{' '}
            <Link className="text-primary hover:underline" href="/legal/privacy">
              Privacy
            </Link>
            .
          </p>
          <p className="mt-2">
            No mobile information (including opt-in data and consent) will be shared with third parties or affiliates for marketing or promotional purposes.
          </p>
        </div>
      </section>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">Opt-Out and Help</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Opt out</span>: reply <span className="rounded border border-stroke bg-surface-0 px-2 py-0.5 text-xs text-text3">STOP</span> to stop receiving SMS
            alerts.
          </li>
          <li>
            <span className="text-text1">Re-subscribe</span>: reply{' '}
            <span className="rounded border border-stroke bg-surface-0 px-2 py-0.5 text-xs text-text3">START</span> to re-subscribe.
          </li>
          <li>
            <span className="text-text1">Help</span>: reply{' '}
            <span className="rounded border border-stroke bg-surface-0 px-2 py-0.5 text-xs text-text3">HELP</span> or email{' '}
            <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">Sample Messages</h2>
        <div className="space-y-2">
          {sampleMessages.map((msg) => (
            <div key={msg} className="rounded-xl border border-stroke bg-surface-1 p-4 font-mono text-xs text-text2">
              {msg}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
