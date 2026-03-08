'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { LaunchCalendar } from './LaunchCalendar';
import { IosCalendarIcon } from './IosCalendarIcon';
import { browserApiClient } from '@/lib/api/client';
import { getBrowserClient } from '@/lib/api/supabase';
import { BRAND_NAME } from '@/lib/brand';

export function NavBar() {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{ role?: string | null; first_name?: string | null; last_name?: string | null } | null>(
    null
  );
  const pathname = usePathname();
  const menuId = 'primary-navigation';
  const isAdmin = profile?.role === 'admin';

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
    const cancelLoad = loadProfile();
    return () => cancelLoad?.();
  }, [loadProfile]);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) {
        setProfile(null);
        return;
      }
      loadProfile();
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-stroke bg-[rgba(5,6,10,0.85)] px-4 py-3 backdrop-blur-xl md:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label={`${BRAND_NAME} home`}
        >
          <Image src="/rocket.svg" alt={`${BRAND_NAME} logo`} width={36} height={36} className="h-9 w-9" priority />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-text1">{BRAND_NAME}</span>
            <span className="text-[12px] uppercase tracking-[0.12em] text-text3">Launch Schedule</span>
          </div>
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            aria-label="Open launch calendar"
            className="btn-secondary flex h-11 w-11 items-center justify-center rounded-lg border border-stroke"
            onClick={() => setCalendarOpen(true)}
          >
            <IosCalendarIcon />
          </button>
          <button
            type="button"
            className="btn-secondary flex h-11 items-center justify-center rounded-lg border border-stroke px-3 text-[11px] uppercase tracking-[0.18em] text-text3 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <div className="hidden items-center gap-4 text-sm text-text3 md:flex">
            <Link href="/about" className="hover:text-text1">
              About
            </Link>
            <Link href="/docs/faq" className="hover:text-text1">
              FAQ
            </Link>
            <Link href="/docs/sms-opt-in" className="hover:text-text1">
              SMS Opt-In
            </Link>
            <Link href="/artemis" className="hover:text-text1">
              Artemis
            </Link>
            <Link href="/artemis-ii" className="hover:text-text1">
              Artemis II
            </Link>
            <Link href="/spacex" className="hover:text-text1">
              SpaceX
            </Link>
            <Link href="/catalog" className="hover:text-text1">
              Catalog
            </Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-text1">
                Admin
              </Link>
            )}
            {profile ? (
              <Link href="/account" className="hover:text-text1">
                {profile.first_name?.trim() || 'Account'}
              </Link>
            ) : (
              <Link href="/auth/sign-in" className="hover:text-text1">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </nav>
      {menuOpen && (
        <div
          id={menuId}
          className="border-b border-stroke bg-[rgba(5,6,10,0.92)] px-4 pb-4 md:hidden"
        >
          <div className="flex flex-col gap-3 text-sm text-text3">
            <Link href="/about" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              About
            </Link>
            <Link href="/docs/faq" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              FAQ
            </Link>
            <Link href="/docs/sms-opt-in" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              SMS Opt-In
            </Link>
            <Link href="/artemis" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              Artemis
            </Link>
            <Link href="/artemis-ii" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              Artemis II
            </Link>
            <Link href="/spacex" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              SpaceX
            </Link>
            <Link href="/catalog" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
              Catalog
            </Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
                Admin
              </Link>
            )}
            {profile ? (
              <Link href="/account" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
                {profile.first_name?.trim() || 'Account'}
              </Link>
            ) : (
              <Link href="/auth/sign-in" className="hover:text-text1" onClick={() => setMenuOpen(false)}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
      <LaunchCalendar open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </>
  );
}
