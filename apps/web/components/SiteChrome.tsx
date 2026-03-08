'use client';

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getBrowserClient } from '@/lib/api/supabase';
import { browserApiClient } from '@/lib/api/client';
import type { ViewerTier } from '@/lib/tiers';
import { CommLinkHeader } from '@/components/CommLinkHeader';
import { DesktopRail, type RailProfile } from '@/components/DesktopRail';
import { DockingBay } from '@/components/DockingBay';
import { LaunchCalendar } from '@/components/LaunchCalendar';
import { LaunchSearchModal } from '@/components/LaunchSearchModal';
import { TipJarModal } from '@/components/TipJarModal';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { useToast } from '@/components/ToastProvider';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function SiteChrome() {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tipJarOpen, setTipJarOpen] = useState(false);
  const [profile, setProfile] = useState<RailProfile>(null);
  const [viewerTier, setViewerTier] = useState<ViewerTier | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const pathname = usePathname();
  const { pushToast } = useToast();
  const isAdmin = profile?.role === 'admin';
  const isCameraGuide = /^\/launches\/[^/]+\/ar(?:\/|$)/.test(pathname || '');
  const isAuthPath = pathname.startsWith('/auth/');
  const feedbackContext = useMemo(() => {
    if (!pathname) return null;
    if (pathname === '/') return { source: 'launch_card' as const, launchId: null as string | null };
    const match = pathname.match(/^\/launches\/([^/]+)$/);
    if (!match) return null;
    return { source: 'launch_details' as const, launchId: match[1] || null };
  }, [pathname]);

  const loadSubscription = useCallback(() => {
    let cancelled = false;
    browserApiClient
      .getViewerEntitlements()
      .then((data) => {
        if (cancelled) return;
        const tier = data?.tier;
        if (tier === 'anon' || tier === 'free' || tier === 'premium') {
          setViewerTier(tier);
          return;
        }
        setViewerTier(null);
      })
      .catch(() => {
        if (cancelled) return;
        setViewerTier(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProfile = useCallback(() => {
    let cancelled = false;
    browserApiClient
      .getProfile()
      .then((nextProfile) => {
        if (cancelled) return;
        setProfile(
          nextProfile
            ? {
                role: nextProfile.role,
                first_name: nextProfile.firstName,
                last_name: nextProfile.lastName
              }
            : null
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setProfile(null);
        console.error('profile fetch error', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isCameraGuide) return;
    const cancelProfile = loadProfile();
    const cancelSubscription = loadSubscription();
    return () => {
      cancelProfile?.();
      cancelSubscription?.();
    };
  }, [isCameraGuide, loadProfile, loadSubscription]);

  useEffect(() => {
    if (isCameraGuide) return;
    const supabase = getBrowserClient();
    if (!supabase) {
      setIsAuthed(false);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getUser()
      .then((result: { data?: { user?: unknown | null } | null }) => {
        if (cancelled) return;
        const authed = Boolean(result.data?.user);
        setIsAuthed(authed);
        if (!authed) {
          setProfile(null);
          setViewerTier('anon');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setIsAuthed(false);
        setProfile(null);
        setViewerTier('anon');
      });

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const authed = Boolean(session?.user);
      setIsAuthed(authed);
      if (!authed) {
        setProfile(null);
        setViewerTier('anon');
        return;
      }
      loadProfile();
      loadSubscription();
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [isCameraGuide, loadProfile, loadSubscription]);

  useEffect(() => {
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined' || isCameraGuide) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const metaShortcut = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      if (metaShortcut) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== '/') return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      setSearchOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCameraGuide]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const tip = params.get('tip');
    const premium = params.get('premium');
    if (!tip && !premium) return;

    const tipMode = params.get('tip_mode');
    if (tip === 'success') {
      pushToast({
        tone: 'success',
        message: tipMode === 'monthly' ? 'Monthly tip active — thank you!' : 'Thanks for the tip!'
      });
    } else if (tip === 'cancel') {
      pushToast({
        tone: 'info',
        message: tipMode === 'monthly' ? 'Monthly tip checkout canceled.' : 'Tip checkout canceled.'
      });
    }

    if (premium === 'welcome') {
      pushToast({
        tone: 'success',
        message: 'Premium is active. Live updates, alerts, and recurring feeds are ready.'
      });
    } else if (premium === 'payment_issue') {
      pushToast({
        tone: 'warning',
        message: 'Billing needs attention. Update your payment method in Account.'
      });
    }

    params.delete('tip');
    params.delete('tip_mode');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    try {
      window.history.replaceState(null, '', nextUrl);
    } catch {
      // Browser throttles replaceState when called too frequently.
    }
  }, [pathname, pushToast]);

  if (isCameraGuide) return null;

  return (
    <>
      <DesktopRail profile={profile} />
      <CommLinkHeader />
      <DockingBay
        profile={profile}
        isAdmin={isAdmin}
        viewerTier={viewerTier}
        onOpenCalendar={() => setCalendarOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenTipJar={() => setTipJarOpen(true)}
      />

      <LaunchCalendar open={calendarOpen} onClose={() => setCalendarOpen(false)} />
      <Suspense fallback={null}>
        <LaunchSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </Suspense>
      <TipJarModal open={tipJarOpen} onClose={() => setTipJarOpen(false)} />
      {feedbackContext && <FeedbackWidget source={feedbackContext.source} launchId={feedbackContext.launchId} />}
    </>
  );
}
