import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Notifications | ${BRAND_NAME}`,
  description: `Native push notification guidance for ${BRAND_NAME}.`,
  alternates: { canonical: '/docs/sms-opt-in' }
};

export default function NotificationsGuidePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Docs</p>
      <h1 className="text-3xl font-semibold text-text1">Native Push Notifications</h1>
      <p className="mt-3 text-sm text-text2">
        {BRAND_NAME} now uses native iOS and Android push only for launch alerts. This page replaces the legacy SMS disclosure flow and exists as a stable reference for the mobile-first
        notification setup.
      </p>

      <div className="mt-6 rounded-xl border border-stroke bg-surface-1 p-4">
        <p className="text-sm font-semibold text-text1">Where to manage alerts</p>
        <p className="mt-1 text-sm text-text2">
          Open the mobile app, then use the notification settings screen to register a device and manage push alert scopes.
        </p>
      </div>

      <section className="mt-8 space-y-3 text-sm text-text2">
        <h2 className="text-xl font-semibold text-text1">Quick links</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Link className="text-primary hover:underline" href="/preferences">
              Notification settings
            </Link>
          </li>
          <li>
            <Link className="text-primary hover:underline" href="/legal/privacy">
              Privacy notice
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
