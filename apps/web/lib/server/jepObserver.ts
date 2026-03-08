import { createHash } from 'node:crypto';

const OBSERVER_BUCKET_DEG = 0.1;

export type JepObserver = {
  latDeg: number;
  lonDeg: number;
  latBucket: number;
  lonBucket: number;
  locationHash: string;
  source: 'query' | 'header' | 'provided';
};

type HeaderLike = {
  get(name: string): string | null;
};

export function resolveJepObserverFromUrl(url: URL): JepObserver | null {
  const latRaw = pickFirst(url.searchParams, ['observer_lat', 'lat', 'latitude']);
  const lonRaw = pickFirst(url.searchParams, ['observer_lon', 'lon', 'longitude']);
  if (!latRaw || !lonRaw) return null;
  return normalizeJepObserver(latRaw, lonRaw, 'query');
}

export function resolveJepObserverFromHeaders(headers: HeaderLike): JepObserver | null {
  const latRaw =
    headers.get('x-observer-lat') ||
    headers.get('x-vercel-ip-latitude') ||
    headers.get('cf-ipcity-latitude') ||
    '';
  const lonRaw =
    headers.get('x-observer-lon') ||
    headers.get('x-vercel-ip-longitude') ||
    headers.get('cf-ipcity-longitude') ||
    '';
  if (!latRaw || !lonRaw) return null;
  return normalizeJepObserver(latRaw, lonRaw, 'header');
}

export function resolveJepObserverFromBody(body: unknown): JepObserver | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  const latRaw = pickFirstRecord(payload, ['observer_lat', 'observerLat', 'lat', 'latitude']);
  const lonRaw = pickFirstRecord(payload, ['observer_lon', 'observerLon', 'lon', 'longitude']);
  if (latRaw == null || lonRaw == null) return null;
  return normalizeJepObserver(latRaw, lonRaw, 'provided');
}

export function normalizeJepObserver(
  latInput: number | string,
  lonInput: number | string,
  source: JepObserver['source']
): JepObserver | null {
  const lat = toFinite(latInput);
  const lon = toFinite(lonInput);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const latBucket = bucket(lat, OBSERVER_BUCKET_DEG, -90, 90);
  const lonBucket = bucket(lon, OBSERVER_BUCKET_DEG, -180, 180);
  const locationHash = buildJepObserverHash(latBucket, lonBucket);

  return {
    latDeg: lat,
    lonDeg: lon,
    latBucket,
    lonBucket,
    locationHash,
    source
  };
}

export function buildJepObserverHash(latBucket: number, lonBucket: number) {
  const payload = `${latBucket.toFixed(3)},${lonBucket.toFixed(3)}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function pickFirst(searchParams: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function pickFirstRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toFinite(value: number | string) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bucket(value: number, step: number, min: number, max: number) {
  const snapped = Math.round(value / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return Math.round(clamped * 1000) / 1000;
}
