'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { PremiumUpsellModal } from '@/components/PremiumUpsellModal';

type AdvancedWeatherDisclosureProps = {
  count: number;
  isPremium: boolean;
  isAuthed: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  title?: string;
  description?: string;
  featureLabel?: string;
};

export function AdvancedWeatherDisclosure({
  count,
  isPremium,
  isAuthed,
  children,
  className,
  contentClassName,
  title = '45 WS planning forecast',
  description = 'Premium planning products from 45 WS add broader launch-day and week-ahead Cape context.',
  featureLabel
}: AdvancedWeatherDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);

  const handleToggle = () => {
    if (!isPremium) {
      setUpsellOpen(true);
      return;
    }
    setIsExpanded((current) => !current);
  };

  return (
    <>
      <section className={clsx('overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]', className)}>
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isPremium ? isExpanded : false}
          className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-white/5"
        >
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Advanced weather</div>
            <h3 className="mt-1 text-lg font-semibold text-text1">{title}</h3>
            <p className="mt-1 text-sm text-text3">
              {description}
              {!isPremium ? ' Premium required to open.' : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
              {count} product{count === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-stroke/70 bg-surface-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2">
              {isPremium ? (isExpanded ? 'Collapse' : 'Expand') : 'Premium'}
              {isPremium ? (
                <ChevronDownIcon className={clsx('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
              ) : (
                <LockIcon className="h-3.5 w-3.5" />
              )}
            </span>
          </div>
        </button>

        {isPremium && isExpanded ? (
          <div className={clsx('border-t border-stroke/70 p-4', contentClassName)}>{children}</div>
        ) : null}
      </section>

      <PremiumUpsellModal
        open={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        isAuthed={isAuthed}
        featureLabel={featureLabel ?? title}
      />
    </>
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
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
