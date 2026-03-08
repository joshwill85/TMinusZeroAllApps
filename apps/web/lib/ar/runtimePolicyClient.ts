import type { ArClientProfile } from '@/lib/ar/clientProfile';
import type { ArRuntimePoseMode } from '@/lib/ar/runtimeSelector';

type RuntimePolicyCache = {
  fetchedAtMs: number;
  expiresAtMs: number;
  overrides: Array<{
    profile: ArClientProfile;
    poseMode: ArRuntimePoseMode;
    confidence: 'medium' | 'high' | 'low';
    reasons: string[];
  }>;
};

const CACHE_KEY = 'ar:runtime-policy:v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(): RuntimePolicyCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RuntimePolicyCache;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.overrides)) return null;
    if (typeof parsed.expiresAtMs !== 'number' || parsed.expiresAtMs <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: RuntimePolicyCache) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function readCachedArRuntimePolicyOverride(profile: ArClientProfile) {
  const cached = readCache();
  if (!cached) {
    return {
      resolved: false,
      override: null
    };
  }
  return {
    resolved: true,
    override: cached.overrides.find((entry) => entry.profile === profile) ?? null
  };
}

export async function fetchArRuntimePolicyOverride(profile: ArClientProfile) {
  const cached = readCachedArRuntimePolicyOverride(profile);
  if (cached.resolved) {
    return cached.override;
  }

  const response = await fetch('/api/public/ar/runtime-policy', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  }).catch(() => null);
  if (!response?.ok) return null;

  const json = (await response.json().catch(() => null)) as
    | {
        overrides?: RuntimePolicyCache['overrides'];
        maxAgeSeconds?: number;
      }
    | null;
  const overrides = Array.isArray(json?.overrides) ? json.overrides : [];
  const maxAgeSeconds =
    typeof json?.maxAgeSeconds === 'number' && Number.isFinite(json.maxAgeSeconds) && json.maxAgeSeconds > 0
      ? json.maxAgeSeconds
      : CACHE_TTL_MS / 1000;
  writeCache({
    fetchedAtMs: Date.now(),
    expiresAtMs: Date.now() + maxAgeSeconds * 1000,
    overrides
  });
  return overrides.find((entry) => entry.profile === profile) ?? null;
}
