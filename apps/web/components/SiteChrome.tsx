'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { ViewerTier } from '@tminuszero/domain';
import { buildCalendarHref } from '@tminuszero/navigation';
import { useProfileQuery, useViewerEntitlementsQuery } from '@/lib/api/queries';
import { CommLinkHeader } from '@/components/CommLinkHeader';
import { DesktopRail, type RailProfile } from '@/components/DesktopRail';
import { DockingBay } from '@/components/DockingBay';
import { LaunchSearchModal } from '@/components/LaunchSearchModal';
import { TipJarModal } from '@/components/TipJarModal';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { useToast } from '@/components/ToastProvider';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

const OPEN_LAUNCH_SEARCH_EVENT = 'tmz:open-launch-search';

export function SiteChrome() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [tipJarOpen, setTipJarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();
  const profile = useMemo<RailProfile>(() => {
    if (!profileQuery.data) return null;
    return {
      role: profileQuery.data.role,
      first_name: profileQuery.data.firstName,
      last_name: profileQuery.data.lastName
    };
  }, [profileQuery.data]);
  const viewerTier = useMemo<ViewerTier | null>(() => {
    const tier = entitlementsQuery.data?.tier;
    return tier === 'anon' || tier === 'premium' ? tier : null;
  }, [entitlementsQuery.data?.tier]);
  const isAdmin = profile?.role === 'admin';
  const isCameraGuide = /^\/launches\/[^/]+\/ar(?:\/|$)/.test(pathname || '');
  const feedbackContext = useMemo(() => {
    if (!pathname) return null;
    if (pathname === '/') return { source: 'launch_card' as const, launchId: null as string | null };
    const match = pathname.match(/^\/launches\/([^/]+)$/);
    if (!match) return null;
    return { source: 'launch_details' as const, launchId: match[1] || null };
  }, [pathname]);

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
    if (typeof window === 'undefined' || isCameraGuide) return;

    const onOpenLaunchSearch = () => setSearchOpen(true);
    window.addEventListener(OPEN_LAUNCH_SEARCH_EVENT, onOpenLaunchSearch);
    return () => window.removeEventListener(OPEN_LAUNCH_SEARCH_EVENT, onOpenLaunchSearch);
  }, [isCameraGuide]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const tip = params.get('tip');
    const premium = params.get('premium');
    if (!tip && !premium) return;

    const tipMode = params.get('tip_mode');
    if (tip === 'open') {
      setTipJarOpen(true);
    } else if (tip === 'success') {
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
        onOpenCalendar={() => router.push(buildCalendarHref())}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenTipJar={() => setTipJarOpen(true)}
      />

      <Suspense fallback={null}>
        <LaunchSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </Suspense>
      <TipJarModal open={tipJarOpen} onClose={() => setTipJarOpen(false)} />
      {feedbackContext && <FeedbackWidget source={feedbackContext.source} launchId={feedbackContext.launchId} />}
    </>
  );
}
