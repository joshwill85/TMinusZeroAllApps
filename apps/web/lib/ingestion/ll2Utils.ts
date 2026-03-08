import { Launch } from '@/lib/types/launch';

export function normalizeNetPrecision(value: unknown): Launch['netPrecision'] {
  if (value == null) return 'minute';
  let raw: unknown = value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 'minute';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed;
      }
    } else {
      raw = trimmed;
    }
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { abbrev?: string; name?: string; id?: number | string };
    raw = obj.abbrev || obj.name || obj.id || '';
  }

  const normalized = String(raw).toLowerCase();
  if (!normalized) return 'minute';
  if (normalized.includes('tbd') || normalized.includes('unknown')) return 'tbd';
  if (normalized.includes('sec')) return 'minute';
  if (normalized.includes('min')) return 'minute';
  if (normalized.includes('hour') || normalized === 'hr') return 'hour';
  if (normalized.includes('day')) return 'day';
  if (normalized.includes('month') || normalized === 'm') return 'month';
  if (normalized.startsWith('q') || normalized.includes('quarter')) return 'month';
  if (normalized.includes('year') || normalized === 'y') return 'month';
  return 'minute';
}

export function extractUrlFromValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'true' || trimmed === 'false') return null;
    if (trimmed.startsWith('http')) return trimmed;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractUrlFromValue(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractUrlFromValue(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === 'object') {
    const maybe = value as { url?: string };
    if (typeof maybe.url === 'string') return maybe.url;
  }
  return null;
}

export function selectVideoUrl(vidUrls: unknown, fallback?: unknown): string | null {
  const candidates = Array.isArray(vidUrls) ? vidUrls : [];
  const official = candidates.find((v: any) => (v?.type?.name || '').toLowerCase().includes('official'));
  if (official?.url) return official.url as string;

  const sorted = [...candidates]
    .filter((v: any) => typeof v?.url === 'string')
    .sort((a: any, b: any) => {
      const ap = typeof a?.priority === 'number' ? a.priority : 999;
      const bp = typeof b?.priority === 'number' ? b.priority : 999;
      return ap - bp;
    });

  if (sorted[0]?.url) return sorted[0].url as string;

  return extractUrlFromValue(fallback);
}

export function derivePadShortCode(padName?: string | null, padShortCode?: string | null) {
  if (padShortCode) return padShortCode;
  const name = (padName || '').trim();
  if (!name) return 'PAD';

  const direct = name.match(/\b([A-Z]{1,4}-\d{1,3}[A-Z]?)\b/);
  if (direct) return direct[1];

  const numberMatch = name.match(/(?:Space Launch Complex|Launch Complex|Launch Pad|Launch Area|Space Launch Site|Launch Site|Complex|Pad|Site|Area)\s*([0-9]{1,3}[A-Z]?)/i);
  if (numberMatch) {
    const code = numberMatch[1].toUpperCase();
    if (/Space Launch Complex/i.test(name)) return `SLC-${code}`;
    if (/Launch Complex/i.test(name) || /Complex/i.test(name)) return `LC-${code}`;
    if (/Launch Pad/i.test(name) || /Pad/i.test(name)) return `LP-${code}`;
    if (/Launch Area/i.test(name) || /Area/i.test(name)) return `LA-${code}`;
    if (/Space Launch Site/i.test(name) || /Launch Site/i.test(name) || /Site/i.test(name)) return `LS-${code}`;
  }

  return name.split(',')[0]?.trim() || name;
}

export function derivePadState(stateCode?: string | null, locationName?: string | null): string | null {
  if (stateCode) return stateCode;
  if (!locationName) return null;
  const match = locationName.match(/,\s*([A-Z]{2})\s*,\s*USA/i);
  return match ? match[1].toUpperCase() : null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
