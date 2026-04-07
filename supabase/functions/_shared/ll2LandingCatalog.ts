import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type LandingRole = 'booster' | 'spacecraft' | 'unknown';

export type Ll2LandingLike = {
  id?: number | string | null;
  attempt?: boolean;
  success?: boolean | null;
  description?: string | null;
  downrange_distance?: number | null;
  landing_location?: unknown;
  type?: unknown;
};

export function normalizeLandingRole(role: LandingRole | string | null | undefined): LandingRole {
  return role === 'booster' || role === 'spacecraft' ? role : 'unknown';
}

export function mapLl2LandingCatalogRow(landing: Ll2LandingLike, fetchedAt: string): Record<string, unknown> | null {
  const landingId = toFiniteInt(landing?.id);
  if (landingId == null) return null;

  return {
    ll2_landing_id: landingId,
    attempt: typeof landing?.attempt === 'boolean' ? landing.attempt : null,
    success: typeof landing?.success === 'boolean' ? landing.success : null,
    description: normalizeNonEmptyString(landing?.description),
    downrange_distance_km: typeof landing?.downrange_distance === 'number' ? landing.downrange_distance : null,
    landing_location: landing?.landing_location ?? null,
    landing_type: landing?.type ?? null,
    raw: landing,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

export async function upsertLl2LandingCatalogRows(
  supabase: SupabaseClient,
  landings: Ll2LandingLike[],
  fetchedAt: string
) {
  const rows = new Map<number, Record<string, unknown>>();
  for (const landing of Array.isArray(landings) ? landings : []) {
    const row = mapLl2LandingCatalogRow(landing, fetchedAt);
    const landingId = typeof row?.ll2_landing_id === 'number' ? row.ll2_landing_id : null;
    if (landingId == null) continue;
    rows.set(landingId, row);
  }

  if (!rows.size) return 0;

  const { error } = await supabase.from('ll2_landings').upsert([...rows.values()], { onConflict: 'll2_landing_id' });
  if (error) throw error;

  return rows.size;
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
