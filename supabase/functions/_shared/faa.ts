export const FAA_USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateWindow = {
  validStart: string | null;
  validEnd: string | null;
  source: string | null;
};

export type DateWindowPrecision = 'none' | 'date' | 'datetime';

export type GeometryBBox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type GeoPoint = { lat: number; lon: number };

export function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseNotamId(value: unknown): string | null {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return null;
  const direct = raw.match(/\b\d+\/\d+\b/);
  if (direct?.[0]) return direct[0];
  const underscore = raw.match(/\b(\d+)_(\d+)\b/);
  if (underscore) return `${underscore[1]}/${underscore[2]}`;
  return null;
}

export function parseNotamIdFromSourceKey(sourceKey: string | null | undefined): string | null {
  const raw = normalizeNonEmptyString(sourceKey);
  if (!raw) return null;
  return parseNotamId(raw);
}

export function parseModAbsTime(value: unknown): string | null {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return null;
  if (!/^\d{12}$/.test(raw)) return null;

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));

  if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)).toISOString();
}

export function parseDateWindowFromText(text: string | null | undefined): DateWindow {
  const raw = normalizeNonEmptyString(text);
  if (!raw) return { validStart: null, validEnd: null, source: null };

  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();

  const throughPattern = /([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\s+through\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\s*(UTC|LOCAL)?/i;
  const through = normalized.match(throughPattern);
  if (through) {
    const start = parseDateCandidate(through[1], through[3]);
    const endDate = parseDateCandidate(through[2], through[3]);
    if (start && endDate) {
      return {
        validStart: toStartOfDayUtc(start).toISOString(),
        validEnd: toStartOfNextDayUtc(endDate).toISOString(),
        source: through[0]
      };
    }
  }

  const dashPattern = /([A-Za-z]+\s+\d{1,2}\s*,?\s*\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2}\s*,?\s*\d{4})\s*(UTC|LOCAL)?/i;
  const dash = normalized.match(dashPattern);
  if (dash) {
    const start = parseDateCandidate(dash[1], dash[3]);
    const endDate = parseDateCandidate(dash[2], dash[3]);
    if (start && endDate) {
      return {
        validStart: toStartOfDayUtc(start).toISOString(),
        validEnd: toStartOfNextDayUtc(endDate).toISOString(),
        source: dash[0]
      };
    }
  }

  const singlePattern = /([A-Za-z]+,\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*(UTC|LOCAL)?/i;
  const single = normalized.match(singlePattern);
  if (single) {
    const date = parseDateCandidate(single[2], single[3]);
    if (date) {
      return {
        validStart: toStartOfDayUtc(date).toISOString(),
        validEnd: toStartOfNextDayUtc(date).toISOString(),
        source: single[0]
      };
    }
  }

  return { validStart: null, validEnd: null, source: null };
}

export function parseFaaNotamDetailWindow({
  webText,
  notamText
}: {
  webText?: string | null;
  notamText?: string | null;
}): DateWindow {
  const htmlLines = htmlishTextLines(webText);
  const fieldStart = extractLabeledDateTime(htmlLines, 'Beginning Date and Time');
  const fieldEnd = extractLabeledDateTime(htmlLines, 'Ending Date and Time');

  const preciseCandidates: DateWindow[] = [];
  if (fieldStart || fieldEnd) {
    preciseCandidates.push({
      validStart: fieldStart,
      validEnd: fieldEnd,
      source: 'detail_fields'
    });
  }

  const preciseText = [normalizeNonEmptyString(notamText), htmlLines.join('\n')].filter(Boolean).join('\n');
  const effectivePairs = extractEffectiveUtcPairs(preciseText);
  if (effectivePairs.length) {
    preciseCandidates.push(buildUtcRangeWindow(effectivePairs, 'effective_utc'));
  }

  const numericPairs = extractNumericUtcPairs(preciseText);
  if (numericPairs.length) {
    preciseCandidates.push(buildUtcRangeWindow(numericPairs, 'utc_minute_range'));
  }

  const mergedPrecise = mergeDateWindows(preciseCandidates);
  if (mergedPrecise) return mergedPrecise;

  return parseDateWindowFromText([normalizeNonEmptyString(notamText), stripHtmlishToText(webText)].filter(Boolean).join('\n'));
}

export function inferDateWindowPrecision(
  validStart: string | null | undefined,
  validEnd: string | null | undefined
): DateWindowPrecision {
  const start = normalizeNonEmptyString(validStart);
  const end = normalizeNonEmptyString(validEnd);
  if (!start && !end) return 'none';

  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  const startDateOnly = isDateOnlyInstant(startMs);
  const endDateOnly = isDateOnlyInstant(endMs);

  if ((start && !Number.isFinite(startMs)) || (end && !Number.isFinite(endMs))) return 'datetime';
  if ((startDateOnly || !start) && (endDateOnly || !end)) {
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const deltaMs = endMs - startMs;
      if (deltaMs % DAY_MS === 0) return 'date';
    }
    if ((start && startDateOnly) || (end && endDateOnly)) return 'date';
  }

  return 'datetime';
}

function parseDateCandidate(value: string, timezoneHint: string | undefined): Date | null {
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .trim();

  const variants = [normalized];
  if (/^[A-Za-z]+\s+\d{1,2}\s+\d{4}$/.test(normalized)) {
    variants.push(normalized.replace(/^([A-Za-z]+\s+\d{1,2})\s+(\d{4})$/, '$1, $2'));
  }

  if (timezoneHint && timezoneHint.toUpperCase() === 'UTC') {
    variants.push(...variants.map((entry) => `${entry} UTC`));
  }

  for (const candidate of variants) {
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) return new Date(ms);
  }

  return null;
}

function parseFaaUtcDateTimeText(value: string | null | undefined): string | null {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return null;

  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .trim();

  const match =
    normalized.match(/([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+at\s+(\d{3,4})\s+UTC/i) ||
    normalized.match(/([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{3,4})\s+UTC/i);
  if (!match) return null;

  const date = parseDateCandidate(match[1], 'UTC');
  if (!date) return null;

  const hhmm = match[2].padStart(4, '0');
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0)).toISOString();
}

function parseUtcCompactDateTime(value: string): string | null {
  const raw = value.trim();
  if (!/^\d{10}$/.test(raw)) return null;

  const year = 2000 + Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  const hour = Number(raw.slice(6, 8));
  const minute = Number(raw.slice(8, 10));

  if (![year, month, day, hour, minute].every((entry) => Number.isFinite(entry))) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)).toISOString();
}

function extractLabeledDateTime(lines: string[], label: string) {
  const normalizedLabel = normalizeLabel(label);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeLabel(line);

    if (normalizedLine === normalizedLabel) {
      for (let probe = index + 1; probe < Math.min(lines.length, index + 4); probe += 1) {
        const parsed = parseFaaUtcDateTimeText(lines[probe]);
        if (parsed) return parsed;
      }
      continue;
    }

    const inlineMatch = line.match(new RegExp(`^${escapeRegex(label)}\\s*:?\\s*(.+)$`, 'i'));
    if (inlineMatch?.[1]) {
      const parsed = parseFaaUtcDateTimeText(inlineMatch[1]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function extractEffectiveUtcPairs(text: string) {
  const out: Array<{ validStart: string; validEnd: string }> = [];
  const pattern = /EFFECTIVE\s+(\d{10})\s+UTC[\s\S]{0,160}?UNTIL\s+(\d{10})\s+UTC/gi;
  for (const match of text.matchAll(pattern)) {
    const validStart = parseUtcCompactDateTime(match[1]);
    const validEnd = parseUtcCompactDateTime(match[2]);
    if (!validStart || !validEnd) continue;
    out.push({ validStart, validEnd });
  }
  return out;
}

function extractNumericUtcPairs(text: string) {
  const out: Array<{ validStart: string; validEnd: string }> = [];
  const pattern = /\b(\d{10})-(\d{10})\b/g;
  for (const match of text.matchAll(pattern)) {
    const validStart = parseUtcCompactDateTime(match[1]);
    const validEnd = parseUtcCompactDateTime(match[2]);
    if (!validStart || !validEnd) continue;
    out.push({ validStart, validEnd });
  }
  return out;
}

function buildUtcRangeWindow(pairs: Array<{ validStart: string; validEnd: string }>, source: string): DateWindow {
  const startMs = pairs.map((pair) => Date.parse(pair.validStart)).filter(Number.isFinite);
  const endMs = pairs.map((pair) => Date.parse(pair.validEnd)).filter(Number.isFinite);
  if (!startMs.length || !endMs.length) {
    return { validStart: null, validEnd: null, source: null };
  }

  return {
    validStart: new Date(Math.min(...startMs)).toISOString(),
    validEnd: new Date(Math.max(...endMs)).toISOString(),
    source
  };
}

function mergeDateWindows(windows: DateWindow[]) {
  const precise = windows.filter((window) => inferDateWindowPrecision(window.validStart, window.validEnd) === 'datetime');
  if (!precise.length) return null;

  const startMs = precise
    .map((window) => (window.validStart ? Date.parse(window.validStart) : NaN))
    .filter((value) => Number.isFinite(value));
  const endMs = precise
    .map((window) => (window.validEnd ? Date.parse(window.validEnd) : NaN))
    .filter((value) => Number.isFinite(value));
  const sources = Array.from(new Set(precise.map((window) => normalizeNonEmptyString(window.source)).filter(Boolean)));

  return {
    validStart: startMs.length ? new Date(Math.min(...startMs)).toISOString() : null,
    validEnd: endMs.length ? new Date(Math.max(...endMs)).toISOString() : null,
    source: sources.length ? sources.join('+') : null
  };
}

function htmlishTextLines(value: string | null | undefined) {
  const stripped = stripHtmlishToText(value);
  if (!stripped) return [];
  return stripped
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripHtmlishToText(value: string | null | undefined) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return '';

  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|td|th|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+:/g, '')
    .replace(/:+$/g, '')
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDateOnlyInstant(timestampMs: number) {
  if (!Number.isFinite(timestampMs)) return false;
  const date = new Date(timestampMs);
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function toStartOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toStartOfNextDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
}

export function bboxFromGeometry(geometry: unknown): GeometryBBox | null {
  const points = geometryCoordinatePairs(geometry);
  if (!points.length) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    minLat = Math.min(minLat, lat);
    minLon = Math.min(minLon, lon);
    maxLat = Math.max(maxLat, lat);
    maxLon = Math.max(maxLon, lon);
  }

  if (![minLat, minLon, maxLat, maxLon].every((n) => Number.isFinite(n))) return null;
  return { minLat, minLon, maxLat, maxLon };
}

export function geometryPointCount(geometry: unknown): number {
  return geometryCoordinatePairs(geometry).length;
}

function geometryCoordinatePairs(geometry: unknown): Array<[number, number]> {
  if (!geometry || typeof geometry !== 'object') return [];
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  const out: Array<[number, number]> = [];
  walkCoordinates(coordinates, out);
  return out;
}

function walkCoordinates(node: unknown, out: Array<[number, number]>) {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    out.push([node[0], node[1]]);
    return;
  }
  for (const child of node) {
    walkCoordinates(child, out);
  }
}

export function pointInBoundingBox(point: GeoPoint, bbox: GeometryBBox | null, paddingDeg = 0): boolean {
  if (!bbox) return false;
  return (
    point.lat >= bbox.minLat - paddingDeg &&
    point.lat <= bbox.maxLat + paddingDeg &&
    point.lon >= bbox.minLon - paddingDeg &&
    point.lon <= bbox.maxLon + paddingDeg
  );
}

export function pointInGeometry(point: GeoPoint, geometry: unknown): boolean {
  if (!geometry || typeof geometry !== 'object') return false;
  const kind = normalizeNonEmptyString((geometry as { type?: unknown }).type)?.toLowerCase();
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;

  if (kind === 'polygon' && Array.isArray(coordinates)) {
    return pointInPolygonRings(point, coordinates as unknown[]);
  }

  if (kind === 'multipolygon' && Array.isArray(coordinates)) {
    return (coordinates as unknown[]).some((polygon) => Array.isArray(polygon) && pointInPolygonRings(point, polygon as unknown[]));
  }

  return false;
}

function pointInPolygonRings(point: GeoPoint, rings: unknown[]): boolean {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  const shell = normalizeRing(rings[0]);
  if (!shell.length || !pointInRing(point, shell)) return false;

  for (let i = 1; i < rings.length; i += 1) {
    const hole = normalizeRing(rings[i]);
    if (hole.length && pointInRing(point, hole)) return false;
  }

  return true;
}

function normalizeRing(ring: unknown): Array<[number, number]> {
  if (!Array.isArray(ring)) return [];
  const points: Array<[number, number]> = [];
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    points.push([lon, lat]);
  }
  return points;
}

function pointInRing(point: GeoPoint, ring: Array<[number, number]>): boolean {
  let inside = false;
  const x = point.lon;
  const y = point.lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

export function buildNotamSourceUrl(notamId: string | null | undefined): string | null {
  const id = parseNotamId(notamId);
  if (!id) return null;
  return `https://tfr.faa.gov/tfrapi/getWebText?notamId=${encodeURIComponent(id)}`;
}

export function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'n' || normalized === 'no' || normalized === 'false' || normalized === '0') return false;
  return null;
}
