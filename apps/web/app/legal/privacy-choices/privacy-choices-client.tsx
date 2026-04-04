'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildAuthHref, buildPrivacyChoicesHref, buildProfileHref } from '@tminuszero/navigation';
import { getBrowserClient } from '@/lib/api/supabase';
import { applyGuestViewerState, fetchAccountExport, useDeleteAccountMutation, usePrivacyPreferencesQuery, useProfileQuery, useUpdatePrivacyPreferencesMutation, useViewerSessionQuery } from '@/lib/api/queries';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { deleteCookie, readCookie, setCookie } from '@/lib/privacy/clientCookies';
import { notifyPrivacyPreferencesChanged } from '@/lib/privacy/embedPreference';
import { ApiClientError } from '@tminuszero/api-client';

type PrivacyPreferenceUpdates = {
  blockThirdPartyEmbeds?: boolean;
};

function readCookiePreferences() {
  return {
    blockEmbeds: readCookie(PRIVACY_COOKIES.blockEmbeds) === '1'
  };
}

function toMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    if (error.code === 'unauthorized') return 'Sign in to manage account privacy preferences.';
    if (error.code === 'supabase_not_configured') return 'Account features are unavailable in this environment.';
    if (error.code === 'no_changes') return 'No changes to save.';
  }
  return error instanceof Error ? error.message : fallback;
}

export function PrivacyChoicesClient() {
  const queryClient = useQueryClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const profileQuery = useProfileQuery();
  const privacyPreferencesQuery = usePrivacyPreferencesQuery();
  const updatePrivacyPreferencesMutation = useUpdatePrivacyPreferencesMutation();
  const deleteAccountMutation = useDeleteAccountMutation();
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [prefsMessage, setPrefsMessage] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [blockEmbeds, setBlockEmbeds] = useState(false);

  const authStatus: 'loading' | 'authed' | 'guest' =
    viewerSessionQuery.isPending && !viewerSessionQuery.data
      ? 'loading'
      : viewerSessionQuery.data?.viewerId
        ? 'authed'
        : 'guest';

  const signedInLabel = useMemo(() => {
    const profile = profileQuery.data;
    const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    return displayName || profile?.email || viewerSessionQuery.data?.email || 'your account';
  }, [profileQuery.data, viewerSessionQuery.data?.email]);
  const signInHref = buildAuthHref('sign-in', { returnTo: buildPrivacyChoicesHref() });
  const accountHref = buildProfileHref();
  const gpcEnabled = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (navigator as any).globalPrivacyControl === true;
  }, []);

  const saveAccountPreferences = useCallback(
    async (updates: PrivacyPreferenceUpdates, options?: { silent?: boolean }) => {
      if (authStatus !== 'authed' || Object.keys(updates).length === 0) return;

      const silent = options?.silent ?? false;
      if (!silent) {
        setPrefsMessage(null);
        setPrefsError(null);
      }

      try {
        await updatePrivacyPreferencesMutation.mutateAsync(updates);
        if (!silent) {
          setPrefsMessage('Saved.');
        }
      } catch (error) {
        if (!silent) {
          setPrefsError(toMessage(error, 'Unable to save preferences.'));
        }
      }
    },
    [authStatus, updatePrivacyPreferencesMutation]
  );

  useEffect(() => {
    const cookiePrefs = readCookiePreferences();
    setBlockEmbeds(cookiePrefs.blockEmbeds);
    deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
    deleteCookie(PRIVACY_COOKIES.limitSensitive);
    notifyPrivacyPreferencesChanged();
  }, []);

  useEffect(() => {
    if (authStatus !== 'authed' || !privacyPreferencesQuery.data) return;

    const cookiePrefs = readCookiePreferences();
    const accountPrefs = privacyPreferencesQuery.data;
    const nextEmbeds = cookiePrefs.blockEmbeds || accountPrefs.blockThirdPartyEmbeds;

    setBlockEmbeds(nextEmbeds);

    if (nextEmbeds) setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
    else deleteCookie(PRIVACY_COOKIES.blockEmbeds);
    notifyPrivacyPreferencesChanged();

    const promote: PrivacyPreferenceUpdates = {};
    if (nextEmbeds && !accountPrefs.blockThirdPartyEmbeds) promote.blockThirdPartyEmbeds = true;
    if (Object.keys(promote).length > 0) {
      void saveAccountPreferences(promote, { silent: true });
    }
  }, [authStatus, privacyPreferencesQuery.data, saveAccountPreferences]);

  async function downloadExport() {
    setExporting(true);
    setRequestMessage(null);
    setRequestError(null);

    try {
      const payload = await fetchAccountExport(queryClient);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `tminuszero-data-export-${date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRequestMessage('Export downloaded.');
    } catch (error) {
      setRequestError(toMessage(error, 'Export failed'));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setRequestMessage(null);
    setRequestError(null);

    try {
      await deleteAccountMutation.mutateAsync(deleteConfirm);
      const supabase = getBrowserClient();
      await supabase?.auth.signOut().catch(() => undefined);
      applyGuestViewerState(queryClient);
      setRequestMessage('Account deleted.');
      setDeleteConfirm('');
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === 'confirm_required') {
          setRequestError('Type DELETE to confirm.');
        } else if (error.code === 'unauthorized') {
          setRequestError('Sign in to delete your account.');
        } else if (error.code === 'active_subscription') {
          setRequestError(
            'You have an active subscription and we could not cancel renewal automatically. Cancel billing first, then delete your account.'
          );
        } else if (error.code === 'apple_revocation_not_configured') {
          setRequestError('Account deletion for Sign in with Apple is temporarily unavailable. Contact support and try again later.');
        } else if (error.code === 'apple_revocation_unavailable') {
          setRequestError('Please sign in with Apple again before deleting this account.');
        } else if (error.code === 'apple_revocation_failed') {
          setRequestError('We could not complete the Apple account-revocation step. Try again or contact support.');
        } else {
          setRequestError(error.code || 'Delete failed');
        }
      } else {
        setRequestError(toMessage(error, 'Delete failed'));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-lg font-semibold text-text1">Privacy Preferences</h2>
        <p className="mt-1 text-sm text-text3">
          The current web build does not use a sitewide analytics or advertising cookie banner. Embedded X posts and third-party video players only load after you choose to load them.
        </p>
        <p className="mt-2 text-sm text-text3">
          The one browser-level preference that materially changes current behavior is whether to always keep third-party media external-only. If you are signed in, we also save that choice to
          your account.
        </p>
        {gpcEnabled && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Your browser’s Global Privacy Control (GPC) signal is enabled. The current build does not use ad-tech or sale/sharing cookies, and third-party media still requires an explicit load
            action.
          </div>
        )}

        <div className="mt-4 grid gap-3">
          <Toggle
            label="Always block third-party embeds (X, YouTube, Vimeo)"
            checked={blockEmbeds}
            onChange={(checked) => {
              setBlockEmbeds(checked);
              if (checked) setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
              else deleteCookie(PRIVACY_COOKIES.blockEmbeds);
              notifyPrivacyPreferencesChanged();
              setPrefsMessage(null);
              setPrefsError(null);
              void saveAccountPreferences({ blockThirdPartyEmbeds: checked });
            }}
            helper="When enabled, supported third-party posts and video players stay external-only in this browser and, if you are signed in, on your account."
          />
        </div>

        <button
          type="button"
          className="btn-secondary mt-4 rounded-lg px-3 py-2 text-xs"
          onClick={() => {
            deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
            deleteCookie(PRIVACY_COOKIES.limitSensitive);
            deleteCookie(PRIVACY_COOKIES.blockEmbeds);
            notifyPrivacyPreferencesChanged();
            setBlockEmbeds(false);
            setPrefsMessage(null);
            setPrefsError(null);
            void saveAccountPreferences(
              {
                blockThirdPartyEmbeds: false
              },
              { silent: true }
            );
            setPrefsMessage(authStatus === 'authed' ? 'Browser and account media-loading preference cleared.' : 'Browser media-loading preference cleared.');
          }}
        >
          Reset media preference
        </button>

        {prefsMessage && <div className="mt-3 text-sm text-success">{prefsMessage}</div>}
        {prefsError && <div className="mt-3 text-sm text-warning">{prefsError}</div>}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-lg font-semibold text-text1">Your Privacy Requests</h2>
        <p className="mt-1 text-sm text-text3">If you have an account, you can exercise certain rights self-serve. Otherwise, contact us by email.</p>

        {authStatus === 'loading' ? (
          <div className="mt-3 text-sm text-text3">Loading…</div>
        ) : authStatus === 'guest' ? (
          <div className="mt-3 space-y-2 text-sm text-text2">
            <div>
              Sign in to download or delete your account data:{' '}
              <Link className="text-primary hover:underline" href={signInHref}>
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
              <Link className="text-primary hover:underline" href={accountHref}>
                Account
              </Link>
              .
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn rounded-lg px-4 py-2 text-sm" onClick={() => void downloadExport()} disabled={exporting}>
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
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-sm"
                  onClick={() => void deleteAccount()}
                  disabled={deleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                >
                  {deleting ? 'Deleting…' : 'Delete my account'}
                </button>
              </div>
              <div className="mt-2 text-xs text-text3">
                If you have an active subscription, we will try to cancel renewal before deletion. If that fails, cancel billing first in{' '}
                <Link className="text-primary hover:underline" href={accountHref}>
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
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
