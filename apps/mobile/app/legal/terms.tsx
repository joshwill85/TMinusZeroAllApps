import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';

export default function TermsScreen() {
  return (
    <LegalSummaryScreen
      testID="legal-terms-screen"
      eyebrow="Legal"
      title="Terms of Service"
      description="Core customer terms for using T-Minus Zero, including subscriptions, alerts, and acceptable use."
      lastUpdated="Jan 30, 2026"
      actions={[
        { label: 'Privacy notice', href: '/legal/privacy' },
        { label: 'Alert settings', href: '/preferences', variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'Service scope',
          body: 'T-Minus Zero provides launch schedules, related content, and optional alerts for informational use.',
          bullets: [
            'Launch times, status, and mission data can change quickly and may be incomplete.',
            'The service is not for safety-critical, emergency, or mission-critical decisions.',
            'You must be at least 13 to use the service and at least 18 for paid purchases.'
          ]
        },
        {
          title: 'Accounts and subscriptions',
          body: 'You are responsible for account activity and any recurring subscription charges you authorize.',
          bullets: [
            'Keep login credentials secure and current.',
            'Subscriptions renew until canceled.',
            'Cancellation stops future renewal and access continues through the current paid period unless stated otherwise.',
            'Fees are generally non-refundable except where required by law.'
          ]
        },
        {
          title: 'SMS and alerts',
          body: 'SMS alerts are optional, require consent, and are subject to carrier delivery behavior.',
          bullets: [
            'You opt in by adding a phone number, completing verification, and enabling SMS alerts.',
            'Message frequency varies by the launches you follow.',
            'Carrier messaging and data rates may apply.',
            'Reply STOP to opt out and HELP for support where supported.'
          ]
        },
        {
          title: 'Acceptable use',
          body: 'Do not misuse the service or attempt to bypass access controls.',
          bullets: [
            'Do not scrape or abuse the service beyond reasonable limits.',
            'Do not reverse engineer or attempt to bypass entitlements or security features.',
            'Do not use the service for unlawful, harmful, or abusive activity.'
          ]
        },
        {
          title: 'Legal limits',
          body: 'The service is provided as-is and liability is limited to the extent permitted by law.',
          bullets: [
            'Third-party data sources and embedded services keep their own terms and ownership.',
            'The service may change over time and terms may be updated with a revised date.',
            'Deleting an account while subscribed may still require subscription cancellation handling.'
          ]
        }
      ]}
    />
  );
}
