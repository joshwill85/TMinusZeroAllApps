import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';

export default function PrivacyNoticeScreen() {
  return (
    <LegalSummaryScreen
      testID="legal-privacy-screen"
      eyebrow="Legal"
      title="Privacy Notice"
      description="How T-Minus Zero collects, uses, and discloses account, push, billing, and diagnostics data."
      lastUpdated="Jan 20, 2026"
      actions={[
        { label: 'Privacy choices', href: '/legal/privacy-choices' },
        { label: 'Terms of service', href: '/legal/terms', variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'What we collect',
          body: 'We collect the information needed to run launch tracking, account, billing, push, and support features.',
          bullets: [
            'Account data such as name, email, timezone, and authentication identifiers.',
            'Push registration data such as platform, installation ID, push token, app version, and device name.',
            'Billing state such as subscription status and processor identifiers. Payment card details stay with the payment processor.',
            'Operational data such as IP address, device/app details, usage diagnostics, and limited feature telemetry.'
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
          body: 'We rely on standard infrastructure and communications vendors to operate the service.',
          bullets: [
            'Authentication and database infrastructure.',
            'Hosting, content delivery, and security services.',
            'Subscription billing and payment processing.',
            'Email and push infrastructure.'
          ]
        },
        {
          title: 'Your rights',
          body: 'Depending on your state, you may have rights to access, delete, correct, export, or opt out of certain processing. The native Privacy Choices screen is the mobile self-serve path for supported requests.',
          bullets: [
            'Access or export your account data.',
            'Delete your account subject to billing and legal constraints.',
            'Opt out of sale/sharing if applicable and limit sensitive-data use where required.',
            'Disable third-party embeds inside supported experiences.'
          ]
        }
      ]}
    />
  );
}
