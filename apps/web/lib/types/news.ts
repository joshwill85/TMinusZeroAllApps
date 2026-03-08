export type NewsType = 'article' | 'blog' | 'report';

export type NewsStreamLaunch = {
  id: string;
  name: string | null;
  net: string | null;
  netPrecision: 'minute' | 'hour' | 'day' | 'month' | 'tbd' | null;
  statusName: string | null;
  statusText: string | null;
  provider: string | null;
};

export type NewsStreamItem = {
  snapi_uid: string;
  item_type: NewsType;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  authors: Array<{ name?: string | null }> | null;
  featured: boolean | null;
  launch: {
    primary: NewsStreamLaunch;
    extraCount: number;
    matchedBy: 'join' | 'mention';
  } | null;
};

export type NewsStreamPage = {
  items: NewsStreamItem[];
  nextCursor: number;
  hasMore: boolean;
};

