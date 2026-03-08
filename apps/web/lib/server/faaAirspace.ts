import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

const DEFAULT_ADVISORY_LIMIT = 6;

type LaunchMatchRow = {
  id: string;
  launch_id: string;
  faa_tfr_record_id: string;
  faa_tfr_shape_id: string | null;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'manual';
  match_confidence: number | null;
  match_score: number | null;
  match_strategy: string | null;
  match_meta: Record<string, unknown> | null;
  matched_at: string | null;
};

type TfrRecordRow = {
  id: string;
  notam_id: string | null;
  source_key: string;
  facility: string | null;
  state: string | null;
  type: string | null;
  legal: string | null;
  title: string | null;
  description: string | null;
  valid_start: string | null;
  valid_end: string | null;
  has_shape: boolean;
  status: 'active' | 'expired' | 'manual';
  mod_at: string | null;
};

type ShapeRow = {
  id: string;
  faa_tfr_record_id: string;
};

export type LaunchFaaAirspaceAdvisory = {
  matchId: string;
  launchId: string;
  tfrRecordId: string;
  tfrShapeId: string | null;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched' | 'manual';
  matchConfidence: number | null;
  matchScore: number | null;
  matchStrategy: string | null;
  matchedAt: string | null;
  notamId: string | null;
  title: string;
  type: string | null;
  facility: string | null;
  state: string | null;
  status: 'active' | 'expired' | 'manual';
  validStart: string | null;
  validEnd: string | null;
  isActiveNow: boolean;
  hasShape: boolean;
  shapeCount: number;
  sourceGraphicUrl: string | null;
  sourceRawUrl: string | null;
  sourceUrl: string | null;
  matchMeta: Record<string, unknown> | null;
};

export type LaunchFaaAirspaceData = {
  launchId: string;
  generatedAt: string;
  hasPotentialRestrictions: boolean;
  advisories: LaunchFaaAirspaceAdvisory[];
};

async function fetchLaunchFaaAirspaceCore(launchId: string, limit: number): Promise<LaunchFaaAirspaceData | null> {
  if (!isSupabaseConfigured()) return null;
  if (!launchId) return null;

  const advisoryLimit = clampInt(limit, 1, 20);
  const supabase = createSupabasePublicClient();

  const { data: matchRows, error: matchError } = await supabase
    .from('faa_launch_matches')
    .select(
      'id, launch_id, faa_tfr_record_id, faa_tfr_shape_id, match_status, match_confidence, match_score, match_strategy, match_meta, matched_at'
    )
    .eq('launch_id', launchId)
    .in('match_status', ['matched', 'ambiguous', 'manual'])
    .order('match_confidence', { ascending: false, nullsFirst: false })
    .order('matched_at', { ascending: false })
    .limit(advisoryLimit);

  if (matchError) {
    console.error('faa airspace match query error', matchError);
    return null;
  }

  const matches = (matchRows || []) as LaunchMatchRow[];
  if (!matches.length) {
    return {
      launchId,
      generatedAt: new Date().toISOString(),
      hasPotentialRestrictions: false,
      advisories: []
    };
  }

  const recordIds = Array.from(new Set(matches.map((row) => row.faa_tfr_record_id).filter(Boolean)));

  const [{ data: recordRows, error: recordError }, { data: shapeRows, error: shapeError }] = await Promise.all([
    supabase
      .from('faa_tfr_records')
      .select(
        'id, notam_id, source_key, facility, state, type, legal, title, description, valid_start, valid_end, has_shape, status, mod_at'
      )
      .in('id', recordIds),
    supabase.from('faa_tfr_shapes').select('id, faa_tfr_record_id').in('faa_tfr_record_id', recordIds)
  ]);

  if (recordError) {
    console.error('faa airspace record query error', recordError);
    return null;
  }
  if (shapeError) {
    console.error('faa airspace shape query error', shapeError);
    return null;
  }

  const recordById = new Map<string, TfrRecordRow>();
  for (const row of (recordRows || []) as TfrRecordRow[]) {
    recordById.set(row.id, row);
  }

  const shapeCountByRecordId = new Map<string, number>();
  for (const row of (shapeRows || []) as ShapeRow[]) {
    const current = shapeCountByRecordId.get(row.faa_tfr_record_id) || 0;
    shapeCountByRecordId.set(row.faa_tfr_record_id, current + 1);
  }

  const nowMs = Date.now();

  const advisories = matches
    .map((match): LaunchFaaAirspaceAdvisory | null => {
      const record = recordById.get(match.faa_tfr_record_id);
      if (!record) return null;

      const title =
        normalizeNonEmptyString(record.title) ||
        normalizeNonEmptyString(record.description) ||
        normalizeNonEmptyString(record.legal) ||
        normalizeNonEmptyString(record.type) ||
        'FAA Temporary Flight Restriction';
      const sourceGraphicUrl = buildNotamGraphicUrl(record.notam_id);
      const sourceRawUrl = buildNotamRawUrl(record.notam_id);

      return {
        matchId: match.id,
        launchId: match.launch_id,
        tfrRecordId: record.id,
        tfrShapeId: match.faa_tfr_shape_id,
        matchStatus: match.match_status,
        matchConfidence: typeof match.match_confidence === 'number' ? match.match_confidence : null,
        matchScore: typeof match.match_score === 'number' ? match.match_score : null,
        matchStrategy: normalizeNonEmptyString(match.match_strategy),
        matchedAt: normalizeNonEmptyString(match.matched_at),
        notamId: normalizeNonEmptyString(record.notam_id),
        title,
        type: normalizeNonEmptyString(record.type),
        facility: normalizeNonEmptyString(record.facility),
        state: normalizeNonEmptyString(record.state),
        status: record.status,
        validStart: normalizeNonEmptyString(record.valid_start),
        validEnd: normalizeNonEmptyString(record.valid_end),
        isActiveNow: isActiveInWindow(record.valid_start, record.valid_end, nowMs),
        hasShape: Boolean(record.has_shape),
        shapeCount: shapeCountByRecordId.get(record.id) || 0,
        sourceGraphicUrl,
        sourceRawUrl,
        sourceUrl: sourceGraphicUrl || sourceRawUrl,
        matchMeta: isObject(match.match_meta) ? (match.match_meta as Record<string, unknown>) : null
      };
    })
    .filter((entry): entry is LaunchFaaAirspaceAdvisory => entry != null)
    .sort((a, b) => {
      if (a.isActiveNow !== b.isActiveNow) return a.isActiveNow ? -1 : 1;
      const aConfidence = typeof a.matchConfidence === 'number' ? a.matchConfidence : -1;
      const bConfidence = typeof b.matchConfidence === 'number' ? b.matchConfidence : -1;
      if (aConfidence !== bConfidence) return bConfidence - aConfidence;
      const aMs = a.validStart ? Date.parse(a.validStart) : Number.POSITIVE_INFINITY;
      const bMs = b.validStart ? Date.parse(b.validStart) : Number.POSITIVE_INFINITY;
      return aMs - bMs;
    });

  return {
    launchId,
    generatedAt: new Date().toISOString(),
    hasPotentialRestrictions: advisories.some((entry) => entry.matchStatus === 'matched' || entry.matchStatus === 'ambiguous'),
    advisories
  };
}

export async function fetchLaunchFaaAirspace({
  launchId,
  limit = DEFAULT_ADVISORY_LIMIT
}: {
  launchId: string;
  limit?: number;
}): Promise<LaunchFaaAirspaceData | null> {
  return fetchLaunchFaaAirspaceCore(launchId, limit);
}

function isActiveInWindow(validStart: string | null, validEnd: string | null, nowMs: number) {
  const startMs = validStart ? Date.parse(validStart) : NaN;
  const endMs = validEnd ? Date.parse(validEnd) : NaN;
  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMs);

  if (hasStart && hasEnd) return nowMs >= startMs && nowMs < endMs;
  if (hasStart) return nowMs >= startMs;
  if (hasEnd) return nowMs < endMs;
  return false;
}

function buildNotamGraphicUrl(notamId: string | null | undefined) {
  const parsed = parseNotamId(notamId);
  if (!parsed) return null;
  const pageId = parsed.replace('/', '_');
  return `https://tfr.faa.gov/tfr3/?page=detail_${encodeURIComponent(pageId)}.html`;
}

function buildNotamRawUrl(notamId: string | null | undefined) {
  const id = normalizeNonEmptyString(notamId);
  if (!id) return null;
  return `https://tfr.faa.gov/tfrapi/getWebText?notamId=${encodeURIComponent(id)}`;
}

function parseNotamId(value: string | null | undefined) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return null;
  const direct = raw.match(/\b\d+\/\d+\b/);
  if (direct?.[0]) return direct[0];
  const underscore = raw.match(/\b(\d+)_(\d+)\b/);
  if (underscore?.[1] && underscore?.[2]) return `${underscore[1]}/${underscore[2]}`;
  return null;
}

function normalizeNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
