'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

type ForecastAdvisoriesDisclosureProps = {
  count: number;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  contentClassName?: string;
};

export function ForecastAdvisoriesDisclosure({
  count,
  children,
  defaultExpanded = false,
  className,
  contentClassName,
}: ForecastAdvisoriesDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <section className={clsx('overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-white/5"
      >
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">FAA airspace</div>
          <h3 className="mt-1 text-lg font-semibold text-text1">Launch advisories</h3>
          <p className="mt-1 text-sm text-text3">Temporary flight restrictions and NOTAM matches tied to this launch.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {count} match{count === 1 ? '' : 'es'}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-stroke/70 bg-surface-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2">
            {isExpanded ? 'Collapse' : 'Expand'}
            <ChevronDownIcon className={clsx('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
          </span>
        </div>
      </button>

      {isExpanded ? (
        <div className={clsx('border-t border-stroke/70 p-4', contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
