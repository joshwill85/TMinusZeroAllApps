import { PREMIUM_TERMS_LAST_UPDATED_LABEL } from '@tminuszero/domain';
import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';
import { getPublicSiteUrl } from '@/src/config/api';

export default function TermsScreen() {
  const publicSiteUrl = getPublicSiteUrl();

  return (
    <LegalSummaryScreen
      testID="legal-terms-screen"
      eyebrow="Legal"
      title="Terms of Service"
      description="Core customer terms for using T-Minus Zero, including subscriptions, push alerts, and acceptable use."
      lastUpdated={PREMIUM_TERMS_LAST_UPDATED_LABEL}
      actions={[
        { label: 'Privacy notice', href: '/legal/privacy' },
        { label: 'Support', href: '/support', variant: 'secondary' },
        { label: 'Full terms on web', externalUrl: `${publicSiteUrl}/legal/terms`, variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'Service scope',
          body: 'T-Minus Zero provides launch schedules, related content, and optional push alerts for informational use.',
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
            'Pricing and plan details are shown before you confirm purchase.',
            'Subscriptions renew until canceled.',
            'Store-billed subscriptions are managed through the App Store or Google Play after purchase. Web-billed subscriptions are managed on the web.',
            'Cancellation stops future renewal and access continues through the current paid period unless stated otherwise.',
            'Fees are generally non-refundable except where required by law.'
          ]
        },
        {
          title: 'Push alerts',
          body: 'Push alerts are optional and managed in the mobile app.',
          bullets: [
            'Register a device from the notification settings screen.',
            'Message frequency varies by the launches you follow.',
            'Keep your device notifications enabled to receive alerts.',
            'You can disable alerts at any time from the app.'
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
            'Deleting an account while subscribed may still require subscription cancellation handling.',
            'Support and account-request details are available from the native Support and Privacy surfaces.'
          ]
        }
      ]}
    />
  );
}
