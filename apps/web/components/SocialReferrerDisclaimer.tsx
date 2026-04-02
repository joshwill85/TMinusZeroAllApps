'use client';

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserClient } from '@/lib/api/supabase';

type SocialSource = 'x';

const DISMISS_KEY = 'tminus.social_disclaimer.dismissed_at';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(value: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(value));
  } catch {
    return;
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function resolveSourceFromUtm(value: string): SocialSource | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'x' || normalized === 'twitter' || normalized === 't.co' || normalized === 'x.com' || normalized === 'twitter.com') return 'x';
  return null;
}

function resolveSourceFromReferrerHost(host: string | null): SocialSource | null {
  if (!host) return null;
  const normalized = host.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 't.co' || hostMatches(normalized, 'x.com') || hostMatches(normalized, 'twitter.com')) return 'x';
  return null;
}

function getReferrerHost(): string | null {
  if (typeof document === 'undefined') return null;
  const raw = document.referrer;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function readSearchSnapshot() {
  if (typeof window === 'undefined') {
    return { utmSource: '' };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: (params.get('utm_source') || '').trim().toLowerCase()
  };
}

export function SocialReferrerDisclaimer() {
  const pathname = usePathname();
  const [utmSource, setUtmSource] = useState('');
  const [open, setOpen] = useState(false);
  const [resolvedSource, setResolvedSource] = useState<SocialSource | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  const shouldConsider = useMemo(() => {
    if (!pathname) return true;
    if (pathname.startsWith('/embed')) return false;
    if (pathname.startsWith('/auth/')) return false;
    if (pathname === '/upgrade') return false;
    return true;
  }, [pathname]);

  useEffect(() => {
    const snapshot = readSearchSnapshot();
    setUtmSource(snapshot.utmSource);
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    writeDismissedAt(Date.now());
  }, []);

  useEffect(() => {
    if (!shouldConsider) {
      setResolvedSource(null);
      return;
    }

    const fromUtm = resolveSourceFromUtm(utmSource);
    if (fromUtm) {
      setResolvedSource(fromUtm);
      return;
    }
    setResolvedSource(resolveSourceFromReferrerHost(getReferrerHost()));
  }, [shouldConsider, utmSource]);

  useEffect(() => {
    if (!shouldConsider) return;

    const supabase = getBrowserClient();
    if (!supabase) {
      setIsAuthed(false);
      setAuthReady(true);
      return;
    }

    let cancelled = false;
    supabase.auth
      .getSession()
      .then((result: any) => {
        if (cancelled) return;
        setIsAuthed(Boolean(result?.data?.session?.user));
        setAuthReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsAuthed(false);
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const authed = Boolean(session?.user);
      setIsAuthed(authed);
      if (authed) setOpen(false);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [shouldConsider]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!shouldConsider) return;
    if (!authReady) return;
    if (isAuthed) return;
    if (!resolvedSource) return;

    const dismissedAt = readDismissedAt();
    if (dismissedAt != null && Date.now() - dismissedAt < DISMISS_TTL_MS) return;
    setOpen(true);
  }, [authReady, isAuthed, resolvedSource, shouldConsider]);

  if (!open) return null;

  const upgradeHref = '/upgrade?return_to=%2F';
  const sourceLabel = 'X';

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-4 md:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(0,0,0,0.35)] backdrop-blur-sm"
        onClick={close}
        aria-label="Dismiss refresh disclaimer"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refresh disclaimer"
        className="relative w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Heads-up</div>
            <div className="text-base font-semibold text-text1">Refresh speeds</div>
          </div>
          <button type="button" className="text-sm text-text3 hover:text-text1" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <p className="mt-2 text-sm text-text2">
          Since you&apos;re visiting from {sourceLabel}: public (not signed in) data can be up to <span className="font-semibold text-text1">2 hours</span> behind.
        </p>
        <p className="mt-2 text-sm text-text2">
          Sign in when you want account ownership and purchase restore. Premium uses the live refresh cadence and moves faster near active launches.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Link href={upgradeHref} className="btn rounded-lg px-4 py-2 text-sm" onClick={close}>
            View Premium
          </Link>
          <button type="button" className="text-xs text-text3 hover:text-text1" onClick={close}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
