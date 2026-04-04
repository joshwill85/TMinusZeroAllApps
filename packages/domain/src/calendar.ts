export type CalendarGridDay = {
  date: Date;
  key: string;
  isCurrentMonth: boolean;
};

export type CalendarDayTemporalState = 'past' | 'today' | 'future';

export type CalendarLaunchMarkerState = CalendarDayTemporalState | 'none';

export type CalendarEventLinkInput = {
  title: string;
  location?: string | null;
  description?: string | null;
  detailUrl?: string | null;
  startIso: string;
  endIso?: string | null;
  allDay?: boolean;
  brandName?: string | null;
};

export function buildCalendarMonthDays(anchor: Date) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startWeekday = monthStart.getDay();
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const days: CalendarGridDay[] = [];

  for (let offset = startWeekday; offset > 0; offset -= 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), 1 - offset);
    const key = toLocalDateKey(date);
    if (!key) continue;
    days.push({ date, key, isCurrentMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), day);
    const key = toLocalDateKey(date);
    if (!key) continue;
    days.push({ date, key, isCurrentMonth: true });
  }

  let trailingDay = 1;
  while (days.length % 7 !== 0) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() + 1, trailingDay);
    const key = toLocalDateKey(date);
    if (!key) {
      trailingDay += 1;
      continue;
    }
    days.push({ date, key, isCurrentMonth: false });
    trailingDay += 1;
  }

  return days;
}

export function getCalendarMonthBounds(anchor: Date) {
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 0, 0, 0, 0)
  };
}

export function groupItemsByLocalDate<T>(items: T[], getDateValue: (item: T) => Date | string | null | undefined) {
  const grouped = new Map<string, T[]>();

  items.forEach((item) => {
    const key = toLocalDateKey(getDateValue(item));
    if (!key) return;
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  });

  return grouped;
}

export function toLocalDateKey(value: Date | string | null | undefined) {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' && value.trim()
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseCalendarDayKey(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const parsed = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getCalendarDayTemporalState(
  dayKey: string,
  referenceDate: Date = new Date()
): CalendarDayTemporalState | null {
  const day = parseCalendarDayKey(dayKey);
  const referenceKey = toLocalDateKey(referenceDate);
  const reference = parseCalendarDayKey(referenceKey);
  if (!day || !reference) return null;

  const dayMs = day.getTime();
  const referenceMs = reference.getTime();
  if (dayMs < referenceMs) return 'past';
  if (dayMs > referenceMs) return 'future';
  return 'today';
}

export function getCalendarLaunchMarkerState(
  dayKey: string,
  itemCount: number,
  referenceDate: Date = new Date()
): CalendarLaunchMarkerState {
  if (!Number.isFinite(itemCount) || itemCount < 1) return 'none';
  return getCalendarDayTemporalState(dayKey, referenceDate) ?? 'none';
}

export function buildCalendarEventLinks(input: CalendarEventLinkInput) {
  const title = input.title.trim();
  const location = String(input.location || '').trim();
  const description = String(input.description || '').trim();
  const detailUrl = String(input.detailUrl || '').trim();
  const brandName = String(input.brandName || '').trim();
  const start = safeDate(input.startIso) ?? new Date();
  const end = safeDate(input.endIso) ?? start;
  const allDay = input.allDay === true;
  const fullDescription = [description, detailUrl ? `More: ${detailUrl}` : null].filter(Boolean).join('\n\n');
  const googleDates = allDay
    ? `${formatUtcDate(start)}/${formatUtcDate(addDays(start, 1))}`
    : `${formatUtcStamp(start)}/${formatUtcStamp(end)}`;
  const outlookStart = allDay ? formatDateOnlyIso(start) : start.toISOString();
  const outlookEnd = allDay ? formatDateOnlyIso(addDays(start, 1)) : end.toISOString();

  return {
    googleUrl:
      'https://www.google.com/calendar/render?action=TEMPLATE' +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${encodeURIComponent(googleDates)}` +
      `&details=${encodeURIComponent(fullDescription)}` +
      `&location=${encodeURIComponent(location)}` +
      (detailUrl ? `&sprop=${encodeURIComponent(detailUrl)}` : '') +
      (brandName ? `&sprop=name:${encodeURIComponent(brandName)}` : ''),
    outlookUrl:
      'https://outlook.live.com/calendar/0/deeplink/compose' +
      `?subject=${encodeURIComponent(title)}` +
      `&body=${encodeURIComponent(fullDescription)}` +
      `&startdt=${encodeURIComponent(outlookStart)}` +
      `&enddt=${encodeURIComponent(outlookEnd)}` +
      `&location=${encodeURIComponent(location)}` +
      `&allday=${encodeURIComponent(allDay ? 'true' : 'false')}`
  };
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatUtcStamp(value: Date) {
  const iso = value.toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10).replace(/-/g, '');
}

function formatDateOnlyIso(value: Date) {
  return value.toISOString().slice(0, 10);
}
