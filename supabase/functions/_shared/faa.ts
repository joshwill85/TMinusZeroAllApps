export const FAA_USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';

export type DateWindow = {
  validStart: string | null;
  validEnd: string | null;
  source: string | null;
};

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
