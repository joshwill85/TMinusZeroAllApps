'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAuthHref, buildPrivacyChoicesHref, buildProfileHref, buildUpgradeHref } from '@tminuszero/navigation';
import type { RailProfile } from './DesktopRail';
import { CalendarBadge } from './CalendarBadge';
import { BRAND_NAME } from '@/lib/brand';
import type { ViewerTier } from '@tminuszero/domain';

type DockingBayProps = {
  profile: RailProfile;
  viewerTier?: ViewerTier | null;
  onOpenCalendar: () => void;
  onOpenSearch: () => void;
  onOpenTipJar: () => void;
};

const ANIMATION_MS = 220;

export function DockingBay({ profile, viewerTier, onOpenCalendar, onOpenSearch, onOpenTipJar }: DockingBayProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const accountHref = profile ? buildProfileHref() : buildAuthHref('sign-in');
  const accountLabel = profile?.first_name?.trim() || 'Account';
  const accountInitials = profileInitials(profile);

  const sitemapLinks = useMemo(
    () =>
      [
        { label: 'Launches', href: '/#schedule' },
        { label: 'Providers', href: '/launch-providers' },
        { label: 'Artemis', href: '/artemis' },
        { label: 'SpaceX', href: '/spacex' },
        { label: 'Blue Origin', href: '/blue-origin' },
        { label: 'News', href: '/news' },
        { label: 'About', href: '/about' },
        { label: 'FAQ', href: '/docs/faq' },
        { label: 'Support', href: '/support' },
        { label: 'Notifications', href: '/preferences' },
        viewerTier && viewerTier !== 'premium' ? { label: 'Premium · $3.99/mo', href: buildUpgradeHref() } : null,
        { label: accountLabel, href: accountHref }
      ].filter(Boolean) as Array<{ label: string; href: string }>,
    [accountHref, accountLabel, viewerTier]
  );

  const legalLinks = useMemo(
    () => [
      { label: 'Support', href: '/support' },
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Privacy Choices', href: buildPrivacyChoicesHref() },
      { label: 'Data Use', href: '/legal/data' }
    ],
    []
  );

  const aboutLinks = useMemo(
    () => [
      { label: `Why ${BRAND_NAME}`, href: '/about' },
      { label: 'The Space Devs (LL2)', href: 'https://thespacedevs.com/llapi' }
    ],
    []
  );

  const openSheet = useCallback(() => {
    if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    setMounted(true);
    window.requestAnimationFrame(() => setOpen(true));
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), ANIMATION_MS);
  }, []);

  useEffect(() => {
    closeSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeSheet();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeSheet, mounted]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const homeActive = pathname === '/';
  const calendarActive = pathname.startsWith('/calendar');
  const newsActive = pathname.startsWith('/news');
  const infoActive =
    pathname.startsWith('/info') ||
    pathname.startsWith('/catalog') ||
    pathname.startsWith('/starship') ||
    pathname.startsWith('/blue-origin');

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[70] md:left-[60px] md:w-[calc(100%-60px)]" data-nosnippet>
        <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+0.35rem)]">
          <div className="rounded-2xl border border-stroke bg-[rgba(7,9,19,0.66)] px-3 py-2 shadow-glow backdrop-blur-xl">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <div className="flex">
                <Link
                  href="/"
                  className={clsx(dockIconClass, homeActive && dockIconActiveClass)}
                  aria-label="Home"
                >
                  <HomeIcon className="h-5 w-5" />
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/news"
                  className={clsx(dockIconClass, newsActive && dockIconActiveClass)}
                  aria-label="News"
                >
                  <NewsIcon className="h-5 w-5" />
                </Link>
                <Link
                  href="/info"
                  className={clsx(dockIconClass, infoActive && dockIconActiveClass)}
                  aria-label="Info"
                >
                  <InfoIcon className="h-5 w-5" />
                </Link>
                <button
                  type="button"
                  className={clsx(dockIconClass, calendarActive && dockIconActiveClass)}
                  onClick={onOpenCalendar}
                  aria-label="Calendar"
                >
                  <CalendarBadge />
                </button>
                <button type="button" className={dockIconClass} onClick={onOpenSearch} aria-label="Search">
                  <SearchIcon className="h-5 w-5" />
                </button>
                <Link
                  href={accountHref}
                  className={clsx(
                    dockIconClass,
                    (pathname?.startsWith('/account') || pathname?.startsWith('/me')) && dockIconActiveClass
                  )}
                  aria-label="Account"
                  title={profile?.first_name?.trim() ? `Account: ${profile.first_name.trim()}` : 'Account'}
                >
                  {accountInitials ? <ProfileBadge initials={accountInitials} /> : <UserIcon className="h-5 w-5" />}
                </Link>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className={clsx(dockIconClass, open && dockIconActiveClass)}
                  onClick={() => (open ? closeSheet() : openSheet())}
                  aria-label={open ? 'Close manifest' : 'Open manifest'}
                  aria-expanded={open}
                  aria-haspopup="dialog"
                >
                  <MenuIcon className="h-5 w-5" />
                  <span className="sr-only">Manifest</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mounted && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center pb-[calc(env(safe-area-inset-bottom)+4.75rem)]"
          data-nosnippet
        >
          <button
            type="button"
            className={clsx(
              'absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm transition-opacity duration-200',
              open ? 'opacity-100' : 'opacity-0'
            )}
            onClick={closeSheet}
            aria-label="Close manifest"
          />
          <div
            role="dialog"
            aria-label="Manifest"
            className={clsx(
              'relative w-full border-t border-stroke bg-surface-1 shadow-glow',
              'transition-transform duration-200 ease-out motion-reduce:transition-none',
              open ? 'translate-y-0' : 'translate-y-full'
            )}
          >
            <div className="mx-auto flex h-[30vh] w-full max-w-6xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 md:px-8">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.24em] text-text4">Manifest</div>
                <button type="button" className="text-sm text-text3 hover:text-text1" onClick={closeSheet}>
                  Close
                </button>
              </div>

              <div className="mt-3 grid flex-1 grid-cols-2 gap-4 overflow-y-auto sm:grid-cols-4">
                <Section title="Sitemap">
                  {sitemapLinks.map((link) => (
                    <Link key={link.href} href={link.href} className={sheetLinkClass} onClick={closeSheet}>
                      {link.label}
                    </Link>
                  ))}
                </Section>

                <Section title="Legal">
                  {legalLinks.map((link) => (
                    <a key={link.href} href={link.href} className={sheetLinkClass} onClick={closeSheet}>
                      {link.label}
                    </a>
                  ))}
                </Section>

                <Section title="About">
                  {aboutLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className={sheetLinkClass}
                      onClick={closeSheet}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                    >
                      {link.label}
                    </a>
                  ))}
                </Section>

                <Section title="Tip Jar">
                  <p className="text-xs text-text3">Support {BRAND_NAME}.</p>
                  <button
                    type="button"
                    className="btn mt-2 w-full rounded-xl px-3 py-2 text-sm"
                    onClick={() => {
                      closeSheet();
                      onOpenTipJar();
                    }}
                  >
                    <TipJarIcon className="h-4 w-4" />
                    Tip
                  </button>
                </Section>
              </div>

              <div className="mt-3 text-[11px] text-text4">Primary launch schedule data: The Space Devs - Launch Library 2</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.24em] text-text4">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

const dockIconClass =
  'inline-flex h-11 w-11 items-center justify-center gap-2 rounded-2xl border border-transparent bg-[rgba(255,255,255,0.02)] text-text2 shadow-[0_1px_0_rgba(255,255,255,0.04)] transition hover:-translate-y-[1px] hover:border-stroke hover:text-text1 active:translate-y-0';

const dockIconActiveClass = 'border-primary bg-[rgba(34,211,238,0.12)] text-text1';

const sheetLinkClass = 'block text-sm text-text2 hover:text-text1';

function ProfileBadge({ initials }: { initials: string }) {
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-[11px] font-semibold text-current"
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function profileInitials(profile: RailProfile) {
  if (!profile) return '';
  const first = String(profile.first_name || '').trim();
  const last = String(profile.last_name || '').trim();
  const firstInitial = first ? (Array.from(first)[0] ?? '') : '';
  const lastInitial = last ? (Array.from(last)[0] ?? '') : '';
  const initials = `${firstInitial}${lastInitial}`.trim().toUpperCase();
  return initials;
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 11.3 12 4l8 7.3v8.3c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6v-8.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 21v-6.2c0-.9.7-1.6 1.6-1.6h2.4c.9 0 1.6.7 1.6 1.6V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NewsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 6.5h8.5a2 2 0 0 1 2 2V18a1.5 1.5 0 0 1-1.5 1.5H8a2 2 0 0 1-2-2V6.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6 8.5H5a1.5 1.5 0 0 0-1.5 1.5V18a1.5 1.5 0 0 0 1.5 1.5h1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 10h5M9 13h6M9 16h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M16.2 16.2 21 21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="6.6" y="9" width="7" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14.6" y="9" width="2.8" height="3.6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14.6" y="13.4" width="2.8" height="3.6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10.1" cy="12.6" r="0.9" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function TipJarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 9h10l-1 10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 9V7a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
