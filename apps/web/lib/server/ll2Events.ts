import type { SupabaseClient } from '@supabase/supabase-js';
import type { Launch, LaunchRelatedEvent } from '@/lib/types/launch';

type Ll2EventRow = {
  ll2_event_id: number;
  name: string;
  date: string | null;
  date_precision: string | null;
  duration: string | null;
  type_name: string | null;
  url: string | null;
};

type Ll2EventJoinRow = { launch_id: string; ll2_event_id: number };

type LaunchEventMeta = {
  event: LaunchRelatedEvent;
  dateMs: number | null;
  durationMs: number | null;
};

export async function attachNextLaunchEvents(
  supabase: SupabaseClient,
  launches: Launch[],
  nowMs = Date.now()
) {
  if (!launches.length) return launches;
  const launchIds = launches.map((launch) => launch.id).filter(Boolean);
  if (!launchIds.length) return launches;

  const joinRows: Ll2EventJoinRow[] = [];
  for (const chunk of chunkArray(launchIds, 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from('ll2_event_launches')
      .select('launch_id, ll2_event_id')
      .in('launch_id', chunk);
    if (error) {
      console.error('ll2_event_launches query error', error);
      return launches;
    }
    (data || []).forEach((row) => joinRows.push(row as Ll2EventJoinRow));
  }

  if (!joinRows.length) return launches;

  const eventIds = Array.from(new Set(joinRows.map((row) => row.ll2_event_id)));
  const eventRows: Ll2EventRow[] = [];
  for (const chunk of chunkArray(eventIds, 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from('ll2_events')
      .select('ll2_event_id, name, date, date_precision, duration, type_name, url')
      .in('ll2_event_id', chunk);
    if (error) {
      console.error('ll2_events query error', error);
      return launches;
    }
    (data || []).forEach((row) => eventRows.push(row as Ll2EventRow));
  }

  const eventById = new Map<number, LaunchEventMeta>();
  for (const row of eventRows) {
    const dateMs = row.date ? Date.parse(row.date) : NaN;
    const durationMs = parseIsoDurationToMs(row.duration);
    const event: LaunchRelatedEvent = {
      id: row.ll2_event_id,
      name: row.name,
      date: row.date,
      datePrecision: row.date_precision,
      typeName: row.type_name ?? undefined,
      url: row.url ?? undefined
    };
    eventById.set(row.ll2_event_id, {
      event,
      dateMs: Number.isFinite(dateMs) ? dateMs : null,
      durationMs
    });
  }

  const eventsByLaunch = new Map<string, LaunchEventMeta[]>();
  for (const join of joinRows) {
    const meta = eventById.get(join.ll2_event_id);
    if (!meta) continue;
    if (!eventsByLaunch.has(join.launch_id)) eventsByLaunch.set(join.launch_id, []);
    eventsByLaunch.get(join.launch_id)?.push(meta);
  }

  const nextEventByLaunch = new Map<string, LaunchRelatedEvent>();
  const currentEventByLaunch = new Map<string, LaunchRelatedEvent>();
  for (const [launchId, events] of eventsByLaunch.entries()) {
    const currentEvent = pickCurrentEvent(events, nowMs);
    const nextEvent = pickNextEvent(events, nowMs);
    if (currentEvent) currentEventByLaunch.set(launchId, currentEvent);
    if (nextEvent) nextEventByLaunch.set(launchId, nextEvent);
  }

  return launches.map((launch) => ({
    ...launch,
    currentEvent: currentEventByLaunch.get(launch.id),
    nextEvent: nextEventByLaunch.get(launch.id)
  }));
}

function pickNextEvent(events: LaunchEventMeta[], nowMs: number) {
  const upcoming = events
    .filter((entry) => entry.dateMs != null && entry.dateMs > nowMs)
    .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0));
  return upcoming.length ? upcoming[0].event : null;
}

function pickCurrentEvent(events: LaunchEventMeta[], nowMs: number) {
  const active = events
    .filter((entry) => isEventCurrent(entry, nowMs))
    .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0));
  return active.length ? active[active.length - 1].event : null;
}

const MAX_CURRENT_EVENT_DURATION_MS = 48 * 60 * 60 * 1000;

function isEventCurrent(entry: LaunchEventMeta, nowMs: number) {
  if (entry.dateMs == null) return false;
  const windowMs = resolveCurrentWindowMs(entry);
  if (windowMs == null) return false;
  return nowMs >= entry.dateMs && nowMs <= entry.dateMs + windowMs;
}

function resolveCurrentWindowMs(entry: LaunchEventMeta) {
  if (entry.durationMs && entry.durationMs > 0 && entry.durationMs <= MAX_CURRENT_EVENT_DURATION_MS) {
    return entry.durationMs;
  }
  const precision = entry.event.datePrecision?.toLowerCase();
  if (precision === 'minute') return 60 * 60 * 1000;
  if (precision === 'hour') return 2 * 60 * 60 * 1000;
  if (precision === 'day') return 24 * 60 * 60 * 1000;
  return null;
}

function parseIsoDurationToMs(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  const ms = totalSeconds * 1000;
  return negative ? -ms : ms;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
