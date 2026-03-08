'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getBrowserClient } from '@/lib/api/supabase';
import type { EmailOtpType } from '@supabase/supabase-js';
import { buildAuthQuery, readAuthIntent, readReturnTo, withAuthQuery } from '@/lib/utils/returnTo';

type Status = 'working' | 'error' | 'missing';
type OAuthProvider = 'google' | 'twitter';

const POST_CONFIRM_NEXT_STORAGE_KEY = 'tmn_auth_post_confirm_next';
const PENDING_PROFILE_STORAGE_KEY = 'tmn_auth_pending_profile';

function readHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(trimmed);
}

function clearAuthParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
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
  const trimmed = (value || '').trim();
  if (!trimmed) return '/';
  if (!trimmed.startsWith('/')) return '/';
  if (trimmed.startsWith('//')) return '/';
  return trimmed;
}

async function maybeApplyPendingProfile() {
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
    const profileRes = await fetch('/api/me/profile', { cache: 'no-store' });
    const profileJson = await profileRes.json().catch(() => ({}));
    const current = profileJson?.profile || null;
    const hasFirst = typeof current?.first_name === 'string' && current.first_name.trim().length > 0;
    const hasLast = typeof current?.last_name === 'string' && current.last_name.trim().length > 0;
    if (hasFirst && hasLast) return;

    const payload: Record<string, string> = {};
    if (!hasFirst) payload.first_name = firstName;
    if (!hasLast) payload.last_name = lastName;
    await fetch('/api/me/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => undefined);
  } catch {
    return;
  }
}

export default function AuthCallbackClient() {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState<string | null>(null);
  const [postAuthNextPath, setPostAuthNextPath] = useState<string>('/');
  const [pkceMissing, setPkceMissing] = useState(false);
  const [retryingProvider, setRetryingProvider] = useState<OAuthProvider | null>(null);
  const authIntent = readAuthIntent(searchParams);

  const signInHref = withAuthQuery('/auth/sign-in', { returnTo: postAuthNextPath, intent: authIntent });

  async function retryOAuth(provider: OAuthProvider) {
    setRetryingProvider(provider);
    setMessage(null);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available.');

      const baseUrl = window.location.origin.replace(/\/+$/, '');
      const callbackQuery = buildAuthQuery({ returnTo: postAuthNextPath, intent: authIntent });
      const callbackUrl = `${baseUrl}/auth/callback${callbackQuery ? `?${callbackQuery}` : ''}`;
      try {
        window.localStorage.setItem(POST_CONFIRM_NEXT_STORAGE_KEY, postAuthNextPath);
      } catch {}

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl
        }
      });
      if (error) throw error;
    } catch (err: any) {
      setStatus('error');
      setPkceMissing(true);
      setMessage(err?.message || 'Unable to continue with OAuth.');
      setRetryingProvider(null);
    }
  }

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

      const code = params.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
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
          window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
        } catch {}
        await maybeApplyPendingProfile();
        clearAuthParams();
        window.location.replace(redirectTo);
        return;
      }

      const tokenHash = params.get('token_hash');
      const type = params.get('type');
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
          window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
        } catch {}
        await maybeApplyPendingProfile();
        clearAuthParams();
        window.location.replace(redirectTo);
        return;
      }

      const hashParams = readHashParams();
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (cancelled) return;
        if (error) {
          setStatus('error');
          setMessage(error.message);
          setPkceMissing(false);
          return;
        }
        setPkceMissing(false);
        try {
          window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
        } catch {}
        await maybeApplyPendingProfile();
        clearAuthParams();
        window.location.replace(redirectTo);
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
  }, [queryString]);

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-warning">
        <div className="space-y-3">
          <p>{message || 'Unable to sign you in.'}</p>
          {pkceMissing ? (
            <div className="space-y-2">
              <p className="text-xs text-text3">
                Tip: if you’re in an in-app browser, open this page in Safari/Chrome and try again.
              </p>
              <button
                type="button"
                className="btn w-full rounded-lg"
                disabled={retryingProvider != null}
                onClick={() => retryOAuth('google')}
              >
                {retryingProvider === 'google' ? 'Continuing…' : 'Continue with Google'}
              </button>
              <button
                type="button"
                className="btn-secondary w-full rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-text1 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={retryingProvider != null}
                onClick={() => retryOAuth('twitter')}
              >
                {retryingProvider === 'twitter' ? 'Continuing…' : 'Continue with X'}
              </button>
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
