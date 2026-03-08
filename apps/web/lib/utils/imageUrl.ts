export function normalizeImageUrl(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://')) return `https://${trimmed.slice(7)}`;
  if (lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return trimmed;
  if (trimmed.includes('/')) return `/${trimmed.replace(/^\/+/, '')}`;
  return undefined;
}
