const SOCIAL_PREVIEW_UA_TOKENS = [
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'slackbot',
  'discordbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'pinterest',
  'skypeuripreview',
  'vkshare',
  'kakaotalk',
  'line',
  'snapchat',
  'embedly',
  'outlook',
  'teams',
  'redditbot',
  'mastodon'
];

export function isSocialPreviewUserAgent(userAgent?: string | null) {
  if (!userAgent) return false;
  const lower = userAgent.toLowerCase();
  return SOCIAL_PREVIEW_UA_TOKENS.some((token) => lower.includes(token));
}

export function shouldServeLiteOg(userAgent?: string | null) {
  if (!userAgent) return false;
  if (isSocialPreviewUserAgent(userAgent)) return false;
  const lower = userAgent.toLowerCase();
  return ['bot', 'crawl', 'spider', 'slurp', 'archiver', 'scanner'].some((token) => lower.includes(token));
}

export function normalizeOgCacheKeyTimestamp(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const iso = date.toISOString();
  return iso.slice(0, 13);
}

export function buildOgVersionSegment({
  baseVersion,
  cacheGeneratedAt,
  override
}: {
  baseVersion: string;
  cacheGeneratedAt?: string | null;
  override?: string | null;
}) {
  const overrideValue = override?.trim();
  if (overrideValue) return encodeURIComponent(overrideValue);
  const bucket = normalizeOgCacheKeyTimestamp(cacheGeneratedAt);
  const parts = [baseVersion, bucket].filter(Boolean);
  return encodeURIComponent(parts.join('__') || 'v');
}
