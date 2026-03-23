import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';

export default function SmsTermsRoute() {
  return (
    <LegalSummaryScreen
      testID="legal-sms-screen"
      eyebrow="Legal"
      title="SMS Terms"
      description="Required disclosures and opt-out rules for SMS launch alerts."
      lastUpdated="Jan 20, 2026"
      actions={[
        { label: 'SMS opt-in guide', href: '/docs/sms-opt-in' },
        { label: 'Privacy notice', href: '/legal/privacy', variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'Program summary',
          body: 'SMS alerts are used for launch reminders and status updates that the customer explicitly requests.',
          bullets: [
            'Message frequency varies based on alert settings.',
            'Message and data rates may apply.',
            'Consent is not a condition of purchase.'
          ]
        },
        {
          title: 'Consent and verification',
          body: 'Users should actively opt in, verify a US phone number, and then save their SMS settings.',
          bullets: [
            'Checkboxes should be unchecked by default.',
            'Verification should complete before SMS is marked enabled.',
            'The app should surface the exact account state after saving.'
          ]
        },
        {
          title: 'Opt-out and help',
          body: 'Users need simple, documented commands to stop or recover SMS alerts.',
          bullets: [
            'Reply STOP to cancel.',
            'Reply START to re-subscribe.',
            'Reply HELP or contact support if something does not work as expected.'
          ]
        }
      ]}
    />
  );
}
