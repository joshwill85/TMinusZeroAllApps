'use client';

import { ApiClientError } from '@tminuszero/api-client';
import { useEffect, useState } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { AuthProviderV1 } from '@tminuszero/contracts';
import { buildAuthHref, readAuthIntent, readReturnTo, sanitizeReturnTo } from '@tminuszero/navigation';
import { sharedQueryKeys } from '@tminuszero/query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { browserApiClient } from '@/lib/api/client';
import { getBrowserClient } from '@/lib/api/supabase';
import type { EmailOtpType, Session, User, UserIdentity } from '@supabase/supabase-js';
import { invalidateViewerScopedQueries } from '@/lib/api/queries';
import { getSharedProfile, updateSharedProfile } from '@/lib/api/webAccountAdapters';

type Status = 'working' | 'error' | 'missing';

const POST_CONFIRM_NEXT_STORAGE_KEY = 'tmn_auth_post_confirm_next';
const PENDING_PREMIUM_CLAIM_STORAGE_KEY = 'tmn_auth_pending_claim_token';
const PENDING_PROFILE_STORAGE_KEY = 'tmn_auth_pending_profile';

function normalizeAuthProvider(value: unknown): 'apple' | 'google' | 'email_link' | 'unknown' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (normalized === 'apple') return 'apple';
  if (normalized === 'google') return 'google';
  return 'unknown';
}

function readAppleAction(searchParams: URLSearchParams) {
  return searchParams.get('apple_action') === 'link' ? 'link' : null;
}

function inferEmailLinkProvider(type: string | null) {
  const normalized = String(type || '')
    .trim()
    .toLowerCase();

  if (normalized === 'signup' || normalized === 'magiclink' || normalized === 'invite' || normalized === 'recovery' || normalized === 'email') {
    return 'email_link' as const;
  }

  return 'unknown' as const;
}

function readHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(trimmed);
}

function readConfirmationUrlParams(value: string | null) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return new URLSearchParams();

  try {
    const url = new URL(trimmed);
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function clearAuthParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('confirmation_url');
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.hash = '';
  const nextUrl = url.toString();
  if (nextUrl === window.location.href) return;
  try {
    window.history.replaceState({}, '', nextUrl);
  } catch {
    // Browser throttles replaceState when called too frequently.
  }
}

function safeNextPath(value: string | null) {
  return sanitizeReturnTo(value, '/');
}

function isPrivateRelayEmail(email: string | null | undefined) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .endsWith('privaterelay.appleid.com');
}

function extractDisplayName(user: User | null | undefined) {
  const metadata = ((user?.user_metadata || {}) as Record<string, unknown>) ?? {};
  const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
  if (fullName) {
    return fullName;
  }

  const firstName =
    typeof metadata.first_name === 'string'
      ? metadata.first_name.trim()
      : typeof metadata.given_name === 'string'
        ? metadata.given_name.trim()
        : '';
  const lastName =
    typeof metadata.last_name === 'string'
      ? metadata.last_name.trim()
      : typeof metadata.family_name === 'string'
        ? metadata.family_name.trim()
        : '';
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  return combined || null;
}

async function captureRequiredWebAppleAuth(session: Session | null | undefined) {
  if (!session) {
    return;
  }

  const user = session.user ?? null;
  const provider = normalizeAuthProvider((user?.app_metadata as Record<string, unknown> | undefined)?.provider);
  if (provider !== 'apple') {
    return;
  }

  const providerRefreshToken = typeof session.provider_refresh_token === 'string' ? session.provider_refresh_token.trim() : '';
  const providerAccessToken = typeof session.provider_token === 'string' ? session.provider_token.trim() : '';
  if (!providerRefreshToken && !providerAccessToken) {
    throw new Error('We could not complete Apple sign-in securely. Please try again.');
  }

  try {
    await browserApiClient.captureAppleAuth({
      source: providerRefreshToken ? 'web_provider_refresh' : 'web_provider_access',
      providerToken: providerRefreshToken || providerAccessToken,
      appleUserId: null,
      email: typeof user?.email === 'string' ? user.email : null,
      emailIsPrivateRelay: isPrivateRelayEmail(user?.email),
      firstName:
        typeof (user?.user_metadata as Record<string, unknown> | undefined)?.given_name === 'string'
          ? String((user?.user_metadata as Record<string, unknown>).given_name).trim() || null
          : null,
      lastName:
        typeof (user?.user_metadata as Record<string, unknown> | undefined)?.family_name === 'string'
          ? String((user?.user_metadata as Record<string, unknown>).family_name).trim() || null
          : null
    });
  } catch {
    throw new Error('We could not finish Apple sign-in securely. Please try again.');
  }
}

async function rollbackLinkedAppleIdentity() {
  const supabase = getBrowserClient();
  if (!supabase) {
    return;
  }

  const identitiesResult = await supabase.auth.getUserIdentities().catch(() => null);
  const appleIdentity =
    identitiesResult?.data?.identities?.find((identity: UserIdentity) => normalizeAuthProvider(identity?.provider) === 'apple') ?? null;

  if (appleIdentity) {
    await supabase.auth.unlinkIdentity(appleIdentity).catch(() => undefined);
  }

  await browserApiClient.clearAppleAuthArtifacts().catch(() => undefined);
}

async function maybeAttachPendingPremiumClaim() {
  if (typeof window === 'undefined') return null;

  let claimToken = '';
  try {
    claimToken = window.localStorage.getItem(PENDING_PREMIUM_CLAIM_STORAGE_KEY) || '';
  } catch {
    claimToken = '';
  }

  const normalizedClaimToken = claimToken.trim();
  if (!normalizedClaimToken) {
    return null;
  }

  try {
    const payload = await browserApiClient.attachPremiumClaim(normalizedClaimToken);
    return safeNextPath(payload.returnTo || null);
  } finally {
    try {
      window.localStorage.removeItem(PENDING_PREMIUM_CLAIM_STORAGE_KEY);
    } catch {}
  }
}

function formatPendingPremiumClaimError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'claim_pending') {
      return 'Sign-in succeeded, but the Premium purchase is still being verified. Open Upgrade and try again in a moment.';
    }
    if (error.code === 'claim_email_mismatch') {
      return 'Sign-in succeeded, but this Premium purchase must be attached with the same checkout email.';
    }
    if (error.code === 'claim_already_claimed') {
      return 'Sign-in succeeded, but this Premium purchase is already linked to another account.';
    }
  }

  return 'Sign-in succeeded, but the Premium claim could not be attached yet. Open Account and try again in a moment.';
}

async function maybeApplyPendingProfile(queryClient: QueryClient) {
  if (typeof window === 'undefined') return;
  let pending: { first_name?: string; last_name?: string } | null = null;
  try {
    const raw = window.localStorage.getItem(PENDING_PROFILE_STORAGE_KEY);
    if (raw) pending = JSON.parse(raw);
    window.localStorage.removeItem(PENDING_PROFILE_STORAGE_KEY);
  } catch {
    pending = null;
  }
  if (!pending) return;

  const firstName = typeof pending.first_name === 'string' ? pending.first_name.trim() : '';
  const lastName = typeof pending.last_name === 'string' ? pending.last_name.trim() : '';
  if (!firstName || !lastName) return;

  try {
    const current = await getSharedProfile().catch(() => null);
    const hasFirst = typeof current?.firstName === 'string' && current.firstName.trim().length > 0;
    const hasLast = typeof current?.lastName === 'string' && current.lastName.trim().length > 0;
    if (hasFirst && hasLast) return;

    const nextProfile = await updateSharedProfile({
      ...(hasFirst ? {} : { firstName }),
      ...(hasLast ? {} : { lastName })
    });
    queryClient.setQueryData(sharedQueryKeys.profile, nextProfile);
  } catch {
    return;
  }
}

async function finishSuccessfulAuth(queryClient: QueryClient, redirectTo: string, type: string | null, session?: Session | null) {
  await recordWebCallbackContext(type, session ?? null);
  const claimRedirectTo = await maybeAttachPendingPremiumClaim();
  try {
    window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
  } catch {}
  invalidateViewerScopedQueries(queryClient);
  await maybeApplyPendingProfile(queryClient);
  clearAuthParams();
  window.location.replace(claimRedirectTo || redirectTo);
}

async function finishSuccessfulAppleLink(queryClient: QueryClient, redirectTo: string, session?: Session | null) {
  await recordWebCallbackContext(null, session ?? null);
  try {
    window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
  } catch {}
  invalidateViewerScopedQueries(queryClient);
  clearAuthParams();
  window.location.replace(redirectTo);
}

async function recordWebCallbackContext(type: string | null, session?: Session | null) {
  const supabase = getBrowserClient();
  let provider: Extract<AuthProviderV1, 'apple' | 'google' | 'email_link' | 'unknown'> = inferEmailLinkProvider(type);
  let user = session?.user ?? null;

  if (!user && supabase) {
    const result = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    user = result.data.user ?? null;
  }

  if (provider === 'unknown') {
    provider = normalizeAuthProvider((user?.app_metadata as Record<string, unknown> | undefined)?.provider);
  }

  await browserApiClient
    .recordAuthContext({
      provider,
      platform: 'web',
      eventType: 'oauth_callback',
      displayName: extractDisplayName(user),
      emailIsPrivateRelay: isPrivateRelayEmail(user?.email)
    })
    .catch(() => {});
}

export default function AuthCallbackClient() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const queryString = searchParams.toString();
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState<string | null>(null);
  const [postAuthNextPath, setPostAuthNextPath] = useState<string>('/');
  const [pkceMissing, setPkceMissing] = useState(false);
  const authIntent = readAuthIntent(searchParams);

  const signInHref = buildAuthHref('sign-in', { returnTo: postAuthNextPath, intent: authIntent });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = getBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Supabase not available.');
          setPkceMissing(false);
        }
        return;
      }

      const params = new URLSearchParams(queryString);
      const confirmationParams = readConfirmationUrlParams(params.get('confirmation_url'));
      const queryError = params.get('error');
      const queryErrorDescription = params.get('error_description');
      if (queryError) {
        if (!cancelled) {
          setStatus('error');
          setMessage(queryErrorDescription || queryError);
          setPkceMissing(false);
        }
        return;
      }

      const redirectTo = (() => {
        const explicitReturnTo = readReturnTo(params);
        if (explicitReturnTo) return safeNextPath(explicitReturnTo);
        try {
          const storedNext = window.localStorage.getItem(POST_CONFIRM_NEXT_STORAGE_KEY);
          return safeNextPath(storedNext);
        } catch {
          return '/';
        }
      })();
      if (!cancelled) setPostAuthNextPath(redirectTo);
      const appleAction = readAppleAction(params);

      const code = params.get('code') || confirmationParams.get('code');
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          const raw = String(error.message || '');
          const lower = raw.toLowerCase();
          const isPkceMissing =
            error.name === 'AuthPKCECodeVerifierMissingError' ||
            lower.includes('pkce code verifier') ||
            lower.includes('code verifier') ||
            lower.includes('pkce_code_verifier_not_found');

          setStatus('error');
          if (isPkceMissing) {
            setPkceMissing(true);
            setMessage(
              "This sign-in finished in a different browser (or in-app webview) than the one that started it, so we can’t complete it automatically. Please sign in again in this same browser to continue."
            );
          } else {
            setPkceMissing(false);
            setMessage(error.message);
          }
          return;
        }
        setPkceMissing(false);
        try {
          await captureRequiredWebAppleAuth(data.session ?? null);
        } catch (error) {
          if (appleAction === 'link') {
            await rollbackLinkedAppleIdentity().catch(() => undefined);
          } else {
            await supabase.auth.signOut().catch(() => undefined);
          }
          setStatus('error');
          setMessage(
            appleAction === 'link'
              ? 'We could not finish linking Sign in with Apple securely. Please try again.'
              : error instanceof Error
                ? error.message
                : 'Unable to sign you in.'
          );
          return;
        }
        try {
          if (appleAction === 'link') {
            await finishSuccessfulAppleLink(queryClient, redirectTo, data.session ?? null);
          } else {
            await finishSuccessfulAuth(queryClient, redirectTo, null, data.session ?? null);
          }
        } catch (error) {
          setStatus('error');
          setMessage(appleAction === 'link' ? 'Sign in with Apple linked, but the account view did not refresh yet. Reload the page and try again.' : formatPendingPremiumClaimError(error));
        }
        return;
      }

      const tokenHash = params.get('token_hash') || confirmationParams.get('token_hash') || confirmationParams.get('token');
      const type = params.get('type') || confirmationParams.get('type');
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
        if (cancelled) return;
        if (error) {
          setStatus('error');
          setMessage(error.message);
          setPkceMissing(false);
          return;
        }
        setPkceMissing(false);
        try {
          await finishSuccessfulAuth(queryClient, redirectTo, type);
        } catch (error) {
          setStatus('error');
          setMessage(formatPendingPremiumClaimError(error));
        }
        return;
      }

      const hashParams = readHashParams();
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (cancelled) return;
        if (error) {
          setStatus('error');
          setMessage(error.message);
          setPkceMissing(false);
          return;
        }
        setPkceMissing(false);
        try {
          await captureRequiredWebAppleAuth(data.session ?? null);
        } catch (error) {
          if (appleAction === 'link') {
            await rollbackLinkedAppleIdentity().catch(() => undefined);
          } else {
            await supabase.auth.signOut().catch(() => undefined);
          }
          setStatus('error');
          setMessage(
            appleAction === 'link'
              ? 'We could not finish linking Sign in with Apple securely. Please try again.'
              : error instanceof Error
                ? error.message
                : 'Unable to sign you in.'
          );
          return;
        }
        try {
          if (appleAction === 'link') {
            await finishSuccessfulAppleLink(queryClient, redirectTo, data.session ?? null);
          } else {
            await finishSuccessfulAuth(queryClient, redirectTo, null, data.session ?? null);
          }
        } catch (error) {
          setStatus('error');
          setMessage(appleAction === 'link' ? 'Sign in with Apple linked, but the account view did not refresh yet. Reload the page and try again.' : formatPendingPremiumClaimError(error));
        }
        return;
      }

      if (!cancelled) {
        setStatus('missing');
        setMessage('This link is missing or expired. Please try again.');
        setPkceMissing(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [queryClient, queryString]);

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-warning">
        <div className="space-y-3">
          <p>{message || 'Unable to sign you in.'}</p>
          {pkceMissing ? (
            <div className="space-y-2">
              <p className="text-xs text-text3">
                Tip: if you’re in an in-app browser, open this page in Safari or Chrome and sign in again there.
              </p>
              <Link href={signInHref} className="block text-center text-sm text-text2 underline hover:text-text1">
                Go to sign in
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
        {message || 'This link is missing or expired.'}
      </div>
    );
  }

  return <p className="text-sm text-text2">Signing you in…</p>;
}
