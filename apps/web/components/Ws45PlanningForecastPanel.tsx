import type {
  Ws45Planning24hStructuredPayload,
  Ws45PlanningStructuredPayload,
  Ws45PlanningWeeklyStructuredPayload
} from '../../../shared/ws45PlanningParser';
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
  const detail = forecast?.structured_payload ?? null;

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

          {detail ? <PlanningDetailSection detail={detail} /> : null}
        </div>
      )}
    </section>
  );
}

function PlanningDetailSection({ detail }: { detail: Ws45PlanningStructuredPayload }) {
  if (detail.kind === 'planning_24h') {
    return <Planning24hSection detail={detail} />;
  }
  return <PlanningWeeklySection detail={detail} />;
}

function Planning24hSection({ detail }: { detail: Ws45Planning24hStructuredPayload }) {
  return (
    <>
      <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">24-hour periods</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detail.periods.map((period) => (
            <article key={period.label} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">
                {[period.dayLabel, period.label].filter(Boolean).join(' • ')}
              </div>
              {period.skyCondition ? <div className="mt-2 text-base font-semibold text-text1">{period.skyCondition}</div> : null}
              <div className="mt-3 space-y-2">
                <MetricRow label="Precip" value={formatPercent(period.precipitationProbabilityPct)} />
                <MetricRow label="Lightning" value={formatPercent(period.lightningProbabilityPct)} />
                <MetricRow label="Wind" value={period.wind || 'TBD'} />
                <MetricRow
                  label="Temp"
                  value={formatTemperatureRange(period.temperatureMinF, period.temperatureMaxF, period.temperatureLabel)}
                />
                <MetricRow label="Severe" value={period.severeWeatherPotential || 'TBD'} />
              </div>
            </article>
          ))}
        </div>
      </div>

      {detail.sourceNotes.length || detail.contact || detail.preparedBy ? (
        <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Source notes</div>
          <div className="mt-3 space-y-2 text-sm text-text2">
            {detail.sourceNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            {detail.coverageNote ? <p>{detail.coverageNote}</p> : null}
            {detail.contact ? <p>{detail.contact}</p> : null}
            {detail.preparedBy ? <p>Prepared by {detail.preparedBy}</p> : null}
            {(detail.sunriseZulu || detail.sunsetZulu) ? (
              <p>
                {[detail.sunriseZulu ? `Sunrise(Z) ${detail.sunriseZulu}` : null, detail.sunsetZulu ? `Sunset(Z) ${detail.sunsetZulu}` : null]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PlanningWeeklySection({ detail }: { detail: Ws45PlanningWeeklyStructuredPayload }) {
  return (
    <>
      <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Week-ahead daily detail</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detail.days.map((day) => (
            <article key={day.dateLabel} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{day.dayLabel || 'Forecast day'}</div>
                  <div className="mt-1 text-base font-semibold text-text1">{day.dateLabel}</div>
                </div>
                <div className="text-right text-sm text-text2">{formatWeeklyTemps(day.minTempF, day.maxTempF)}</div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DayPartCard label="AM" sky={day.am.skyCondition} precip={day.am.precipitationProbabilityPct} lightning={day.am.lightningProbabilityPct} wind={day.am.wind} />
                <DayPartCard label="PM" sky={day.pm.skyCondition} precip={day.pm.precipitationProbabilityPct} lightning={day.pm.lightningProbabilityPct} wind={day.pm.wind} />
              </div>

              <div className="mt-3 text-xs text-text3">
                Severe weather potential: <span className="text-text2">{day.severeWeatherPotential || 'TBD'}</span>
              </div>
            </article>
          ))}
        </div>
      </div>

      {detail.sourceNotes.length || detail.contact || detail.preparedBy || detail.climate ? (
        <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Source notes</div>
          <div className="mt-3 space-y-2 text-sm text-text2">
            {detail.sourceNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            {detail.contact ? <p>{detail.contact}</p> : null}
            {detail.preparedBy ? <p>Prepared by {detail.preparedBy}</p> : null}
            {detail.postedLabel ? <p>{detail.postedLabel}</p> : null}
            {detail.climate ? (
              <p>
                Monthly averages:{' '}
                {[
                  detail.climate.rainProbabilityPct != null ? `rain ${detail.climate.rainProbabilityPct}%` : null,
                  detail.climate.lightningProbabilityPct != null ? `lightning ${detail.climate.lightningProbabilityPct}%` : null,
                  detail.climate.lowTempF != null ? `low ${detail.climate.lowTempF}F` : null,
                  detail.climate.highTempF != null ? `high ${detail.climate.highTempF}F` : null
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function DayPartCard({
  label,
  sky,
  precip,
  lightning,
  wind
}: {
  label: string;
  sky: string | null;
  precip: number | null;
  lightning: number | null;
  wind: string | null;
}) {
  return (
    <div className="rounded-lg border border-stroke/70 bg-[rgba(255,255,255,0.02)] p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      {sky ? <div className="mt-2 text-sm font-semibold text-text1">{sky}</div> : null}
      <div className="mt-2 space-y-1">
        <MetricRow label="Precip" value={formatPercent(precip)} compact />
        <MetricRow label="Lightning" value={formatPercent(lightning)} compact />
        <MetricRow label="Wind" value={wind || 'TBD'} compact />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  compact = false
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${compact ? '' : 'border-b border-stroke/50 py-1.5 last:border-0'}`}>
      <span className="text-xs text-text3">{label}</span>
      <span className="text-right text-sm font-semibold text-text1">{value}</span>
    </div>
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

function formatPercent(value: number | null | undefined) {
  return value == null ? 'TBD' : `${Math.round(value)}%`;
}

function formatTemperatureRange(min: number | null | undefined, max: number | null | undefined, label: string | null | undefined) {
  if (min != null && max != null) return `${min}-${max}F`;
  return label || 'TBD';
}

function formatWeeklyTemps(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null) return `${min}-${max}F`;
  if (min != null) return `Low ${min}F`;
  if (max != null) return `High ${max}F`;
  return 'Temps TBD';
}
