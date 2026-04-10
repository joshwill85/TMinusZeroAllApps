import type { Ws45OperationalWeather } from '@/lib/server/ws45RangeWeather';

export function Ws45OperationalPanel({
  operational,
  padTimezone,
  className
}: {
  operational: Ws45OperationalWeather | null;
  padTimezone: string;
  className?: string;
}) {
  const toneClass = toneContainerClass(operational?.tone || 'normal');

  return (
    <section className={className ?? 'rounded-2xl border border-stroke bg-surface-1 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">5 WS live board</div>
          <h2 className="text-xl font-semibold text-text1">Launch-area operational weather</h2>
          <p className="mt-1 max-w-2xl text-sm text-text3">
            Live range conditions for the current launch area, including lightning phase and wind status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {operational?.stale ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs uppercase tracking-[0.08em] text-warning">
              Stale
            </span>
          ) : null}
          {operational?.actionUrl && operational?.actionLabel ? (
            <a
              href={operational.actionUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text2 hover:border-primary"
            >
              {operational.actionLabel}
            </a>
          ) : null}
        </div>
      </div>

      {!operational ? (
        <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text2">
          No live range status available right now.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className={`rounded-xl border p-4 ${toneClass}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text1">{operational.subtitle || operational.title}</div>
                <div className="mt-1 text-xs text-text3">
                  {operational.fetchedAt ? `Updated ${formatDateTime(operational.fetchedAt, padTimezone)} (${formatDateTime(operational.fetchedAt, 'UTC')})` : 'Live update time unavailable'}
                </div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.08em] ${toneBadgeClass(operational.tone)}`}>
                {operational.items.find((item) => item.id === 'range')?.value || 'Operational'}
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text2">{operational.summary}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {operational.items.map((item) => (
              <div key={item.id} className={`rounded-xl border p-4 ${toneCardClass(item.tone)}`}>
                <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{item.label}</div>
                <div className="mt-2 text-base font-semibold text-text1">{item.value}</div>
                {item.detail ? <p className="mt-2 text-sm leading-relaxed text-text2">{item.detail}</p> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function toneContainerClass(tone: Ws45OperationalWeather['tone']) {
  if (tone === 'critical') return 'border-danger/40 bg-[rgba(120,16,34,0.22)]';
  if (tone === 'warning') return 'border-warning/40 bg-warning/10';
  if (tone === 'watch') return 'border-primary/30 bg-primary/10';
  return 'border-stroke bg-[rgba(255,255,255,0.02)]';
}

function toneBadgeClass(tone: Ws45OperationalWeather['tone']) {
  if (tone === 'critical') return 'border-danger/40 text-danger bg-[rgba(251,113,133,0.08)]';
  if (tone === 'warning') return 'border-warning/40 text-warning bg-warning/10';
  if (tone === 'watch') return 'border-primary/40 text-primary bg-primary/10';
  return 'border-success/40 text-success bg-success/10';
}

function toneCardClass(tone: Ws45OperationalWeather['tone']) {
  if (tone === 'critical') return 'border-danger/30 bg-[rgba(120,16,34,0.18)]';
  if (tone === 'warning') return 'border-warning/30 bg-[rgba(251,191,36,0.08)]';
  if (tone === 'watch') return 'border-primary/30 bg-[rgba(59,130,246,0.08)]';
  return 'border-stroke bg-[rgba(255,255,255,0.02)]';
}

function formatDateTime(value: string, tz: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short'
  }).format(date);
}
