const SNAPI_BASE = 'https://api.spaceflightnewsapi.net/v4';
const SNAPI_USER_AGENT = Deno.env.get('SNAPI_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';

export type SnapiItemType = 'articles' | 'blogs' | 'reports';

export type SnapiAuthor = {
  name: string;
  socials?: Record<string, string>;
};

export type SnapiItem = {
  id: number;
  title: string;
  url: string;
  image_url?: string | null;
  news_site?: string | null;
  summary?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  featured?: boolean | null;
  authors?: SnapiAuthor[] | null;
  launches?: Array<{ launch_id: string; provider?: string }>;
  events?: Array<{ event_id: number; provider?: string }>;
};

export function toSnapiUid(type: SnapiItemType, id: number) {
  return `${type}:${id}`;
}

export async function fetchSnapiPage({
  type,
  limit = 100,
  offset = 0,
  sinceIso,
  hasLaunch = false
}: {
  type: SnapiItemType;
  limit?: number;
  offset?: number;
  sinceIso?: string;
  hasLaunch?: boolean;
}) {
  const url = new URL(`${SNAPI_BASE}/${type}/`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('ordering', 'updated_at');
  if (hasLaunch) url.searchParams.set('has_launch', 'true');
  if (sinceIso) url.searchParams.set('updated_at_gte', sinceIso);

  const res = await fetch(url, { headers: { accept: 'application/json', 'User-Agent': SNAPI_USER_AGENT } });
  if (res.status === 429) {
    return { items: [] as SnapiItem[], next: null, skipped: true, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    return { items: [] as SnapiItem[], next: null, skipped: true, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`snapi_${type}_list_${res.status}`);

  const json = await res.json();
  return {
    items: Array.isArray(json?.results) ? (json.results as SnapiItem[]) : [],
    next: typeof json?.next === 'string' ? json.next : null,
    skipped: false,
    skipReason: null
  };
}
