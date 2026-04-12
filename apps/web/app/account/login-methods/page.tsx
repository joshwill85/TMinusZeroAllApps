'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthMethodV1 } from '@tminuszero/api-client';
import { isRecoveryOnlyViewer, normalizeAuthSourceProvider } from '@tminuszero/domain';
import type { UserIdentity } from '@supabase/supabase-js';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import { AccountRecoveryOnlyNotice } from '@/components/AccountRecoveryOnlyNotice';
import { invalidateViewerScopedQueries, useAuthMethodsQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/lib/api/queries';
import { browserApiClient } from '@/lib/api/client';
import { getBrowserClient } from '@/lib/api/supabase';

type NoticeTone = 'success' | 'warning' | 'error';

function findMethod(methods: AuthMethodV1[] | undefined, provider: AuthMethodV1['provider']) {
  return methods?.find((method) => method.provider === provider) ?? null;
}

function getNoticeClass(tone: NoticeTone) {
  if (tone === 'success') {
    return 'border-success/30 bg-success/10 text-success';
  }
  if (tone === 'warning') {
    return 'border-warning/30 bg-warning/10 text-warning';
  }
  return 'border-danger/40 bg-danger/10 text-danger';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function LoginMethodsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const authMethodsQuery = useAuthMethodsQuery();
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [busyAction, setBusyAction] = useState<'link_apple' | 'unlink_apple' | 'link_google' | 'unlink_google' | null>(null);

  const status: 'loading' | 'authed' | 'guest' = viewerSessionQuery.isPending
    ? 'loading'
    : viewerSessionQuery.data?.viewerId
      ? 'authed'
      : 'guest';
  const isRecoveryOnly = isRecoveryOnlyViewer({
    isAuthed: status === 'authed',
    tier: entitlementsQuery.data?.tier === 'premium' ? 'premium' : 'anon'
  });

  const emailMethod = findMethod(authMethodsQuery.data?.methods, 'email_password');
  const googleMethod = findMethod(authMethodsQuery.data?.methods, 'google');
  const appleMethod = findMethod(authMethodsQuery.data?.methods, 'apple');

  useEffect(() => {
    const linkedProvider = normalizeAuthSourceProvider(searchParams.get('linked_provider'));
    if (linkedProvider !== 'apple' && linkedProvider !== 'google') {
      return;
    }

    setNotice({
      tone: 'success',
      message: `${linkedProvider === 'google' ? 'Google' : 'Sign in with Apple'} linked to this account.`
    });

    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('linked_provider');
    try {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Browser can throttle replaceState calls.
    }
  }, [searchParams]);

  async function handleLinkProvider(provider: 'apple' | 'google') {
    if (busyAction) {
      return;
    }

    const supabase = getBrowserClient();
    if (!supabase) {
      setNotice({ tone: 'error', message: 'Supabase is not available in this browser.' });
      return;
    }

    setBusyAction(provider === 'google' ? 'link_google' : 'link_apple');
    setNotice(null);
    try {
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('return_to', `/account/login-methods?linked_provider=${provider}`);
      callbackUrl.searchParams.set('link_provider', provider);
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo: callbackUrl.toString()
        }
      });
      if (error) {
        throw error;
      }
    } catch (error) {
      setBusyAction(null);
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, `Unable to start ${provider === 'google' ? 'Google' : 'Sign in with Apple'} linking.`)
      });
    }
  }

  async function handleUnlinkProvider(provider: 'apple' | 'google') {
    if (busyAction) {
      return;
    }

    const supabase = getBrowserClient();
    if (!supabase) {
      setNotice({ tone: 'error', message: 'Supabase is not available in this browser.' });
      return;
    }

    setBusyAction(provider === 'google' ? 'unlink_google' : 'unlink_apple');
    setNotice(null);
    try {
      const identitiesResult = await supabase.auth.getUserIdentities();
      if (identitiesResult.error) {
        throw identitiesResult.error;
      }
      const linkedIdentity =
        identitiesResult.data.identities.find(
          (identity: UserIdentity) => normalizeAuthSourceProvider(identity?.provider) === provider
        ) ?? null;
      if (!linkedIdentity) {
        if (provider === 'apple') {
          await browserApiClient.clearAppleAuthArtifacts().catch(() => undefined);
        }
        invalidateViewerScopedQueries(queryClient);
        setNotice({
          tone: 'success',
          message: `${provider === 'google' ? 'Google' : 'Sign in with Apple'} was already removed from this account.`
        });
        return;
      }

      const unlinkResult = await supabase.auth.unlinkIdentity(linkedIdentity);
      if (unlinkResult.error) {
        throw unlinkResult.error;
      }

      if (provider === 'apple') {
        await browserApiClient.clearAppleAuthArtifacts().catch(() => undefined);
      }
      invalidateViewerScopedQueries(queryClient);
      setNotice({
        tone: 'success',
        message: `${provider === 'google' ? 'Google' : 'Sign in with Apple'} removed from this account.`
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, `Unable to remove ${provider === 'google' ? 'Google' : 'Sign in with Apple'}.`)
      });
    } finally {
      setBusyAction(null);
    }
  }

  const isLoading = status === 'loading' || (status === 'authed' && authMethodsQuery.isPending && !authMethodsQuery.data);
  const queryError = authMethodsQuery.error ? getErrorMessage(authMethodsQuery.error, 'Unable to load login methods.') : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Account</p>
          <h1 className="text-3xl font-semibold text-text1">Login Methods</h1>
          <p className="mt-1 text-sm text-text3">Manage the sign-in methods attached to this customer account.</p>
        </div>
        <Link href={buildProfileHref()} className="text-sm text-primary hover:underline">
          Back to account
        </Link>
      </div>

      {notice ? (
        <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${getNoticeClass(notice.tone)}`}>{notice.message}</div>
      ) : null}

      {!notice && queryError ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{queryError}</div>
      ) : null}

      {isLoading ? <p className="mt-4 text-text3">Loading…</p> : null}

      {status === 'guest' ? (
        <p className="mt-4 text-text2">
          You are not signed in. <Link className="text-primary" href={buildAuthHref('sign-in', { returnTo: '/account/login-methods' })}>Sign in</Link> to manage linked login methods.
        </p>
      ) : null}

      {status === 'authed' && !isLoading && isRecoveryOnly ? (
        <AccountRecoveryOnlyNotice
          title="Login methods return when Premium is active"
          description="Provider linking and unlinking are disabled while this signed-in account is on free access."
        />
      ) : null}

      {status === 'authed' && !isLoading && !isRecoveryOnly ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Policy</div>
            <div className="mt-1 text-base font-semibold text-text1">Use explicit linking for provider identities</div>
            <p className="mt-2 text-text3">
              Same-email provider sign-ins may link automatically through Supabase. Apple private relay or different-email identities stay separate until you link them from this page.
            </p>
          </div>

          <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Email and password</div>
                <div className="mt-1 text-base font-semibold text-text1">
                  {emailMethod?.linked ? 'Linked' : 'Not linked'}
                </div>
                <div className="mt-2 text-xs text-text3">
                  {emailMethod?.email || viewerSessionQuery.data?.email || 'No email address available'}
                </div>
                {emailMethod?.linkedAt ? (
                  <div className="mt-1 text-xs text-text3">Linked on {formatDateTime(emailMethod.linkedAt)}</div>
                ) : null}
              </div>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs text-text3">Primary</span>
            </div>
          </div>

          <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Google</div>
                <div className="mt-1 text-base font-semibold text-text1">
                  {googleMethod?.linked ? 'Linked' : 'Not linked'}
                </div>
                <div className="mt-2 text-xs text-text3">
                  {googleMethod?.linked ? googleMethod.email || 'Google identity linked' : 'Add Google as a login method for this account.'}
                </div>
                {googleMethod?.linkedAt ? (
                  <div className="mt-1 text-xs text-text3">Linked on {formatDateTime(googleMethod.linkedAt)}</div>
                ) : null}
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  googleMethod?.linked
                    ? 'border border-success/30 text-success'
                    : 'border border-stroke text-text3'
                }`}
              >
                {googleMethod?.linked ? 'Active' : 'Available'}
              </span>
            </div>

            {googleMethod?.linked && !googleMethod.canUnlink ? (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Add another sign-in method before removing Google from this account.
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              {!googleMethod?.linked ? (
                <button
                  type="button"
                  className="btn rounded-lg px-4 py-2 text-xs"
                  onClick={() => void handleLinkProvider('google')}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'link_google' ? 'Starting…' : 'Link Google'}
                </button>
              ) : null}

              {googleMethod?.linked ? (
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-xs"
                  onClick={() => void handleUnlinkProvider('google')}
                  disabled={busyAction !== null || !googleMethod.canUnlink}
                >
                  {busyAction === 'unlink_google' ? 'Removing…' : 'Remove Google'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Sign in with Apple</div>
                <div className="mt-1 text-base font-semibold text-text1">
                  {appleMethod?.linked ? 'Linked' : 'Not linked'}
                </div>
                <div className="mt-2 text-xs text-text3">
                  {appleMethod?.linked
                    ? appleMethod.email
                      ? appleMethod.emailIsPrivateRelay
                        ? `${appleMethod.email} (private relay)`
                        : appleMethod.email
                      : 'Apple identity linked'
                    : 'Add Apple as a login method for this account.'}
                </div>
                {appleMethod?.linkedAt ? (
                  <div className="mt-1 text-xs text-text3">Linked on {formatDateTime(appleMethod.linkedAt)}</div>
                ) : null}
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  appleMethod?.linked
                    ? 'border border-success/30 text-success'
                    : 'border border-stroke text-text3'
                }`}
              >
                {appleMethod?.linked ? 'Active' : 'Available'}
              </span>
            </div>

            {appleMethod?.linked && !appleMethod.canUnlink ? (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Add another sign-in method before removing Sign in with Apple from this account.
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              {!appleMethod?.linked ? (
                <button
                  type="button"
                  className="btn rounded-lg px-4 py-2 text-xs"
                  onClick={() => void handleLinkProvider('apple')}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'link_apple' ? 'Starting…' : 'Link Sign in with Apple'}
                </button>
              ) : null}

              {appleMethod?.linked ? (
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-4 py-2 text-xs"
                  onClick={() => void handleUnlinkProvider('apple')}
                  disabled={busyAction !== null || !appleMethod.canUnlink}
                >
                  {busyAction === 'unlink_apple' ? 'Removing…' : 'Remove Sign in with Apple'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
