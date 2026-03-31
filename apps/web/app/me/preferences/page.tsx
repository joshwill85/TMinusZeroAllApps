import Link from 'next/link';
import { buildProfileHref } from '@tminuszero/navigation';
import { BRAND_NAME } from '@/lib/brand';

export default function PreferencesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Profile</p>
      <h1 className="text-3xl font-semibold text-text1">Notifications</h1>
      <p className="mt-3 text-sm text-text2">
        {BRAND_NAME} is moving to native mobile push only for launch alerts. Web no longer manages legacy notification subscriptions.
      </p>

      <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
        <div className="text-xs uppercase tracking-[0.1em] text-text3">Current setup</div>
        <div className="mt-2 text-base font-semibold text-text1">Push alerts live in the mobile app</div>
        <p className="mt-2">
          Use the native iOS or Android app to manage launch alerts, device registration, and alert rules. The web surface now stays read-only for this area so nothing legacy can be changed here by
          accident.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
        <div className="text-xs uppercase tracking-[0.1em] text-text3">What still works here</div>
        <p className="mt-2">
          Profile basics, account access, and marketing email preferences remain available elsewhere in your account. Essential account email flows are unchanged.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link className="btn rounded-lg px-4 py-2 text-xs" href={buildProfileHref()}>
            Open profile
          </Link>
          <Link className="text-xs text-primary hover:underline" href="/account">
            Open account
          </Link>
        </div>
      </div>
    </div>
  );
}
