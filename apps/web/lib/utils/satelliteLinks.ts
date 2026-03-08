import { getSatelliteOwnerAlias } from '@/lib/constants/satelliteOwnerAliases';

const OWNER_CODE_PATTERN = /^[A-Z0-9-]{1,32}$/;

export function buildSatelliteHref(noradCatId: number | string) {
  return `/satellites/${encodeURIComponent(String(noradCatId))}`;
}

export function buildSatelliteOwnerHref(ownerCode: string) {
  const normalized = normalizeSatelliteOwnerCode(ownerCode);
  if (!normalized) return null;
  return `/satellites/owners/${encodeURIComponent(normalized.toLowerCase())}`;
}

export function normalizeSatelliteOwnerCode(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (!OWNER_CODE_PATTERN.test(normalized)) return null;
  return normalized;
}

export function parseSatelliteOwnerParam(value: string) {
  const decoded = safeDecode(value).trim();
  return normalizeSatelliteOwnerCode(decoded);
}

export function formatSatelliteOwnerLabel(ownerCode: string | null | undefined) {
  const normalized = normalizeSatelliteOwnerCode(ownerCode);
  if (!normalized) return null;
  const alias = getSatelliteOwnerAlias(normalized);
  return alias ? `${alias} (${normalized})` : normalized;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
