import { tryConsumeProvider } from '@/lib/ingestion/rateLimit';
import { APP_USER_AGENT } from '@/lib/brand';

const SNAPI_BASE = 'https://api.spaceflightnewsapi.net/v4';
const SNAPI_USER_AGENT = process.env.SNAPI_USER_AGENT || APP_USER_AGENT;

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
  const rate = await tryConsumeProvider('snapi');
  if (!rate.allowed) {
    return { items: [] as SnapiItem[], next: null, skipped: true, skipReason: 'rate_limit' };
  }

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
  if (!res.ok) {
    throw new Error(`SNAPI ${type} list failed ${res.status}`);
  }

  const json = (await res.json()) as any;
  return {
    items: Array.isArray(json?.results) ? (json.results as SnapiItem[]) : [],
    next: typeof json?.next === 'string' ? json.next : null,
    skipped: false,
    skipReason: null
  };
}

export async function fetchSnapiUpdated({
  type,
  sinceIso,
  limit = 100,
  maxPages = 5,
  hasLaunch = false
}: {
  type: SnapiItemType;
  sinceIso?: string;
  limit?: number;
  maxPages?: number;
  hasLaunch?: boolean;
}) {
  const items: SnapiItem[] = [];
  const seen = new Set<number>();
  let offset = 0;
  let pages = 0;
  let truncated = false;

  while (true) {
    const page = await fetchSnapiPage({ type, limit, offset, sinceIso, hasLaunch });
    if (page.skipped) {
      return { items: [] as SnapiItem[], pages, truncated: false, skipped: true, skipReason: page.skipReason };
    }

    for (const item of page.items) {
      const id = Number(item?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }

    pages++;
    if (!page.next || page.items.length === 0) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    offset += limit;
  }

  return { items, pages, truncated, skipped: false, skipReason: null };
}
