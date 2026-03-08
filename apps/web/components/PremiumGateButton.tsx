'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import clsx from 'clsx';
import { PremiumUpsellModal } from '@/components/PremiumUpsellModal';

export function PremiumGateButton({
  isAuthed,
  featureLabel,
  className,
  children,
  ariaLabel
}: {
  isAuthed: boolean;
  featureLabel: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={clsx(className)}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel ?? `${featureLabel} (Premium)`}
      >
        <span className="relative inline-flex items-center gap-2">
          {children}
          <LockIcon className="h-3.5 w-3.5 opacity-80" />
        </span>
      </button>
      <PremiumUpsellModal open={open} onClose={() => setOpen(false)} isAuthed={isAuthed} featureLabel={featureLabel} />
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

