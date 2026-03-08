const SAM_PUBLIC_HOST = 'sam.gov';
const SAM_API_HOST = 'api.sam.gov';

function asCleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSamHost(hostname: string) {
  return hostname === SAM_PUBLIC_HOST || hostname.endsWith(`.${SAM_PUBLIC_HOST}`);
}

function isSamApiLikePath(pathname: string) {
  const normalized = pathname.trim().toLowerCase();
  return normalized.startsWith('/api/');
}

export function normalizeSamPublicUrl(value: string | null | undefined): string | null {
  const raw = asCleanString(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') return null;

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === SAM_API_HOST) return null;

    if (isSamHost(hostname) && isSamApiLikePath(parsed.pathname)) {
      return null;
    }

    parsed.protocol = 'https:';
    parsed.searchParams.delete('api_key');
    parsed.searchParams.delete('apiKey');
    parsed.searchParams.delete('apikey');
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildSamPublicSearchUrl(query: string | null | undefined) {
  const url = new URL('https://sam.gov/search/');
  url.searchParams.set('index', 'opp');
  url.searchParams.set('page', '1');
  url.searchParams.set('sort', '-relevance');
  const normalizedQuery = asCleanString(query);
  if (normalizedQuery) {
    url.searchParams.set('q', normalizedQuery);
  }
  return url.toString();
}

export function resolveSamPublicUrl(input: {
  preferredUrl?: string | null;
  fallbackQuery?: string | null;
}) {
  return (
    normalizeSamPublicUrl(input.preferredUrl) ||
    buildSamPublicSearchUrl(input.fallbackQuery)
  );
}
