import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MISSING_SETTING = Symbol('missing_setting');
type CachedSettingValue = unknown | typeof MISSING_SETTING;
const settingsCacheByClient = new WeakMap<object, Map<string, CachedSettingValue>>();

function normalizeSettingKey(key: string) {
  const trimmed = String(key ?? '').trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSettingKeys(keys: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const normalized = normalizeSettingKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function getClientSettingsCache(client: SupabaseClient) {
  const clientKey = client as unknown as object;
  let cache = settingsCacheByClient.get(clientKey);
  if (!cache) {
    cache = new Map<string, CachedSettingValue>();
    settingsCacheByClient.set(clientKey, cache);
  }
  return cache;
}

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

export async function getCachedSettings(client: SupabaseClient, keys: string[]) {
  const normalizedKeys = normalizeSettingKeys(keys);
  if (!normalizedKeys.length) return {} as Record<string, unknown>;

  const cache = getClientSettingsCache(client);
  const missingKeys = normalizedKeys.filter((key) => !cache.has(key));
  if (missingKeys.length) {
    const fresh = await getSettings(client, missingKeys);
    for (const key of missingKeys) {
      if (Object.prototype.hasOwnProperty.call(fresh, key)) {
        cache.set(key, fresh[key]);
      } else {
        cache.set(key, MISSING_SETTING);
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const key of normalizedKeys) {
    const value = cache.get(key);
    if (value !== undefined && value !== MISSING_SETTING) {
      out[key] = value;
    }
  }
  return out;
}

export async function getCachedSetting(client: SupabaseClient, key: string) {
  const normalizedKey = normalizeSettingKey(key);
  if (!normalizedKey) return undefined;
  const out = await getCachedSettings(client, [normalizedKey]);
  return out[normalizedKey];
}

export function primeCachedSettings(client: SupabaseClient, entries: Record<string, unknown>) {
  const cache = getClientSettingsCache(client);
  for (const [key, value] of Object.entries(entries)) {
    const normalizedKey = normalizeSettingKey(key);
    if (!normalizedKey) continue;
    cache.set(normalizedKey, value);
  }
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
