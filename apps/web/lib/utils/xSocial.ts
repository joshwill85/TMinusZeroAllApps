export function resolveXPostId(externalId: string | null | undefined, url: string | null | undefined) {
  return normalizeNumericId(externalId) || extractXStatusId(externalId) || extractXStatusId(url);
}

function normalizeNumericId(value: string | null | undefined) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function extractXStatusId(value: string | null | undefined) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host.endsWith('x.com') && !host.endsWith('twitter.com')) return null;

    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const statusIndex = segments.findIndex((segment) => segment.toLowerCase() === 'status');
    if (statusIndex < 0) return null;

    const id = (segments[statusIndex + 1] || '').trim();
    return /^\d+$/.test(id) ? id : null;
  } catch {
    const match = trimmed.match(/\/status\/(\d+)/i);
    if (match?.[1]) return match[1];
    return null;
  }
}
