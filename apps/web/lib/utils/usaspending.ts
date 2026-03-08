const USASPENDING_PUBLIC_ROOT = 'https://www.usaspending.gov/';

type ResolveUsaspendingAwardSourceUrlInput = {
  awardId?: string | null;
  sourceUrl?: string | null;
  awardPageUrl?: string | null;
  awardApiUrl?: string | null;
};

export function buildUsaspendingSearchUrl(
  awardId: string | null | undefined
) {
  const normalized = asCleanString(awardId);
  if (!normalized) return null;
  return `https://www.usaspending.gov/search/?hash=${encodeURIComponent(normalized)}`;
}

export function normalizeUsaspendingPublicUrl(
  value: string | null | undefined,
  awardId: string | null | undefined = null
) {
  const normalizedValue = asCleanString(value);
  if (!normalizedValue) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalizedValue);
  } catch {
    return normalizedValue;
  }

  const host = parsed.hostname.toLowerCase();
  if (!isUsaspendingHost(host)) return normalizedValue;

  if (isUsaspendingApiHost(host)) {
    const fromUrl = extractAwardIdFromUsaspendingUrl(parsed);
    const resolvedAwardId = asCleanString(awardId) || fromUrl;
    return buildUsaspendingSearchUrl(resolvedAwardId) || USASPENDING_PUBLIC_ROOT;
  }

  return parsed.toString();
}

export function resolveUsaspendingAwardSourceUrl(
  input: ResolveUsaspendingAwardSourceUrlInput
) {
  const awardId = asCleanString(input.awardId);
  const candidates = [input.awardPageUrl, input.sourceUrl, input.awardApiUrl];

  for (const candidate of candidates) {
    const normalized = normalizeUsaspendingPublicUrl(candidate, awardId);
    if (normalized) return normalized;
  }

  return buildUsaspendingSearchUrl(awardId);
}

function asCleanString(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUsaspendingHost(hostname: string) {
  return hostname === 'usaspending.gov' || hostname.endsWith('.usaspending.gov');
}

function isUsaspendingApiHost(hostname: string) {
  return hostname === 'api.usaspending.gov';
}

function extractAwardIdFromUsaspendingUrl(parsed: URL) {
  const hash = asCleanString(parsed.searchParams.get('hash'));
  if (hash) return maybeDecode(hash);

  const awardMatch = parsed.pathname.match(/\/award\/([^/?#]+)/i);
  if (awardMatch?.[1]) return maybeDecode(awardMatch[1]);

  return null;
}

function maybeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
