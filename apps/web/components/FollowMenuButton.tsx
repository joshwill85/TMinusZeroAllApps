'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

export type FollowMenuOption = {
  key: string;
  label: string;
  description: string;
  active: boolean;
  disabled?: boolean;
  locked?: boolean;
  onPress: () => void;
};

export function FollowMenuButton({
  label,
  active,
  activeCount = 0,
  capacityLabel,
  notificationsActive = false,
  options,
  notificationsContent,
  defaultView = 'following',
  onMenuStateChange
}: {
  label: string;
  active: boolean;
  activeCount?: number;
  capacityLabel?: string;
  notificationsActive?: boolean;
  options: FollowMenuOption[];
  notificationsContent?: ReactNode;
  defaultView?: 'following' | 'notifications';
  onMenuStateChange?: (state: { open: boolean; view: 'following' | 'notifications' }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'following' | 'notifications'>('following');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    onMenuStateChange?.({ open, view });
  }, [onMenuStateChange, open, view]);

  useEffect(() => {
    if (!open) {
      setView(defaultView);
    }
  }, [defaultView, open]);

  return (
    <div ref={ref} className="relative" data-no-card-nav="true">
      <button
        type="button"
        className={clsx(
          'btn-secondary relative flex h-11 items-center gap-2 rounded-full border border-stroke px-3 text-text2 transition hover:border-primary',
          active && 'border-primary text-primary'
        )}
        onClick={() =>
          setOpen((value) => {
            if (!value) {
              setView(defaultView);
            }
            return !value;
          })
        }
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className={clsx(
            'flex h-5 w-5 items-center justify-center rounded-full border transition',
            active ? 'border-primary/70 bg-primary/10 text-primary' : 'border-white/12 bg-white/5 text-text1'
          )}
          aria-hidden="true"
        >
          {active ? <CheckIcon className="h-3 w-3" /> : <PlusIcon className="h-3 w-3" />}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
        {capacityLabel ? (
          <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', active ? 'bg-primary/15 text-primary' : 'bg-white/6 text-text2')}>
            {capacityLabel}
          </span>
        ) : activeCount > 0 ? (
          <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', active ? 'bg-primary/15 text-primary' : 'bg-white/6 text-text2')}>
            {activeCount}
          </span>
        ) : null}
        {notificationsActive && <span className="h-2 w-2 rounded-full bg-primary shadow-glow" aria-hidden="true" />}
        <ChevronDownIcon className={clsx('h-3.5 w-3.5 text-text3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-stroke bg-[rgba(10,14,26,0.97)] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur" data-no-card-nav="true">
          <div className="px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text3">Follow and notifications</div>
            {notificationsContent ? (
              <div className="mt-3 flex rounded-xl border border-stroke bg-white/[0.03] p-1">
                <TabButton
                  label="Following"
                  active={view === 'following'}
                  detail={capacityLabel ?? (activeCount > 0 ? String(activeCount) : undefined)}
                  onClick={() => setView('following')}
                />
                <TabButton label="Notifications" active={view === 'notifications'} detail={notificationsActive ? 'On' : undefined} onClick={() => setView('notifications')} />
              </div>
            ) : null}
          </div>

          {view === 'following' || !notificationsContent ? (
            <div className="space-y-1">
              {options.map((option) => {
                const locked = option.locked && !option.active;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={clsx(
                      'flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition',
                      option.active
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : locked
                          ? 'border-white/8 bg-white/[0.02] text-text3 hover:border-primary/30 hover:bg-white/[0.04]'
                          : 'border-transparent text-text2 hover:bg-white/5',
                      option.disabled && 'opacity-50'
                    )}
                    onClick={() => {
                      option.onPress();
                      setOpen(false);
                    }}
                    disabled={option.disabled}
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-current">
                        <span>{option.label}</span>
                        {locked ? <LockIcon className="h-3.5 w-3.5 text-text3" /> : null}
                      </div>
                      <div className={clsx('mt-1 text-xs leading-5', locked ? 'text-text4' : 'text-text3')}>{option.description}</div>
                    </div>
                    <div
                      className={clsx(
                        'mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
                        option.active ? 'bg-primary/15 text-primary' : locked ? 'bg-white/[0.05] text-text3' : 'bg-white/[0.04] text-text3'
                      )}
                    >
                      {option.active ? (
                        'On'
                      ) : locked ? (
                        <>
                          <LockIcon className="h-3 w-3" />
                          <span>Premium</span>
                        </>
                      ) : (
                        'Off'
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-2 pb-2">{notificationsContent}</div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  detail,
  onClick
}: {
  label: string;
  active: boolean;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition',
        active ? 'bg-primary/12 text-primary' : 'text-text3 hover:text-text1'
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      {detail ? <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-primary/18 text-primary' : 'bg-white/[0.05] text-text3')}>{detail}</span> : null}
    </button>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M6.5 12.5 10 16l7.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none">
      <rect x="4.5" y="9" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
