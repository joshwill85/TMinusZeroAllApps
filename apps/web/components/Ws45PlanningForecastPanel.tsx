import type { Ws45PlanningForecast } from '@/lib/server/ws45RangeWeather';

export function Ws45PlanningForecastPanel({
  forecast,
  kind,
  padTimezone,
  className
}: {
  forecast: Ws45PlanningForecast | null;
  kind: 'planning_24h' | 'weekly_planning';
  padTimezone: string;
  className?: string;
}) {
  const title = kind === 'planning_24h' ? '45 WS planning forecast' : 'Cape weekly outlook';
  const subtitle = kind === 'planning_24h' ? 'Day-of range trend context' : 'Week-ahead Cape weather trend';
  const limitedExtract = forecast?.parse_status !== 'parsed';

  return (
    <section className={className ?? 'rounded-2xl border border-stroke bg-surface-1 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Advanced weather</div>
          <h2 className="text-xl font-semibold text-text1">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-text3">{subtitle}</p>
        </div>
        {forecast?.pdf_url ? (
          <div className="flex flex-wrap items-center gap-2">
            {limitedExtract ? (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-warning">
                Limited extract
              </span>
            ) : null}
            <a
              href={forecast.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text2 hover:border-primary"
            >
              View PDF
            </a>
          </div>
        ) : null}
      </div>

      {!forecast ? (
        <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text2">
          No planning forecast available yet.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
            <div className="text-sm font-semibold text-text1">{forecast.source_label || title}</div>
            <div className="mt-1 text-xs text-text3">
              {formatIssuedLine(forecast.issued_at, padTimezone)}
              {formatValidLine(forecast.valid_start, forecast.valid_end, padTimezone)}
            </div>
            {forecast.headline ? <div className="mt-3 text-lg font-semibold text-text1">{forecast.headline}</div> : null}
            {forecast.summary ? <p className="mt-3 text-sm leading-relaxed text-text2">{forecast.summary}</p> : null}
          </div>

          {forecast.highlights?.length ? (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Highlights</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {forecast.highlights.slice(0, 4).map((highlight) => (
                  <span key={highlight} className="rounded-full border border-stroke px-3 py-1 text-xs text-text2">
                    {highlight}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function formatIssuedLine(issuedAt: string | null | undefined, tz: string) {
  if (!issuedAt) return null;
  const local = formatDateTime(issuedAt, tz);
  const utc = formatDateTime(issuedAt, 'UTC');
  return `Issued ${local} (${utc})`;
}

function formatValidLine(start: string | null | undefined, end: string | null | undefined, tz: string) {
  if (!start || !end) return null;
  const local = formatRange(start, end, tz);
  const utc = formatRange(start, end, 'UTC');
  return ` • Valid ${local} (${utc})`;
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

function formatRange(start: string, end: string, tz: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 'TBD';
  const sameDay = formatDayKey(startDate, tz) === formatDayKey(endDate, tz);
  const datePart = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: tz }).format(startDate);
  const startTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(startDate);
  const endTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(endDate);
  const endDatePart = sameDay ? null : new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: tz }).format(endDate);
  return endDatePart ? `${datePart} ${startTime} - ${endDatePart} ${endTime}` : `${datePart} ${startTime} - ${endTime}`;
}

function formatDayKey(date: Date, tz: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(date);
}
