import { Launch } from '@/lib/types/launch';
import { isCountdownEligible } from '@/lib/time';
import { BRAND_NAME } from '@/lib/brand';

const DEFAULT_TIMEZONE = 'America/New_York';

export function buildLaunchShare(launch: Launch) {
  const title = `${launch.name} | ${BRAND_NAME}`;
  const netLabel = formatShareNet(launch);
  const padLabel = [launch.pad?.shortCode, launch.pad?.state].filter(Boolean).join(' ');
  const statusLabel = launch.statusText || launch.status;

  const parts = [
    launch.provider,
    launch.vehicle,
    padLabel ? `Pad ${padLabel}` : null,
    netLabel ? `NET ${netLabel}` : null,
    statusLabel ? `Status ${statusLabel}` : null
  ].filter(Boolean);
  const cacheVersion = launch.cacheGeneratedAt || launch.lastUpdated || '';
  const params = new URLSearchParams();
  if (cacheVersion) params.set('v', cacheVersion);
  const query = params.toString();
  const path = `/share/launch/${launch.id}${query ? `?${query}` : ''}`;

  return {
    title,
    text: parts.join(' • '),
    path
  };
}

function formatShareNet(launch: Launch) {
  if (!launch.net) return '';
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return '';
  const tz = launch.pad?.timezone || DEFAULT_TIMEZONE;

  if (!isCountdownEligible(launch)) {
    const day = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: tz
    }).format(date);
    return `${day} • Time TBD`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short'
  }).format(date);
}
