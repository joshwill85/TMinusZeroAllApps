import { slugify } from '@/lib/utils/slug';

export function normalizeArtemisAwardeeName(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function buildArtemisAwardeeRecipientKey(value: string | null | undefined): string {
  const normalized = normalizeArtemisAwardeeName(value).toLowerCase();
  if (!normalized) return '';
  return normalized
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|inc|corp|corporation|company|co|llc|ltd|lp|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildArtemisAwardeeSlug(value: string | null | undefined): string {
  const normalized = normalizeArtemisAwardeeName(value);
  if (!normalized) return 'awardee';
  return slugify(normalized, 96) || 'awardee';
}

export function buildArtemisAwardeeHref(slug: string): string {
  return `/artemis/awardees/${encodeURIComponent(slug)}`;
}
