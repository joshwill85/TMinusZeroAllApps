import type { Launch } from '@/lib/types/launch';
import { buildSlugId, slugify } from '@/lib/utils/slug';

export type LaunchLinkData = Pick<Launch, 'id' | 'name' | 'slug'>;

export function buildLaunchHref(launch: LaunchLinkData) {
  const slugSource = launch.slug || launch.name || '';
  const slugId = buildSlugId(slugSource, launch.id);
  return `/launches/${encodeURIComponent(slugId)}`;
}

export function buildRocketHref(launch: Launch, rocketLabel?: string) {
  const label = rocketLabel || launch.rocket?.fullName || launch.vehicle || 'rocket';
  const rocketId = launch.ll2RocketConfigId != null ? String(launch.ll2RocketConfigId) : null;
  if (rocketId) {
    const slugId = buildSlugId(label, rocketId);
    return `/rockets/${encodeURIComponent(slugId)}`;
  }
  const slug = slugify(label);
  return `/rockets/${encodeURIComponent(slug || label)}`;
}

export function buildLocationHref(launch: Launch) {
  const pad = launch.pad;
  const locationName = pad.locationName?.trim();
  const padFallback = pad.shortCode && pad.shortCode !== 'Pad' ? pad.shortCode : pad.name;
  const label = locationName || padFallback || 'location';
  const locationId = launch.ll2PadId != null ? String(launch.ll2PadId) : null;
  if (locationId) {
    const slugId = buildSlugId(label, locationId);
    return `/locations/${encodeURIComponent(slugId)}`;
  }
  const slug = slugify(label);
  return `/locations/${encodeURIComponent(slug || label)}`;
}

export function buildProviderHref(provider?: string | null) {
  const name = provider?.trim();
  if (!name || name.toLowerCase() === 'unknown') return null;
  const slug = toProviderSlug(name);
  if (!slug) return null;
  return `/providers/${encodeURIComponent(slug)}`;
}

export function toProviderSlug(provider: string) {
  return provider
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 64);
}
