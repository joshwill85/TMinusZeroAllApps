import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

const DEFAULT_ADVISORY_LIMIT = 6;
const DEFAULT_MAP_ADVISORY_LIMIT = 8;
const MAX_ADVISORY_FETCH = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LAUNCH_ADVISORY_WINDOW_MS = 7 * DAY_MS;

type LaunchMatchStatus = 'matched' | 'ambiguous' | 'unmatched' | 'manual';

type LaunchMatchRow = {
  id: string;
  launch_id: string;
  faa_tfr_record_id: string;
  faa_tfr_shape_id: string | null;
  match_status: LaunchMatchStatus;
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

type ShapeSummaryRow = {
  id: string;
  faa_tfr_record_id: string;
};

type ShapeGeometryRow = ShapeSummaryRow & {
  geometry: Record<string, unknown> | null;
  bbox_min_lat: number | null;
  bbox_min_lon: number | null;
  bbox_max_lat: number | null;
  bbox_max_lon: number | null;
};

type LaunchWindowRow = {
  launch_id: string;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_timezone: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  pad_name: string | null;
  pad_short_code: string | null;
  location_name: string | null;
};

type NotamDetailRow = {
  notam_id: string;
  parsed: Record<string, unknown> | null;
  fetched_at: string | null;
  web_text: string | null;
  notam_text: string | null;
};

type ParsedNotamDetail = {
  validStart: string | null;
  validEnd: string | null;
  rawText: string | null;
  fetchedAt: string | null;
};

type LaunchTimingContext = {
  startIso: string;
  endIso: string;
  timezone: string | null;
  localDateKeys: string[];
};

type LaunchFaaAirspaceSnapshot = {
  launchId: string;
  generatedAt: string;
  launchRow: LaunchWindowRow | null;
  launchTiming: LaunchTimingContext | null;
  advisories: LaunchFaaAirspaceAdvisory[];
  shapesByRecordId: Map<string, ShapeGeometryRow[]>;
  shapeById: Map<string, ShapeGeometryRow>;
};

export type LaunchFaaAirspaceAdvisory = {
  matchId: string;
  launchId: string;
  tfrRecordId: string;
  tfrShapeId: string | null;
  matchStatus: LaunchMatchStatus;
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
  rawText: string | null;
  rawTextFetchedAt: string | null;
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

export type LaunchFaaAirspaceMapPoint = {
  latitude: number;
  longitude: number;
};

export type LaunchFaaAirspaceMapBounds = {
  minLatitude: number;
  minLongitude: number;
  maxLatitude: number;
  maxLongitude: number;
};

export type LaunchFaaAirspaceMapPolygon = {
  polygonId: string;
  outerRing: LaunchFaaAirspaceMapPoint[];
  holes: LaunchFaaAirspaceMapPoint[][];
  bounds: LaunchFaaAirspaceMapBounds | null;
};

export type LaunchFaaAirspaceMapPad = {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  shortCode: string | null;
  locationName: string | null;
};

export type LaunchFaaAirspaceMapAdvisory = LaunchFaaAirspaceAdvisory & {
  polygons: LaunchFaaAirspaceMapPolygon[];
};

export type LaunchFaaAirspaceMapData = {
  launchId: string;
  generatedAt: string;
  advisoryCount: number;
  hasRenderableGeometry: boolean;
  pad: LaunchFaaAirspaceMapPad;
  bounds: LaunchFaaAirspaceMapBounds | null;
  advisories: LaunchFaaAirspaceMapAdvisory[];
};

export async function fetchLaunchFaaAirspace({
  launchId,
  limit = DEFAULT_ADVISORY_LIMIT
}: {
  launchId: string;
  limit?: number;
}): Promise<LaunchFaaAirspaceData | null> {
  const snapshot = await loadLaunchFaaAirspaceSnapshot({
    launchId,
    limit,
    matchStatuses: ['matched', 'ambiguous', 'manual'],
    includeShapeGeometry: false
  });
  if (!snapshot) return null;

  return {
    launchId: snapshot.launchId,
    generatedAt: snapshot.generatedAt,
    hasPotentialRestrictions: snapshot.advisories.some((entry) => entry.matchStatus === 'matched' || entry.matchStatus === 'ambiguous'),
    advisories: snapshot.advisories
  };
}

export async function fetchLaunchFaaAirspaceMap({
  launchId,
  limit = DEFAULT_MAP_ADVISORY_LIMIT
}: {
  launchId: string;
  limit?: number;
}): Promise<LaunchFaaAirspaceMapData | null> {
  const snapshot = await loadLaunchFaaAirspaceSnapshot({
    launchId,
    limit,
    matchStatuses: ['matched', 'manual'],
    includeShapeGeometry: true
  });
  if (!snapshot) return null;

  const advisories = snapshot.advisories.map((advisory) => ({
    ...advisory,
    polygons: buildMapPolygonsForAdvisory(advisory, snapshot.shapeById, snapshot.shapesByRecordId)
  }));
  const bounds = computeMapBounds(
    advisories.flatMap((advisory) => advisory.polygons.map((polygon) => polygon.bounds)),
    snapshot.launchRow?.pad_latitude ?? null,
    snapshot.launchRow?.pad_longitude ?? null
  );

  return {
    launchId: snapshot.launchId,
    generatedAt: snapshot.generatedAt,
    advisoryCount: advisories.length,
    hasRenderableGeometry: advisories.some((advisory) => advisory.polygons.length > 0),
    pad: {
      latitude: toFiniteNumber(snapshot.launchRow?.pad_latitude),
      longitude: toFiniteNumber(snapshot.launchRow?.pad_longitude),
      label:
        normalizeNonEmptyString(snapshot.launchRow?.pad_short_code) ||
        normalizeNonEmptyString(snapshot.launchRow?.pad_name) ||
        normalizeNonEmptyString(snapshot.launchRow?.location_name),
      shortCode: normalizeNonEmptyString(snapshot.launchRow?.pad_short_code),
      locationName: normalizeNonEmptyString(snapshot.launchRow?.location_name)
    },
    bounds,
    advisories
  };
}

async function loadLaunchFaaAirspaceSnapshot({
  launchId,
  limit,
  matchStatuses,
  includeShapeGeometry
}: {
  launchId: string;
  limit: number;
  matchStatuses: LaunchMatchStatus[];
  includeShapeGeometry: boolean;
}): Promise<LaunchFaaAirspaceSnapshot | null> {
  if (!isSupabaseConfigured()) return null;
  if (!launchId) return null;

  const advisoryLimit = clampInt(limit, 1, MAX_ADVISORY_FETCH);
  const normalizedStatuses = Array.from(new Set(matchStatuses.filter(Boolean)));
  if (!normalizedStatuses.length) return null;

  const supabase = createSupabasePublicClient();
  const generatedAt = new Date().toISOString();

  const [{ data: matchRows, error: matchError }, { data: launchRow, error: launchError }] = await Promise.all([
    supabase
      .from('faa_launch_matches')
      .select(
        'id, launch_id, faa_tfr_record_id, faa_tfr_shape_id, match_status, match_confidence, match_score, match_strategy, match_meta, matched_at'
      )
      .eq('launch_id', launchId)
      .in('match_status', normalizedStatuses)
      .order('match_confidence', { ascending: false, nullsFirst: false })
      .order('matched_at', { ascending: false })
      .limit(MAX_ADVISORY_FETCH),
    supabase
      .from('launches_public_cache')
      .select('launch_id, net, window_start, window_end, pad_timezone, pad_latitude, pad_longitude, pad_name, pad_short_code, location_name')
      .eq('launch_id', launchId)
      .maybeSingle()
  ]);

  if (matchError) {
    console.error('faa airspace match query error', matchError);
    return null;
  }
  if (launchError) {
    console.warn('faa airspace launch window query error', launchError);
  }

  const launchTiming = buildLaunchTimingContext((launchRow || null) as LaunchWindowRow | null);
  const matches = (matchRows || []) as LaunchMatchRow[];
  if (!matches.length) {
    return {
      launchId,
      generatedAt,
      launchRow: (launchRow || null) as LaunchWindowRow | null,
      launchTiming,
      advisories: [],
      shapesByRecordId: new Map(),
      shapeById: new Map()
    };
  }

  const recordIds = Array.from(new Set(matches.map((row) => row.faa_tfr_record_id).filter(Boolean)));
  if (!recordIds.length) {
    return {
      launchId,
      generatedAt,
      launchRow: (launchRow || null) as LaunchWindowRow | null,
      launchTiming,
      advisories: [],
      shapesByRecordId: new Map(),
      shapeById: new Map()
    };
  }

  const shapeSelect = includeShapeGeometry
    ? 'id, faa_tfr_record_id, geometry, bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon'
    : 'id, faa_tfr_record_id';
  const [{ data: recordRows, error: recordError }, { data: shapeRowsRaw, error: shapeError }] = await Promise.all([
    supabase
      .from('faa_tfr_records')
      .select(
        'id, notam_id, source_key, facility, state, type, legal, title, description, valid_start, valid_end, has_shape, status, mod_at'
      )
      .in('id', recordIds),
    supabase.from('faa_tfr_shapes').select(shapeSelect).in('faa_tfr_record_id', recordIds)
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
  const shapesByRecordId = new Map<string, ShapeGeometryRow[]>();
  const shapeById = new Map<string, ShapeGeometryRow>();
  const shapeRows = ((shapeRowsRaw || []) as unknown) as Array<ShapeSummaryRow | ShapeGeometryRow>;
  for (const row of shapeRows) {
    const currentCount = shapeCountByRecordId.get(row.faa_tfr_record_id) || 0;
    shapeCountByRecordId.set(row.faa_tfr_record_id, currentCount + 1);

    if (!includeShapeGeometry || !('geometry' in row)) continue;

    const geometryRow = row as ShapeGeometryRow;
    const bucket = shapesByRecordId.get(geometryRow.faa_tfr_record_id) || [];
    bucket.push(geometryRow);
    shapesByRecordId.set(geometryRow.faa_tfr_record_id, bucket);
    shapeById.set(geometryRow.id, geometryRow);
  }

  const notamDetailsByNotamId = await loadNotamDetails((recordRows || []) as TfrRecordRow[]);
  const nowMs = Date.now();

  const advisories = matches
    .map((match): LaunchFaaAirspaceAdvisory | null => {
      const record = recordById.get(match.faa_tfr_record_id);
      if (!record) return null;

      const notamDetail = notamDetailsByNotamId.get(normalizeNonEmptyString(record.notam_id) || '');
      const validStart = notamDetail?.validStart ?? normalizeNonEmptyString(record.valid_start);
      const validEnd = notamDetail?.validEnd ?? normalizeNonEmptyString(record.valid_end);
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
        validStart,
        validEnd,
        isActiveNow: isActiveInWindow(validStart, validEnd, nowMs),
        hasShape: Boolean(record.has_shape),
        shapeCount: shapeCountByRecordId.get(record.id) || 0,
        rawText: notamDetail?.rawText ?? null,
        rawTextFetchedAt: notamDetail?.fetchedAt ?? null,
        sourceGraphicUrl,
        sourceRawUrl,
        sourceUrl: sourceGraphicUrl || sourceRawUrl,
        matchMeta: isObject(match.match_meta) ? (match.match_meta as Record<string, unknown>) : null
      };
    })
    .filter((entry): entry is LaunchFaaAirspaceAdvisory => entry != null)
    .filter((entry) => advisoryAppliesToLaunchWindow(entry, launchTiming))
    .sort((a, b) => {
      if (a.isActiveNow !== b.isActiveNow) return a.isActiveNow ? -1 : 1;
      const aMatchRank = advisoryMatchRank(a.matchStatus);
      const bMatchRank = advisoryMatchRank(b.matchStatus);
      if (aMatchRank !== bMatchRank) return aMatchRank - bMatchRank;
      const aConfidence = typeof a.matchConfidence === 'number' ? a.matchConfidence : -1;
      const bConfidence = typeof b.matchConfidence === 'number' ? b.matchConfidence : -1;
      if (aConfidence !== bConfidence) return bConfidence - aConfidence;
      const aMs = a.validStart ? Date.parse(a.validStart) : Number.POSITIVE_INFINITY;
      const bMs = b.validStart ? Date.parse(b.validStart) : Number.POSITIVE_INFINITY;
      return aMs - bMs;
    })
    .slice(0, advisoryLimit);

  return {
    launchId,
    generatedAt,
    launchRow: (launchRow || null) as LaunchWindowRow | null,
    launchTiming,
    advisories,
    shapesByRecordId,
    shapeById
  };
}

function buildMapPolygonsForAdvisory(
  advisory: LaunchFaaAirspaceAdvisory,
  shapeById: Map<string, ShapeGeometryRow>,
  shapesByRecordId: Map<string, ShapeGeometryRow[]>
) {
  const selectedShapes: ShapeGeometryRow[] = [];
  if (advisory.tfrShapeId) {
    const matchedShape = shapeById.get(advisory.tfrShapeId);
    if (matchedShape) selectedShapes.push(matchedShape);
  }
  if (!selectedShapes.length) {
    selectedShapes.push(...(shapesByRecordId.get(advisory.tfrRecordId) || []));
  }

  return selectedShapes.flatMap((shape) => geometryRowToMapPolygons(shape));
}

function geometryRowToMapPolygons(shape: ShapeGeometryRow): LaunchFaaAirspaceMapPolygon[] {
  if (!isObject(shape.geometry)) return [];

  const type = normalizeNonEmptyString(shape.geometry.type);
  const coordinates = shape.geometry.coordinates;

  if (type === 'Polygon' && Array.isArray(coordinates)) {
    const polygon = normalizePolygonCoordinates(coordinates, `${shape.id}:0`);
    return polygon ? [polygon] : [];
  }

  if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
    return coordinates
      .map((polygonCoordinates, index) =>
        Array.isArray(polygonCoordinates) ? normalizePolygonCoordinates(polygonCoordinates, `${shape.id}:${index}`) : null
      )
      .filter((polygon): polygon is LaunchFaaAirspaceMapPolygon => polygon != null);
  }

  return [];
}

function normalizePolygonCoordinates(rawRings: unknown[], polygonId: string): LaunchFaaAirspaceMapPolygon | null {
  if (!Array.isArray(rawRings) || rawRings.length === 0) return null;

  const [outerRingRaw, ...holeRingsRaw] = rawRings;
  const outerRing = normalizeCoordinateRing(outerRingRaw);
  if (outerRing.length < 3) return null;

  const holes = holeRingsRaw.map((ring) => normalizeCoordinateRing(ring)).filter((ring) => ring.length >= 3);
  return {
    polygonId,
    outerRing,
    holes,
    bounds: computePolygonBounds(outerRing)
  };
}

function normalizeCoordinateRing(rawRing: unknown): LaunchFaaAirspaceMapPoint[] {
  if (!Array.isArray(rawRing)) return [];

  const points = rawRing.map((coordinate) => normalizeCoordinatePoint(coordinate)).filter((point): point is LaunchFaaAirspaceMapPoint => point != null);
  if (points.length < 3) return [];

  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && first.latitude === last.latitude && first.longitude === last.longitude) {
    points.pop();
  }

  return points.length >= 3 ? points : [];
}

function normalizeCoordinatePoint(rawCoordinate: unknown): LaunchFaaAirspaceMapPoint | null {
  if (!Array.isArray(rawCoordinate) || rawCoordinate.length < 2) return null;
  const longitude = toFiniteNumber(rawCoordinate[0]);
  const latitude = toFiniteNumber(rawCoordinate[1]);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function computePolygonBounds(points: LaunchFaaAirspaceMapPoint[]): LaunchFaaAirspaceMapBounds | null {
  let minLatitude = Number.POSITIVE_INFINITY;
  let minLongitude = Number.POSITIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }

  if (!Number.isFinite(minLatitude) || !Number.isFinite(minLongitude) || !Number.isFinite(maxLatitude) || !Number.isFinite(maxLongitude)) {
    return null;
  }

  return { minLatitude, minLongitude, maxLatitude, maxLongitude };
}

function computeMapBounds(
  polygonBounds: Array<LaunchFaaAirspaceMapBounds | null>,
  padLatitude: number | null,
  padLongitude: number | null
) {
  let minLatitude = Number.POSITIVE_INFINITY;
  let minLongitude = Number.POSITIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;

  for (const bounds of polygonBounds) {
    if (!bounds) continue;
    minLatitude = Math.min(minLatitude, bounds.minLatitude);
    minLongitude = Math.min(minLongitude, bounds.minLongitude);
    maxLatitude = Math.max(maxLatitude, bounds.maxLatitude);
    maxLongitude = Math.max(maxLongitude, bounds.maxLongitude);
  }

  const normalizedPadLatitude = toFiniteNumber(padLatitude);
  const normalizedPadLongitude = toFiniteNumber(padLongitude);
  if (normalizedPadLatitude != null && normalizedPadLongitude != null) {
    minLatitude = Math.min(minLatitude, normalizedPadLatitude);
    minLongitude = Math.min(minLongitude, normalizedPadLongitude);
    maxLatitude = Math.max(maxLatitude, normalizedPadLatitude);
    maxLongitude = Math.max(maxLongitude, normalizedPadLongitude);
  }

  if (!Number.isFinite(minLatitude) || !Number.isFinite(minLongitude) || !Number.isFinite(maxLatitude) || !Number.isFinite(maxLongitude)) {
    return null;
  }

  return { minLatitude, minLongitude, maxLatitude, maxLongitude };
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

function buildLaunchTimingContext(row: LaunchWindowRow | null): LaunchTimingContext | null {
  if (!row) return null;

  const startIso = normalizeNonEmptyString(row.window_start) || normalizeNonEmptyString(row.net);
  if (!startIso) return null;

  const endIso = normalizeNonEmptyString(row.window_end) || startIso;
  const timezone = normalizeNonEmptyString(row.pad_timezone);

  return {
    startIso,
    endIso,
    timezone,
    localDateKeys: enumerateLaunchLocalDateKeys(startIso, endIso, timezone)
  };
}

async function loadNotamDetails(recordRows: TfrRecordRow[]): Promise<Map<string, ParsedNotamDetail>> {
  const notamIds = Array.from(
    new Set(
      recordRows
        .map((row) => normalizeNonEmptyString(row.notam_id))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (!notamIds.length || !isSupabaseAdminConfigured()) {
    return new Map();
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('faa_notam_details')
    .select('notam_id, parsed, fetched_at, web_text, notam_text')
    .in('notam_id', notamIds)
    .order('fetched_at', { ascending: false });

  if (error) {
    console.warn('faa airspace notam detail query error', error);
    return new Map();
  }

  const detailByNotamId = new Map<string, ParsedNotamDetail>();
  for (const row of (data || []) as NotamDetailRow[]) {
    const notamId = normalizeNonEmptyString(row.notam_id);
    if (!notamId || detailByNotamId.has(notamId)) continue;

    const window = parseNotamDetailWindow(row.parsed);
    const rawText = normalizeNotamRawText(row.notam_text, row.web_text);
    if (!window.validStart && !window.validEnd && !rawText) continue;
    detailByNotamId.set(notamId, {
      validStart: window.validStart,
      validEnd: window.validEnd,
      rawText,
      fetchedAt: normalizeNonEmptyString(row.fetched_at)
    });
  }

  return detailByNotamId;
}

function parseNotamDetailWindow(parsed: Record<string, unknown> | null) {
  if (!isObject(parsed)) {
    return { validStart: null, validEnd: null };
  }

  const dateWindow = isObject(parsed.dateWindow) ? parsed.dateWindow : null;
  return {
    validStart: normalizeNonEmptyString(dateWindow?.validStart),
    validEnd: normalizeNonEmptyString(dateWindow?.validEnd)
  };
}

function normalizeNotamRawText(notamText: string | null, webText: string | null) {
  const primary = normalizeMultilineText(notamText);
  if (primary) return primary;
  const fallback = normalizeMultilineText(webText);
  if (!fallback) return null;
  return stripHtmlToPlainText(fallback);
}

function normalizeMultilineText(value: string | null | undefined) {
  const raw = typeof value === 'string' ? value : '';
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  return normalized.length ? normalized : null;
}

function stripHtmlToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function advisoryAppliesToLaunchWindow(advisory: LaunchFaaAirspaceAdvisory, launchTiming: LaunchTimingContext | null) {
  if (!launchTiming) return true;
  if (!advisory.validStart && !advisory.validEnd) return true;
  if (!isLaunchSpecificWindow(advisory.validStart, advisory.validEnd)) {
    return advisory.matchStatus === 'manual' || advisory.matchStatus === 'matched' || advisory.isActiveNow;
  }

  if (isDateOnlyUtcWindow(advisory.validStart, advisory.validEnd)) {
    const advisoryDateKeys = enumerateDateOnlyWindowKeys(advisory.validStart, advisory.validEnd);
    return advisoryDateKeys.some((key) => launchTiming.localDateKeys.includes(key));
  }

  return rangesOverlap(launchTiming.startIso, launchTiming.endIso, advisory.validStart, advisory.validEnd);
}

function rangesOverlap(
  leftStartIso: string | null,
  leftEndIso: string | null,
  rightStartIso: string | null,
  rightEndIso: string | null
) {
  const leftStartMs = leftStartIso ? Date.parse(leftStartIso) : NaN;
  const leftEndMs = leftEndIso ? Date.parse(leftEndIso) : NaN;
  const rightStartMs = rightStartIso ? Date.parse(rightStartIso) : NaN;
  const rightEndMs = rightEndIso ? Date.parse(rightEndIso) : NaN;

  const leftHasStart = Number.isFinite(leftStartMs);
  const leftHasEnd = Number.isFinite(leftEndMs);
  const rightHasStart = Number.isFinite(rightStartMs);
  const rightHasEnd = Number.isFinite(rightEndMs);

  const leftStart = leftHasStart ? leftStartMs : Number.NEGATIVE_INFINITY;
  const leftEnd = leftHasEnd ? normalizeExclusiveEnd(leftStartMs, leftEndMs) : Number.POSITIVE_INFINITY;
  const rightStart = rightHasStart ? rightStartMs : Number.NEGATIVE_INFINITY;
  const rightEnd = rightHasEnd ? normalizeExclusiveEnd(rightStartMs, rightEndMs) : Number.POSITIVE_INFINITY;

  return leftStart < rightEnd && rightStart < leftEnd;
}

function isLaunchSpecificWindow(validStart: string | null, validEnd: string | null) {
  const startMs = validStart ? Date.parse(validStart) : NaN;
  const endMs = validEnd ? Date.parse(validEnd) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return true;
  return endMs > startMs && endMs - startMs <= MAX_LAUNCH_ADVISORY_WINDOW_MS;
}

function normalizeExclusiveEnd(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return endMs;
  return endMs > startMs ? endMs : startMs + 1;
}

function enumerateLaunchLocalDateKeys(startIso: string, endIso: string, timezone: string | null) {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs)) return [];

  const out = new Set<string>();
  const resolvedTimezone = timezone || 'UTC';
  const endProbe = Number.isFinite(endMs) && endMs > startMs ? endMs - 1 : startMs;
  const totalMs = Math.max(0, endProbe - startMs);
  const steps = Math.max(1, Math.ceil(totalMs / (12 * 60 * 60 * 1000)) + 1);

  for (let index = 0; index < steps; index += 1) {
    const ratio = steps === 1 ? 0 : index / (steps - 1);
    const sampleMs = startMs + Math.round(totalMs * ratio);
    out.add(formatDateKey(sampleMs, resolvedTimezone));
  }

  return Array.from(out);
}

function enumerateDateOnlyWindowKeys(validStart: string | null, validEnd: string | null) {
  const startMs = validStart ? Date.parse(validStart) : NaN;
  const endMs = validEnd ? Date.parse(validEnd) : NaN;
  if (!Number.isFinite(startMs)) return [];

  const effectiveEndMs = Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + DAY_MS;
  const out: string[] = [];

  for (let currentMs = startMs; currentMs < effectiveEndMs; currentMs += DAY_MS) {
    out.push(new Date(currentMs).toISOString().slice(0, 10));
  }

  return out;
}

function formatDateKey(timestampMs: number, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestampMs));
}

function isDateOnlyUtcWindow(validStart: string | null, validEnd: string | null) {
  if (!validStart || !validEnd) return false;
  const start = new Date(validStart);
  const end = new Date(validEnd);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;

  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0 &&
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0 &&
    (endMs - startMs) % DAY_MS === 0
  );
}

function advisoryMatchRank(status: LaunchFaaAirspaceAdvisory['matchStatus']) {
  switch (status) {
    case 'manual':
      return 0;
    case 'matched':
      return 1;
    case 'ambiguous':
      return 2;
    default:
      return 3;
  }
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

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
