import Link from 'next/link';
import clsx from 'clsx';
import type { ArtemisFaqItem } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';

export type ArtemisEvidenceKind = 'stream' | 'report' | 'status' | 'reference' | 'note';

export type ArtemisEvidenceItem = {
  id: string;
  label: string;
  href?: string;
  detail?: string;
  source?: string;
  capturedAt?: string;
  kind?: ArtemisEvidenceKind;
};

export type ArtemisEvidenceCenterProps = {
  launch?: Launch | null;
  items?: readonly ArtemisEvidenceItem[];
  faq?: readonly ArtemisFaqItem[];
  title?: string;
  className?: string;
  compact?: boolean;
  emptyLabel?: string;
  maxItems?: number;
};

export function ArtemisEvidenceCenter({
  launch,
  items,
  faq,
  title = 'Evidence center',
  className,
  compact = false,
  emptyLabel = 'No mission evidence links are available for the selected event.',
  maxItems = 14
}: ArtemisEvidenceCenterProps) {
  const resolvedItems = (items && items.length > 0 ? items : buildEvidenceItemsFromLaunch(launch)).slice(0, Math.max(0, maxItems));

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
      <h3 className={clsx('font-semibold text-text1', compact ? 'text-sm' : 'text-base')}>{title}</h3>

      {resolvedItems.length === 0 ? (
        <p className={clsx('text-text3', compact ? 'mt-2 text-xs' : 'mt-3 text-sm')}>{emptyLabel}</p>
      ) : (
        <ul className={clsx(compact ? 'mt-2 space-y-2' : 'mt-3 space-y-2')}>
          {resolvedItems.map((item) => {
            const external = isExternalUrl(item.href);
            return (
              <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                {item.href ? (
                  external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-text1">{item.label}</span>
                        {item.kind ? (
                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                            {item.kind}
                          </span>
                        ) : null}
                      </div>
                      <EvidenceItemMeta item={item} />
                    </a>
                  ) : (
                    <Link href={item.href} className="block transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-text1">{item.label}</span>
                        {item.kind ? (
                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                            {item.kind}
                          </span>
                        ) : null}
                      </div>
                      <EvidenceItemMeta item={item} />
                    </Link>
                  )
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text1">{item.label}</span>
                      {item.kind ? (
                        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                          {item.kind}
                        </span>
                      ) : null}
                    </div>
                    <EvidenceItemMeta item={item} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!compact && faq && faq.length > 0 ? (
        <details className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.08em] text-text3">Reference FAQ</summary>
          <dl className="mt-2 space-y-2">
            {faq.slice(0, 4).map((entry) => (
              <div key={entry.question}>
                <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
                <dd className="mt-1 text-xs text-text2">{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function EvidenceItemMeta({ item }: { item: ArtemisEvidenceItem }) {
  return (
    <div className="mt-1 space-y-1 text-xs text-text3">
      {item.detail ? <p>{item.detail}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {item.source ? <span>{item.source}</span> : null}
        {item.capturedAt ? <time dateTime={toDateTimeAttr(item.capturedAt)}>{formatDate(item.capturedAt)}</time> : null}
      </div>
    </div>
  );
}

function buildEvidenceItemsFromLaunch(launch: Launch | null | undefined): ArtemisEvidenceItem[] {
  if (!launch) return [];
  const evidence: ArtemisEvidenceItem[] = [];
  const seen = new Set<string>();

  const push = (entry: Omit<ArtemisEvidenceItem, 'id'>) => {
    const key = `${entry.href || entry.label}::${entry.kind || 'reference'}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ ...entry, id: key });
  };

  push({
    label: 'Status signal',
    detail: launch.statusText || launch.status || 'Status pending',
    capturedAt: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
    source: 'Launch feed',
    kind: 'status'
  });

  pushIfHref(
    push,
    launch.videoUrl,
    launch.videoUrl,
    {
      label: 'Primary webcast',
      detail: launch.name,
      source: launch.provider,
      capturedAt: launch.net,
      kind: 'stream'
    }
  );

  for (const link of launch.launchVidUrls || []) {
    pushIfHref(push, link?.url, link?.url, {
      label: link?.title?.trim() || 'Launch stream',
      detail: link?.description?.trim() || undefined,
      source: link?.source || link?.publisher || launch.provider,
      kind: 'stream'
    });
  }

  for (const link of launch.launchInfoUrls || []) {
    pushIfHref(push, link?.url, link?.url, {
      label: link?.title?.trim() || 'Mission report',
      detail: link?.description?.trim() || undefined,
      source: link?.source || 'Launch feed',
      kind: 'report'
    });
  }

  for (const link of launch.mission?.infoUrls || []) {
    pushIfHref(push, link?.url, link?.url, {
      label: link?.title?.trim() || 'Mission reference',
      detail: link?.description?.trim() || launch.mission?.name,
      source: link?.source || 'Mission feed',
      kind: 'reference'
    });
  }

  for (const link of launch.mission?.vidUrls || []) {
    pushIfHref(push, link?.url, link?.url, {
      label: link?.title?.trim() || 'Mission stream',
      detail: link?.description?.trim() || launch.mission?.name,
      source: link?.source || link?.publisher || 'Mission feed',
      kind: 'stream'
    });
  }

  pushIfHref(push, launch.currentEvent?.url, launch.currentEvent?.url, {
    label: launch.currentEvent?.name || 'Current related event',
    detail: launch.currentEvent?.typeName || undefined,
    capturedAt: launch.currentEvent?.date || undefined,
    source: 'Related events',
    kind: 'reference'
  });

  pushIfHref(push, launch.nextEvent?.url, launch.nextEvent?.url, {
    label: launch.nextEvent?.name || 'Next related event',
    detail: launch.nextEvent?.typeName || undefined,
    capturedAt: launch.nextEvent?.date || undefined,
    source: 'Related events',
    kind: 'reference'
  });

  pushIfHref(push, launch.flightclubUrl, launch.flightclubUrl, {
    label: 'Trajectory profile',
    source: 'FlightClub',
    kind: 'reference'
  });

  pushIfHref(push, launch.spacexXPostUrl, launch.spacexXPostUrl, {
    label: 'Mission social update',
    source: 'X',
    capturedAt: launch.spacexXPostCapturedAt || undefined,
    kind: 'report'
  });

  return evidence;
}

function pushIfHref(
  push: (entry: Omit<ArtemisEvidenceItem, 'id'>) => void,
  rawHref: string | undefined | null,
  fallbackDetail: string | undefined | null,
  entry: Omit<ArtemisEvidenceItem, 'id' | 'href'>
) {
  const href = typeof rawHref === 'string' ? rawHref.trim() : '';
  if (!href) return;
  push({
    ...entry,
    href,
    detail: entry.detail || (entry.source ? `${entry.source} • ${fallbackDetail || href}` : fallbackDetail || href)
  });
}

function formatDate(value: string) {
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

function toDateTimeAttr(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function isExternalUrl(value: string | undefined) {
  if (!value) return false;
  return /^https?:\/\//i.test(value);
}
