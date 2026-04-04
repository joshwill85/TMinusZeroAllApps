'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { getCalendarDayTemporalState } from '@tminuszero/domain';
import { Launch } from '@/lib/types/launch';
import { formatDateOnly } from '@/lib/time';
import { resolveProviderLogoUrl } from '@/lib/utils/providerLogo';
import { buildLaunchHref, buildProviderHref } from '@/lib/utils/launchLinks';
import { CalendarDayTile, CalendarStateLegend } from '@/components/CalendarDayTile';
import { CalendarMonthYearPicker } from '@/components/CalendarMonthYearPicker';

export function LaunchCalendar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(false);
  const [mobileDayDetailsOpen, setMobileDayDetailsOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const localTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const currentMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1), [monthOffset, today]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const controller = new AbortController();

    const from = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 0, 0, 0);
    const to = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1, 0, 0, 0);

    const qs = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      limit: '1000',
      sort: 'soonest'
    }).toString();

    fetch(`/api/public/launches?${qs}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => setLaunches(json.launches || []))
      .catch((err) => console.error('calendar fetch error', err))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, currentMonth]);

  const calendarDays = useMemo(() => {
    const startDay = new Date(currentMonth);
    startDay.setDate(1);
    const startWeekday = startDay.getDay(); // 0 = Sun
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const days: { date: Date; iso: string }[] = [];

    for (let i = 0; i < startWeekday; i++) {
      const d = new Date(currentMonth);
      d.setDate(d.getDate() - (startWeekday - i));
      days.push({ date: d, iso: ymdLocal(d) });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(currentMonth);
      d.setDate(i);
      days.push({ date: d, iso: ymdLocal(d) });
    }
    while (days.length % 7 !== 0) {
      const d = new Date(currentMonth);
      d.setDate(daysInMonth + (days.length - (startWeekday + daysInMonth) + 1));
      days.push({ date: d, iso: ymdLocal(d) });
    }
    return days;
  }, [currentMonth]);

  const launchesByDay = useMemo(() => {
    const map = new Map<string, Launch[]>();
    launches.forEach((l) => {
      const iso = ymdLocal(new Date(l.net));
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(l);
    });
    return map;
  }, [launches]);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const isCurrentMonth =
      today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth();
    setSelectedDay(isCurrentMonth ? ymdLocal(today) : ymdLocal(currentMonth));
    setMobileDayDetailsOpen(false);
  }, [open, currentMonth, today]);

  const selectedLaunches = selectedDay ? launchesByDay.get(selectedDay) || [] : [];
  const selectedDayLabel = selectedDay ? formatDateOnly(`${selectedDay}T00:00:00`, localTimezone) : 'Select a day';
  const selectedDayLaunchLabel = formatLaunchCountLabel(selectedLaunches.length);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[rgba(0,0,0,0.55)] p-4 backdrop-blur-sm md:p-8">
      <div className="w-full max-w-5xl rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Launch calendar</div>
            <h2 className="text-xl font-semibold text-text1">
              {currentMonth.toLocaleString('default', { month: 'long' })} {currentMonth.getFullYear()}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn rounded-lg px-3 py-2 text-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="mt-4">
          <CalendarMonthYearPicker
            value={currentMonth}
            today={today}
            compact
            onChange={(nextMonth) => {
              const offset = (nextMonth.getFullYear() - today.getFullYear()) * 12 + (nextMonth.getMonth() - today.getMonth());
              setMonthOffset(offset);
            }}
          />
        </div>

        {loading && <div className="mt-3 text-sm text-text3">Loading launches...</div>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Past, today, upcoming</div>
          <CalendarStateLegend />
        </div>

        <div className="mt-4 overflow-x-auto pb-2">
          <div className="grid min-w-[560px] grid-cols-7 gap-3">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="text-center text-xs uppercase tracking-[0.08em] text-text3">
                {d}
              </div>
            ))}
            {calendarDays.map((day) => {
              const isCurrentMonth = day.date.getMonth() === currentMonth.getMonth();
              const key = day.iso;
              const items = launchesByDay.get(key) || [];
              const isSelected = selectedDay === key;
              return (
                <CalendarDayTile
                  key={key}
                  dayKey={key}
                  dayNumber={day.date.getDate()}
                  launchCount={items.length}
                  isCurrentMonth={isCurrentMonth}
                  isSelected={isSelected}
                  ariaLabel={buildCalendarDayLabel(key, items.length, localTimezone)}
                  onClick={() => {
                    setSelectedDay(key);
                    setMobileDayDetailsOpen(true);
                  }}
                  compact
                />
              );
            })}
          </div>
        </div>

        <div className="mt-3 sm:hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-left"
            onClick={() => setMobileDayDetailsOpen((openValue) => !openValue)}
            aria-expanded={mobileDayDetailsOpen}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text1">{selectedDayLabel}</div>
              <div className="mt-0.5 text-xs text-text3">{selectedDayLaunchLabel}</div>
            </div>
            <span className="shrink-0 text-xs text-text3">{mobileDayDetailsOpen ? 'Hide' : 'Show'}</span>
          </button>
        </div>

        <div className={clsx('mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3', !mobileDayDetailsOpen && 'hidden sm:block')}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-text1">
              {selectedDayLabel}
            </div>
            <div className="text-xs text-text3">{selectedDayLaunchLabel}</div>
          </div>
          <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
            {selectedLaunches.length === 0 && <div className="text-sm text-text3">No launches on this date.</div>}
            {selectedLaunches.map((l) => {
              const providerHref = buildProviderHref(l.provider);
              return (
                <div
                  key={l.id}
                  className="flex flex-col gap-2 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderLogo
                      provider={l.provider}
                      logoUrl={resolveProviderLogoUrl(l)}
                      className="mt-0.5 h-9 w-9"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-text1">{l.name}</div>
                      <div className="text-xs text-text3">
                        {providerHref ? (
                          <Link href={providerHref} className="transition hover:text-text1">
                            {l.provider}
                          </Link>
                        ) : (
                          l.provider
                        )}{' '}
                        • {l.vehicle}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={buildLaunchHref(l)}
                    className="btn-secondary self-start rounded-md px-3 py-1 text-xs sm:self-auto"
                    onClick={onClose}
                  >
                    Details
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderLogo({
  provider,
  logoUrl,
  className
}: {
  provider: string;
  logoUrl?: string;
  className?: string;
}) {
  const sizeClass = className || 'h-4 w-4';
  const initial = (provider || '?').trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span className={clsx('relative inline-flex shrink-0 items-center justify-center', sizeClass)}>
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.55),rgba(124,92,255,0.28))] opacity-80 blur-[2px]"
      />
      <span className="relative flex h-full w-full items-center justify-center rounded-full border border-white/20 bg-[rgba(7,9,19,0.85)] shadow-[0_0_10px_rgba(34,211,238,0.3)]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-[86%] w-[86%] object-contain drop-shadow-[0_0_2px_rgba(255,255,255,0.6)]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="text-[9px] font-semibold text-text2 drop-shadow-[0_0_2px_rgba(255,255,255,0.35)]">
            {initial}
          </span>
        )}
      </span>
    </span>
  );
}

function ymdLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildCalendarDayLabel(dayKey: string, count: number, localTimezone: string) {
  const label = [formatDateOnly(`${dayKey}T00:00:00`, localTimezone)];
  const dayState = getCalendarDayTemporalState(dayKey);

  if (dayState === 'today') {
    label.push('today');
  } else if (dayState === 'past') {
    label.push(count > 0 ? 'past launches' : 'past date');
  } else if (dayState === 'future') {
    label.push(count > 0 ? 'upcoming launches' : 'future date');
  }

  label.push(count > 0 ? formatLaunchCountLabel(count) : 'no launches');
  return label.join(' • ');
}

function formatLaunchCountLabel(count: number) {
  return `${count} launch${count === 1 ? '' : 'es'}`;
}
