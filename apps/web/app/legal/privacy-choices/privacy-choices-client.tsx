'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserClient } from '@/lib/api/supabase';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { readCookie, setCookie, deleteCookie } from '@/lib/privacy/clientCookies';

type Profile = {
  user_id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type AccountPrivacyPreferences = {
  opt_out_sale_share: boolean;
  limit_sensitive: boolean;
  block_third_party_embeds: boolean;
  gpc_enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type AccountPrivacyPreferencesUpdate = Partial<
  Pick<
    AccountPrivacyPreferences,
    'opt_out_sale_share' | 'limit_sensitive' | 'block_third_party_embeds' | 'gpc_enabled'
  >
>;

function isGpcEnabled() {
  if (typeof navigator === 'undefined') return false;
  return (navigator as any).globalPrivacyControl === true;
}

function readCookiePreferences() {
  return {
    optOutSaleShare: readCookie(PRIVACY_COOKIES.optOutSaleShare) === '1',
    limitSensitive: readCookie(PRIVACY_COOKIES.limitSensitive) === '1',
    blockEmbeds: readCookie(PRIVACY_COOKIES.blockEmbeds) === '1'
  };
}

export function PrivacyChoicesClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [prefsMessage, setPrefsMessage] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const gpcEnabled = useMemo(() => isGpcEnabled(), []);

  const [optOutSaleShare, setOptOutSaleShare] = useState(false);
  const [limitSensitive, setLimitSensitive] = useState(false);
  const [blockEmbeds, setBlockEmbeds] = useState(false);

  const saveAccountPreferences = useCallback(
    async (updates: AccountPrivacyPreferencesUpdate, options?: { silent?: boolean }) => {
      if (authStatus !== 'authed') return;
      if (Object.keys(updates).length === 0) return;

      const silent = options?.silent ?? false;
      if (!silent) {
        setPrefsMessage(null);
        setPrefsError(null);
      }

      try {
        const res = await fetch('/api/me/privacy/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = json?.error || 'failed_to_save';
          if (code === 'unauthorized') throw new Error('Sign in to save preferences to your account.');
          throw new Error(code);
        }
        if (!silent) setPrefsMessage('Saved.');
      } catch (err: any) {
        if (!silent) setPrefsError(err?.message || 'Unable to save preferences.');
      }
    },
    [authStatus]
  );

  useEffect(() => {
    let active = true;
    fetch('/api/me/profile', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = await res.json().catch(() => ({}));
        return (json.profile as Profile | null) || null;
      })
      .then((data) => {
        if (!active) return;
        if (data) {
          setProfile(data);
          setAuthStatus('authed');
        } else {
          setProfile(null);
          setAuthStatus('guest');
        }
      })
      .catch(() => {
        if (!active) return;
        setProfile(null);
        setAuthStatus('guest');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const cookiePrefs = readCookiePreferences();

    setOptOutSaleShare(cookiePrefs.optOutSaleShare);
    setLimitSensitive(cookiePrefs.limitSensitive);
    setBlockEmbeds(cookiePrefs.blockEmbeds);
  }, []);

  useEffect(() => {
    if (!gpcEnabled) return;
    setOptOutSaleShare(true);
    setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
  }, [gpcEnabled]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    let active = true;

    const load = async () => {
      try {
        const res = await fetch('/api/me/privacy/preferences', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) return;

        const account = (json.preferences as AccountPrivacyPreferences | null) || null;
        const cookiePrefs = readCookiePreferences();

        const nextSaleShare = gpcEnabled || cookiePrefs.optOutSaleShare || Boolean(account?.opt_out_sale_share);
        const nextSensitive = cookiePrefs.limitSensitive || Boolean(account?.limit_sensitive);
        const nextEmbeds = cookiePrefs.blockEmbeds || Boolean(account?.block_third_party_embeds);

        setOptOutSaleShare(nextSaleShare);
        setLimitSensitive(nextSensitive);
        setBlockEmbeds(nextEmbeds);

        if (nextSaleShare) setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
        else deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
        if (nextSensitive) setCookie(PRIVACY_COOKIES.limitSensitive, '1');
        else deleteCookie(PRIVACY_COOKIES.limitSensitive);
        if (nextEmbeds) setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
        else deleteCookie(PRIVACY_COOKIES.blockEmbeds);

        const promote: AccountPrivacyPreferencesUpdate = {};
        if (nextSaleShare && !account?.opt_out_sale_share) promote.opt_out_sale_share = true;
        if (nextSensitive && !account?.limit_sensitive) promote.limit_sensitive = true;
        if (nextEmbeds && !account?.block_third_party_embeds) promote.block_third_party_embeds = true;
        if (gpcEnabled && !account?.gpc_enabled) promote.gpc_enabled = true;
        if (Object.keys(promote).length > 0) void saveAccountPreferences(promote, { silent: true });
      } catch {
        return;
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [authStatus, gpcEnabled, saveAccountPreferences]);

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const signedInLabel = displayName || profile?.email || 'your account';

  async function downloadExport() {
    setExporting(true);
    setRequestMessage(null);
    setRequestError(null);
    try {
      const res = await fetch('/api/me/export', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (json as any)?.error || 'export_failed';
        if (code === 'unauthorized') throw new Error('Sign in to download your data.');
        throw new Error(code);
      }

      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `tminuszero-data-export-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setRequestMessage('Export downloaded.');
    } catch (err: any) {
      setRequestError(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setRequestMessage(null);
    setRequestError(null);
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
      setRequestMessage('Account deleted.');
      setProfile(null);
      setAuthStatus('guest');
      setDeleteConfirm('');
    } catch (err: any) {
      setRequestError(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-lg font-semibold text-text1">Privacy Preferences</h2>
        <p className="mt-1 text-sm text-text3">
          The current build does not “sell” or “share” personal information. These preferences are provided to support state privacy opt‑outs and to prepare for future optional
          features.
        </p>
        <p className="mt-2 text-sm text-text3">
          If you are signed in, we save these choices to your account. Otherwise, they are stored in this browser (cookies).
        </p>
        {gpcEnabled && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Your browser’s Global Privacy Control (GPC) signal is enabled. We treat this as an opt‑out of sale/sharing where applicable.
          </div>
        )}

        <div className="mt-4 grid gap-3">
          <Toggle
            label="Opt out of sale/sharing of personal information"
            checked={optOutSaleShare}
            disabled={gpcEnabled}
            onChange={(checked) => {
              setOptOutSaleShare(checked);
              if (checked) setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
              else deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
              setPrefsMessage(null);
              setPrefsError(null);
              void saveAccountPreferences({ opt_out_sale_share: checked });
            }}
            helper="If we ever engage in “sale” or “sharing” as defined by certain state laws, this opt‑out will be applied."
          />
          <Toggle
            label="Limit use of sensitive personal information"
            checked={limitSensitive}
            onChange={(checked) => {
              setLimitSensitive(checked);
              if (checked) setCookie(PRIVACY_COOKIES.limitSensitive, '1');
              else deleteCookie(PRIVACY_COOKIES.limitSensitive);
              setPrefsMessage(null);
              setPrefsError(null);
              void saveAccountPreferences({ limit_sensitive: checked });
            }}
            helper="We only use sensitive data as needed to run the Service (authentication, security, billing). This preference is provided for state-law “limit” choices."
          />
          <Toggle
            label="Block third‑party video embeds (YouTube/Vimeo)"
            checked={blockEmbeds}
            onChange={(checked) => {
              setBlockEmbeds(checked);
              if (checked) setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
              else deleteCookie(PRIVACY_COOKIES.blockEmbeds);
              setPrefsMessage(null);
              setPrefsError(null);
              void saveAccountPreferences({ block_third_party_embeds: checked });
            }}
            helper="When enabled, embedded video players are disabled and you can use the external stream link instead."
          />
        </div>

        <button
          type="button"
          className="btn-secondary mt-4 rounded-lg px-3 py-2 text-xs"
          onClick={() => {
            deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
            deleteCookie(PRIVACY_COOKIES.limitSensitive);
            deleteCookie(PRIVACY_COOKIES.blockEmbeds);
            setOptOutSaleShare(false);
            setLimitSensitive(false);
            setBlockEmbeds(false);
            setPrefsMessage(null);
            setPrefsError(null);
            void saveAccountPreferences(
              {
                opt_out_sale_share: false,
                limit_sensitive: false,
                block_third_party_embeds: false,
                gpc_enabled: false
              },
              { silent: true }
            );
            setPrefsMessage(authStatus === 'authed' ? 'Privacy preferences cleared for your account and this browser.' : 'Privacy preferences cleared for this browser.');
          }}
          disabled={gpcEnabled}
        >
          Clear preferences
        </button>

        {prefsMessage && <div className="mt-3 text-sm text-success">{prefsMessage}</div>}
        {prefsError && <div className="mt-3 text-sm text-warning">{prefsError}</div>}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-lg font-semibold text-text1">Your Privacy Requests</h2>
        <p className="mt-1 text-sm text-text3">If you have an account, you can exercise certain rights self‑serve. Otherwise, contact us by email.</p>

        {authStatus === 'loading' ? (
          <div className="mt-3 text-sm text-text3">Loading…</div>
        ) : authStatus === 'guest' ? (
          <div className="mt-3 space-y-2 text-sm text-text2">
            <div>
              Sign in to download or delete your account data:{' '}
              <Link className="text-primary hover:underline" href="/auth/sign-in">
                Sign in
              </Link>
              .
            </div>
            <div>
              Or email us at{' '}
              <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              .
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              Signed in as <span className="text-text1">{signedInLabel}</span>. Manage and correct account profile details on{' '}
              <Link className="text-primary hover:underline" href="/account">
                Account
              </Link>
              .
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn rounded-lg px-4 py-2 text-sm" onClick={downloadExport} disabled={exporting}>
                {exporting ? 'Preparing…' : 'Download my data'}
              </button>
              <a className="btn-secondary rounded-lg px-4 py-2 text-sm" href="/legal/privacy" aria-label="Privacy Notice">
                Read the Privacy Notice
              </a>
            </div>

            <div className="rounded-xl border border-warning/30 bg-[rgba(251,113,133,0.08)] p-3 text-sm text-text2">
              <div className="font-semibold text-text1">Delete account</div>
              <p className="mt-1 text-text3">
                This deletes your {BRAND_NAME} account and associated data in our database. It does not delete records held by payment providers.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-sm"
                  onClick={deleteAccount}
                  disabled={deleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                >
                  {deleting ? 'Deleting…' : 'Delete my account'}
                </button>
              </div>
              <div className="mt-2 text-xs text-text3">
                If you have an active subscription, we will try to cancel renewal before deletion. If that fails, cancel billing first in{' '}
                <Link className="text-primary hover:underline" href="/account">
                  Account
                </Link>
                .
              </div>
            </div>
          </div>
        )}
      </section>

      {requestMessage && <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{requestMessage}</div>}
      {requestError && <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{requestError}</div>}
    </div>
  );
}

function Toggle({
  label,
  helper,
  checked,
  disabled,
  onChange
}: {
  label: string;
  helper?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-3">
      <span className="flex-1">
        <div className="text-sm font-semibold text-text1">{label}</div>
        {helper ? <div className="mt-1 text-xs text-text3">{helper}</div> : null}
      </span>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-stroke bg-surface-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
