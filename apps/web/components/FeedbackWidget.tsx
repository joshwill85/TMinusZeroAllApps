'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { getBrowserClient } from '@/lib/api/supabase';

type FeedbackSource = 'launch_card' | 'launch_details';

type FeedbackAuthUser = {
  email?: string | null;
  user_metadata?: unknown;
};

type FeedbackGetUserResult = {
  data: { user: FeedbackAuthUser | null };
};

export function FeedbackWidget({ source, launchId }: { source: FeedbackSource; launchId?: string | null }) {
  const pathname = usePathname() || '/';
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameId = useId();
  const emailId = useId();
  const messageId = useId();
  const companyId = useId();

  const context = useMemo(
    () => ({
      pagePath: pathname,
      source,
      launchId: launchId ?? undefined
    }),
    [launchId, pathname, source]
  );

  useEffect(() => {
    const dismissedAt = readDismissedAt();
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_WINDOW_MS) return;
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (email.trim() && name.trim()) return;
    const supabase = getBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }: FeedbackGetUserResult) => {
        if (cancelled) return;
        const user = data.user;
        if (!user) return;
        if (!email.trim() && user.email) setEmail(user.email);
        if (!name.trim()) {
          const nextName = buildNameFromUserMeta(user.user_metadata);
          if (nextName) setName(nextName);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [email, name, open]);

  if (!visible) return null;

  const dismiss = () => {
    writeDismissedAt(Date.now());
    setOpen(false);
    setVisible(false);
  };

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const openModal = () => {
    setSuccess(false);
    setError(null);
    setStartedAtMs(Date.now());
    setOpen(true);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          message: message.trim(),
          pagePath: context.pagePath,
          source: context.source,
          launchId: context.launchId,
          startedAtMs: startedAtMs ?? undefined,
          company: company.trim() || undefined
        })
      });

      if (res.ok) {
        setSuccess(true);
        setMessage('');
        return;
      }

      const json = await res.json().catch(() => ({}));
      const code = json?.error || 'submit_failed';
      setError(code);
    } catch (err) {
      console.error('feedback submit error', err);
      setError('submit_failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-[calc(var(--dock-offset)+env(safe-area-inset-bottom)+0.75rem)] right-4 z-[55] md:right-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="group inline-flex items-center gap-2 rounded-full border border-stroke bg-[rgba(7,9,19,0.72)] px-3 py-2 text-xs text-text2 shadow-glow backdrop-blur-xl transition hover:border-primary hover:text-text1"
            onClick={openModal}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <ChatIcon className="h-4 w-4 text-text3 transition group-hover:text-text2" />
            <span className="font-semibold tracking-[0.08em]">Feedback</span>
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stroke bg-[rgba(7,9,19,0.72)] text-text3 shadow-glow backdrop-blur-xl transition hover:border-primary hover:text-text1"
            onClick={dismiss}
            aria-label="Dismiss feedback button for one week"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 md:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
            onClick={close}
            aria-label="Close feedback form"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Feedback</div>
                <div className="text-base font-semibold text-text1">Help us improve</div>
                <div className="mt-1 text-xs text-text3">No tracking. Just what you type here.</div>
              </div>
              <button type="button" className="text-sm text-text3 hover:text-text1" onClick={close}>
                Close
              </button>
            </div>

            {success ? (
              <div className="mt-4 space-y-2">
                <div className="text-base font-semibold text-text1">Thank you.</div>
                <div className="text-sm text-text3">We read every message.</div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form className="mt-4 space-y-3" onSubmit={onSubmit}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor={nameId} className="text-[11px] uppercase tracking-[0.08em] text-text3">
                      Name
                    </label>
                    <input
                      id={nameId}
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={emailId} className="text-[11px] uppercase tracking-[0.08em] text-text3">
                      Email
                    </label>
                    <input
                      id={emailId}
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      required
                      maxLength={320}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor={messageId} className="text-[11px] uppercase tracking-[0.08em] text-text3">
                    Feedback
                  </label>
                  <textarea
                    id={messageId}
                    required
                    rows={5}
                    minLength={5}
                    maxLength={5000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What should we fix or add?"
                    className="w-full resize-none rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none focus:border-primary"
                  />
                  <div className="text-[11px] text-text3">Please don’t include passwords or payment info.</div>
                </div>

                <div className="hidden">
                  <label htmlFor={companyId}>Company</label>
                  <input id={companyId} value={company} onChange={(e) => setCompany(e.target.value)} tabIndex={-1} autoComplete="off" />
                </div>

                {error && <div className="text-xs text-danger">{formatError(error)}</div>}

                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="text-xs text-text3 hover:text-text1" onClick={dismiss}>
                    Hide for a week
                  </button>
                  <button type="submit" className="btn rounded-lg px-4 py-2 text-sm" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send feedback'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const DISMISS_KEY = 'feedback_widget_dismissed_at';
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function readDismissedAt() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function writeDismissedAt(value: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DISMISS_KEY, String(value));
}

function buildNameFromUserMeta(meta: unknown) {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  const first = typeof record.first_name === 'string' ? record.first_name.trim() : '';
  const last = typeof record.last_name === 'string' ? record.last_name.trim() : '';
  const combined = `${first} ${last}`.trim();
  return combined || null;
}

function formatError(code: string) {
  switch (code) {
    case 'rate_limited':
      return 'Too many submissions. Please try again later.';
    case 'supabase_not_configured':
      return 'Feedback is temporarily unavailable.';
    case 'invalid_body':
      return 'Please enter a valid email and at least 5 characters of feedback.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M7 8.5h10M7 12h7M12 20.5c4.97 0 9-3.36 9-7.5s-4.03-7.5-9-7.5-9 3.36-9 7.5c0 1.78.75 3.42 2 4.73V21l3.02-1.51c1.19.65 2.54 1.01 3.98 1.01Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M7 7l10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
