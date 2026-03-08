'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { getBrowserClient } from '@/lib/api/supabase';

type Message = { tone: 'error' | 'success'; text: string };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const emailId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not available');
      const baseUrl = window.location.origin.replace(/\/+$/, '');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${baseUrl}/auth/reset-password`
      });

      if (error) console.warn('password reset request warning', error.message);
      setMessage({ tone: 'success', text: "If an account exists for that email, you'll receive a reset link shortly." });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'Unable to send reset email.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Auth</p>
        <h1 className="text-3xl font-semibold text-text1">Forgot password</h1>
        <p className="text-sm text-text2">We will email you a secure link to reset your password.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-stroke bg-surface-1 p-4">
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
        <button type="submit" className="btn w-full rounded-lg" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
        {message && (
          <div className={message.tone === 'error' ? 'text-sm text-warning' : 'text-sm text-success'}>
            {message.text}
          </div>
        )}
      </form>
      <p className="text-sm text-text3">
        Remembered your password?{' '}
        <Link href="/auth/sign-in" className="text-primary">
          Sign in
        </Link>
      </p>
    </div>
  );
}
