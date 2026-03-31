'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { buildAuthCallbackHref, buildAuthHref, buildPreferencesHref, buildProfileHref } from '@tminuszero/navigation';
import { BillingPanel } from '@/components/BillingPanel';
import { TipJarRecurringPanel } from '@/components/TipJarRecurringPanel';
import {
  applyGuestViewerState,
  useAdminAccessOverrideQuery,
  useDeleteAccountMutation,
  useMarketingEmailQuery,
  useProfileQuery,
  useUpdateAdminAccessOverrideMutation,
  useUpdateMarketingEmailMutation,
  useUpdateProfileMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';
import { getBrowserClient } from '@/lib/api/supabase';

export default function AccountPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();
  const marketingEmailQuery = useMarketingEmailQuery();
  const adminAccessOverrideQuery = useAdminAccessOverrideQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const updateAdminAccessOverrideMutation = useUpdateAdminAccessOverrideMutation();
  const updateMarketingEmailMutation = useUpdateMarketingEmailMutation();
  const deleteAccountMutation = useDeleteAccountMutation();

  const marketingLabelId = useId();

  const status: 'loading' | 'authed' | 'guest' = viewerSessionQuery.isPending
    ? 'loading'
    : viewerSessionQuery.data?.viewerId
      ? 'authed'
      : 'guest';

  const profile = profileQuery.data ?? null;
  const isPaid = entitlementsQuery.data?.isPaid ?? false;
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editTimezone, setEditTimezone] = useState('America/New_York');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState<boolean | null>(null);
  const [marketingMessage, setMarketingMessage] = useState<string | null>(null);
  const [marketingError, setMarketingError] = useState<string | null>(null);

  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendEmailMessage, setResendEmailMessage] = useState<string | null>(null);
  const [resendEmailError, setResendEmailError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [adminAccessMessage, setAdminAccessMessage] = useState<string | null>(null);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setEditFirstName(profile.firstName || '');
    setEditLastName(profile.lastName || '');
    setEditTimezone(profile.timezone || 'America/New_York');
  }, [profile]);

  useEffect(() => {
    if (status !== 'authed') {
      setMarketingEmailOptIn(null);
      return;
    }
    if (!marketingEmailQuery.data) return;
    setMarketingEmailOptIn(marketingEmailQuery.data.marketingEmailOptIn);
  }, [marketingEmailQuery.data, status]);

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const emailPremiumLocked = isPaid !== true;
  const emailVerified = Boolean(profile?.emailConfirmedAt);
  const isAdminViewer = viewerSessionQuery.data?.role === 'admin';
  const adminAccessOverride = adminAccessOverrideQuery.data?.adminAccessOverride ?? entitlementsQuery.data?.adminAccessOverride ?? null;
  const effectiveTier = entitlementsQuery.data?.tier ?? 'anon';
  const effectiveTierSource = entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = entitlementsQuery.data?.billingIsPaid === true;
  const premiumStatus = searchParams.get('premium');
  const showPremiumWelcome = premiumStatus === 'welcome' && isPaid === true;
  const profileFirstName = String(profile?.firstName || '').trim();
  const profileLastName = String(profile?.lastName || '').trim();
  const profileTimezone = String(profile?.timezone || 'America/New_York').trim();
  const nextFirstName = editFirstName.trim();
  const nextLastName = editLastName.trim();
  const nextTimezone = editTimezone.trim();
  const hasBlankedExistingName =
    (profileFirstName.length > 0 && nextFirstName.length === 0) || (profileLastName.length > 0 && nextLastName.length === 0);
  const hasProfileChanges =
    nextFirstName !== profileFirstName || nextLastName !== profileLastName || nextTimezone !== profileTimezone;
  const canSaveProfile = Boolean(
    status === 'authed' && nextTimezone && hasProfileChanges && !hasBlankedExistingName && !updateProfileMutation.isPending
  );
  const showLoading = status === 'loading' || (status === 'authed' && profileQuery.isPending && !profile);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!premiumStatus) return;
    if (premiumStatus === 'welcome' && isPaid !== true) return;

    const url = new URL(window.location.href);
    if (!url.searchParams.has('premium')) return;
    url.searchParams.delete('premium');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;

    try {
      window.history.replaceState(null, '', nextUrl);
    } catch {
      // Browser throttles replaceState when called too frequently.
    }
  }, [isPaid, premiumStatus]);

  async function resendVerificationEmail() {
    if (!profile?.email) return;
    setResendingEmail(true);
    setResendEmailMessage(null);
    setResendEmailError(null);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');
      const baseUrl = window.location.origin.replace(/\/+$/, '');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: profile.email,
        options: {
          emailRedirectTo: `${baseUrl}${buildAuthCallbackHref({ returnTo: '/account' })}`
        }
      });
      if (error) throw error;
      setResendEmailMessage(
        `Verification email sent to ${profile.email}. If you don’t see it within a few minutes, check your spam/junk folder (and Promotions).`
      );
    } catch (error: unknown) {
      setResendEmailError(getErrorMessage(error, 'Unable to resend verification email.'));
    } finally {
      setResendingEmail(false);
    }
  }

  async function saveProfile() {
    if (hasBlankedExistingName) {
      setProfileMessage(null);
      setProfileError('First and last name cannot be cleared once set.');
      return;
    }

    const payload: { firstName?: string; lastName?: string; timezone?: string } = {};
    if (nextFirstName && nextFirstName !== profileFirstName) payload.firstName = nextFirstName;
    if (nextLastName && nextLastName !== profileLastName) payload.lastName = nextLastName;
    if (nextTimezone !== profileTimezone) payload.timezone = nextTimezone;

    if (!Object.keys(payload).length) {
      setProfileMessage(null);
      setProfileError('No changes to save.');
      return;
    }

    setProfileMessage(null);
    setProfileError(null);
    try {
      const nextProfile = await updateProfileMutation.mutateAsync(payload);
      setEditFirstName(nextProfile.firstName || '');
      setEditLastName(nextProfile.lastName || '');
      setEditTimezone(nextProfile.timezone || 'America/New_York');
      setProfileMessage('Profile updated.');
    } catch (error: unknown) {
      setProfileError(getErrorMessage(error, 'Profile update failed'));
    }
  }

  async function updateMarketingOptIn(next: boolean) {
    if (status !== 'authed') return;
    setMarketingMessage(null);
    setMarketingError(null);
    const previous = marketingEmailOptIn;
    setMarketingEmailOptIn(next);
    try {
      const payload = await updateMarketingEmailMutation.mutateAsync(next);
      setMarketingEmailOptIn(payload.marketingEmailOptIn);
      setMarketingMessage(
        payload.marketingEmailOptIn
          ? 'Marketing emails enabled.'
          : 'Marketing emails disabled. Essential account emails will still be sent when needed.'
      );
    } catch (error: unknown) {
      setMarketingEmailOptIn(previous);
      setMarketingError(getErrorMessage(error, 'Failed to save'));
    }
  }

  async function updateAdminAccessOverride(next: 'anon' | 'premium' | null) {
    setAdminAccessMessage(null);
    setAdminAccessError(null);
    try {
      await updateAdminAccessOverrideMutation.mutateAsync({ adminAccessOverride: next });
      setAdminAccessMessage(
        next === null ? 'Default admin access restored.' : next === 'premium' ? 'Admin premium test mode is active.' : 'Admin free test mode is active.'
      );
    } catch (error: unknown) {
      setAdminAccessError(getErrorMessage(error, 'Unable to update admin access.'));
    }
  }

  async function deleteAccount() {
    setDeleteMessage(null);
    setDeleteError(null);
    try {
      await deleteAccountMutation.mutateAsync(deleteConfirm);
      const supabase = getBrowserClient();
      await supabase?.auth.signOut().catch(() => undefined);
      applyGuestViewerState(queryClient);
      setDeleteMessage('Account deleted.');
      setDeleteConfirm('');
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code === 'confirm_required') {
        setDeleteError('Type DELETE to confirm.');
        return;
      }
      if (code === 'active_subscription') {
        setDeleteError(
          'You have an active subscription and we could not cancel renewal automatically. Cancel billing first, then delete your account.'
        );
        return;
      }
      setDeleteError(getErrorMessage(error, 'Delete failed'));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Account</p>
      <h1 className="text-3xl font-semibold text-text1">Profile</h1>
      {deleteMessage && (
        <div className="mt-3 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {deleteMessage}
        </div>
      )}
      {deleteError && (
        <div className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {deleteError}
        </div>
      )}
      {showLoading && <p className="text-text3">Loading...</p>}
      {status === 'guest' && !showLoading && (
        <p className="text-text2">
          You are not signed in. <Link className="text-primary" href={buildAuthHref('sign-in', { returnTo: buildProfileHref() })}>Sign in</Link> to manage your account, restore purchases, and billing settings.
        </p>
      )}
      {status === 'authed' && !showLoading && (
        <>
          {showPremiumWelcome && (
            <div className="mt-4 rounded-2xl border border-primary/30 bg-[rgba(34,211,238,0.08)] p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Premium quick-start</div>
              <div className="mt-1 text-base font-semibold text-text1">Everything is unlocked. Start with three setup steps.</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Link className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 hover:border-primary" href={buildPreferencesHref()}>
                  Open notification settings
                </Link>
                <Link className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 hover:border-primary" href="/account/saved">
                  Build My Launches
                </Link>
                <Link
                  className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 hover:border-primary"
                  href="/account/integrations"
                >
                  Set up recurring feeds
                </Link>
              </div>
            </div>
          )}
          <div className="mt-4 space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
            <div className="flex items-center justify-between">
              <span className="text-text3">Name</span>
              <span className="text-text1">{fullName || 'Not set'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Email</span>
              <span className="text-text1">{profile?.email || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Email verified</span>
              <span className={emailVerified ? 'text-success' : 'text-warning'}>{emailVerified ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Timezone</span>
              <span className="text-text1">{profile?.timezone || 'America/New_York'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Member since</span>
              <span className="text-text1">{profile?.createdAt ? formatDate(profile.createdAt) : '—'}</span>
            </div>
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Update profile</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text3">First name</span>
                  <input
                    type="text"
                    className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={editFirstName}
                    onChange={(event) => setEditFirstName(event.target.value)}
                    autoComplete="given-name"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text3">Last name</span>
                  <input
                    type="text"
                    className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={editLastName}
                    onChange={(event) => setEditLastName(event.target.value)}
                    autoComplete="family-name"
                  />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-text3">Timezone (IANA)</span>
                  <input
                    type="text"
                    className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={editTimezone}
                    onChange={(event) => setEditTimezone(event.target.value)}
                    placeholder="America/New_York"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="btn rounded-lg px-4 py-2 text-xs" onClick={saveProfile} disabled={!canSaveProfile}>
                  {updateProfileMutation.isPending ? 'Saving…' : 'Save profile'}
                </button>
                <Link className="text-xs text-primary hover:underline" href="/legal/privacy-choices">
                  Privacy choices
                </Link>
              </div>
              {hasBlankedExistingName && <div className="mt-2 text-xs text-warning">First and last name cannot be cleared once set.</div>}
              {profileMessage && <div className="mt-2 text-xs text-success">{profileMessage}</div>}
              {profileError && <div className="mt-2 text-xs text-warning">{profileError}</div>}
            </div>
            {!emailVerified && profile?.email && (
              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Email verification</div>
                <div className="mt-2 text-xs text-text3">
                  Verify your email to keep your account secure. We sent a verification email to{' '}
                  <span className="text-text2">{profile.email}</span>. If you don’t see it within a few minutes, check your spam/junk folder (and Promotions).
                </div>
                <button
                  type="button"
                  className="btn-secondary mt-3 rounded-lg px-3 py-2 text-xs"
                  onClick={resendVerificationEmail}
                  disabled={resendingEmail}
                >
                  {resendingEmail ? 'Sending…' : 'Resend verification email'}
                </button>
                {resendEmailMessage && <div className="mt-2 text-xs text-success">{resendEmailMessage}</div>}
                {resendEmailError && <div className="mt-2 text-xs text-warning">{resendEmailError}</div>}
              </div>
            )}
            <button
              className="btn w-fit rounded-lg"
              onClick={async () => {
                const supabase = getBrowserClient();
                if (!supabase) return;
                await supabase.auth.signOut();
                applyGuestViewerState(queryClient);
              }}
            >
              Sign out
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <BillingPanel />
            </div>
            {isAdminViewer && (
              <div className="md:col-span-2 rounded-2xl border border-primary/20 bg-[rgba(34,211,238,0.06)] p-4 text-sm text-text2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.1em] text-text3">Admin access testing</div>
                    <div className="mt-1 text-base font-semibold text-text1">Switch this admin account between free and premium</div>
                    <div className="mt-1 text-xs text-text3">
                      This changes customer access across web, iPhone, and Android. Billing and admin tools stay unchanged.
                    </div>
                  </div>
                  <span className="rounded-full border border-primary/30 px-3 py-1 text-xs text-primary">
                    {effectiveTier === 'premium' ? 'Premium access' : 'Free access'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <AdminAccessButton
                    label="Use default"
                    active={adminAccessOverride === null}
                    disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
                    onClick={() => void updateAdminAccessOverride(null)}
                  />
                  <AdminAccessButton
                    label="Free"
                    active={adminAccessOverride === 'anon'}
                    disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
                    onClick={() => void updateAdminAccessOverride('anon')}
                  />
                  <AdminAccessButton
                    label="Premium"
                    active={adminAccessOverride === 'premium'}
                    disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
                    onClick={() => void updateAdminAccessOverride('premium')}
                  />
                </div>
                <div className="mt-3 grid gap-2 text-xs text-text3 sm:grid-cols-3">
                  <div>
                    <span className="text-text3">Current access:</span> <span className="text-text2">{effectiveTier === 'premium' ? 'Premium' : 'Free'}</span>
                  </div>
                  <div>
                    <span className="text-text3">Source:</span> <span className="text-text2">{formatEffectiveTierSource(effectiveTierSource)}</span>
                  </div>
                  <div>
                    <span className="text-text3">Real billing:</span> <span className="text-text2">{billingIsPaid ? 'Active' : 'Inactive'}</span>
                  </div>
                </div>
                {adminAccessMessage && <div className="mt-2 text-xs text-success">{adminAccessMessage}</div>}
                {adminAccessError && <div className="mt-2 text-xs text-warning">{adminAccessError}</div>}
              </div>
            )}
            <div className="md:col-span-2">
              <TipJarRecurringPanel />
            </div>
            <div className="md:col-span-2 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Integrations</div>
                  <div className="mt-1 text-base font-semibold text-text1">Calendar, RSS, embeds</div>
                  <div className="mt-1 text-xs text-text3">
                    Manage tokenized links for Premium integrations (rotate/revoke, copy links).
                  </div>
                </div>
                <Link className="shrink-0 text-sm text-primary hover:underline" href="/account/integrations">
                  Open
                </Link>
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Saved</div>
                  <div className="mt-1 text-base font-semibold text-text1">Presets, follows, starred launches</div>
                  <div className="mt-1 text-xs text-text3">Manage saved views, My Launches rules, and Premium alert sources in one place.</div>
                </div>
                <Link className="shrink-0 text-sm text-primary hover:underline" href="/account/saved">
                  Open
                </Link>
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Notifications</div>
              <div className="mt-1 text-base font-semibold text-text1">Push alerts live in the mobile app</div>
              <p className="mt-2 text-text3">
                Web no longer manages legacy notification subscriptions. Open the native app to manage alert rules and device registration.
              </p>
              <Link className="mt-3 inline-flex text-xs text-primary hover:underline" href={buildPreferencesHref()}>
                Open native notification settings
              </Link>
            </div>
            <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Marketing emails</div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div id={marketingLabelId} className="text-text3">Marketing emails</div>
                  <div className="text-xs text-text3">Optional product updates and occasional offers. Off by default.</div>
                </div>
                <ToggleButton
                  checked={(marketingEmailOptIn ?? false) === true}
                  disabled={marketingEmailOptIn === null || updateMarketingEmailMutation.isPending}
                  onChange={(next) => void updateMarketingOptIn(next)}
                  labelledBy={marketingLabelId}
                />
              </div>
              <div className="mt-2 text-xs text-text3">
                Essential account emails still send even when this is off, including password resets, billing receipts, and security notices.
              </div>
              {marketingMessage && <div className="mt-2 text-xs text-success">{marketingMessage}</div>}
              {marketingError && <div className="mt-2 text-xs text-warning">{marketingError}</div>}
            </div>
            <div className="md:col-span-2 rounded-2xl border border-danger/40 bg-[rgba(251,113,133,0.08)] p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Danger zone</div>
              <div className="mt-1 text-lg font-semibold text-text1">Delete account</div>
              <p className="mt-2 text-text3">
                This permanently deletes your account and associated data in our database. It does not delete records held by payment providers.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-sm text-danger hover:border-danger/60"
                  onClick={() => void deleteAccount()}
                  disabled={deleteAccountMutation.isPending || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                >
                  {deleteAccountMutation.isPending ? 'Deleting…' : 'Delete my account'}
                </button>
              </div>
              <div className="mt-2 text-xs text-text3">
                If you have an active subscription, we will try to cancel renewal before deletion. If that fails, cancel billing first above.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ToggleButton({
  checked,
  disabled,
  onChange,
  labelledBy
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
}) {
  return (
    <button
      type="button"
      className={`flex h-6 w-11 items-center rounded-full border px-1 transition ${
        checked ? 'border-primary bg-[rgba(34,211,238,0.2)] justify-end' : 'border-stroke bg-surface-0 justify-start'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-disabled={disabled}
    >
      <span className="h-4 w-4 rounded-full bg-white" />
    </button>
  );
}

function AdminAccessButton({
  label,
  active,
  disabled,
  onClick
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
        active
          ? 'border-primary bg-[rgba(34,211,238,0.16)] text-primary'
          : 'border-stroke bg-surface-0 text-text2 hover:border-primary/40'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatEffectiveTierSource(value: string) {
  if (value === 'admin_override') return 'Manual override';
  if (value === 'admin') return 'Admin default';
  if (value === 'subscription') return 'Paid subscription';
  if (value === 'free') return 'Signed in without Premium';
  return 'Guest';
}

function stableKey(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
