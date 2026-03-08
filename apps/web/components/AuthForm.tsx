'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { getBrowserClient } from '@/lib/api/supabase';
import { buildAuthQuery, readAuthIntent, readReturnTo } from '@/lib/utils/returnTo';
import { CaptchaWidget } from './CaptchaWidget';

const POST_CONFIRM_NEXT_STORAGE_KEY = 'tmn_auth_post_confirm_next';

type OAuthProvider = 'google' | 'twitter';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
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
  const passwordHint = useMemo(() => (isSignUp ? 'Minimum 8 characters.' : undefined), [isSignUp]);
  const redirectPath = useMemo(() => readReturnTo(searchParams), [searchParams]);
  const authIntent = useMemo(() => readAuthIntent(searchParams), [searchParams]);
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
  const oauthAvailable = useMemo(() => {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!url || !anonKey) return false;
    if (url.includes('your-supabase-url.supabase.co') || url.includes('<project-ref>')) return false;
    if (anonKey === 'SUPABASE_ANON_KEY' || anonKey === 'anon_placeholder' || anonKey === 'public_anon_key') return false;
    return true;
  }, []);
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
    const query = buildAuthQuery({ returnTo: redirectPath, intent: authIntent });
    return `${baseUrl}/auth/callback${query ? `?${query}` : ''}`;
  }, [authIntent, baseUrl, redirectPath]);

  function promptTermsAcceptance() {
    setTermsPrompt(true);
    try {
      termsInputRef.current?.focus();
      termsInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
  }

  async function startOAuth(provider: OAuthProvider) {
    setMessage(null);
    if (isSignUp && !acceptTerms) {
      promptTermsAcceptance();
      setMessage({ tone: 'error', text: 'Please accept the Terms and Privacy Policy to continue.' });
      return;
    }

    setLoading(true);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');

      try {
        window.localStorage.setItem(POST_CONFIRM_NEXT_STORAGE_KEY, redirectPath);
      } catch {}

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: emailRedirectTo || undefined
        }
      });
      if (error) throw error;
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Unable to continue with OAuth.' });
      setLoading(false);
    }
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
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        if (!acceptTerms) {
          promptTermsAcceptance();
          setMessage({ tone: 'error', text: 'Please accept the Terms and Privacy Policy to continue.' });
          return;
        }
        if (captchaProvider && !captchaToken) throw new Error('Please complete the captcha verification.');
        try {
          window.localStorage.setItem(POST_CONFIRM_NEXT_STORAGE_KEY, redirectPath);
        } catch {}

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: emailRedirectTo || undefined,
            captchaToken: captchaToken || undefined
          }
        });
        if (error) {
          const raw = String(error.message || 'Error');
          const lowered = raw.toLowerCase();
          if (lowered.includes('already registered') || lowered.includes('already exists')) {
            throw new Error('An account with this email already exists. Try signing in.');
          }
          throw error;
        }

        if (data?.session) {
          try {
            window.localStorage.removeItem(POST_CONFIRM_NEXT_STORAGE_KEY);
          } catch {}
          router.push(redirectPath);
          return;
        }

        const normalizedEmail = email.trim();
        setVerificationEmail(normalizedEmail);
        setMessage({
          tone: 'success',
          text:
            authIntent === 'upgrade'
              ? 'Account created. Please verify your email to continue. After that, we’ll bring you back to what you were viewing. If you don’t see the email within a few minutes, check your spam/junk folder (and Promotions).'
              : 'Account created. Please verify your email to continue. If you don’t see the email within a few minutes, check your spam/junk folder (and Promotions).'
        });
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
      } else {
        setMessage({ tone: 'error', text: rawMessage });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4">
      {oauthAvailable ? (
        <>
          <div className="space-y-2">
            <OAuthButton
              onClick={() => startOAuth('google')}
              disabled={loading}
              icon={<GoogleIcon className="h-5 w-5" />}
            >
              Continue with Google
            </OAuthButton>
            <OAuthButton
              onClick={() => startOAuth('twitter')}
              disabled={loading}
              icon={<XIcon className="h-5 w-5" />}
            >
              Continue with X
            </OAuthButton>
          </div>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-stroke" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface-1 px-2 text-xs uppercase tracking-[0.14em] text-text3">Or</span>
            </div>
          </div>
        </>
      ) : null}

      {isSignUp ? (
        <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-text3">
          Free account perks: 15-minute refreshes, one saved view, one My Launches list, and synced preferences. Premium stays optional later.
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
          onChange={(e) => setEmail(e.target.value)}
        />
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
        {loading ? 'Working...' : mode === 'sign-in' ? 'Sign in' : 'Create free account'}
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

function OAuthButton({
  children,
  onClick,
  disabled,
  icon
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn-secondary relative flex w-full items-center justify-center rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-text1 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="absolute left-3 inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.73 1.22 9.24 3.22l6.9-6.9C35.93 2.09 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l8.04 6.25C12.6 13.24 17.92 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.2 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.5c-.54 2.92-2.18 5.39-4.63 7.05l7.07 5.48c4.14-3.83 6.26-9.47 6.26-16.78z"
      />
      <path
        fill="#FBBC05"
        d="M10.6 28.47A14.5 14.5 0 0 1 9.5 24c0-1.55.27-3.05.75-4.47l-8.04-6.25A23.9 23.9 0 0 0 0 24c0 3.86.92 7.51 2.56 10.78l8.04-6.31z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.14 15.9-5.82l-7.07-5.48c-1.96 1.32-4.47 2.1-8.83 2.1-6.08 0-11.4-3.74-13.4-8.97l-8.04 6.31C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.9 2H22l-6.78 7.75L23 22h-6.1l-4.78-7.02L5.98 22H2.88l7.26-8.3L1 2h6.24l4.32 6.4L18.9 2zm-1.07 18.2h1.7L6.36 3.7H4.54l13.29 16.5z"
      />
    </svg>
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
