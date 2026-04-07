import clsx from 'clsx';
import { formatMissionTimelineTimeLabel } from '@tminuszero/domain';

type MissionTimelinePhase = string | null | undefined;

export type MissionTimelineCardItem = {
  id: string;
  label: string;
  time?: string | null;
  description?: string | null;
  phase?: MissionTimelinePhase;
  sourceTitle?: string | null;
};

export function MissionTimelineCards({
  items,
  className
}: {
  items: MissionTimelineCardItem[];
  className?: string;
}) {
  return (
    <div className={clsx('grid gap-3 md:grid-cols-2', className)}>
      {items.map((item) => {
        const timeLabel = formatMissionTimelineTimeLabel(item.time, normalizePhase(item.phase));
        const tone = getPhaseTone(item.phase);

        return (
          <article
            key={item.id}
            className={clsx(
              'relative overflow-hidden rounded-xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4',
              tone.card
            )}
          >
            <div className={clsx('absolute inset-y-0 left-0 w-1', tone.rail)} aria-hidden="true" />
            <div className="pl-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span
                  className={clsx(
                    'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
                    tone.pill
                  )}
                >
                  {formatTimelinePhaseLabel(item.phase)}
                </span>
                {timeLabel ? <span className="text-xs font-medium text-text3">{timeLabel}</span> : null}
              </div>

              <div className="mt-3 text-sm font-semibold text-text1">{item.label}</div>
              {item.sourceTitle ? <div className="mt-1 text-xs text-text3">{item.sourceTitle}</div> : null}
              {item.description ? <p className="mt-3 text-sm leading-relaxed text-text2">{item.description}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function getPhaseTone(phase: MissionTimelinePhase) {
  if (phase === 'prelaunch') {
    return {
      pill: 'border-primary/40 bg-primary/10 text-primary',
      rail: 'bg-primary/80',
      card: 'border-primary/20'
    };
  }

  if (phase === 'postlaunch') {
    return {
      pill: 'border-warning/40 bg-warning/10 text-warning',
      rail: 'bg-warning/80',
      card: 'border-warning/20'
    };
  }

  return {
    pill: 'border-stroke bg-surface-0 text-text2',
    rail: 'bg-text3/60',
    card: 'border-stroke'
  };
}

function formatTimelinePhaseLabel(phase: MissionTimelinePhase) {
  if (phase === 'prelaunch') return 'Pre-launch';
  if (phase === 'postlaunch') return 'Post-launch';
  return 'Timeline';
}

function normalizePhase(phase: MissionTimelinePhase) {
  if (phase === 'prelaunch' || phase === 'postlaunch' || phase === 'timeline') return phase;
  return undefined;
}
