export type Ws45ForecastScenario = {
  label?: string;
  povPercent?: number;
  primaryConcerns?: string[];
  weatherVisibility?: string;
  tempF?: number;
  humidityPercent?: number;
  liftoffWinds?: { directionDeg?: number; speedMphMin?: number; speedMphMax?: number; raw?: string };
  additionalRiskCriteria?: {
    upperLevelWindShear?: string;
    boosterRecoveryWeather?: string;
    solarActivity?: string;
  };
  clouds?: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }>;
};

export type Ws45Forecast = {
  id: string;
  source_label?: string | null;
  forecast_kind?: string | null;
  pdf_url: string;
  issued_at?: string | null;
  valid_start?: string | null;
  valid_end?: string | null;
  mission_name?: string | null;
  match_status?: string | null;
  match_confidence?: number | null;
  forecast_discussion?: string | null;
  launch_day_pov_percent?: number | null;
  delay_24h_pov_percent?: number | null;
  launch_day_primary_concerns?: string[] | null;
  delay_24h_primary_concerns?: string[] | null;
  launch_day?: Ws45ForecastScenario | null;
  delay_24h?: Ws45ForecastScenario | null;
};

export function Ws45ForecastPanel({
  forecast,
  padTimezone,
  className
}: {
  forecast: Ws45Forecast | null;
  padTimezone: string;
  className?: string;
}) {
  return (
    <section className={className ?? 'rounded-2xl border border-stroke bg-surface-1 p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">45 WS enhanced forecast</div>
          <h2 className="text-xl font-semibold text-text1">Launch weather brief</h2>
          <p className="mt-1 max-w-2xl text-sm text-text3">
            Enhanced mission forecast details for select Eastern Range launches.{' '}
            <span className="text-text4">Source: 45th Weather Squadron PDFs.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {forecast?.pdf_url ? (
            <a
              href={forecast.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text2 hover:border-primary"
            >
              View PDF
            </a>
          ) : null}
          {forecast?.forecast_kind && (
            <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
              {forecast.forecast_kind}
            </span>
          )}
        </div>
      </div>

      {!forecast ? (
        <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text2">
          No forecast attached yet.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
            <div>
              <div className="text-sm font-semibold text-text1">{forecast.source_label || forecast.mission_name || 'Forecast'}</div>
              <div className="mt-1 text-xs text-text3">
                {formatIssuedLine(forecast.issued_at, padTimezone)}
                {formatValidLine(forecast.valid_start, forecast.valid_end, padTimezone)}
              </div>
            </div>
            <div className="text-right text-xs text-text3">
              {forecast.match_status && (
                <div>
                  Match: {forecast.match_status}
                  {forecast.match_confidence != null ? ` (${forecast.match_confidence}%)` : ''}
                </div>
              )}
            </div>
          </div>

          {forecast.forecast_discussion && (
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Forecast discussion</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text2">{forecast.forecast_discussion}</p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <ScenarioCard
              title="Launch Day"
              povPercent={forecast.launch_day?.povPercent ?? forecast.launch_day_pov_percent ?? null}
              concerns={forecast.launch_day?.primaryConcerns ?? forecast.launch_day_primary_concerns ?? null}
              scenario={forecast.launch_day ?? null}
            />
            <ScenarioCard
              title={forecast.delay_24h?.label || '24-Hour Delay'}
              povPercent={forecast.delay_24h?.povPercent ?? forecast.delay_24h_pov_percent ?? null}
              concerns={forecast.delay_24h?.primaryConcerns ?? forecast.delay_24h_primary_concerns ?? null}
              scenario={forecast.delay_24h ?? null}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ScenarioCard({
  title,
  povPercent,
  concerns,
  scenario
}: {
  title: string;
  povPercent: number | null;
  concerns: string[] | null;
  scenario: Ws45ForecastScenario | null;
}) {
  const pov = Number.isFinite(povPercent ?? NaN) ? clampInt(povPercent as number, 0, 100) : null;
  const concernList = (concerns || []).map((c) => String(c).trim()).filter(Boolean);
  const windLabel = formatWinds(scenario?.liftoffWinds);
  const wxVis = scenario?.weatherVisibility ? scenario.weatherVisibility.trim() : null;
  const tempHumidity =
    scenario?.tempF != null && scenario?.humidityPercent != null ? `${scenario.tempF}°F • ${scenario.humidityPercent}% RH` : null;
  const clouds = Array.isArray(scenario?.clouds) ? scenario?.clouds ?? [] : [];
  const risk = scenario?.additionalRiskCriteria || null;

  return (
    <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
          <div className="mt-1 text-sm font-semibold text-text1">{pov == null ? 'PoV TBD' : `PoV ${pov}%`}</div>
        </div>
        <PovRing pov={pov} />
      </div>

      {concernList.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {concernList.map((c) => (
            <span key={c} className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] ${concernTone(pov)}`}>
              {c}
            </span>
          ))}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Row label="Weather" value={wxVis || '—'} />
        <Row label="Winds (200')" value={windLabel || '—'} />
        <Row label="Temp/Humidity" value={tempHumidity || '—'} />
        <Row label="UL Wind Shear" value={risk?.upperLevelWindShear || '—'} />
        <Row label="Booster Recovery" value={risk?.boosterRecoveryWeather || '—'} />
        <Row label="Solar Activity" value={risk?.solarActivity || '—'} />
      </dl>

      {clouds.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Cloud layers</div>
          <ul className="mt-2 space-y-1 text-xs text-text2">
            {clouds.map((layer, idx) => (
              <li key={`${layer.type}:${idx}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-text1">{layer.type}</span>
                <span className="text-text3">{formatCloudLayer(layer)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stroke bg-[rgba(0,0,0,0.12)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-0.5 text-sm text-text1">{value}</div>
    </div>
  );
}

function PovRing({ pov }: { pov: number | null }) {
  const pct = pov == null ? 0 : clampInt(pov, 0, 100);
  const ringColor = pov == null ? 'rgba(148,163,184,0.55)' : pct <= 10 ? 'rgba(74,222,128,0.9)' : pct <= 25 ? 'rgba(251,191,36,0.9)' : 'rgba(251,113,133,0.9)';
  const bg = `conic-gradient(${ringColor} ${pct}%, rgba(255,255,255,0.08) 0)`;

  return (
    <div className="relative h-14 w-14 shrink-0 rounded-full" style={{ background: bg }}>
      <div className="absolute inset-[5px] flex flex-col items-center justify-center rounded-full bg-surface-1 text-[10px] uppercase tracking-[0.1em] text-text3">
        <div className="text-sm font-semibold text-text1">{pov == null ? '—' : `${pct}%`}</div>
        <div>PoV</div>
      </div>
    </div>
  );
}

function concernTone(pov: number | null) {
  if (pov == null) return 'border-stroke text-text3 bg-white/5';
  if (pov <= 10) return 'border-success/40 text-success bg-success/10';
  if (pov <= 25) return 'border-warning/40 text-warning bg-warning/10';
  return 'border-danger/40 text-danger bg-danger/10';
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

function formatWinds(
  winds: Ws45ForecastScenario['liftoffWinds'] | null | undefined
) {
  if (!winds) return null;
  const direction = typeof winds.directionDeg === 'number' ? clampInt(winds.directionDeg, 0, 360) : null;
  const min = typeof winds.speedMphMin === 'number' ? clampInt(winds.speedMphMin, 0, 300) : null;
  const max = typeof winds.speedMphMax === 'number' ? clampInt(winds.speedMphMax, 0, 300) : null;
  const card = direction == null ? null : degreesToCardinal(direction);
  const dirLabel = direction == null ? '' : `${direction}°${card ? ` ${card}` : ''}`;
  if (min == null && max == null) return dirLabel || null;
  const speedLabel = min != null && max != null && min !== max ? `${min}–${max} mph` : `${min ?? max} mph`;
  return dirLabel ? `${dirLabel} • ${speedLabel}` : speedLabel;
}

function degreesToCardinal(degrees: number) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((degrees % 360) / 22.5)) % 16;
  return dirs[idx] || null;
}

function formatCloudLayer(layer: { coverage?: string; baseFt?: number; topsFt?: number }) {
  const coverage = layer.coverage ? String(layer.coverage).trim() : null;
  const base = typeof layer.baseFt === 'number' ? layer.baseFt : null;
  const tops = typeof layer.topsFt === 'number' ? layer.topsFt : null;
  const baseLabel = base == null ? null : `${formatNumber(base)} ft`;
  const topsLabel = tops == null ? null : `${formatNumber(tops)} ft`;
  const heightLabel = baseLabel && topsLabel ? `${baseLabel}–${topsLabel}` : baseLabel || topsLabel || '—';
  return coverage ? `${coverage} • ${heightLabel}` : heightLabel;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
