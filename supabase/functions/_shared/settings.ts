import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function getSettings(client: SupabaseClient, keys: string[]) {
  if (!keys.length) return {} as Record<string, unknown>;
  const { data, error } = await client.from('system_settings').select('key, value').in('key', keys);
  if (error) throw error;
  const out: Record<string, unknown> = {};
  for (const row of data || []) {
    out[row.key] = row.value;
  }
  return out;
}

export function readStringSetting(value: unknown, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

export function readBooleanSetting(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

export function readNumberSetting(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function readStringArraySetting(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
      }
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}
