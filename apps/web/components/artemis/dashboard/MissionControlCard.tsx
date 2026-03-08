import type { ReactNode } from 'react';
import clsx from 'clsx';

export function MissionControlCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1/90 p-4 shadow-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text1">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-text3">{subtitle}</p> : null}
        </div>
        {action ? <div className="text-xs text-text3">{action}</div> : null}
      </header>
      <div className={clsx('mt-3', bodyClassName)}>{children}</div>
    </section>
  );
}
