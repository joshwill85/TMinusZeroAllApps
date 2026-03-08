import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';

const STATUS_FIELDS = new Set(['status_abbrev', 'status_name', 'status_id']);
const TIMING_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const OPERATIONS_FIELDS = new Set(['probability', 'hold_reason', 'fail_reason']);
const DETAILS_FIELDS = new Set(['programs', 'crew', 'payloads', 'timeline']);
const CHANGELOG_FIELDS = new Set([...STATUS_FIELDS, ...TIMING_FIELDS, ...OPERATIONS_FIELDS, ...DETAILS_FIELDS]);

export async function GET(request: Request) {
  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  const { searchParams } = new URL(request.url);
  const hoursRaw = searchParams.get('hours');
  const hours = clampInt(hoursRaw ? Number(hoursRaw) : 24, 1, 168);
  const region = parseLaunchRegion(searchParams.get('region'));

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 503 });
  }

  let results: Array<{
    launchId: string;
    name: string;
    summary: string;
    lastUpdated?: string;
    lastUpdatedLabel?: string;
    entries: Array<{
      updateId: string;
      changeSummary?: string;
      updatedFields: string[];
      detectedAt?: string;
      detectedLabel?: string;
      details?: string[];
    }>;
  }> = [];

  const supabase = createSupabaseAdminClient();
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('launch_updates')
    .select('id, detected_at, changed_fields, old_values, new_values, launch_id, launches!inner(name, hidden, pad_timezone)')
    .gte('detected_at', sinceIso)
    .eq('launches.hidden', false);
  if (region === 'us') query = query.in('launches.pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') query = query.not('launches.pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);

  const { data, error } = await query.order('detected_at', { ascending: false }).limit(25);

  if (error) {
    console.error('changed launches fetch error', error);
  } else if (data) {
    const grouped = new Map<
      string,
      (typeof results)[number] & {
        padTimezone: string | null;
      }
    >();

    data.forEach((row: any) => {
      const launchId = String(row.launch_id || '');
      if (!launchId) return;
      const filteredFields = filterChangelogFields(row.changed_fields ?? []);
      if (filteredFields.length === 0) return;
      const padTimezone = row.launches?.pad_timezone || null;

      const update = {
        updateId: String(row.id ?? `${launchId}:${row.detected_at ?? ''}`),
        updatedFields: filteredFields,
        changeSummary: summarizeChangedFields(filteredFields),
        detectedAt: row.detected_at ?? undefined,
        detectedLabel: formatLocalTimeLabel(row.detected_at, padTimezone) || undefined,
        details: buildChangeDetails({
          fields: filteredFields,
          oldValues: row.old_values ?? null,
          newValues: row.new_values ?? null,
          timezone: padTimezone
        })
      };

      const existing = grouped.get(launchId);
      if (existing) {
        existing.entries.push(update);
        if (!existing.lastUpdated || (update.detectedAt && update.detectedAt > existing.lastUpdated)) {
          existing.lastUpdated = update.detectedAt;
        }
      } else {
        grouped.set(launchId, {
          launchId,
          name: row.launches?.name ?? 'Launch',
          summary: '',
          lastUpdated: update.detectedAt,
          lastUpdatedLabel: update.detectedLabel,
          entries: [update],
          padTimezone
        });
      }
    });

    results = Array.from(grouped.values()).map((group) => {
      const combinedFields = group.entries.flatMap((entry) => entry.updatedFields || []);
      const summary = summarizeChangedFields(combinedFields);
      const entries = group.entries.sort((a, b) => {
        const aTime = a.detectedAt ? Date.parse(a.detectedAt) : 0;
        const bTime = b.detectedAt ? Date.parse(b.detectedAt) : 0;
        return bTime - aTime;
      });
      const lastUpdatedLabel =
        entries[0]?.detectedLabel ||
        (group.lastUpdated ? formatLocalTimeLabel(group.lastUpdated, group.padTimezone) || undefined : undefined);
      return {
        launchId: group.launchId,
        name: group.name,
        summary,
        entries,
        lastUpdated: group.lastUpdated,
        lastUpdatedLabel
      };
    });

    results.sort((a, b) => {
      const aTime = a.lastUpdated ? Date.parse(a.lastUpdated) : 0;
      const bTime = b.lastUpdated ? Date.parse(b.lastUpdated) : 0;
      return bTime - aTime;
    });
  }

  return NextResponse.json(
    {
      hours,
      tier: viewer.tier,
      intervalSeconds: viewer.refreshIntervalSeconds,
      results
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function filterChangelogFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.trim())
    .filter((field) => CHANGELOG_FIELDS.has(field.toLowerCase()));
}

function summarizeChangedFields(fields: string[]) {
  const normalized = new Set(fields.map((f) => f.toLowerCase().trim()));
  const parts: string[] = [];
  if (Array.from(STATUS_FIELDS).some((field) => normalized.has(field))) parts.push('Status updated');
  if (Array.from(TIMING_FIELDS).some((field) => normalized.has(field))) parts.push('Timing updated');
  if (Array.from(OPERATIONS_FIELDS).some((field) => normalized.has(field))) parts.push('Operations updated');
  if (Array.from(DETAILS_FIELDS).some((field) => normalized.has(field))) parts.push('Details updated');
  return parts.length ? parts.join(' • ') : 'Updated';
}

function buildChangeDetails({
  fields,
  oldValues,
  newValues,
  timezone
}: {
  fields: string[];
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  timezone: string | null;
}) {
  const details: string[] = [];
  const normalized = new Set(fields.map((f) => f.toLowerCase()));
  const handled = new Set<string>();

  if (normalized.has('status_abbrev') || normalized.has('status_name') || normalized.has('status_id')) {
    details.push(`Status: ${formatSimple(pickStatus(oldValues))} -> ${formatSimple(pickStatus(newValues))}`);
    handled.add('status_abbrev');
    handled.add('status_name');
    handled.add('status_id');
  }

  if (normalized.has('net')) {
    details.push(`NET: ${formatDate(oldValues?.net, timezone)} -> ${formatDate(newValues?.net, timezone)}`);
    handled.add('net');
  }

  if (normalized.has('window_start')) {
    details.push(`Window start: ${formatDate(oldValues?.window_start, timezone)} -> ${formatDate(newValues?.window_start, timezone)}`);
    handled.add('window_start');
  }

  if (normalized.has('window_end')) {
    details.push(`Window end: ${formatDate(oldValues?.window_end, timezone)} -> ${formatDate(newValues?.window_end, timezone)}`);
    handled.add('window_end');
  }

  if (normalized.has('net_precision')) {
    details.push(`NET precision: ${formatSimple(oldValues?.net_precision)} -> ${formatSimple(newValues?.net_precision)}`);
    handled.add('net_precision');
  }

  if (normalized.has('video_url')) {
    details.push(`Watch link: ${formatUrl(oldValues?.video_url)} -> ${formatUrl(newValues?.video_url)}`);
    handled.add('video_url');
  }

  if (normalized.has('webcast_live')) {
    details.push(`Webcast live: ${formatBool(oldValues?.webcast_live)} -> ${formatBool(newValues?.webcast_live)}`);
    handled.add('webcast_live');
  }

  if (normalized.has('featured')) {
    details.push(`Featured: ${formatBool(oldValues?.featured)} -> ${formatBool(newValues?.featured)}`);
    handled.add('featured');
  }

  if (normalized.has('hidden')) {
    details.push(`Hidden: ${formatBool(oldValues?.hidden)} -> ${formatBool(newValues?.hidden)}`);
    handled.add('hidden');
  }

  if (normalized.has('tier_override')) {
    details.push(`Tier override: ${formatSimple(oldValues?.tier_override)} -> ${formatSimple(newValues?.tier_override)}`);
    handled.add('tier_override');
  }

  if (normalized.has('name')) {
    details.push(`Name: ${formatSimple(oldValues?.name)} -> ${formatSimple(newValues?.name)}`);
    handled.add('name');
  }

  fields.forEach((field) => {
    const key = field.toLowerCase();
    if (handled.has(key)) return;
    const oldValue = formatSimple(oldValues?.[field]);
    const newValue = formatSimple(newValues?.[field]);
    details.push(`${labelize(field)}: ${oldValue} -> ${newValue}`);
  });

  return details;
}

function pickStatus(values: Record<string, any> | null) {
  if (!values) return null;
  return values.status_abbrev || values.status_name || values.status_id || null;
}

function formatSimple(value: any) {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') return truncateString(value, 140);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return truncateString(JSON.stringify(value), 140);
    } catch {
      return 'unavailable';
    }
  }
  return String(value);
}

function formatBool(value: any) {
  if (value === null || value === undefined) return 'none';
  return value ? 'yes' : 'no';
}

function formatDate(value: any, timezone: string | null) {
  if (!value) return 'none';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatSimple(value);
  const zone = timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  }).format(date);
}

function formatLocalTimeLabel(value: any, timezone: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const zone = timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  }).format(date);
}

function formatUrl(value: any) {
  if (!value) return 'none';
  const raw = String(value).trim();
  if (!raw) return 'none';
  try {
    const url = new URL(raw);
    const host = url.host.replace(/^www\\./, '');
    const path = url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}...` : url.pathname;
    return `${host}${path}`;
  } catch {
    return raw.length > 32 ? `${raw.slice(0, 32)}...` : raw;
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ').replace(/\\b\\w/g, (char) => char.toUpperCase());
}

function truncateString(value: string, limit: number) {
  const trimmed = String(value || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
