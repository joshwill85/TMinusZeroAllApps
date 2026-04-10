import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import {
  getWs45LiveCadenceMinutes,
  summarizeWs45LaunchOperational,
  type Ws45LaunchBoardContext,
  type Ws45OperationalTone
} from '../../../../shared/ws45LiveBoard';

export type Ws45LiveWeatherSnapshot = {
  id: string;
  fetched_at?: string | null;
  summary?: string | null;
  agencies?: unknown;
  lightning_rings?: unknown;
};

export type Ws45PlanningForecast = {
  id: string;
  product_kind: 'planning_24h' | 'weekly_planning';
  source_label?: string | null;
  pdf_url: string;
  issued_at?: string | null;
  valid_start?: string | null;
  valid_end?: string | null;
  headline?: string | null;
  summary?: string | null;
  highlights?: string[] | null;
  document_family?: string | null;
  parse_status?: string | null;
  parse_confidence?: number | null;
  publish_eligible?: boolean | null;
};

export type Ws45OperationalWeather = {
  source: 'ws45_live';
  title: string;
  subtitle: string | null;
  fetchedAt: string | null;
  summary: string;
  tone: Ws45OperationalTone;
  stale: boolean;
  items: Array<{
    id: string;
    label: string;
    value: string;
    detail: string | null;
    tone: Ws45OperationalTone;
  }>;
  actionLabel: string | null;
  actionUrl: string | null;
};

type LaunchWeatherContext = Ws45LaunchBoardContext & {
  net?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
};

const WEEKLY_PLANNING_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function getWeatherClient() {
  return isSupabaseAdminConfigured() ? createSupabaseAdminClient() : createSupabasePublicClient();
}

export async function fetchWs45LiveWeatherSnapshotForLaunch(
  launch: LaunchWeatherContext,
  isEasternRange: boolean
) {
  if (!isSupabaseConfigured() || !isEasternRange) return null as Ws45LiveWeatherSnapshot | null;
  const cadenceMinutes = getWs45LiveCadenceMinutes(launch.windowStart || launch.net || null);
  if (cadenceMinutes == null) return null as Ws45LiveWeatherSnapshot | null;

  const client = getWeatherClient();
  const { data, error } = await client
    .from('ws45_live_weather_snapshots')
    .select('id, fetched_at, summary, agencies, lightning_rings')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as Ws45LiveWeatherSnapshot | null) ?? null;
}

export function buildWs45OperationalWeather(
  snapshot: Ws45LiveWeatherSnapshot | null,
  launch: LaunchWeatherContext
): Ws45OperationalWeather | null {
  if (!snapshot) return null;
  const operational = summarizeWs45LaunchOperational(
    {
      agencies: Array.isArray(snapshot.agencies) ? snapshot.agencies : []
    },
    launch
  );
  if (!operational) return null;

  const cadenceMinutes = getWs45LiveCadenceMinutes(launch.windowStart || launch.net || null) ?? 120;
  const fetchedMs = Date.parse(String(snapshot.fetched_at || ''));
  const stale = Number.isFinite(fetchedMs) ? Date.now() - fetchedMs > cadenceMinutes * 2 * 60 * 1000 : true;

  return {
    source: 'ws45_live',
    title: '5 WS live board',
    subtitle: operational.agencyName,
    fetchedAt: snapshot.fetched_at || null,
    summary: operational.summary,
    tone: operational.tone,
    stale,
    items: [
      {
        id: 'lightning',
        label: 'Lightning / phase',
        value: operational.lightningLabel,
        detail: operational.lightningDetail,
        tone: operational.tone === 'critical' || operational.lightningLabel !== 'No active lightning phases' ? operational.tone : 'normal'
      },
      {
        id: 'wind',
        label: 'Wind',
        value: operational.windLabel,
        detail: operational.windDetail,
        tone: operational.windLabel !== 'No active wind advisory' ? operational.tone : 'normal'
      },
      {
        id: 'range',
        label: 'Range weather',
        value: operational.rangeStatus,
        detail: operational.rangeDetail,
        tone: operational.tone
      }
    ],
    actionLabel: 'Open live board',
    actionUrl: 'https://nimboard.rad.spaceforce.mil/nimboard'
  };
}

export async function fetchWs45PlanningForecastsForLaunch(
  launch: LaunchWeatherContext,
  isEasternRange: boolean
) {
  if (!isSupabaseConfigured() || !isEasternRange) {
    return {
      planning24h: null as Ws45PlanningForecast | null,
      weekly: null as Ws45PlanningForecast | null
    };
  }

  const client = getWeatherClient();
  const { data, error } = await client
    .from('ws45_planning_forecasts')
    .select(
      'id, product_kind, source_label, pdf_url, issued_at, valid_start, valid_end, headline, summary, highlights, document_family, parse_status, parse_confidence, publish_eligible'
    )
    .in('product_kind', ['planning_24h', 'weekly_planning'])
    .neq('parse_status', 'failed')
    .not('valid_start', 'is', null)
    .not('valid_end', 'is', null)
    .order('publish_eligible', { ascending: false })
    .order('issued_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(20);

  if (error || !data) {
    return {
      planning24h: null as Ws45PlanningForecast | null,
      weekly: null as Ws45PlanningForecast | null
    };
  }

  const rows = (data as Ws45PlanningForecast[]).filter(isUsablePlanningForecast).map(normalizePlanningForecastForDisplay);
  const planning24h = pickPlanning24hForecast(rows.filter((row) => row.product_kind === 'planning_24h'), launch);
  const weekly = shouldShowWeeklyPlanningForLaunch(launch)
    ? rows.find((row) => row.product_kind === 'weekly_planning') ?? null
    : null;

  return { planning24h, weekly };
}

function pickPlanning24hForecast(rows: Ws45PlanningForecast[], launch: LaunchWeatherContext) {
  if (!rows.length) return null;
  const launchStartMs = Date.parse(String(launch.windowStart || launch.net || ''));
  const launchEndMs = Date.parse(String(launch.windowEnd || launch.windowStart || launch.net || ''));
  const normalizedLaunchEndMs =
    Number.isFinite(launchEndMs) && Number.isFinite(launchStartMs) && launchEndMs >= launchStartMs ? launchEndMs : launchStartMs;

  const overlapping = rows.find((row) => {
    const startMs = Date.parse(String(row.valid_start || ''));
    const endMs = Date.parse(String(row.valid_end || ''));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(launchStartMs)) return false;
    return startMs <= normalizedLaunchEndMs && endMs >= launchStartMs;
  });
  if (overlapping) return overlapping;

  if (Number.isFinite(launchStartMs)) {
    const nearby = rows.find((row) => {
      const issuedMs = Date.parse(String(row.issued_at || row.valid_start || ''));
      if (!Number.isFinite(issuedMs)) return false;
      return Math.abs(issuedMs - launchStartMs) <= 36 * 60 * 60 * 1000;
    });
    if (nearby) return nearby;
  }

  return rows[0] ?? null;
}

function isUsablePlanningForecast(row: Ws45PlanningForecast | null | undefined): row is Ws45PlanningForecast {
  if (!row?.id || !row.product_kind || !row.pdf_url) return false;
  if (row.parse_status === 'failed') return false;
  if (!row.valid_start || !row.valid_end) return false;
  return Boolean(row.summary || row.headline || row.source_label);
}

function normalizePlanningForecastForDisplay(row: Ws45PlanningForecast): Ws45PlanningForecast {
  const limitedExtract = row.parse_status !== 'parsed';
  const headline = row.headline || row.source_label || null;
  const summary =
    row.summary ||
    (limitedExtract ? 'Limited extract from the current WS45 planning product. Open the PDF for the full forecast text.' : null);

  return {
    ...row,
    headline,
    summary
  };
}

function shouldShowWeeklyPlanningForLaunch(launch: LaunchWeatherContext) {
  const launchStartMs = Date.parse(String(launch.windowStart || launch.net || ''));
  if (!Number.isFinite(launchStartMs)) return false;

  const nowMs = Date.now();
  return launchStartMs >= nowMs && launchStartMs - nowMs <= WEEKLY_PLANNING_LOOKAHEAD_MS;
}
