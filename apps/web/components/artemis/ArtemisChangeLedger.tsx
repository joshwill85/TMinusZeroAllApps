import Link from 'next/link';
import clsx from 'clsx';
import type { ArtemisChangeItem } from '@/lib/types/artemis';

export type ArtemisChangeLedgerProps = {
  changes: readonly ArtemisChangeItem[];
  title?: string;
  emptyLabel?: string;
  maxItems?: number;
  className?: string;
};

export function ArtemisChangeLedger({
  changes,
  title = 'Change ledger',
  emptyLabel = 'No mission change entries are available yet.',
  maxItems = 12,
  className
}: ArtemisChangeLedgerProps) {
  const sortedChanges = [...changes]
    .sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date))
    .slice(0, Math.max(0, maxItems));

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text1">{title}</h3>
        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
          {sortedChanges.length}
        </span>
      </div>

      {sortedChanges.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {sortedChanges.map((change) => {
            const isExternal = isExternalUrl(change.href);
            return (
              <li key={`${change.title}:${change.date}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text1">{change.title}</div>
                    <p className="mt-1 text-xs text-text2">{change.summary}</p>
                  </div>
                  <time dateTime={toDateTimeAttr(change.date)} className="shrink-0 text-[11px] text-text3">
                    {formatChangeDate(change.date)}
                  </time>
                </div>
                {change.href ? (
                  isExternal ? (
                    <a
                      href={change.href}
                      className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source
                    </a>
                  ) : (
                    <Link href={change.href} className="mt-2 inline-flex text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80">
                      Open source
                    </Link>
                  )
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function parseDateOrZero(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toDateTimeAttr(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function formatChangeDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function isExternalUrl(value: string | undefined) {
  if (!value) return false;
  return /^https?:\/\//i.test(value);
}
