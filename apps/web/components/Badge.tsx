import { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeTone = 'primary' | 'neutral' | 'warning' | 'danger' | 'success' | 'info';

type Props = {
  tone?: BadgeTone;
  children: ReactNode;
  subtle?: boolean;
};

const toneClasses: Record<BadgeTone, string> = {
  primary: 'bg-[rgba(34,211,238,0.12)] text-text1 border-[rgba(34,211,238,0.25)]',
  neutral: 'bg-[rgba(234,240,255,0.06)] text-text2 border-stroke',
  warning: 'bg-[rgba(251,191,36,0.12)] text-warning border-[rgba(251,191,36,0.35)]',
  danger: 'bg-[rgba(251,113,133,0.12)] text-danger border-[rgba(251,113,133,0.35)]',
  success: 'bg-[rgba(52,211,153,0.12)] text-success border-[rgba(52,211,153,0.35)]',
  info: 'bg-[rgba(96,165,250,0.12)] text-info border-[rgba(96,165,250,0.35)]'
};

export function Badge({ tone = 'neutral', children, subtle }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
        subtle ? 'opacity-80' : 'opacity-100',
        toneClasses[tone]
      )}
    >
      {children}
    </span>
  );
}
