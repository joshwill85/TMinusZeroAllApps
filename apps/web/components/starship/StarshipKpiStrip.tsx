import clsx from 'clsx';
import type { StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';

type StarshipSnapshot = StarshipProgramSnapshot | StarshipMissionSnapshot;

export type StarshipKpiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export type StarshipKpiMetric = {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: StarshipKpiTone;
};

export type StarshipKpiStripProps = {
  snapshot: StarshipSnapshot;
  metrics?: readonly StarshipKpiMetric[];
  title?: string;
  className?: string;
};

const TONE_CLASS: Record<StarshipKpiTone, string> = {
  default: 'border-stroke',
  success: 'border-success/40',
  warning: 'border-warning/40',
  danger: 'border-danger/40',
  info: 'border-info/40'
};

export function StarshipKpiStrip({ snapshot, metrics, title = 'Program metrics', className }: StarshipKpiStripProps) {
  const resolvedMetrics = metrics && metrics.length > 0 ? metrics : buildDefaultMetrics(snapshot);

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)} aria-label={title}>
      <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {resolvedMetrics.map((metric) => (
          <article key={metric.id} className={clsx('rounded-xl border bg-surface-0 px-3 py-2', TONE_CLASS[metric.tone || 'default'])}>
            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{metric.label}</div>
            <div className="mt-1 text-lg font-semibold text-text1">{metric.value}</div>
            {metric.detail ? <div className="mt-1 text-xs text-text3">{metric.detail}</div> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function buildDefaultMetrics(snapshot: StarshipSnapshot): StarshipKpiMetric[] {
  const nextLaunchLabel = formatDate(snapshot.nextLaunch?.net || null);
  const updatedLabel = formatDate(snapshot.lastUpdated || snapshot.generatedAt);

  const metrics: StarshipKpiMetric[] = [
    {
      id: 'upcoming',
      label: 'Upcoming',
      value: String(snapshot.upcoming.length),
      tone: 'info'
    },
    {
      id: 'recent',
      label: 'Recent',
      value: String(snapshot.recent.length)
    },
    {
      id: 'next-launch',
      label: 'Next launch',
      value: nextLaunchLabel || 'Awaiting feed',
      tone: snapshot.nextLaunch ? 'success' : 'warning'
    },
    {
      id: 'last-updated',
      label: 'Last updated',
      value: updatedLabel || 'Unknown'
    }
  ];

  if (isMissionSnapshot(snapshot)) {
    metrics.push(
      {
        id: 'crew',
        label: 'Crew highlights',
        value: String(snapshot.crewHighlights.length),
        tone: snapshot.crewHighlights.length > 0 ? 'success' : 'default'
      },
      {
        id: 'changes',
        label: 'Change entries',
        value: String(snapshot.changes.length)
      }
    );
  } else {
    metrics.push({
      id: 'faq',
      label: 'FAQ entries',
      value: String(snapshot.faq.length)
    });
  }

  return metrics;
}

function isMissionSnapshot(snapshot: StarshipSnapshot): snapshot is StarshipMissionSnapshot {
  return 'missionName' in snapshot;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}
