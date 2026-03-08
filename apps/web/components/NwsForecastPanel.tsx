import { Badge, type BadgeTone } from './Badge';
import { WeatherIcon } from './WeatherIcon';

export type NwsLaunchWeather = {
  id: string;
  issued_at?: string | null;
  valid_start?: string | null;
  valid_end?: string | null;
  summary?: string | null;
  probability?: number | null;
  data?: any;
};

export function NwsForecastPanel({
  forecast,
  padTimezone,
  className
}: {
  forecast: NwsLaunchWeather | null;
  padTimezone: string;
  className?: string;
}) {
  const period = forecast?.data?.period ?? null;
  const iconUrl = typeof period?.icon === 'string' ? period.icon : null;
  const shortForecast = forecast?.summary || (typeof period?.shortForecast === 'string' ? period.shortForecast : null);
  const detailedForecast = typeof period?.detailedForecast === 'string' && period.detailedForecast.trim() ? period.detailedForecast.trim() : null;
  const periodName = typeof period?.name === 'string' ? period.name.trim() : null;
  const isDaytime = typeof period?.isDaytime === 'boolean' ? period.isDaytime : null;
  const forecastKind = typeof forecast?.data?.forecastKind === 'string' ? forecast.data.forecastKind : null;
  const forecastKindLabel = forecastKind === 'hourly' ? 'Hourly' : forecastKind === 'forecast' ? 'Forecast' : null;
  const temperature = typeof period?.temperature === 'number' ? period.temperature : null;
  const temperatureUnit = typeof period?.temperatureUnit === 'string' ? period.temperatureUnit : null;
  const wind = buildWindLabel(period);
  const windGust = formatWindGust(period?.windGust);
  const precip = formatPct(forecast?.probability);
  const humidity = formatPct(period?.relativeHumidity?.value);
  const cloudCover = formatPct(
    period?.cloudCover?.value ??
    period?.skyCover?.value ??
    period?.cloudCover ??
    period?.skyCover
  );
  const badges: Array<{ label: string; tone: BadgeTone }> = [];
  if (periodName) badges.push({ label: periodName, tone: 'primary' });
  if (isDaytime != null) badges.push({ label: isDaytime ? 'Daytime' : 'Night', tone: isDaytime ? 'success' : 'neutral' });
  if (forecastKindLabel) badges.push({ label: `${forecastKindLabel} match`, tone: 'info' });
  if (windGust) badges.push({ label: `Gusts ${windGust}`, tone: 'warning' });
  if (cloudCover) badges.push({ label: `Clouds ${cloudCover}`, tone: 'neutral' });

  return (
    <section className={className ?? 'rounded-2xl border border-stroke bg-surface-1 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">National Weather Service</div>
          <h2 className="text-xl font-semibold text-text1">Launch weather forecast</h2>
          <p className="mt-1 max-w-2xl text-sm text-text3">
            Forecast for the pad location at T-0, sourced from api.weather.gov.
          </p>
        </div>
      </div>

      {!forecast ? (
        <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text2">
          No forecast available yet.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
            <div className="flex items-start gap-3">
              {(iconUrl || shortForecast) && (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-stroke bg-black/20">
                  <WeatherIcon nwsIconUrl={iconUrl} shortForecast={shortForecast} className="h-10 w-10" />
                </div>
              )}
              <div>
                <div className="text-sm font-semibold text-text1">{shortForecast || 'Forecast'}</div>
                <div className="mt-1 text-xs text-text3">
                  {formatIssuedLine(forecast.issued_at, padTimezone)}
                  {formatValidLine(forecast.valid_start, forecast.valid_end, padTimezone)}
                </div>
                {badges.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <Badge key={badge.label} tone={badge.tone} subtle>
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <Metric label="Temp" value={formatTemperature(temperature, temperatureUnit) || '—'} />
              <Metric label="Precip" value={precip || '—'} />
              <Metric label="Wind" value={wind || '—'} />
              {humidity && <Metric label="Humidity" value={humidity} />}
              {cloudCover && <Metric label="Clouds" value={cloudCover} />}
            </div>
          </div>

          {detailedForecast && (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Details</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text2">{detailedForecast}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stroke bg-[rgba(0,0,0,0.12)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-0.5 text-sm text-text1">{value}</div>
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
  return endDatePart ? `${datePart} ${startTime} – ${endDatePart} ${endTime}` : `${datePart} ${startTime} – ${endTime}`;
}

function formatDayKey(date: Date, tz: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(date);
}

function formatTemperature(temp: number | null, unit: string | null) {
  if (temp == null || !Number.isFinite(temp)) return null;
  const u = unit ? String(unit).trim().toUpperCase() : 'F';
  return `${Math.round(temp)}°${u}`;
}

function formatPct(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(n)));
  return `${pct}%`;
}

function formatWindGust(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return null;
}

function buildWindLabel(period: any) {
  const dir = typeof period?.windDirection === 'string' ? period.windDirection.trim() : null;
  const speed = typeof period?.windSpeed === 'string' ? period.windSpeed.trim() : null;
  const gust = formatWindGust(period?.windGust);
  if (dir && speed && gust) return `${dir} ${speed} gusts ${gust}`;
  if (speed && gust) return `${speed} gusts ${gust}`;
  if (dir && speed) return `${dir} ${speed}`;
  return speed || dir || gust || null;
}
