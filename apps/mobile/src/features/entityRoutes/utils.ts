export function readRouteParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractLabelFromSlug(value: string) {
  const decoded = decodeRouteSegment(String(value || '').trim());
  if (!decoded) return 'Unknown';
  const match = decoded.match(/^(.+)-\d+$/);
  const source = match?.[1] || decoded;
  return source
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function extractRouteNumericId(value: string) {
  const decoded = decodeRouteSegment(String(value || '').trim());
  if (!decoded) return null;
  if (/^\d+$/.test(decoded)) {
    const numeric = Number(decoded);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
  }
  const match = decoded.match(/-(\d+)$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function extractStrictRouteNumericId(value: string) {
  const decoded = decodeRouteSegment(String(value || '').trim());
  if (!decoded || !/^\d+$/.test(decoded)) {
    return null;
  }
  const numeric = Number(decoded);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function extractSlugSource(value: string) {
  const decoded = decodeRouteSegment(String(value || '').trim());
  if (!decoded) return '';
  const match = decoded.match(/^(.+)-\d+$/);
  return (match?.[1] || decoded).trim();
}

export function extractSearchTextFromSlug(value: string) {
  const source = extractSlugSource(value);
  return source.replace(/[-_]+/g, ' ').trim();
}
