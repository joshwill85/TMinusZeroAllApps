const SPACEX_CONTENT_BASE_URL = 'https://content.spacex.com/api/spacex-website';
const DEFAULT_USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';

export type SpaceXCmsAsset = {
  url: string;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  ext?: string | null;
  hash?: string | null;
  formats?: Record<string, { url?: string | null; width?: number | null; height?: number | null }>;
};

export type SpaceXLaunchTile = {
  id?: number;
  title?: string | null;
  link?: string | null; // SpaceX missionId / page slug (e.g. "sl-6-100")
  missionStatus?: string | null;
  vehicle?: string | null;
  returnSite?: string | null;
  launchSite?: string | null;
  launchDate?: string | null; // YYYY-MM-DD
  launchTime?: string | null; // HH:MM:SS
  missionType?: string | null;
};

export type SpaceXMission = {
  missionId: string;
  title?: string | null;
  callToAction?: string | null;
  infographicDesktop?: SpaceXCmsAsset | null;
  infographicMobile?: SpaceXCmsAsset | null;
};

export function getSpaceXWebsiteLaunchPageUrl(missionId: string) {
  const safe = (missionId || '').trim();
  return safe ? `https://www.spacex.com/launches/${encodeURIComponent(safe)}` : null;
}

export function extractSpaceXMissionIdFromLaunchUrl(url: string | null | undefined) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }

  if (!parsed) return null;

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'spacex.com') return null;

  const parts = parsed.pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
  const launchesIndex = parts.findIndex((segment) => segment.toLowerCase() === 'launches');
  if (launchesIndex === -1 || launchesIndex >= parts.length - 1) return null;

  const missionId = decodeURIComponent(parts[launchesIndex + 1] || '').trim();
  return missionId || null;
}

export async function fetchSpaceXLaunchTiles({
  upcomingOnly = true,
  userAgent = DEFAULT_USER_AGENT
}: {
  upcomingOnly?: boolean;
  userAgent?: string;
}): Promise<SpaceXLaunchTile[]> {
  const url = upcomingOnly
    ? `${SPACEX_CONTENT_BASE_URL}/launches-page-tiles/upcoming`
    : `${SPACEX_CONTENT_BASE_URL}/launches-page-tiles`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': userAgent } });
  if (!res.ok) throw new Error(`spacex_tiles_${res.status}`);
  const json = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(json)) return [];
  return json
    .map((row: any) => {
      return {
        id: typeof row?.id === 'number' ? row.id : undefined,
        title: typeof row?.title === 'string' ? row.title : null,
        link: typeof row?.link === 'string' ? row.link : null,
        missionStatus: typeof row?.missionStatus === 'string' ? row.missionStatus : null,
        vehicle: typeof row?.vehicle === 'string' ? row.vehicle : null,
        returnSite: typeof row?.returnSite === 'string' ? row.returnSite : null,
        launchSite: typeof row?.launchSite === 'string' ? row.launchSite : null,
        launchDate: typeof row?.launchDate === 'string' ? row.launchDate : null,
        launchTime: typeof row?.launchTime === 'string' ? row.launchTime : null,
        missionType: typeof row?.missionType === 'string' ? row.missionType : null
      } satisfies SpaceXLaunchTile;
    })
    .filter((t) => Boolean(t.link));
}

export async function fetchSpaceXMission({
  missionId,
  userAgent = DEFAULT_USER_AGENT
}: {
  missionId: string;
  userAgent?: string;
}): Promise<SpaceXMission | null> {
  const safe = (missionId || '').trim();
  if (!safe) return null;

  const url = `${SPACEX_CONTENT_BASE_URL}/missions/${encodeURIComponent(safe)}`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': userAgent } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`spacex_mission_${res.status}`);
  const json = (await res.json().catch(() => null)) as any;
  if (!json || typeof json !== 'object') return null;
  const resolvedId = typeof json?.missionId === 'string' && json.missionId.trim() ? json.missionId.trim() : safe;

  return {
    missionId: resolvedId,
    title: typeof json?.title === 'string' ? json.title : null,
    callToAction: typeof json?.callToAction === 'string' ? json.callToAction : null,
    infographicDesktop: normalizeCmsAsset(json?.infographicDesktop),
    infographicMobile: normalizeCmsAsset(json?.infographicMobile)
  };
}

function normalizeCmsAsset(asset: unknown): SpaceXCmsAsset | null {
  if (!asset || typeof asset !== 'object') return null;
  const obj = asset as any;
  const url = typeof obj?.url === 'string' ? obj.url : null;
  if (!url) return null;

  const formatsIn = obj?.formats;
  const formats: SpaceXCmsAsset['formats'] = {};
  if (formatsIn && typeof formatsIn === 'object') {
    for (const [key, value] of Object.entries(formatsIn as Record<string, any>)) {
      if (!value || typeof value !== 'object') continue;
      const u = typeof (value as any).url === 'string' ? (value as any).url : null;
      if (!u) continue;
      formats[key] = {
        url: u,
        width: typeof (value as any).width === 'number' ? (value as any).width : null,
        height: typeof (value as any).height === 'number' ? (value as any).height : null
      };
    }
  }

  return {
    url,
    width: typeof obj?.width === 'number' ? obj.width : null,
    height: typeof obj?.height === 'number' ? obj.height : null,
    mime: typeof obj?.mime === 'string' ? obj.mime : null,
    ext: typeof obj?.ext === 'string' ? obj.ext : null,
    hash: typeof obj?.hash === 'string' ? obj.hash : null,
    formats: Object.keys(formats).length ? formats : undefined
  };
}
