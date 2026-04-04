import { NextResponse } from 'next/server';
import { summarizeTrajectoryOpsGaps } from '@/lib/trajectory/opsGapSummary';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { requireAdminRequest } from '../../../_lib/auth';

export const dynamic = 'force-dynamic';

const RELEVANT_STALE_TYPES = new Set(['landing', 'target_orbit', 'hazard_area']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const lat1 = lat1Deg * toRad;
  const lon1 = lon1Deg * toRad;
  const lat2 = lat2Deg * toRad;
  const lon2 = lon2Deg * toRad;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1 - a, 0)));
  return 6371 * c;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.context;

  const nowIso = new Date().toISOString();
  const eligibleRes = await supabase
    .from('launches_public_cache')
    .select('launch_id, net, name, provider, vehicle, status_name, pad_name, location_name, pad_latitude, pad_longitude')
    .gte('net', nowIso)
    .order('net', { ascending: true })
    .limit(50);

  if (eligibleRes.error || !eligibleRes.data) {
    console.error('trajectory eligible query failed', eligibleRes.error);
    return NextResponse.json({ error: 'eligible_query_failed' }, { status: 500 });
  }

  const eligibleLaunchIds: string[] = [];
  for (const row of eligibleRes.data as any[]) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    if (!launchId) continue;
    const hasPad = typeof row?.pad_latitude === 'number' && typeof row?.pad_longitude === 'number';
    if (!hasPad) continue;
    eligibleLaunchIds.push(launchId);
    if (eligibleLaunchIds.length >= 3) break;
  }

  if (!eligibleLaunchIds.includes(parsed.launchId)) {
    return NextResponse.json({ error: 'not_eligible' }, { status: 404 });
  }

  const [launchRes, productRes, constraintsRes] = await Promise.all([
    supabase.from('launches_public_cache').select('*').eq('launch_id', parsed.launchId).maybeSingle(),
    supabase
      .from('launch_trajectory_products')
      .select(
        'launch_id, version, quality, generated_at, product, confidence_tier, source_sufficiency, freshness_state, lineage_complete'
      )
      .eq('launch_id', parsed.launchId)
      .maybeSingle(),
    supabase
      .from('launch_trajectory_constraints')
      .select('id, source, source_id, constraint_type, confidence, fetched_at, data, geometry, created_at, updated_at')
      .eq('launch_id', parsed.launchId)
      .order('fetched_at', { ascending: false })
  ]);

  if (launchRes.error) {
    console.error('trajectory inspector launch fetch failed', launchRes.error);
    return NextResponse.json({ error: 'launch_fetch_failed' }, { status: 500 });
  }
  if (productRes.error) {
    console.error('trajectory inspector product fetch failed', productRes.error);
    return NextResponse.json({ error: 'product_fetch_failed' }, { status: 500 });
  }
  if (constraintsRes.error) {
    console.error('trajectory inspector constraints fetch failed', constraintsRes.error);
    return NextResponse.json({ error: 'constraints_fetch_failed' }, { status: 500 });
  }

  const productGeneratedAtMs =
    typeof productRes.data?.generated_at === 'string' ? Date.parse(productRes.data.generated_at) : NaN;
  const productGeneratedAt = Number.isFinite(productGeneratedAtMs) ? productGeneratedAtMs : null;

  const constraints = (constraintsRes.data ?? []) as any[];
  const opsGapSummary = summarizeTrajectoryOpsGaps({
    constraints,
    productRow: (productRes.data as any) ?? null,
    net: typeof launchRes.data?.net === 'string' ? launchRes.data.net : null
  });
  const newestFetchedAtByType: Record<string, string | null> = {};
  const countByType: Record<string, number> = {};
  const newestRelevantFetchedAtMsByType: Record<string, number> = {};

  for (const row of constraints) {
    const type = typeof row?.constraint_type === 'string' ? row.constraint_type : 'unknown';
    countByType[type] = (countByType[type] ?? 0) + 1;

    const fetchedAtMs = typeof row?.fetched_at === 'string' ? Date.parse(row.fetched_at) : NaN;
    if (Number.isFinite(fetchedAtMs)) {
      const prevIso = newestFetchedAtByType[type];
      const prevMs = prevIso ? Date.parse(prevIso) : NaN;
      if (!prevIso || !Number.isFinite(prevMs) || fetchedAtMs > prevMs) {
        newestFetchedAtByType[type] = new Date(fetchedAtMs).toISOString();
      }
      if (RELEVANT_STALE_TYPES.has(type)) {
        const prev = newestRelevantFetchedAtMsByType[type] ?? 0;
        if (fetchedAtMs > prev) newestRelevantFetchedAtMsByType[type] = fetchedAtMs;
      }
    }
  }

  const missingProduct = opsGapSummary.freshness.missingProduct;
  const staleReasons: Array<{ constraintType: string; newestFetchedAt: string }> = [];
  let productStale = opsGapSummary.freshness.productStale;
  if (productGeneratedAt != null) {
    for (const [constraintType, fetchedAtMs] of Object.entries(newestRelevantFetchedAtMsByType)) {
      if (fetchedAtMs > productGeneratedAt) {
        productStale = true;
        staleReasons.push({ constraintType, newestFetchedAt: new Date(fetchedAtMs).toISOString() });
      }
    }
  }

  const product = productRes.data
    ? {
        launchId: productRes.data.launch_id,
        version: productRes.data.version,
        quality: productRes.data.quality,
        generatedAt: productRes.data.generated_at,
        confidenceTier: typeof productRes.data.confidence_tier === 'string' ? productRes.data.confidence_tier : null,
        freshnessState: typeof productRes.data.freshness_state === 'string' ? productRes.data.freshness_state : null,
        lineageComplete:
          typeof productRes.data.lineage_complete === 'boolean' ? productRes.data.lineage_complete : null,
        sourceSufficiency:
          productRes.data.source_sufficiency && typeof productRes.data.source_sufficiency === 'object'
            ? productRes.data.source_sufficiency
            : null,
        product: productRes.data.product
      }
    : null;

  const productObj = (product?.product ?? null) as any;
  const samples = Array.isArray(productObj?.samples) ? productObj.samples : [];
  const events = Array.isArray(productObj?.events) ? productObj.events : [];
  const assumptions = Array.isArray(productObj?.assumptions) ? productObj.assumptions : [];

  const stepS =
    samples.length >= 2 && typeof samples[0]?.tPlusSec === 'number' && typeof samples[1]?.tPlusSec === 'number'
      ? Math.max(0, Math.round(samples[1].tPlusSec - samples[0].tPlusSec))
      : null;
  const durationS =
    samples.length > 0 && typeof samples[samples.length - 1]?.tPlusSec === 'number'
      ? Math.max(0, Math.round(samples[samples.length - 1].tPlusSec))
      : null;

  const productMeta = product
    ? {
        qualityLabel: typeof productObj?.qualityLabel === 'string' ? productObj.qualityLabel : null,
        sampleCount: samples.length,
        eventCount: events.length,
        assumptionCount: assumptions.length,
        durationS,
        stepS
      }
    : null;

  const constraintSummary = Object.keys(countByType)
    .sort((a, b) => a.localeCompare(b))
    .map((constraintType) => ({
      constraintType,
      count: countByType[constraintType] ?? 0,
      newestFetchedAt: newestFetchedAtByType[constraintType] ?? null
    }));
  const trajectoryAvailability =
    missingProduct ? 'product_missing' : productStale ? 'product_stale' : product ? 'available' : 'unknown';

  let padAudit: Record<string, unknown> | null = null;
  const launchRow = (launchRes.data ?? null) as Record<string, unknown> | null;
  const ll2PadId = launchRow?.ll2_pad_id;
  if (typeof ll2PadId === 'number' && Number.isFinite(ll2PadId)) {
    const { data: canonicalPad, error: canonicalPadError } = await supabase
      .from('ll2_pads')
      .select('ll2_pad_id, name, latitude, longitude, map_url')
      .eq('ll2_pad_id', ll2PadId)
      .maybeSingle();

    if (canonicalPadError) {
      padAudit = {
        ll2PadId,
        status: 'canonical_lookup_failed',
        error: canonicalPadError.message
      };
    } else if (canonicalPad) {
      const cacheLat = launchRow?.pad_latitude;
      const cacheLon = launchRow?.pad_longitude;
      const canonicalLat = canonicalPad.latitude;
      const canonicalLon = canonicalPad.longitude;
      const cacheHasPad = isFiniteNumber(cacheLat) && isFiniteNumber(cacheLon);
      const canonicalHasPad = isFiniteNumber(canonicalLat) && isFiniteNumber(canonicalLon);
      const deltaKm = cacheHasPad && canonicalHasPad ? haversineKm(cacheLat, cacheLon, canonicalLat, canonicalLon) : null;
      padAudit = {
        ll2PadId,
        status: cacheHasPad && canonicalHasPad && (deltaKm == null || deltaKm <= 0.25) ? 'consistent' : 'mismatch_or_incomplete',
        cache: {
          padName: launchRow?.pad_name ?? null,
          latitude: cacheHasPad ? cacheLat : null,
          longitude: cacheHasPad ? cacheLon : null
        },
        canonical: {
          padName: canonicalPad.name ?? null,
          latitude: canonicalHasPad ? canonicalLat : null,
          longitude: canonicalHasPad ? canonicalLon : null,
          mapUrl: canonicalPad.map_url ?? null
        },
        deltaKm
      };
    }
  }

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      eligibleLaunchIds,
      launch: launchRes.data ?? null,
      product,
      productMeta,
      missingProduct,
      productStale,
      productStaleReasons: staleReasons,
      trajectoryAvailability,
      constraints,
      constraintSummary,
      opsGapSummary,
      padAudit
    },
    {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}
