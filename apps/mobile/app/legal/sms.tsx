import { LegalSummaryScreen } from '@/src/features/account/LegalSummaryScreen';

export default function NotificationsPolicyRoute() {
  return (
    <LegalSummaryScreen
      testID="legal-sms-screen"
      eyebrow="Legal"
      title="Notification Policy"
      description="Native push notification guidance and device-level alert behavior."
      lastUpdated="Jan 20, 2026"
      actions={[
        { label: 'Notification settings', href: '/preferences' },
        { label: 'Privacy notice', href: '/legal/privacy', variant: 'secondary' }
      ]}
      sections={[
        {
          title: 'Program summary',
          body: 'Launch alerts are delivered through native push notifications on iOS and Android.',
          bullets: [
            'Message frequency varies based on the launches you follow.',
            'Keep your device notifications enabled to receive alerts.',
            'Alerts can be disabled at any time from the app.'
          ]
        },
        {
          title: 'Setup',
          body: 'Open notification settings, register the device, and choose the alert scopes you want.',
          bullets: [
            'Use the native app for alert management.',
            'Device registration happens locally in the app.',
            'Push delivery follows the operating system notification settings.'
          ]
        }
      ]}
    />
  );
}
