type CoordinateTarget = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  label?: string | null | undefined;
};

function normalizeCoordinate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTextValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatCoordinate(value: number) {
  return value.toFixed(6).replace(/\.?0+$/, '');
}

export function buildAppleMapsSatelliteUrl(target: CoordinateTarget) {
  const latitude = normalizeCoordinate(target.latitude);
  const longitude = normalizeCoordinate(target.longitude);
  if (latitude == null || longitude == null) {
    return null;
  }

  const params = new URLSearchParams({
    ll: `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`,
    t: 'k'
  });
  const label = normalizeTextValue(target.label);
  if (label) {
    params.set('q', label);
  }
  return `https://maps.apple.com/?${params.toString()}`;
}

export function buildGoogleMapsSatelliteUrl(target: CoordinateTarget, zoom = 18) {
  const latitude = normalizeCoordinate(target.latitude);
  const longitude = normalizeCoordinate(target.longitude);
  if (latitude == null || longitude == null) {
    return null;
  }

  const params = new URLSearchParams({
    api: '1',
    map_action: 'map',
    basemap: 'satellite',
    center: `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`,
    zoom: String(Math.max(3, Math.min(21, Math.round(zoom))))
  });
  return `https://www.google.com/maps/@?${params.toString()}`;
}

export function buildPlatformPadMapUrl(target: CoordinateTarget, platformOs: string) {
  if (platformOs === 'ios') {
    return buildAppleMapsSatelliteUrl(target);
  }
  return buildGoogleMapsSatelliteUrl(target);
}

export function isGoogleMapsUrl(value: string | null | undefined) {
  const normalized = normalizeTextValue(value);
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.toLowerCase().startsWith('/maps/');
  } catch {
    return false;
  }
}
