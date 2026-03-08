import type { SVGProps } from 'react';

export function OverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="17" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function TimelineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="12" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="12" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IntelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M5 6.5h14v11H5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h6M8 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 4.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BudgetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M6 19.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 16v-4.5M12 16V7.5M16.5 16v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="6" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 4.6v2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MissionsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5c2.7 3.2 4.4 5.8 5.2 7.7.5 1.2.8 2.2.8 3.1 0 3.2-2.5 5.7-6 5.7s-6-2.5-6-5.7c0-.9.3-1.9.8-3.1.8-1.9 2.5-4.5 5.2-7.7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.5 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
