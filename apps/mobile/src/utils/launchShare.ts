import { Share } from 'react-native';
import { getPublicSiteUrl } from '@/src/config/api';
import { formatTimestamp } from '@/src/utils/format';

const BRAND_NAME = 'T-Minus Zero';

export type LaunchShareInput = {
  id: string;
  name: string;
  net: string | null | undefined;
  provider?: string | null | undefined;
  vehicle?: string | null | undefined;
  statusText?: string | null | undefined;
  status?: string | null | undefined;
  padLabel?: string | null | undefined;
  padLocation?: string | null | undefined;
};

export function buildLaunchShareDescriptor(launch: LaunchShareInput) {
  const padDetails = [normalizePart(launch.padLabel), normalizePart(launch.padLocation)].filter(Boolean).join(' ');
  const netLabel = launch.net ? formatTimestamp(launch.net) : null;
  const statusLabel = normalizePart(launch.statusText) || normalizePart(launch.status);
  const text = [
    normalizePart(launch.provider),
    normalizePart(launch.vehicle),
    padDetails ? `Pad ${padDetails}` : null,
    netLabel ? `NET ${netLabel}` : null,
    statusLabel ? `Status ${statusLabel}` : null
  ]
    .filter(Boolean)
    .join(' • ');
  const url = `${getPublicSiteUrl()}/share/launch/${encodeURIComponent(launch.id)}`;

  return {
    title: launch.name,
    text,
    url,
    message: [launch.name, text || null, url].filter(Boolean).join('\n'),
    subject: `${launch.name} | ${BRAND_NAME}`
  };
}

export async function shareLaunch(launch: LaunchShareInput) {
  const descriptor = buildLaunchShareDescriptor(launch);
  return Share.share(
    {
      title: descriptor.title,
      message: descriptor.message,
      url: descriptor.url
    },
    {
      dialogTitle: 'Share launch',
      subject: descriptor.subject
    }
  );
}

function normalizePart(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}
