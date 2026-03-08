'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import type { StarshipFaqItem } from '@/lib/types/starship';
import { StarshipEvidenceCenter, type StarshipEvidenceItem } from './StarshipEvidenceCenter';
import type { StarshipTimelineEvent } from './StarshipTimelineExplorer';

export type StarshipEventDrawerProps = {
  event: StarshipTimelineEvent | null;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: 'panel' | 'sheet';
  title?: string;
  evidenceItems?: readonly StarshipEvidenceItem[];
  faq?: readonly StarshipFaqItem[];
  className?: string;
};

export function StarshipEventDrawer({
  event,
  open,
  defaultOpen = false,
  onOpenChange,
  variant = 'panel',
  title = 'Event drawer',
  evidenceItems,
  faq,
  className
}: StarshipEventDrawerProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const dialogId = useId();
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? Boolean(open) : internalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  useEffect(() => {
    if (variant !== 'sheet' || !isOpen) return;
    const onKeyDown = (eventKey: KeyboardEvent) => {
      if (eventKey.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setOpen, variant]);

  useEffect(() => {
    if (variant !== 'sheet' || !isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, variant]);

  if (variant === 'sheet') {
    return (
      <>
        <div
          className={clsx(
            'fixed inset-0 z-40 bg-[rgba(0,0,0,0.62)] transition-opacity duration-200 motion-reduce:transition-none',
            isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          )}
          aria-hidden={!isOpen}
          onClick={() => setOpen(false)}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogId}
          className={clsx(
            'fixed inset-x-0 bottom-0 z-50 max-h-[86vh] rounded-t-2xl border border-stroke bg-surface-1 p-4 shadow-surface transition-transform duration-300 motion-reduce:transition-none',
            isOpen ? 'translate-y-0' : 'translate-y-full',
            className
          )}
        >
          <div className="mx-auto h-1.5 w-16 rounded-full bg-text4/50" aria-hidden="true" />
          <DrawerHeader headingId={dialogId} title={title} onClose={() => setOpen(false)} />
          <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} compact />
        </section>
      </>
    );
  }

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-labelledby={dialogId}>
      <DrawerHeader headingId={dialogId} title={title} />
      <DrawerBody event={event} evidenceItems={evidenceItems} faq={faq} />
    </section>
  );
}

function DrawerHeader({
  headingId,
  title,
  onClose
}: {
  headingId: string;
  title: string;
  onClose?: () => void;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3">
      <h3 id={headingId} className="text-base font-semibold text-text1">
        {title}
      </h3>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 transition hover:border-primary hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

function DrawerBody({
  event,
  evidenceItems,
  faq,
  compact = false
}: {
  event: StarshipTimelineEvent | null;
  evidenceItems?: readonly StarshipEvidenceItem[];
  faq?: readonly StarshipFaqItem[];
  compact?: boolean;
}) {
  if (!event) {
    return (
      <div className={clsx('mt-3 rounded-xl border border-stroke bg-surface-0 p-3', compact ? 'text-xs' : 'text-sm')}>
        <div className="font-semibold text-text1">No event selected</div>
        <p className="mt-1 text-text3">Select a timeline item to inspect mission evidence and related references.</p>
      </div>
    );
  }

  return (
    <div className={clsx('mt-3 space-y-3', compact ? 'max-h-[72vh] overflow-y-auto pr-1' : undefined)}>
      <article className="rounded-xl border border-stroke bg-surface-0 p-3">
        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Selected event</div>
        <h4 className="mt-1 text-sm font-semibold text-text1">{event.title}</h4>
        <p className="mt-1 text-xs text-text3">{formatDateLabel(event.eventTime || event.when)}</p>
        {event.summary ? <p className="mt-2 text-sm text-text2">{event.summary}</p> : null}

        <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
          <DetailRow label="event_time" value={formatDateLabel(event.eventTime || event.when)} />
          <DetailRow label="announced_time" value={formatDateLabel(event.announcedTime || event.when)} />
          <DetailRow label="source_type" value={event.sourceType || 'curated-fallback'} />
          <DetailRow label="confidence" value={event.confidence || 'low'} />
          <DetailRow label="supersedes" value={formatSupersedes(event.supersedes)} />
          <DetailRow label="superseded_by" value={event.supersededBy?.eventId || 'none'} />
        </dl>
      </article>

      <StarshipEvidenceCenter launch={event.launch || null} items={evidenceItems} faq={faq} compact={compact} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
      <dt className="uppercase tracking-[0.08em]">{label}</dt>
      <dd className="mt-0.5 text-text2">{value}</dd>
    </div>
  );
}

function formatDateLabel(value: string) {
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

function formatSupersedes(value: StarshipTimelineEvent['supersedes']) {
  if (!value || value.length === 0) return 'none';
  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
}
