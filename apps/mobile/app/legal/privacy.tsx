import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';
import { getPublicSiteUrl } from '@/src/config/api';

export default function PrivacyNoticeScreen() {
  const publicSiteUrl = getPublicSiteUrl();

  return (
    <LegalSummaryScreen
      testID="legal-privacy-screen"
      eyebrow="Legal"
      title="Privacy Notice"
      description="How T-Minus Zero collects, uses, and discloses account, authentication, billing, push, diagnostics, and support data."
      lastUpdated="Apr 3, 2026"
      actions={[
        { label: 'Privacy choices', href: '/legal/privacy-choices' },
        { label: 'Support', href: '/support', variant: 'secondary' },
        { label: 'Full policy on web', externalUrl: `${publicSiteUrl}/legal/privacy`, variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'What we collect',
          body: 'We collect the information needed to run launch tracking, account, billing, push, and support features across the mobile app and connected services.',
          bullets: [
            'Account data such as name, email, timezone, authentication identifiers, and account-provider metadata.',
            'Push registration data such as platform, installation ID, push token, app version, and device name.',
            'Billing state such as subscription status and processor identifiers. Payment card details stay with the payment processor.',
            'Support and feedback communications that you send to us.',
            'Operational data such as IP address, device/app details, usage diagnostics, limited feature telemetry, and sign-in security or attestation events.'
          ]
        },
        {
          title: 'How we use it',
          body: 'Collected information is used to provide the service, secure it, process subscriptions, send the alerts you request, and support the product.',
          bullets: [
            'Run launch schedules, saved items, notifications, and account features.',
            'Authenticate users and prevent abuse.',
            'Send service emails, optional marketing emails if you opt in, and support replies.',
            'Improve reliability with operational diagnostics.'
          ]
        },
        {
          title: 'Who processes it',
          body: 'We rely on standard infrastructure, communications, and platform vendors to operate the service.',
          bullets: [
            'Authentication and database infrastructure.',
            'Hosting, content delivery, and security services.',
            'Subscription billing and payment processing through Apple, Google, or Stripe where applicable.',
            'Email, support, and push infrastructure.'
          ]
        },
        {
          title: 'Your rights',
          body: 'Depending on your state, you may have rights to access, delete, correct, or export your information. The native Privacy Choices screen is the mobile self-serve path for supported account requests.',
          bullets: [
            'Access or export your account data.',
            'Delete your account subject to billing, fraud-prevention, and legal constraints.',
            'If you use Sign in with Apple, account deletion also revokes that Apple connection when available.',
            'Browser-specific media controls for embedded X, YouTube, and Vimeo content live on the website.'
          ]
        }
      ]}
    />
  );
}
