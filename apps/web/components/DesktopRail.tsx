'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { BRAND_NAME } from '@/lib/brand';

export type RailProfile = {
  role?: string | null;
  first_name?: string | null;
  last_name?: string | null;
} | null;

export function DesktopRail({ profile }: { profile: RailProfile }) {
  const pathname = usePathname();
  const accountHref = profile ? '/account' : '/auth/sign-in';
  const initials = profileInitials(profile);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-[60px] flex-col border-r border-stroke bg-[rgba(5,6,10,0.72)] backdrop-blur-xl md:flex"
      aria-label="Primary"
    >
      <div className="flex h-full flex-col items-center py-3">
        <Link
          href="/"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stroke bg-[rgba(7,9,19,0.65)] shadow-glow transition hover:border-primary"
          aria-label={BRAND_NAME}
          title={BRAND_NAME}
        >
          <Image src="/rocket.svg" alt="" width={28} height={28} className="h-7 w-7" priority />
        </Link>

        <nav className="mt-4 flex flex-col items-center gap-2" aria-label="Navigation">
          <Link
            href={accountHref}
            className={clsx(railButtonClass, pathname.startsWith('/account') && 'border-primary text-text1')}
            aria-label="Account"
            title={profile?.first_name?.trim() ? `Account: ${profile.first_name.trim()}` : 'Account'}
          >
            {initials ? <ProfileBadge initials={initials} /> : <UserIcon className="h-5 w-5" />}
          </Link>
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2 pb-2">
          <a href="/legal/terms" className={railFooterItemClass} aria-label="Terms">
            <DocIcon className="h-4 w-4" />
            <span className="text-[10px] leading-none">Terms</span>
          </a>
          <a href="/legal/privacy" className={railFooterItemClass} aria-label="Privacy">
            <LockIcon className="h-4 w-4" />
            <span className="text-[10px] leading-none">Privacy</span>
          </a>
          <a href="/legal/privacy-choices" className={railFooterItemClass} aria-label="Privacy choices">
            <SlidersIcon className="h-4 w-4" />
            <span className="text-[10px] leading-none">Choices</span>
          </a>
        </div>
      </div>
    </aside>
  );
}

const railButtonClass =
  'flex h-11 w-11 items-center justify-center rounded-2xl border border-stroke bg-[rgba(7,9,19,0.55)] text-text2 shadow-glow transition hover:border-primary hover:text-text1';

const railFooterItemClass =
  'flex w-12 flex-col items-center justify-center gap-1 rounded-xl border border-transparent py-2 text-text3 transition hover:border-stroke hover:text-text1';

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

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.5 20a6.5 6.5 0 0 1 13 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 3.5h6.5L18.5 7v13.5c0 .9-.7 1.5-1.6 1.5H8c-.9 0-1.6-.6-1.6-1.5V5c0-.9.7-1.5 1.6-1.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 3.5V7H18.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 11.2h6.4M9 14.6h6.4M9 18h4.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7.5 10.5V8.8a4.5 4.5 0 0 1 9 0v1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7 10.5h10c.9 0 1.6.7 1.6 1.6v7.3c0 .9-.7 1.6-1.6 1.6H7c-.9 0-1.6-.7-1.6-1.6v-7.3c0-.9.7-1.6 1.6-1.6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 14.1v3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 6v0" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M15 12v0" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M11 18v0" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
