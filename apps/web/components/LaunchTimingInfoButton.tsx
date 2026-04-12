'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatLaunchMoment, isDateOnlyNet } from '@/lib/time';
import { useResolvedTimeZone } from '@/lib/hooks/useResolvedTimeZone';
import type { Launch } from '@/lib/types/launch';

type LaunchTimingInfoButtonProps = {
  net: string;
  netPrecision?: Launch['netPrecision'];
  padTimeZone?: string | null;
  countdownLabel: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
};

export function LaunchTimingInfoButton({
  net,
  netPrecision,
  padTimeZone,
  countdownLabel,
  align = 'right',
  className
}: LaunchTimingInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackPadTimeZone = String(padTimeZone || '').trim() || 'America/New_York';
  const localTimeZone = useResolvedTimeZone(fallbackPadTimeZone);
  const countdownValue = isDateOnlyNet(net, netPrecision, localTimeZone) ? 'Awaiting NET' : countdownLabel;

  const localTimeLabel = useMemo(
    () => formatLaunchMoment(net, localTimeZone, netPrecision),
    [localTimeZone, net, netPrecision]
  );
  const padTimeLabel = useMemo(
    () => formatLaunchMoment(net, fallbackPadTimeZone, netPrecision),
    [fallbackPadTimeZone, net, netPrecision]
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!(event.target instanceof Node)) return;
      if (containerRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={clsx('relative inline-flex', className)} data-no-card-nav="true">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-text3 transition hover:border-primary/40 hover:text-primary"
        aria-label="Open launch time reference"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Launch time reference"
          className={clsx(
            'absolute top-full z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-stroke bg-[rgba(10,14,26,0.97)] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur',
            align === 'left' && 'left-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'right' && 'right-0'
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text3">Launch time reference</div>
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs">
            <div />
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">Time</div>
            <div className="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">T-</div>

            <div className="font-semibold text-text2">Local time</div>
            <div className="min-w-0 text-text1">{localTimeLabel}</div>
            <div className="text-right font-mono text-text2">{countdownValue}</div>

            <div className="font-semibold text-text2">Pad time</div>
            <div className="min-w-0 text-text1">{padTimeLabel}</div>
            <div className="text-right font-mono text-text2">{countdownValue}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.25v5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}
