'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';
import { useQueryClient } from '@tanstack/react-query';
import { isRecoveryOnlyViewer } from '@tminuszero/domain';
import { buildAuthCallbackHref, buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import { BillingPanel } from '@/components/BillingPanel';
import { TipJarRecurringPanel } from '@/components/TipJarRecurringPanel';
import {
  applyGuestViewerState,
  useMarketingEmailQuery,
  useProfileQuery,
  useUpdateMarketingEmailMutation,
  useUpdateProfileMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';
import { getBrowserClient } from '@/lib/api/supabase';

export default function AccountPage() {
  const searchParams = useSafeSearchParams();
  const queryClient = useQueryClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();
  const marketingEmailQuery = useMarketingEmailQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const updateMarketingEmailMutation = useUpdateMarketingEmailMutation();

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
  const emailVerified = Boolean(profile?.emailConfirmedAt);
  const premiumStatus = searchParams.get('premium');
  const viewerTier = entitlementsQuery.data?.tier ?? 'anon';
  const isRecoveryOnly = isRecoveryOnlyViewer({
    isAuthed: status === 'authed',
    tier: viewerTier === 'premium' ? 'premium' : 'anon'
  });
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
  const membershipLabel = formatMembershipTierLabel(viewerTier, status === 'authed');

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Account</p>
      <h1 className="text-3xl font-semibold text-text1 text-balance">Account</h1>
      <p className="mt-3 max-w-2xl text-sm text-text2">
        {status === 'authed'
          ? isRecoveryOnly
            ? 'Billing recovery, restore, privacy, support, and sign-out stay available while this account is on free access.'
            : 'Account, billing, alerts, privacy, and launch tools now live in clearer owned sections instead of one mixed page.'
          : 'Sign in to manage account details, restore purchases, and billing.'}
      </p>

      {showLoading ? <p className="mt-4 text-text3">Loading…</p> : null}

      {status === 'guest' && !showLoading ? (
        <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Sign in required</div>
          <div className="mt-1 text-base font-semibold text-text1">Open your account</div>
          <p className="mt-2 text-text3">
            Sign in to manage personal info, restore purchases, and billing settings. Privacy choices remain available separately.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="btn rounded-lg px-4 py-2 text-xs" href={buildAuthHref('sign-in', { returnTo: buildProfileHref() })}>
              Sign in
            </Link>
            <Link className="btn-secondary rounded-lg px-4 py-2 text-xs" href="/legal/privacy-choices">
              Privacy & data
            </Link>
          </div>
        </div>
      ) : null}

      {status === 'authed' && !showLoading && isRecoveryOnly ? (
        <>
          <section
            className="mt-6 rounded-3xl border border-stroke bg-surface-1 p-5 text-sm text-text2 md:p-6"
            aria-labelledby="account-summary-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Account summary</div>
                <h2 id="account-summary-heading" className="mt-1 text-lg font-semibold text-text1">
                  {profile?.email || 'Your account'}
                </h2>
                <div className="mt-1 text-xs text-text3">
                  This shell is limited to membership recovery, privacy, support, and sign-out until Premium is active again.
                </div>
              </div>
              <span className="whitespace-nowrap rounded-full border border-stroke px-3 py-1 text-xs font-semibold text-text2">
                {membershipLabel}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AccountOverviewItem label="Membership" value={membershipLabel} />
              <AccountOverviewItem label="Email" value={profile?.email || '—'} className="sm:col-span-2 xl:col-span-2" />
              <AccountOverviewItem
                label="Renewal"
                value={entitlementsQuery.data?.currentPeriodEnd ? formatDate(entitlementsQuery.data.currentPeriodEnd) : '—'}
              />
              <AccountOverviewItem label="Session" value="Signed in" />
            </div>
          </section>

          <AccountSection
            title="Membership & Billing"
            description="Restart Premium, restore purchases, fix billing issues, or manage existing billing from here."
          >
            <BillingPanel />
          </AccountSection>

          <AccountSection
            title="Privacy, Support & Session"
            description="Only the recovery-safe account destinations remain available on the free state."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <AccountLinkCard
                eyebrow="Privacy choices"
                title="Privacy & data requests"
                description="Export account data, delete your account, and manage embed privacy preferences."
                href="/legal/privacy-choices"
                ctaLabel="Open privacy & data"
              />

              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Support</div>
                <div className="mt-1 text-base font-semibold text-text1">Need billing or account help?</div>
                <p className="mt-2 text-text3">
                  Use Support for restore problems, billing issues, account recovery help, and customer requests.
                </p>
                <Link className="mt-3 inline-flex text-sm text-primary hover:underline" href="/support">
                  Open support
                </Link>
              </div>

              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2 md:col-span-2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Session</div>
                <div className="mt-1 text-base font-semibold text-text1">Sign out on this browser</div>
                <p className="mt-2 text-text3">
                  Signing out clears the current browser session. Billing records, privacy requests, and account ownership stay unchanged.
                </p>
                <button
                  className="btn-secondary mt-3 rounded-lg px-4 py-2 text-xs"
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
            </div>
          </AccountSection>
        </>
      ) : null}

      {status === 'authed' && !showLoading && !isRecoveryOnly ? (
        <>
          <section className="mt-6 rounded-3xl border border-stroke bg-surface-1 p-5 text-sm text-text2 md:p-6" aria-labelledby="account-summary-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Account summary</div>
                <h2 id="account-summary-heading" className="mt-1 text-lg font-semibold text-text1">
                  {fullName || profile?.email || 'Your account'}
                </h2>
                <div className="mt-1 text-xs text-text3">One summary block for identity, membership state, and core account details.</div>
              </div>
              <span className="whitespace-nowrap rounded-full border border-primary/30 bg-[rgba(34,211,238,0.12)] px-3 py-1 text-xs font-semibold text-primary">
                {membershipLabel}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AccountOverviewItem label="Name" value={fullName || 'Not set'} />
              <AccountOverviewItem label="Membership" value={membershipLabel} />
              <AccountOverviewItem label="Email" value={profile?.email || '—'} className="sm:col-span-2 xl:col-span-2" />
              <AccountOverviewItem label="Renewal" value={entitlementsQuery.data?.currentPeriodEnd ? formatDate(entitlementsQuery.data.currentPeriodEnd) : '—'} />
              <AccountOverviewItem label="Session" value="Signed in" />
              <AccountOverviewItem label="Email verified" value={emailVerified ? 'Yes' : 'No'} valueClassName={emailVerified ? 'text-success' : 'text-warning'} />
              <AccountOverviewItem label="Timezone" value={profile?.timezone || 'America/New_York'} />
              <AccountOverviewItem label="Member since" value={profile?.createdAt ? formatDate(profile.createdAt) : '—'} />
            </div>
          </section>

          <AccountSection
            title="Identity & Security"
            description="Profile fields and authentication methods for this customer account."
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Personal info</div>
                <div className="mt-1 text-base font-semibold text-text1">Edit shared account fields</div>
                <div className="mt-2 grid gap-3">
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
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-text3">Timezone (IANA)</span>
                    <input
                      type="text"
                      className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                      value={editTimezone}
                      onChange={(event) => setEditTimezone(event.target.value)}
                      placeholder="America/New_York…"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn rounded-lg px-4 py-2 text-xs" onClick={saveProfile} disabled={!canSaveProfile}>
                    {updateProfileMutation.isPending ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
                {hasBlankedExistingName ? <div className="mt-2 text-xs text-warning">First and last name cannot be cleared once set.</div> : null}
                {profileMessage ? (
                  <div className="mt-2 text-xs text-success" aria-live="polite">
                    {profileMessage}
                  </div>
                ) : null}
                {profileError ? (
                  <div className="mt-2 text-xs text-warning" aria-live="polite">
                    {profileError}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                {!emailVerified && profile?.email ? (
                  <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                    <div className="text-xs uppercase tracking-[0.1em] text-text3">Email verification</div>
                    <div className="mt-1 text-base font-semibold text-text1">Verify your email</div>
                    <div className="mt-2 text-xs text-text3">
                      We sent a verification email to <span className="text-text2">{profile.email}</span>. If you don’t see it within a few minutes, check your spam/junk folder and Promotions.
                    </div>
                    <button
                      type="button"
                      className="btn-secondary mt-3 rounded-lg px-3 py-2 text-xs"
                      onClick={resendVerificationEmail}
                      disabled={resendingEmail}
                    >
                      {resendingEmail ? 'Sending…' : 'Resend verification email'}
                    </button>
                    {resendEmailMessage ? (
                      <div className="mt-2 text-xs text-success" aria-live="polite">
                        {resendEmailMessage}
                      </div>
                    ) : null}
                    {resendEmailError ? (
                      <div className="mt-2 text-xs text-warning" aria-live="polite">
                        {resendEmailError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <AccountLinkCard
                  eyebrow="Login methods"
                  title="Manage login methods"
                  description="Email/password, Google, and Sign in with Apple stay in a dedicated security destination."
                  href="/account/login-methods"
                  ctaLabel="Manage login methods"
                />

                <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Session</div>
                  <div className="mt-1 text-base font-semibold text-text1">Sign out on this browser</div>
                  <p className="mt-2 text-xs text-text3">
                    Signing out clears the current browser session. Account data and billing remain unchanged.
                  </p>
                  <button
                    className="btn-secondary mt-3 rounded-lg px-4 py-2 text-xs"
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
              </div>
            </div>
          </AccountSection>

          <AccountSection
            title="Membership & Billing"
            description="Keep plan status, renewal timing, and billing actions in one owned section."
          >
            <BillingPanel />
          </AccountSection>
          <AccountSection
            title="Communications & Alerts"
            description="Marketing email stays on the account. Launch push alerts stay mobile-only."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Marketing emails</div>
                <div className="mt-1 text-base font-semibold text-text1">Optional product updates</div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div id={marketingLabelId} className="text-text3">
                      Marketing emails
                    </div>
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
                {marketingMessage ? (
                  <div className="mt-2 text-xs text-success" aria-live="polite">
                    {marketingMessage}
                  </div>
                ) : null}
                {marketingError ? (
                  <div className="mt-2 text-xs text-warning" aria-live="polite">
                    {marketingError}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Launch alerts</div>
                <div className="mt-1 text-base font-semibold text-text1">Push alert delivery lives in the mobile app</div>
                <p className="mt-2 text-text3">
                  Web no longer manages legacy notification subscriptions. Use the native iPhone or Android app to manage device registration, push permissions, reminder timing, and live alert delivery.
                </p>
              </div>
            </div>
          </AccountSection>

          <AccountSection
            title="Launch Tools"
            description="Saved launch tools and Premium integrations stay discoverable, but they no longer compete with core account controls."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <AccountLinkCard
                eyebrow="Saved items"
                title="Manage saved items"
                description="Presets, follows, starred launches, and Premium alert sources live together in one launch-tools destination."
                href="/account/saved"
                ctaLabel="Manage saved items"
              />
              <AccountLinkCard
                eyebrow="Integrations"
                title="Manage integrations"
                description="Calendar feeds, RSS feeds, and tokenized next-launch widgets stay in a dedicated integrations destination."
                href="/account/integrations"
                ctaLabel="Manage integrations"
              />
            </div>
          </AccountSection>

          <AccountSection
            title="Privacy & Data"
            description="Keep export, deletion, and privacy preferences under one owner instead of splitting them across account surfaces."
          >
            <AccountLinkCard
              eyebrow="Privacy choices"
              title="Manage privacy & data requests"
              description="Export account data, delete your account, and manage embed privacy preferences from one place."
              href="/legal/privacy-choices"
              ctaLabel="Manage privacy & data"
            />
          </AccountSection>

          <AccountSection
            title="Support & Extras"
            description="Low-frequency account extras sit below the primary customer account work."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Support</div>
                <div className="mt-1 text-base font-semibold text-text1">Need account help?</div>
                <p className="mt-2 text-text3">
                  Use Support for billing issues, privacy questions, account recovery help, and other customer requests.
                </p>
                <Link className="mt-3 inline-flex text-sm text-primary hover:underline" href="/support">
                  Open support
                </Link>
              </div>

              <TipJarRecurringPanel />
            </div>
          </AccountSection>
        </>
      ) : null}
    </div>
  );
}

function AccountSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6" aria-label={title}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-text1">{title}</h2>
        <p className="mt-1 text-sm text-text3">{description}</p>
      </div>
      {children}
    </section>
  );
}

function AccountLinkCard({
  eyebrow,
  title,
  description,
  href,
  ctaLabel
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
      <div className="text-xs uppercase tracking-[0.1em] text-text3">{eyebrow}</div>
      <div className="mt-1 text-base font-semibold text-text1">{title}</div>
      <div className="mt-2 text-xs text-text3">{description}</div>
      <Link className="mt-3 inline-flex text-sm text-primary hover:underline" href={href}>
        {ctaLabel}
      </Link>
    </div>
  );
}

function AccountOverviewItem({
  label,
  value,
  className,
  valueClassName
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`min-w-0 rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 ${className ?? ''}`.trim()}>
      <div className="text-[11px] uppercase tracking-[0.1em] text-text3">{label}</div>
      <div className={`mt-2 break-words text-sm font-semibold text-text1 ${valueClassName ?? ''}`.trim()}>{value}</div>
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatMembershipTierLabel(value: string, isAuthed: boolean) {
  if (value === 'premium') return 'Full access';
  void isAuthed;
  return 'Public access';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
