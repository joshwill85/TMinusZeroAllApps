type CoordinateTarget = {
  latitude?: number | null;
  longitude?: number | null;
  label?: string | null;
};

type GoogleMapsOptions = {
  zoom?: number;
};

type GoogleMapsStaticOptions = GoogleMapsOptions & {
  width?: number;
  height?: number;
  scale?: 1 | 2;
};

function toFiniteCoordinate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatCoordinate(value: number) {
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function readCoordinates(target: CoordinateTarget) {
  const latitude = toFiniteCoordinate(target.latitude);
  const longitude = toFiniteCoordinate(target.longitude);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

export function buildGoogleMapsSatelliteUrl(target: CoordinateTarget, options?: GoogleMapsOptions) {
  const coordinates = readCoordinates(target);
  if (!coordinates) return null;

  const url = new URL('https://www.google.com/maps/@');
  url.searchParams.set('api', '1');
  url.searchParams.set('map_action', 'map');
  url.searchParams.set('basemap', 'satellite');
  url.searchParams.set('center', `${formatCoordinate(coordinates.latitude)},${formatCoordinate(coordinates.longitude)}`);
  url.searchParams.set('zoom', String(clampInteger(options?.zoom ?? 18, 3, 21)));
  return url.toString();
}

export function buildAppleMapsSatelliteUrl(target: CoordinateTarget, options?: GoogleMapsOptions) {
  const coordinates = readCoordinates(target);
  if (!coordinates) return null;

  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('ll', `${formatCoordinate(coordinates.latitude)},${formatCoordinate(coordinates.longitude)}`);
  url.searchParams.set('t', 'k');
  url.searchParams.set('z', String(clampInteger(options?.zoom ?? 18, 3, 21)));
  const label = typeof target.label === 'string' ? target.label.trim() : '';
  if (label) {
    url.searchParams.set('q', label);
  }
  return url.toString();
}

export function buildGoogleMapsStaticSatelliteUrl(target: CoordinateTarget, apiKey: string, options?: GoogleMapsStaticOptions) {
  const coordinates = readCoordinates(target);
  const trimmedApiKey = apiKey.trim();
  if (!coordinates || !trimmedApiKey) return null;

  const width = clampInteger(options?.width ?? 640, 64, 640);
  const height = clampInteger(options?.height ?? 360, 64, 640);
  const scale = options?.scale === 2 ? 2 : 1;
  const zoom = clampInteger(options?.zoom ?? 18, 3, 21);
  const latLon = `${formatCoordinate(coordinates.latitude)},${formatCoordinate(coordinates.longitude)}`;

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', latLon);
  url.searchParams.set('zoom', String(zoom));
  url.searchParams.set('size', `${width}x${height}`);
  url.searchParams.set('scale', String(scale));
  url.searchParams.set('maptype', 'satellite');
  url.searchParams.set('format', 'jpg-baseline');
  url.searchParams.set('markers', `size:mid|color:0xff6b35|${latLon}`);
  url.searchParams.set('key', trimmedApiKey);
  return url.toString();
}

export function buildPadSatellitePreviewPath({
  launchId,
  ll2PadId
}: {
  launchId: string;
  ll2PadId?: number | null;
}) {
  const normalizedLaunchId = String(launchId || '').trim();
  if (!normalizedLaunchId) return null;

  if (typeof ll2PadId === 'number' && Number.isInteger(ll2PadId) && ll2PadId > 0) {
    const params = new URLSearchParams({ ll2PadId: String(ll2PadId) });
    return `/api/pad-satellite?${params.toString()}`;
  }

  const params = new URLSearchParams({ launchId: normalizedLaunchId });
  return `/api/pad-satellite?${params.toString()}`;
}

export function formatCoordinatePair(target: CoordinateTarget, precision = 5) {
  const coordinates = readCoordinates(target);
  if (!coordinates) return null;
  const boundedPrecision = clampInteger(precision, 0, 6);
  return `${coordinates.latitude.toFixed(boundedPrecision)}, ${coordinates.longitude.toFixed(boundedPrecision)}`;
}

export function isGoogleMapsUrl(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.toLowerCase().startsWith('/maps/');
  } catch {
    return false;
  }
}
