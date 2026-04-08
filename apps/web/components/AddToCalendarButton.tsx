'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildCalendarEventLinks } from '@tminuszero/domain';
import clsx from 'clsx';
import { Launch } from '@/lib/types/launch';
import { isCountdownEligible } from '@/lib/time';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { slugify } from '@/lib/utils/slug';
import { CalendarBadge } from '@/components/CalendarBadge';
import { PremiumGateButton } from '@/components/PremiumGateButton';
import { BRAND_NAME, DEFAULT_SITE_URL } from '@/lib/brand';

type CalendarLaunchInput = Pick<Launch, 'id' | 'name' | 'slug' | 'provider' | 'vehicle' | 'pad' | 'net' | 'netPrecision' | 'windowEnd'>;

type AddToCalendarButtonProps = {
  launch: CalendarLaunchInput;
  variant?: 'icon' | 'button';
  showAddBadge?: boolean;
  className?: string;
  requiresAuth?: boolean;
  isAuthed?: boolean;
  requiresPremium?: boolean;
  isPremium?: boolean;
  authHref?: string;
};

export function AddToCalendarButton(props: AddToCalendarButtonProps) {
  const {
    launch,
    variant = 'icon',
    showAddBadge = false,
    className,
    requiresAuth = false,
    requiresPremium = false,
    isAuthed = true,
    isPremium = false,
    authHref = '/auth/sign-in'
  } = props;
  const [open, setOpen] = useState(false);
  const [userTz, setUserTz] = useState('UTC');
  const { googleUrl, outlookUrl, detailUrl, icsUrl } = useMemo(
    () => buildCalendarLinks(launch, userTz),
    [launch, userTz]
  );
  const dialogTitleId = `add-to-calendar-title-${launch.id}`;

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setUserTz(tz);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (requiresPremium && !isPremium) {
    return (
      <PremiumGateButton
        isAuthed={isAuthed}
        featureLabel="launch calendar"
        className={clsx(
          variant === 'icon'
            ? 'btn-secondary relative flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary'
            : 'btn-secondary rounded-lg px-4 py-2 text-sm',
          className
        )}
        ariaLabel="Add to calendar (Premium)"
      >
        {variant === 'icon' ? <CalendarBadge /> : 'Add to calendar'}
      </PremiumGateButton>
    );
  }

  if (requiresAuth && !isAuthed) {
    if (variant === 'icon') {
      return (
        <Link
          href={authHref}
          className={clsx(
            'btn-secondary relative flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary',
            className
          )}
          aria-label="Sign in to add to calendar"
        >
          <CalendarBadge />
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-stroke bg-surface-2 text-text2 shadow-[0_0_6px_rgba(0,0,0,0.35)]">
            <LockIcon className="h-2.5 w-2.5" />
          </span>
        </Link>
      );
    }

    return (
      <Link href={authHref} className={clsx('btn-secondary rounded-lg px-4 py-2 text-sm', className)}>
        Sign in to add to calendar
      </Link>
    );
  }

  const handleAppleCalendar = async () => {
    const hasShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    if (!hasShare) {
      window.location.href = icsUrl;
      setOpen(false);
      return;
    }

    try {
      const res = await fetch(icsUrl);
      if (res.status === 401) {
        window.location.href = authHref;
        return;
      }
      if (!res.ok) throw new Error('ics_fetch_failed');
      const icsText = await res.text();
      const fileName = `${slugify(launch.slug || launch.name) || 'launch'}.ics`;
      const file = new File([icsText], fileName, { type: 'text/calendar' });

      const canShare = typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : true;
      if (!canShare) {
        window.location.href = icsUrl;
        setOpen(false);
        return;
      }

      await navigator.share({
        files: [file],
        title: launch.name,
        text: 'Launch calendar event'
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      window.location.href = icsUrl;
    } finally {
      setOpen(false);
    }
  };

  const handlePrimaryClick = () => {
    const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      void handleAppleCalendar();
      return;
    }
    setOpen(true);
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          className={clsx(
            'btn-secondary relative flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary',
            className
          )}
          onClick={handlePrimaryClick}
          aria-label="Add to calendar"
        >
          <span aria-hidden="true" className="relative">
            <CalendarBadge />
            {showAddBadge && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-stroke bg-surface-2 text-success shadow-[0_0_6px_rgba(0,0,0,0.35)]">
                <PlusIcon className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
        </button>
      ) : (
        <button type="button" className={clsx('btn-secondary rounded-lg px-4 py-2 text-sm', className)} onClick={handlePrimaryClick}>
          Add to calendar
        </button>
      )}

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[95] flex items-end justify-center p-4 md:items-center">
              <button
                type="button"
                className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-label="Close add to calendar"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                className="relative z-10 w-full max-w-md overflow-y-auto rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow max-h-[calc(100dvh-2rem)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.1em] text-text3">Add to calendar</div>
                    <div id={dialogTitleId} className="text-base font-semibold text-text1">
                      {launch.name}
                    </div>
                  </div>
                  <button type="button" className="text-sm text-text3 hover:text-text1" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                    onClick={() => {
                      void handleAppleCalendar();
                    }}
                  >
                    Apple Calendar
                  </button>
                  <a
                    href={googleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                    onClick={() => setOpen(false)}
                  >
                    Google Calendar
                  </a>
                  <a
                    href={outlookUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                    onClick={() => setOpen(false)}
                  >
                    Outlook Calendar
                  </a>
                </div>

                <a
                  href={detailUrl}
                  className="mt-3 block text-center text-xs text-text3 hover:text-text1"
                  onClick={() => setOpen(false)}
                >
                  View launch details
                </a>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 4.5v11" />
      <path d="M4.5 10h11" />
    </svg>
  );
}

function buildCalendarLinks(launch: CalendarLaunchInput, timeZone?: string) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const baseUrl = siteUrl || (typeof window !== 'undefined' ? window.location.origin : DEFAULT_SITE_URL);
  const detailUrl = `${baseUrl}${buildLaunchHref(launch)}`;
  const icsUrl = `/api/launches/${launch.id}/ics`;

  const net = safeDate(launch.net) ?? new Date();
  const windowEnd = safeDate(launch.windowEnd) ?? net;
  const isTimed = isCountdownEligible(launch, timeZone);

  const title = launch.name;
  const location = `${launch.pad.name}${launch.pad.state ? `, ${launch.pad.state}` : ''}`;
  const description = [
    `Launch: ${launch.name}`,
    `Provider: ${launch.provider}`,
    `Vehicle: ${launch.vehicle}`,
    `Pad: ${launch.pad.name}`,
    '',
    `More: ${detailUrl}`
  ].join('\n');

  const { googleUrl, outlookUrl } = buildCalendarEventLinks({
    title,
    location,
    description,
    detailUrl,
    startIso: net.toISOString(),
    endIso: windowEnd.toISOString(),
    allDay: !isTimed,
    brandName: BRAND_NAME
  });

  return { googleUrl, outlookUrl, detailUrl, icsUrl };
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
