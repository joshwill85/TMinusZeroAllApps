'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBrowserClient } from '@/lib/api/supabase';
import Link from 'next/link';
import { BillingPanel } from '@/components/BillingPanel';
import { formatUsPhoneForDisplay } from '@/lib/notifications/phone';
import { TipJarRecurringPanel } from '@/components/TipJarRecurringPanel';
import { buildAuthQuery } from '@/lib/utils/returnTo';

type Profile = {
  user_id: string;
  email: string | null;
  email_confirmed_at?: string | null;
  role?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  timezone?: string | null;
  created_at?: string | null;
};

type SmsStatus = {
  sms_enabled: boolean;
  sms_verified: boolean;
  sms_phone_e164: string | null;
};

export default function AccountPage() {
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [smsStatus, setSmsStatus] = useState<SmsStatus | null>(null);
  const marketingLabelId = useId();
  const launchDayEmailLabelId = useId();
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editTimezone, setEditTimezone] = useState('America/New_York');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState<boolean | null>(null);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const [marketingMessage, setMarketingMessage] = useState<string | null>(null);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [launchDayEmailEnabled, setLaunchDayEmailEnabled] = useState(false);
  const [launchDayEmailProviders, setLaunchDayEmailProviders] = useState<string[]>([]);
  const [launchDayEmailStates, setLaunchDayEmailStates] = useState<string[]>([]);
  const [launchDayEmailLoaded, setLaunchDayEmailLoaded] = useState<{
    enabled: boolean;
    providers: string[];
    states: string[];
  } | null>(null);
  const [launchDayEmailSaving, setLaunchDayEmailSaving] = useState(false);
  const [launchDayEmailMessage, setLaunchDayEmailMessage] = useState<string | null>(null);
  const [launchDayEmailError, setLaunchDayEmailError] = useState<string | null>(null);
  const [filterOptions, setFilterOptions] = useState<{ providers: string[]; states: string[] } | null>(null);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);
  const [filterOptionsError, setFilterOptionsError] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendEmailMessage, setResendEmailMessage] = useState<string | null>(null);
  const [resendEmailError, setResendEmailError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/me/profile', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = await res.json();
        return json.profile as Profile | null;
      })
      .then((data) => {
        if (!active) return;
        if (!data) {
          setProfile(null);
          setStatus('guest');
          return;
        }
        setProfile(data);
        setEditFirstName(data.first_name || '');
        setEditLastName(data.last_name || '');
        setEditTimezone(data.timezone || 'America/New_York');
        setStatus('authed');
      })
      .catch(() => {
        if (!active) return;
        setProfile(null);
        setStatus('guest');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'authed') return;
    let active = true;
    const loadStatus = async () => {
      try {
        const [prefsRes, marketingRes, subscriptionRes] = await Promise.all([
          fetch('/api/me/notifications/preferences', { cache: 'no-store' }),
          fetch('/api/me/marketing-email', { cache: 'no-store' }),
          fetch('/api/me/subscription', { cache: 'no-store' })
        ]);

        const prefsJson = await prefsRes.json().catch(() => ({}));
        const marketingJson = await marketingRes.json().catch(() => ({}));
        const subscriptionJson = await subscriptionRes.json().catch(() => ({}));

        if (!active) return;

        if (prefsRes.ok) {
          const prefs = prefsJson.preferences || {};
          setSmsStatus({
            sms_enabled: !!prefs.sms_enabled,
            sms_verified: !!prefs.sms_verified,
            sms_phone_e164: prefs.sms_phone_e164 || null
          });

          const providers = Array.isArray(prefs.launch_day_email_providers)
            ? prefs.launch_day_email_providers.map((v: any) => String(v || '').trim()).filter(Boolean)
            : [];
          const states = Array.isArray(prefs.launch_day_email_states)
            ? prefs.launch_day_email_states.map((v: any) => String(v || '').trim()).filter(Boolean)
            : [];
          const snapshot = { enabled: !!prefs.launch_day_email_enabled, providers, states };
          setLaunchDayEmailEnabled(snapshot.enabled);
          setLaunchDayEmailProviders(snapshot.providers);
          setLaunchDayEmailStates(snapshot.states);
          setLaunchDayEmailLoaded(snapshot);
        }

        if (marketingRes.ok) {
          setMarketingEmailOptIn(!!marketingJson.marketing_email_opt_in);
        } else {
          setMarketingEmailOptIn(null);
        }

        if (subscriptionRes.ok) {
          setIsPaid(!!subscriptionJson.isPaid);
        } else {
          setIsPaid(false);
        }
      } catch (err) {
        if (!active) return;
        console.error('account status load error', err);
      }
    };

    loadStatus();
    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'authed') return;
    let active = true;
    setFilterOptionsLoading(true);
    setFilterOptionsError(null);
    fetch('/api/filters?mode=live&region=all', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(json?.error || 'filters_failed');
        setFilterOptions({
          providers: Array.isArray(json.providers) ? json.providers : [],
          states: Array.isArray(json.states) ? json.states : []
        });
      })
      .catch((err: any) => {
        if (!active) return;
        setFilterOptions(null);
        setFilterOptionsError(err?.message || 'Unable to load filters.');
      })
      .finally(() => {
        if (!active) return;
        setFilterOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const smsOptInLabel = smsStatus ? (smsStatus.sms_enabled ? 'On' : 'Off') : '—';
  const smsVerifiedLabel = smsStatus ? (smsStatus.sms_verified ? 'Yes' : 'No') : '—';
  const emailPremiumLocked = isPaid !== true;
  const emailVerified = Boolean(profile?.email_confirmed_at);
  const premiumStatus = searchParams.get('premium');
  const showPremiumWelcome = premiumStatus === 'welcome' && isPaid === true;
  const launchDayEmailDirty = launchDayEmailLoaded
    ? launchDayEmailLoaded.enabled !== launchDayEmailEnabled ||
      stableKey(launchDayEmailLoaded.providers) !== stableKey(launchDayEmailProviders) ||
      stableKey(launchDayEmailLoaded.states) !== stableKey(launchDayEmailStates)
    : false;
  const profileFirstName = String(profile?.first_name || '').trim();
  const profileLastName = String(profile?.last_name || '').trim();
  const profileTimezone = String(profile?.timezone || 'America/New_York').trim();
  const nextFirstName = editFirstName.trim();
  const nextLastName = editLastName.trim();
  const nextTimezone = editTimezone.trim();
  const hasBlankedExistingName =
    (profileFirstName.length > 0 && nextFirstName.length === 0) || (profileLastName.length > 0 && nextLastName.length === 0);
  const hasProfileChanges =
    nextFirstName !== profileFirstName || nextLastName !== profileLastName || nextTimezone !== profileTimezone;
  const canSaveProfile = Boolean(status === 'authed' && nextTimezone && hasProfileChanges && !hasBlankedExistingName && !savingProfile);

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
      const authQuery = buildAuthQuery({ returnTo: '/account' });
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: profile.email,
        options: {
          emailRedirectTo: `${baseUrl}/auth/callback${authQuery ? `?${authQuery}` : ''}`
        }
      });
      if (error) throw error;
      setResendEmailMessage(
        `Verification email sent to ${profile.email}. If you don’t see it within a few minutes, check your spam/junk folder (and Promotions).`
      );
    } catch (err: any) {
      setResendEmailError(err?.message || 'Unable to resend verification email.');
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

    const payload: Record<string, string> = {};
    if (nextFirstName && nextFirstName !== profileFirstName) payload.first_name = nextFirstName;
    if (nextLastName && nextLastName !== profileLastName) payload.last_name = nextLastName;
    if (nextTimezone !== profileTimezone) payload.timezone = nextTimezone;

    if (!Object.keys(payload).length) {
      setProfileMessage(null);
      setProfileError('No changes to save.');
      return;
    }

    setSavingProfile(true);
    setProfileMessage(null);
    setProfileError(null);
    try {
      const res = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update profile');
      const nextProfile = (json.profile as Profile | null) || null;
      setProfile(nextProfile);
      setEditFirstName(nextProfile?.first_name || '');
      setEditLastName(nextProfile?.last_name || '');
      setEditTimezone(nextProfile?.timezone || 'America/New_York');
      setProfileMessage('Profile updated.');
    } catch (err: any) {
      setProfileError(err?.message || 'Profile update failed');
    } finally {
      setSavingProfile(false);
    }
  }

  async function updateMarketingOptIn(next: boolean) {
    if (status !== 'authed') return;
    setMarketingSaving(true);
    setMarketingMessage(null);
    setMarketingError(null);
    const previous = marketingEmailOptIn;
    setMarketingEmailOptIn(next);
    try {
      const res = await fetch('/api/me/marketing-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketing_email_opt_in: next })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setMarketingEmailOptIn(!!json.marketing_email_opt_in);
      setMarketingMessage(next ? 'Marketing emails enabled.' : 'Marketing emails disabled. Essential account emails will still be sent when needed.');
    } catch (err: any) {
      setMarketingEmailOptIn(previous);
      setMarketingError(err?.message || 'Failed to save');
    } finally {
      setMarketingSaving(false);
    }
  }

  async function saveLaunchDayEmailPrefs(overrides?: { enabled?: boolean; providers?: string[]; states?: string[] }) {
    if (status !== 'authed') return;
    const nextEnabled = overrides?.enabled ?? launchDayEmailEnabled;
    const nextProviders = overrides?.providers ?? launchDayEmailProviders;
    const nextStates = overrides?.states ?? launchDayEmailStates;

    setLaunchDayEmailSaving(true);
    setLaunchDayEmailMessage(null);
    setLaunchDayEmailError(null);
    try {
      const res = await fetch('/api/me/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          launch_day_email_enabled: nextEnabled,
          launch_day_email_providers: nextProviders,
          launch_day_email_states: nextStates
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = json?.error || 'failed_to_save';
        if (code === 'subscription_required') throw new Error('Premium required. Upgrade to enable launch-day emails.');
        throw new Error(code);
      }

      const prefs = json.preferences || {};
      const providers = Array.isArray(prefs.launch_day_email_providers)
        ? prefs.launch_day_email_providers.map((v: any) => String(v || '').trim()).filter(Boolean)
        : [];
      const states = Array.isArray(prefs.launch_day_email_states)
        ? prefs.launch_day_email_states.map((v: any) => String(v || '').trim()).filter(Boolean)
        : [];
      const snapshot = { enabled: !!prefs.launch_day_email_enabled, providers, states };
      setLaunchDayEmailEnabled(snapshot.enabled);
      setLaunchDayEmailProviders(snapshot.providers);
      setLaunchDayEmailStates(snapshot.states);
      setLaunchDayEmailLoaded(snapshot);
      setLaunchDayEmailMessage('Saved.');
    } catch (err: any) {
      setLaunchDayEmailError(err?.message || 'Failed to save');
    } finally {
      setLaunchDayEmailSaving(false);
    }
  }

  function toggleSelected(value: string, list: string[], setList: (next: string[]) => void) {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    setList(
      list.includes(normalized)
        ? list.filter((v) => v !== normalized)
        : [...list, normalized].sort((a, b) => a.localeCompare(b))
    );
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteMessage(null);
    setDeleteError(null);
    try {
      const res = await fetch('/api/me/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirm })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = json?.error || 'delete_failed';
        if (code === 'confirm_required') throw new Error('Type DELETE to confirm.');
        if (code === 'unauthorized') throw new Error('Sign in to delete your account.');
        if (code === 'active_subscription') {
          throw new Error('You have an active subscription and we could not cancel renewal automatically. Cancel billing first, then delete your account.');
        }
        throw new Error(code);
      }

      const supabase = getBrowserClient();
      await supabase?.auth.signOut().catch(() => undefined);
      setDeleteMessage('Account deleted.');
      setDeleteConfirm('');
      setStatus('guest');
      setProfile(null);
      setIsPaid(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
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
      {status === 'loading' && <p className="text-text3">Loading...</p>}
      {status === 'guest' && (
        <p className="text-text2">
          You are not signed in. <Link className="text-primary" href="/auth/sign-in">Sign in</Link> to manage notifications.
        </p>
      )}
      {status === 'authed' && (
        <>
          {showPremiumWelcome && (
            <div className="mt-4 rounded-2xl border border-primary/30 bg-[rgba(34,211,238,0.08)] p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Premium quick-start</div>
              <div className="mt-1 text-base font-semibold text-text1">Everything is unlocked. Start with three setup steps.</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Link className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 hover:border-primary" href="/me/preferences">
                  Enable browser alerts
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
              <span className="text-text3">Phone</span>
              <span className="text-text1">{smsStatus?.sms_phone_e164 ? formatUsPhoneForDisplay(smsStatus.sms_phone_e164) : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Timezone</span>
              <span className="text-text1">{profile?.timezone || 'America/New_York'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text3">Member since</span>
              <span className="text-text1">{profile?.created_at ? formatDate(profile.created_at) : '—'}</span>
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
                    onChange={(e) => setEditFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text3">Last name</span>
                  <input
                    type="text"
                    className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-text3">Timezone (IANA)</span>
                  <input
                    type="text"
                    className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={editTimezone}
                    onChange={(e) => setEditTimezone(e.target.value)}
                    placeholder="America/New_York"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="btn rounded-lg px-4 py-2 text-xs" onClick={saveProfile} disabled={!canSaveProfile}>
                  {savingProfile ? 'Saving…' : 'Save profile'}
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
                setStatus('guest');
                setProfile(null);
                setIsPaid(false);
              }}
            >
              Sign out
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <BillingPanel />
            </div>
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
                  <div className="mt-1 text-xs text-text3">Manage your saved view, My Launches rules, and any premium extras in one place.</div>
                </div>
                <Link className="shrink-0 text-sm text-primary hover:underline" href="/account/saved">
                  Open
                </Link>
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Email alerts</div>
                  <div id={launchDayEmailLabelId} className="text-base font-semibold text-text1">
                    Launch-day email (8:00 AM local time)
                  </div>
                  <div className="mt-1 text-xs text-text3">
                    Sends at 8:00 AM in <span className="text-text2">{profile?.timezone || 'America/New_York'}</span>.
                  </div>
                </div>
                <ToggleButton
                  checked={launchDayEmailEnabled}
                  disabled={emailPremiumLocked || launchDayEmailSaving}
                  onChange={(next) => {
                    setLaunchDayEmailEnabled(next);
                    saveLaunchDayEmailPrefs({ enabled: next });
                  }}
                  labelledBy={launchDayEmailLabelId}
                />
              </div>

              {emailPremiumLocked && (
                <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text3">
                  Premium required.{' '}
                  <Link className="text-primary hover:underline" href="/upgrade?return_to=%2Faccount">
                    Upgrade to Premium
                  </Link>{' '}
                  to enable launch-day emails.
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className={emailPremiumLocked ? 'opacity-60' : ''}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-text3">Providers</div>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => setLaunchDayEmailProviders([])}
                      disabled={emailPremiumLocked}
                    >
                      Clear (All)
                    </button>
                  </div>
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-stroke bg-surface-0 p-2">
                    {filterOptionsLoading && <div className="text-xs text-text3">Loading…</div>}
                    {filterOptionsError && <div className="text-xs text-warning">{filterOptionsError}</div>}
                    {!filterOptionsLoading &&
                      !filterOptionsError &&
                      (filterOptions?.providers?.length ? (
                        <div className="space-y-1">
                          {filterOptions.providers.map((provider) => (
                            <label
                              key={provider}
                              className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-text2 hover:bg-[rgba(255,255,255,0.03)]"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-stroke bg-surface-0"
                                checked={launchDayEmailProviders.includes(provider)}
                                onChange={() => toggleSelected(provider, launchDayEmailProviders, setLaunchDayEmailProviders)}
                                disabled={emailPremiumLocked}
                              />
                              <span className="min-w-0 flex-1 truncate">{provider}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-text3">No providers available.</div>
                      ))}
                  </div>
                  <div className="mt-1 text-xs text-text3">
                    {launchDayEmailProviders.length ? `${launchDayEmailProviders.length} selected` : 'All providers'}
                  </div>
                </div>

                <div className={emailPremiumLocked ? 'opacity-60' : ''}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-text3">Locations</div>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => setLaunchDayEmailStates([])}
                      disabled={emailPremiumLocked}
                    >
                      Clear (All)
                    </button>
                  </div>
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-stroke bg-surface-0 p-2">
                    {filterOptionsLoading && <div className="text-xs text-text3">Loading…</div>}
                    {filterOptionsError && <div className="text-xs text-warning">{filterOptionsError}</div>}
                    {!filterOptionsLoading &&
                      !filterOptionsError &&
                      (filterOptions?.states?.length ? (
                        <div className="space-y-1">
                          {filterOptions.states.map((state) => (
                            <label
                              key={state}
                              className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-text2 hover:bg-[rgba(255,255,255,0.03)]"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-stroke bg-surface-0"
                                checked={launchDayEmailStates.includes(state)}
                                onChange={() => toggleSelected(state, launchDayEmailStates, setLaunchDayEmailStates)}
                                disabled={emailPremiumLocked}
                              />
                              <span className="min-w-0 flex-1 truncate">{state}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-text3">No locations available.</div>
                      ))}
                  </div>
                  <div className="mt-1 text-xs text-text3">
                    {launchDayEmailStates.length ? `${launchDayEmailStates.length} selected` : 'All locations'}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn rounded-lg px-4 py-2 text-xs"
                  onClick={() => saveLaunchDayEmailPrefs()}
                  disabled={emailPremiumLocked || launchDayEmailSaving || !launchDayEmailDirty}
                >
                  {launchDayEmailSaving ? 'Saving…' : launchDayEmailDirty ? 'Save changes' : 'Saved'}
                </button>
                <div className="text-xs text-text3">We only email on days with matching launches.</div>
              </div>
              {launchDayEmailMessage && <div className="mt-2 text-xs text-success">{launchDayEmailMessage}</div>}
              {launchDayEmailError && <div className="mt-2 text-xs text-warning">{launchDayEmailError}</div>}
            </div>
            <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">SMS status</div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-text3">SMS opt-in</span>
                <span className="text-text1">{smsOptInLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text3">Phone verified</span>
                <span className="text-text1">{smsVerifiedLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text3">Phone</span>
                <span className="text-text1">{smsStatus?.sms_phone_e164 ? formatUsPhoneForDisplay(smsStatus.sms_phone_e164) : '—'}</span>
              </div>
              <Link className="mt-2 inline-flex text-xs text-primary hover:underline" href="/me/preferences">
                Manage notifications
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
                  disabled={marketingEmailOptIn === null || marketingSaving}
                  onChange={updateMarketingOptIn}
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
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-sm text-danger hover:border-danger/60"
                  onClick={deleteAccount}
                  disabled={deleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                >
                  {deleting ? 'Deleting…' : 'Delete my account'}
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function stableKey(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .join('|');
}
