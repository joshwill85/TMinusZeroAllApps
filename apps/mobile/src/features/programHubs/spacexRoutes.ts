import type { SpaceXMissionKeyV1 } from '@tminuszero/api-client';

const SPACE_X_VEHICLE_SEGMENTS = new Set(['starship-super-heavy', 'falcon-9', 'falcon-heavy', 'dragon']);
const SPACE_X_ENGINE_SEGMENTS = new Set(['raptor', 'merlin-1d', 'merlin-vac', 'draco', 'superdraco']);

export const SPACE_X_VEHICLE_ENGINES: Record<string, string[]> = {
  'starship-super-heavy': ['raptor'],
  'falcon-9': ['merlin-1d', 'merlin-vac'],
  'falcon-heavy': ['merlin-1d', 'merlin-vac'],
  dragon: ['draco', 'superdraco']
};

export function normalizeSpaceXMissionParam(value: string | string[] | undefined) {
  const raw = takeFirst(value);
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  if (normalized === 'starship') return 'starship';
  if (normalized === 'falcon-9' || normalized === 'falcon9' || normalized === 'f9') return 'falcon-9';
  if (normalized === 'falcon-heavy' || normalized === 'falconheavy' || normalized === 'fh') return 'falcon-heavy';
  if (normalized === 'dragon' || normalized === 'crew-dragon' || normalized === 'cargo-dragon') return 'dragon';
  return null;
}

export function normalizeSpaceXFlightParam(value: string | string[] | undefined) {
  const normalized = takeFirst(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');

  if (!normalized || !normalized.includes('-')) return null;
  return normalized;
}

export function normalizeSpaceXVehicleParam(value: string | string[] | undefined) {
  const normalized = takeFirst(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return SPACE_X_VEHICLE_SEGMENTS.has(normalized) ? normalized : null;
}

export function normalizeSpaceXEngineParam(value: string | string[] | undefined) {
  const normalized = takeFirst(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return SPACE_X_ENGINE_SEGMENTS.has(normalized) ? normalized : null;
}

export function normalizeSpaceXContractParam(value: string | string[] | undefined) {
  const normalized = takeFirst(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 128);

  return normalized || null;
}

export function buildSpaceXMissionHref(mission: SpaceXMissionKeyV1) {
  return mission === 'spacex-program' ? '/spacex' : `/spacex/missions/${mission}`;
}

export function buildSpaceXFlightHref(flightSlug: string) {
  return `/spacex/flights/${encodeURIComponent(normalizeSpaceXFlightParam(flightSlug) || flightSlug)}`;
}

export function buildSpaceXVehicleHref(vehicleSlug: string) {
  return `/spacex/vehicles/${encodeURIComponent(normalizeSpaceXVehicleParam(vehicleSlug) || vehicleSlug)}`;
}

export function buildSpaceXEngineHref(engineSlug: string) {
  return `/spacex/engines/${encodeURIComponent(normalizeSpaceXEngineParam(engineSlug) || engineSlug)}`;
}

export function buildSpaceXContractHref(contractKey: string) {
  return `/spacex/contracts/${encodeURIComponent(normalizeSpaceXContractParam(contractKey) || 'contract')}`;
}

export function spaceXMissionLabel(mission: SpaceXMissionKeyV1) {
  if (mission === 'spacex-program') return 'SpaceX Program';
  if (mission === 'starship') return 'Starship';
  if (mission === 'falcon-9') return 'Falcon 9';
  if (mission === 'falcon-heavy') return 'Falcon Heavy';
  return 'Dragon';
}

function takeFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}
