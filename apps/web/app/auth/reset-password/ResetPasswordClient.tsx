'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { getBrowserClient } from '@/lib/api/supabase';
import type { EmailOtpType } from '@supabase/supabase-js';

type Message = { tone: 'error' | 'success'; text: string };
type RecoveryState = 'checking' | 'ready' | 'missing' | 'error';

function readHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(trimmed);
}

function clearRecoveryParams() {
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

export default function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');
  const [message, setMessage] = useState<Message | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const passwordId = `${formId}-password`;
  const confirmPasswordId = `${formId}-confirm-password`;

  useEffect(() => {
    let cancelled = false;

    async function prepareRecovery() {
      const supabase = getBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setMessage({ tone: 'error', text: 'Supabase not available.' });
          setRecoveryState('error');
        }
        return;
      }

      const queryParams = new URLSearchParams(searchParamString);
      const queryError = queryParams.get('error');
      const queryErrorDescription = queryParams.get('error_description');
      if (queryError) {
        if (!cancelled) {
          setMessage({ tone: 'error', text: queryErrorDescription || queryError });
          setRecoveryState('error');
        }
        return;
      }

      const code = queryParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          if (error) {
            const raw = String(error.message || '');
            const lower = raw.toLowerCase();
            const isPkceMissing =
              error.name === 'AuthPKCECodeVerifierMissingError' ||
              lower.includes('pkce code verifier') ||
              lower.includes('code verifier') ||
              lower.includes('pkce_code_verifier_not_found');
            setMessage({
              tone: 'error',
              text: isPkceMissing
                ? 'This reset link was opened in a different browser or device than the one that requested it. Please request a new reset link from this device and open it here.'
                : error.message
            });
            setRecoveryState('error');
          } else {
            clearRecoveryParams();
            setRecoveryState('ready');
          }
        }
        return;
      }

      const tokenHash = queryParams.get('token_hash');
      const type = queryParams.get('type');
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
        if (!cancelled) {
          if (error) {
            setMessage({ tone: 'error', text: error.message });
            setRecoveryState('error');
          } else {
            clearRecoveryParams();
            setRecoveryState('ready');
          }
        }
        return;
      }

      const hashParams = readHashParams();
      const hashError = hashParams.get('error');
      const hashErrorDescription = hashParams.get('error_description');
      if (hashError) {
        if (!cancelled) {
          setMessage({ tone: 'error', text: hashErrorDescription || hashError });
          setRecoveryState('error');
        }
        return;
      }

      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if (!cancelled) {
          if (error) {
            setMessage({ tone: 'error', text: error.message });
            setRecoveryState('error');
          } else {
            clearRecoveryParams();
            setRecoveryState('ready');
          }
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        if (data.session) {
          setRecoveryState('ready');
        } else {
          setRecoveryState('missing');
        }
      }
    }

    prepareRecovery();
    return () => {
      cancelled = true;
    };
  }, [searchParamString]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (password.length < 8) {
      setMessage({ tone: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ tone: 'error', text: 'Passwords do not match.' });
      return;
    }

    setSaving(true);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage({ tone: 'success', text: 'Password updated. You can now sign in.' });
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'Unable to reset password.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Auth</p>
        <h1 className="text-3xl font-semibold text-text1">Reset password</h1>
        <p className="text-sm text-text2">Choose a new password for your account.</p>
      </div>

      {recoveryState === 'checking' && <p className="text-sm text-text2">Validating your reset link...</p>}

      {recoveryState === 'missing' && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          This reset link is missing or expired.{' '}
          <Link href="/auth/forgot-password" className="text-primary">
            Request a new link
          </Link>
          .
        </div>
      )}

      {recoveryState === 'error' && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-warning">
          {message?.text || 'Unable to validate the reset link.'}
        </div>
      )}

      {recoveryState === 'ready' && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={passwordId} className="text-sm text-text2">
              New password
            </label>
            <input
              id={passwordId}
              type="password"
              required
              className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-text1"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={confirmPasswordId} className="text-sm text-text2">
              Confirm new password
            </label>
            <input
              id={confirmPasswordId}
              type="password"
              required
              className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-text1"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn w-full rounded-lg" disabled={saving}>
            {saving ? 'Saving...' : 'Update password'}
          </button>
          {message && (
            <div className={message.tone === 'error' ? 'text-sm text-warning' : 'text-sm text-success'}>
              {message.text}
            </div>
          )}
        </form>
      )}

      <p className="text-sm text-text3">
        Ready to sign in?{' '}
        <Link href="/auth/sign-in" className="text-primary">
          Sign in
        </Link>
      </p>
    </div>
  );
}
