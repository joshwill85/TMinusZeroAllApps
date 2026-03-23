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
          This Privacy Notice explains how {BRAND_NAME} (“{BRAND_NAME}”, “we”, “us”) collects, uses, and discloses information when you use our website,
          apps, and related services (the “Service”). This notice is written for a US audience and includes common state privacy rights.
        </p>
        <p>
          For privacy choices and self‑serve requests, visit{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Privacy Choices
          </a>{' '}
          on web, or use the in-app delete-account flow from the mobile Profile screen if you want to remove your account.
        </p>
        <p>
          Depending on the platform and feature you use, some data handling differs between web and mobile surfaces. This notice describes the full Service, including web billing,
          App Store / Google Play billing, mobile push registration, and limited AR telemetry.
        </p>

        <h2 className="text-xl font-semibold text-text1">Information We Collect</h2>
        <p>We collect information you provide, information collected automatically when you use the Service, and information from vendors that help run the Service.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Account information</span>: name, email address, account identifiers, timezone, and authentication information. If you choose a third-party sign-in option that
            we enable on your platform (for example Google, X, or Apple when offered), we receive your email address and basic profile information from that provider.
          </li>
          <li>
            <span className="text-text1">Notification information</span>: phone number (if you opt into SMS), verification status, opt‑in/out timestamps, quiet hours, alert preferences, and SMS consent/compliance records (for example, action history and request metadata such as IP address and user agent).
          </li>
          <li>
            <span className="text-text1">User preferences</span>: per-launch notification settings, watchlists, filter presets, alert rules, and related account preferences.
          </li>
          <li>
            <span className="text-text1">Billing information</span>: subscription status and provider transaction, customer, or subscription identifiers from Stripe, the App Store, or Google Play.
            Payment card details are processed by Stripe and are not stored in our database.
          </li>
          <li>
            <span className="text-text1">Communications</span>: feedback you submit (such as your email address and message) and messages you send to our support inbox.
          </li>
          <li>
            <span className="text-text1">Email preferences</span>: whether you opt in/out of marketing emails (if offered).
          </li>
          <li>
            <span className="text-text1">Push notification information</span> (if enabled): web push subscription endpoint and keys, or mobile push registration data such as platform, installation ID,
            push token, app version, and device name.
          </li>
          <li>
            <span className="text-text1">Automatic data</span>: IP address, device and browser information (such as user agent), app/build information, usage and diagnostic data, limited feature
            telemetry (including AR session summaries), and mobile auth risk / attestation events used to secure sign-in.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">How We Use Information</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide and operate the Service (launch schedule, notifications, and account features).</li>
          <li>Authenticate users, evaluate auth risk, prevent abuse, and secure the Service (including optional CAPTCHA or similar challenge flows).</li>
          <li>Process payments and manage subscriptions.</li>
          <li>Send service communications (verification, alerts you request, and account/billing notices).</li>
          <li>If we send marketing emails, we do so only if you opt in and we provide unsubscribe options.</li>
          <li>Respond to feedback and support requests.</li>
          <li>Debug, maintain, and improve reliability (operational logs and monitoring).</li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">How We Disclose Information</h2>
        <p>We disclose personal information to service providers and vendors that process data on our behalf to provide the Service, such as:</p>
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
            <span className="text-text1">Apple</span> (App Store billing and subscription management for iOS purchases, and Sign in with Apple when enabled on iOS).
          </li>
          <li>
            <span className="text-text1">Google</span> (Google Play billing and subscription management for Android purchases, and Google sign-in where offered).
          </li>
          <li>
            <span className="text-text1">Twilio</span> (SMS delivery and phone verification). You can opt out of SMS alerts at any time by replying STOP (or reply HELP for support). We do not share
            mobile information (including opt‑in data and consent) with third parties or affiliates for marketing or promotional purposes.
          </li>
          <li>
            <span className="text-text1">Resend</span> (email delivery for service emails and optional email notifications).
          </li>
          <li>
            <span className="text-text1">Google Workspace</span> (support email inbox and related business tools).
          </li>
          <li>
            <span className="text-text1">Sign-in providers</span> (such as Google, X, and Apple when enabled on a supported platform) if you choose to use those login options.
          </li>
          <li>
            <span className="text-text1">CAPTCHA providers</span> (Cloudflare Turnstile or hCaptcha) if enabled for account protection.
          </li>
          <li>
            <span className="text-text1">Embedded content providers</span> (e.g., YouTube/Vimeo) if you choose to load embedded video.
          </li>
        </ul>
        <p>
          We do not “sell” personal information. We do not “share” personal information (as those terms are defined under California law). Third‑party services you choose to use through the
          Service (such as Stripe checkout or embedded video) may collect information directly and use it according to their policies.
        </p>

        <h2 className="text-xl font-semibold text-text1">Cookies, Local Storage, and Similar Technologies</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>We use cookies needed to keep you signed in and to secure the Service (session cookies).</li>
          <li>We use local storage for certain user experience features (for example, the iOS “Add to Home Screen” reminder cadence).</li>
          <li>Third‑party services you use through the Service (for example, Stripe checkout or embedded video) may set their own cookies or collect device data.</li>
        </ul>

        <h2 className="text-xl font-semibold text-text1">Sensitive Personal Information</h2>
        <p>
          Some data elements (such as account login credentials and payment information) may be considered “sensitive” under certain privacy laws. We use sensitive data only as
          reasonably necessary to provide the Service (for example, to authenticate you, secure the Service, and process payments through our payment processor).
        </p>

        <h2 className="text-xl font-semibold text-text1">Data Retention</h2>
        <p>
          We retain personal information for as long as reasonably necessary to provide the Service, comply with law, resolve disputes, and enforce agreements. In general:
          account, profile, saved-item, alert, and preference data is retained until you delete your account; operational and security records may be retained for troubleshooting, fraud prevention,
          abuse prevention, and compliance; and billing records may be retained by Stripe, Apple, Google, or by us where required by law.
        </p>

        <h2 className="text-xl font-semibold text-text1">Your US Privacy Rights</h2>
        <p>
          Depending on your state of residence and the nature of our processing, you may have rights to access, correct, delete, or obtain a copy of your personal information, and to
          opt out of certain processing (such as certain disclosures treated as “sale” or “sharing” of personal information under some laws).
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Access/know</span>: request the categories and specific pieces of personal information we hold about you.
          </li>
          <li>
            <span className="text-text1">Delete</span>: request deletion of personal information, subject to certain legal and operational exceptions.
          </li>
          <li>
            <span className="text-text1">Correct</span>: request correction of inaccurate personal information.
          </li>
          <li>
            <span className="text-text1">Portability</span>: request a copy of your information in a portable format.
          </li>
          <li>
            <span className="text-text1">Opt out</span>: opt out of certain disclosures treated as “sale” or “sharing” under some state laws (if applicable).
          </li>
          <li>
            <span className="text-text1">Limit</span>: in some states, request limits on use/disclosure of “sensitive” personal information (if applicable).
          </li>
        </ul>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Self‑serve</span>: use{' '}
            <a className="text-primary hover:underline" href="/legal/privacy-choices">
              Privacy Choices
            </a>{' '}
            to download your data, or use Privacy Choices on web or the in-app mobile Profile flow to delete your account (if signed in).
          </li>
          <li>
            <span className="text-text1">Email</span>: send requests to{' '}
            <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </li>
        </ul>
        <p>
          We may need to verify your identity before fulfilling requests. Authorized agents may submit requests where permitted by law, subject to verification. We will not discriminate against you
          for exercising privacy rights. Some states provide a right to appeal a denial; include “Appeal” in your email subject if you want to appeal a decision.
        </p>
        <p>
          If your browser sends a Global Privacy Control (GPC) signal (also called an opt‑out preference signal), we treat it as a request to opt out of “sale”/“sharing” where those concepts
          apply.
        </p>

        <h2 className="text-xl font-semibold text-text1">California Disclosures</h2>
        <p>
          If you are a California resident, this section provides additional disclosures for the past 12 months.
        </p>
        <p className="text-text1">Categories of personal information collected</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-text1">Identifiers</span>: name, email address, phone number (if you opt into SMS), account identifiers, IP address, and push notification or mobile device
            registration identifiers (if enabled).
          </li>
          <li>
            <span className="text-text1">Personal information categories listed in Cal. Civ. Code § 1798.80</span>: name, email address, and phone number.
          </li>
          <li>
            <span className="text-text1">Commercial information</span>: subscription status and transaction identifiers.
          </li>
          <li>
            <span className="text-text1">Internet or other electronic network activity information</span>: interactions with the Service, push notification or mobile device registration data, limited
            feature telemetry (for example, AR session summaries such as permission status, device category, and session duration), and auth security/risk events.
          </li>
          <li>
            <span className="text-text1">Geolocation data</span>: precise location only if you enable AR features in your browser (used on-device; we do not store your precise location in our database).
          </li>
          <li>
            <span className="text-text1">Audio, electronic, visual, or similar information</span>: camera access for AR features (we do not record or store camera video/audio).
          </li>
        </ul>
        <p>
          We do not “sell” or “share” personal information (as those terms are defined under California law).
        </p>
        <p>
          We disclose the categories of personal information described above to service providers for business purposes, such as authentication and database providers, hosting and content delivery
          networks, payment processors, communications providers (SMS and email), and support tools.
        </p>
        <p>
          To exercise your California privacy rights, use{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Privacy Choices
          </a>{' '}
          or email us at{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <p>
          We do not disclose personal information to third parties for their own direct marketing purposes.
        </p>

        <h2 className="text-xl font-semibold text-text1">Profiling</h2>
        <p>
          We do not use personal information to conduct profiling in furtherance of decisions that produce legal or similarly significant effects about you (as those terms are used in some state
          privacy laws).
        </p>

        <h2 className="text-xl font-semibold text-text1">Children</h2>
        <p>The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13.</p>

        <h2 className="text-xl font-semibold text-text1">Security</h2>
        <p>We use reasonable administrative, technical, and physical safeguards designed to protect personal information, including TLS in transit and database access controls.</p>

        <h2 className="text-xl font-semibold text-text1">Contact</h2>
        <p>
          Contact:{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-text1">Changes</h2>
        <p>We may update this notice from time to time. Material changes will be communicated in the Service or through other appropriate channels.</p>
      </section>
    </div>
  );
}
