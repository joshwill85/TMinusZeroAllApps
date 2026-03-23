'use client';

import { ApiClientError } from '@tminuszero/api-client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { assertPasswordPolicy, PASSWORD_POLICY_HINT } from '@tminuszero/domain';
import { buildAuthCallbackHref, readAuthIntent, readReturnTo } from '@tminuszero/navigation';
import { browserApiClient } from '@/lib/api/client';
import { getBrowserClient } from '@/lib/api/supabase';
import { CaptchaWidget } from './CaptchaWidget';

export function AuthForm({
  mode,
  claimToken,
  claimEmail
}: {
  mode: 'sign-in' | 'sign-up';
  claimToken?: string | null;
  claimEmail?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [termsPrompt, setTermsPrompt] = useState(false);
  const termsInputRef = useRef<HTMLInputElement | null>(null);
  const isSignUp = mode === 'sign-up';
  const passwordHint = useMemo(() => (isSignUp ? PASSWORD_POLICY_HINT : undefined), [isSignUp]);
  const redirectPath = useMemo(() => readReturnTo(searchParams), [searchParams]);
  const authIntent = useMemo(() => readAuthIntent(searchParams), [searchParams]);
  const lockedClaimEmail = useMemo(() => {
    if (!isSignUp) return null;
    const normalized = String(claimEmail || '')
      .trim()
      .toLowerCase();
    return normalized || null;
  }, [claimEmail, isSignUp]);
  const captchaProvider = useMemo(() => {
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return 'turnstile' as const;
    if (process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY) return 'hcaptcha' as const;
    return null;
  }, []);
  const captchaSiteKey = useMemo(() => {
    if (captchaProvider === 'turnstile') return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
    if (captchaProvider === 'hcaptcha') return process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || '';
    return '';
  }, [captchaProvider]);
  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const confirmPasswordId = `${formId}-confirm-password`;
  const passwordHintId = `${formId}-password-hint`;
  const termsErrorId = `${formId}-terms-error`;

  const baseUrl = useMemo(() => {
    if (typeof window !== 'undefined') return window.location.origin.replace(/\/+$/, '');
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
    return siteUrl ? siteUrl.replace(/\/+$/, '') : '';
  }, []);

  const emailRedirectTo = useMemo(() => {
    if (!baseUrl) return '';
    return `${baseUrl}${buildAuthCallbackHref({ returnTo: redirectPath, intent: authIntent })}`;
  }, [authIntent, baseUrl, redirectPath]);

  useEffect(() => {
    if (!lockedClaimEmail) return;
    setEmail((current) => (current.trim() ? current : lockedClaimEmail));
  }, [lockedClaimEmail]);

  function promptTermsAcceptance() {
    setTermsPrompt(true);
    try {
      termsInputRef.current?.focus();
      termsInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
  }

  async function resendVerificationEmail() {
    if (!verificationEmail) return;
    setResendingVerification(true);
    setMessage(null);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');
      if (captchaProvider && !captchaToken) throw new Error('Please complete the captcha verification.');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: verificationEmail,
        options: {
          emailRedirectTo: emailRedirectTo || undefined,
          captchaToken: captchaToken || undefined
        }
      });
      if (error) throw error;
      setMessage({
        tone: 'success',
        text: `Verification email resent to ${verificationEmail}. If you don’t see it within a few minutes, check your spam/junk folder (and Promotions).`
      });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Unable to resend verification email.' });
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setVerificationEmail(null);
    setLoading(true);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');

      if (isSignUp) {
        if (!claimToken) {
          throw new Error('New account creation now starts after Premium checkout.');
        }
        assertPasswordPolicy(password);
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        if (!acceptTerms) {
          promptTermsAcceptance();
          setMessage({ tone: 'error', text: 'Please accept the Terms and Privacy Policy to continue.' });
          return;
        }
        if (captchaProvider && !captchaToken) throw new Error('Please complete the captcha verification.');
        const nextEmail = lockedClaimEmail ?? email.trim().toLowerCase();
        const payload = await browserApiClient.createPremiumAccountFromClaim({
          claimToken,
          email: nextEmail,
          password
        });

        if (!payload.session.refreshToken) {
          throw new Error('The Premium claim session is missing a refresh token.');
        }

        const { error } = await supabase.auth.setSession({
          access_token: payload.session.accessToken,
          refresh_token: payload.session.refreshToken
        });
        if (error) throw error;

        await browserApiClient
          .recordAuthContext({
            provider: 'email_password',
            platform: 'web',
            eventType: 'sign_up'
          })
          .catch(() => {});
        router.push(payload.returnTo || redirectPath);
        return;
      } else {
        if (captchaProvider && !captchaToken) throw new Error('Please complete the captcha verification.');
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: {
            captchaToken: captchaToken || undefined
          }
        });
        if (error) throw error;
        await browserApiClient
          .recordAuthContext({
            provider: 'email_password',
            platform: 'web',
            eventType: 'sign_in'
          })
          .catch(() => {});
        if (claimToken) {
          const payload = await browserApiClient.attachPremiumClaim(claimToken);
          router.push(payload.returnTo || redirectPath);
          return;
        }
        router.push(redirectPath);
      }
    } catch (err: any) {
      if (captchaProvider) {
        setCaptchaToken(null);
        setCaptchaReset((prev) => prev + 1);
      }
      const rawMessage = err?.message || err?.error_description || 'Error';
      const errorCode = err?.code || err?.error || '';
      const isEmailNotConfirmed =
        String(errorCode).toLowerCase() === 'email_not_confirmed' ||
        (typeof rawMessage === 'string' && rawMessage.toLowerCase().includes('email not confirmed'));
      if (!isSignUp && isEmailNotConfirmed) {
        const normalizedEmail = email.trim();
        setVerificationEmail(normalizedEmail);
        setMessage({
          tone: 'error',
          text:
            'Please verify your email to sign in. If you don’t see the email within a few minutes, check your spam/junk folder (and Promotions).'
        });
        setLoading(false);
        return;
      }
      if (!captchaProvider && typeof rawMessage === 'string' && rawMessage.toLowerCase().includes('captcha')) {
        setMessage({
          tone: 'error',
          text: 'Captcha is enabled but no site key is configured. Add NEXT_PUBLIC_TURNSTILE_SITE_KEY or NEXT_PUBLIC_HCAPTCHA_SITE_KEY.'
        });
      } else if (err instanceof ApiClientError) {
        if (err.code === 'account_exists') {
          setMessage({ tone: 'error', text: 'An account with this email already exists. Sign in to claim Premium instead.' });
        } else if (err.code === 'claim_pending') {
          setMessage({ tone: 'error', text: 'Your Premium purchase is still being verified. Return to Upgrade and try again in a moment.' });
        } else if (err.code === 'claim_email_mismatch') {
          setMessage({ tone: 'error', text: 'Use the same email address that was attached to this Premium purchase.' });
        } else if (err.code === 'claim_already_claimed') {
          setMessage({ tone: 'error', text: 'This Premium purchase is already linked to an account. Sign in to manage it.' });
        } else if (err.code === 'unauthorized' && claimToken && !isSignUp) {
          setMessage({ tone: 'error', text: 'Sign-in succeeded, but the Premium claim could not be attached yet. Open Account and try again in a moment.' });
        } else {
          setMessage({ tone: 'error', text: rawMessage });
        }
      } else {
        setMessage({ tone: 'error', text: rawMessage });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4">
      {isSignUp ? (
        <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text3">
          This account will be created from a verified Premium purchase. Signing in without Premium only keeps account ownership, recovery, and billing access.
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm text-text2">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          required
          className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-text1"
          value={email}
          autoComplete="email"
          disabled={loading || Boolean(lockedClaimEmail)}
          onChange={(e) => setEmail(e.target.value)}
        />
        {lockedClaimEmail ? <span className="text-xs text-text3">This Premium claim is locked to {lockedClaimEmail}.</span> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={passwordId} className="text-sm text-text2">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          required
          className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-text1"
          value={password}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={passwordHint ? passwordHintId : undefined}
        />
        {passwordHint ? (
          <span id={passwordHintId} className="text-xs text-text3">
            {passwordHint}
          </span>
        ) : null}
      </div>
      {!isSignUp ? (
        <div className="flex justify-end">
          <Link href="/auth/forgot-password" className="text-xs text-primary hover:text-primary/80">
            Forgot password?
          </Link>
        </div>
      ) : null}
      {isSignUp ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={confirmPasswordId} className="text-sm text-text2">
            Confirm password
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
      ) : null}
      {isSignUp ? (
        <div
          className={`rounded-lg border px-3 py-2 ${
            termsPrompt && !acceptTerms ? 'border-warning/40 bg-warning/10' : 'border-stroke bg-[rgba(255,255,255,0.02)]'
          }`}
        >
          <label className="flex items-start gap-2 text-xs text-text2">
            <input
              ref={termsInputRef}
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-stroke bg-surface-0"
              checked={acceptTerms}
              aria-invalid={termsPrompt && !acceptTerms ? true : undefined}
              aria-describedby={termsPrompt && !acceptTerms ? termsErrorId : undefined}
              onChange={(e) => {
                const checked = e.target.checked;
                setAcceptTerms(checked);
                if (checked) setTermsPrompt(false);
              }}
            />
            <span>
              I agree to the{' '}
              <Link href="/legal/terms" className="text-primary hover:text-primary/80">
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy" className="text-primary hover:text-primary/80">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {termsPrompt && !acceptTerms ? (
            <div id={termsErrorId} className="mt-2 flex items-start gap-2 text-xs text-warning" role="alert">
              <AlertIcon className="mt-0.5 h-4 w-4" />
              <span>Check the box above to continue.</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {captchaProvider && captchaSiteKey ? (
        <CaptchaWidget
          provider={captchaProvider}
          siteKey={captchaSiteKey}
          resetKey={captchaReset}
          onToken={setCaptchaToken}
          className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-3"
        />
      ) : null}
      <button type="submit" className="btn w-full rounded-lg" disabled={loading}>
        {loading ? 'Working...' : mode === 'sign-in' ? 'Sign in' : 'Create account to claim Premium'}
      </button>
      {message ? (
        <div className={message.tone === 'error' ? 'text-sm text-warning' : 'text-sm text-success'}>{message.text}</div>
      ) : null}
      {verificationEmail ? (
        <button
          type="button"
          className="btn-secondary w-full rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-text1 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          onClick={resendVerificationEmail}
          disabled={resendingVerification || loading}
        >
          {resendingVerification ? 'Resending…' : 'Resend verification email'}
        </button>
      ) : null}
    </form>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5c5.25 0 9.5 4.25 9.5 9.5S17.25 21.5 12 21.5 2.5 17.25 2.5 12 6.75 2.5 12 2.5z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M12 7.2v6.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 16.9h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
