import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { reconcileStaleIngestionRuns, releaseJobLock, tryAcquireJobLock } from '../_shared/ingestionRuns.ts';

const DEFAULTS = {
  enabled: true,
  lookbackDays: 540,
  launchLimit: 1200,
  minSamples: 6,
  lockTtlSeconds: 900,
  staleRunTimeoutMs: 6 * 60 * 60 * 1000
};

const SETTINGS_KEYS = [
  'trajectory_templates_job_enabled',
  'trajectory_templates_lookback_days',
  'trajectory_templates_launch_limit',
  'trajectory_templates_min_samples',
  'trajectory_templates_lock_ttl_seconds',
  'trajectory_templates_stale_run_timeout_ms'
];

const JOB_NAME = 'trajectory_templates_generate';

type LaunchSite = 'cape' | 'vandenberg' | 'starbase' | 'unknown';
type MissionClass = 'SSO_POLAR' | 'GTO_GEO' | 'ISS_CREW' | 'LEO_GENERIC' | 'UNKNOWN';
type DirectionSignalKind = 'orbit' | 'hazard' | 'landing';
type LandingDirectionKind = 'rtls' | 'drone_ship' | 'splashdown' | 'land_pad' | 'unknown';

type LaunchRow = {
  launch_id: string;
  net: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  rocket_family: string | null;
  vehicle: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  pad_name: string | null;
  location_name: string | null;
};

type ConstraintRow = {
  launch_id: string;
  source: string | null;
  source_id: string | null;
  constraint_type: string;
  data: any;
  geometry?: any;
  confidence: number | null;
  fetched_at: string | null;
};

type DirectionSignal = {
  kind: DirectionSignalKind;
  azDeg: number;
  sigmaDeg: number;
  weight: number;
};

type LandingSignalCandidate = DirectionSignal & {
  kind: 'landing';
  priority: number;
};

type LaunchDirectionalSample = {
  azDeg: number;
  weight: number;
  signalKinds: DirectionSignalKind[];
  primaryKind: DirectionSignalKind;
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  let authorized = false;
  try {
    authorized = await requireJobAuth(req, supabase);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'trajectory_templates_generate');
  let lockId: string | null = null;

  const stats: Record<string, unknown> = {
    lookbackDays: null as number | null,
    launchLimit: null as number | null,
    minSamples: null as number | null,
    staleIngestionRunsClosed: 0,
    skipped: false,
    skipReason: null as string | null,
    launchesLoaded: 0,
    launchesWithSignal: 0,
    constraintLaunchIdsLoaded: 0,
    constraintRowsLoaded: 0,
    samplesUsed: 0,
    groupsBuilt: 0,
    templatesWritten: 0,
    sourceUsage: {
      orbit: 0,
      hazard: 0,
      landing: 0
    } as Record<string, number>
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.trajectory_templates_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const lookbackDays = clampInt(readNumberSetting(settings.trajectory_templates_lookback_days, DEFAULTS.lookbackDays), 30, 3650);
    const launchLimit = clampInt(readNumberSetting(settings.trajectory_templates_launch_limit, DEFAULTS.launchLimit), 50, 5000);
    const minSamples = clampInt(readNumberSetting(settings.trajectory_templates_min_samples, DEFAULTS.minSamples), 2, 50);

    stats.lookbackDays = lookbackDays;
    stats.launchLimit = launchLimit;
    stats.minSamples = minSamples;
    const lockTtlSeconds = clampInt(
      readNumberSetting(settings.trajectory_templates_lock_ttl_seconds, DEFAULTS.lockTtlSeconds),
      60,
      3600
    );
    const staleRunTimeoutMs = clampInt(
      readNumberSetting(settings.trajectory_templates_stale_run_timeout_ms, DEFAULTS.staleRunTimeoutMs),
      60_000,
      7 * 24 * 60 * 60 * 1000
    );
    stats.lockTtlSeconds = lockTtlSeconds;
    stats.staleRunTimeoutMs = staleRunTimeoutMs;
    stats.staleIngestionRunsClosed = await reconcileStaleIngestionRuns(supabase, {
      jobName: JOB_NAME,
      currentRunId: runId,
      staleBeforeIso: new Date(Date.now() - staleRunTimeoutMs).toISOString()
    });

    lockId = crypto.randomUUID();
    const acquired = await tryAcquireJobLock(supabase, {
      lockName: JOB_NAME,
      ttlSeconds: lockTtlSeconds,
      lockId
    });
    if (!acquired) {
      stats.skipped = true;
      stats.skipReason = 'locked';
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, skipped: true, reason: 'locked', elapsedMs: Date.now() - startedAt, stats });
    }

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const candidateSet = await loadConstraintBackedLaunchSet(supabase, { fromIso, launchLimit });
    const launches = candidateSet.launches;
    const constraintsByLaunch = candidateSet.constraintsByLaunch;
    stats.launchesLoaded = launches.length;
    stats.constraintLaunchIdsLoaded = candidateSet.constraintLaunchIdsLoaded;
    stats.constraintRowsLoaded = candidateSet.constraintRowsLoaded;

    if (!launches.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_constraint_backed_launches' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_constraint_backed_launches', elapsedMs: Date.now() - startedAt });
    }

    const groupedSamples = new Map<
      string,
      {
        samples: Array<{ azDeg: number; weight: number }>;
        sourceMix: Record<string, number>;
      }
    >();

    for (const launch of launches) {
      const constraints = constraintsByLaunch.get(launch.launch_id) || [];
      if (!constraints.length) continue;

      const sample = deriveLaunchDirectionalSample({ launch, constraints });
      if (!sample) continue;

      stats.launchesWithSignal = Number(stats.launchesWithSignal || 0) + 1;
      for (const kind of sample.signalKinds) {
        const sourceUsage = stats.sourceUsage as Record<string, number>;
        sourceUsage[kind] = Number(sourceUsage[kind] || 0) + 1;
      }

      const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : NaN;
      const padLon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : NaN;
      if (!Number.isFinite(padLat) || !Number.isFinite(padLon)) continue;

      const site = classifyLaunchSite({
        padLat,
        padLon,
        padName: launch.pad_name,
        locationName: launch.location_name
      });
      const missionClass = classifyMission({
        orbitName: launch.mission_orbit,
        missionName: launch.mission_name,
        vehicleName: launch.vehicle
      });
      const rocketFamily = (launch.rocket_family || 'unknown').toLowerCase().trim() || 'unknown';
      const key = `${site}|${rocketFamily}|${missionClass}`;

      const existing = groupedSamples.get(key) || { samples: [], sourceMix: {} };
      existing.samples.push({ azDeg: sample.azDeg, weight: sample.weight });
      for (const kind of sample.signalKinds) {
        existing.sourceMix[kind] = Number(existing.sourceMix[kind] || 0) + 1;
      }
      groupedSamples.set(key, existing);
    }

    stats.samplesUsed = Array.from(groupedSamples.values()).reduce((sum, entry) => sum + entry.samples.length, 0);
    stats.groupsBuilt = groupedSamples.size;

    const templates: Record<string, unknown> = {};
    let templatesWritten = 0;

    for (const [key, entry] of groupedSamples.entries()) {
      if (entry.samples.length < minSamples) continue;
      const meanAzDeg = weightedCircularMeanDeg(entry.samples);
      const deviations = entry.samples
        .map((sample) => angularDiffDeg(sample.azDeg, meanAzDeg))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      const p80 = deviations.length ? deviations[Math.min(deviations.length - 1, Math.floor(0.8 * (deviations.length - 1)))] : 0;
      const sigmaBonusDeg = clamp(p80, 0, 12);

      templates[key] = {
        azDeg: meanAzDeg,
        sigmaBonusDeg,
        samples: entry.samples.length,
        p80Deg: p80,
        sourceMix: sortObjectKeys(entry.sourceMix)
      };
      templatesWritten += 1;
    }

    stats.templatesWritten = templatesWritten;

    const payload = {
      version: 'v1',
      generatedAt: new Date().toISOString(),
      lookbackDays,
      minSamples,
      source: 'mixed_constraints',
      templates
    };

    const { error: upsertError } = await supabase
      .from('system_settings')
      .upsert({ key: 'trajectory_templates_v1', value: payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (upsertError) throw upsertError;

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  } finally {
    if (lockId) {
      await releaseJobLock(supabase, { lockName: JOB_NAME, lockId }).catch((error) => {
        console.warn('Failed to release job lock', { jobName: JOB_NAME, error: stringifyError(error) });
      });
    }
  }
});

async function loadConstraintBackedLaunchSet(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    fromIso,
    launchLimit
  }: {
    fromIso: string;
    launchLimit: number;
  }
) {
  const constraintTypes = ['target_orbit', 'hazard_area', 'landing'];
  const pageSize = 1000;
  const candidateLaunchIds: string[] = [];
  const candidateLaunchIdSet = new Set<string>();
  const constraintsByLaunch = new Map<string, ConstraintRow[]>();
  let constraintRowsLoaded = 0;

  for (let pageStart = 0; pageStart < 10_000; pageStart += pageSize) {
    const { data: rows, error } = await supabase
      .from('launch_trajectory_constraints')
      .select('launch_id, source, source_id, constraint_type, data, geometry, confidence, fetched_at')
      .in('constraint_type', constraintTypes)
      .order('fetched_at', { ascending: false, nullsFirst: false })
      .range(pageStart, pageStart + pageSize - 1);
    if (error) throw error;

    const typedRows = (rows as ConstraintRow[] | null) || [];
    if (!typedRows.length) break;

    constraintRowsLoaded += typedRows.length;
    for (const row of typedRows) {
      if (!row.launch_id) continue;
      const existing = constraintsByLaunch.get(row.launch_id) || [];
      existing.push(row);
      constraintsByLaunch.set(row.launch_id, existing);

      if (!candidateLaunchIdSet.has(row.launch_id)) {
        candidateLaunchIdSet.add(row.launch_id);
        candidateLaunchIds.push(row.launch_id);
      }
    }

    if (typedRows.length < pageSize) break;
    if (candidateLaunchIds.length >= launchLimit * 6 && constraintsByLaunch.size >= launchLimit) break;
  }

  if (!candidateLaunchIds.length) {
    return {
      launches: [] as LaunchRow[],
      constraintsByLaunch,
      constraintRowsLoaded,
      constraintLaunchIdsLoaded: 0
    };
  }

  const launches: LaunchRow[] = [];
  const chunkSize = 200;
  for (let index = 0; index < candidateLaunchIds.length; index += chunkSize) {
    const slice = candidateLaunchIds.slice(index, index + chunkSize);
    const { data: rows, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, pad_latitude, pad_longitude, rocket_family, vehicle, mission_name, mission_orbit, pad_name, location_name'
      )
      .in('launch_id', slice)
      .gte('net', fromIso);
    if (error) throw error;
    launches.push(...(((rows as LaunchRow[] | null) || [])));
  }

  launches.sort((left, right) => compareIsoDesc(left.net, right.net));
  const boundedLaunches = launches.slice(0, launchLimit);
  const allowedLaunchIds = new Set(boundedLaunches.map((launch) => launch.launch_id));

  const filteredConstraintsByLaunch = new Map<string, ConstraintRow[]>();
  let filteredConstraintRowsLoaded = 0;
  for (const launch of boundedLaunches) {
    const rows = constraintsByLaunch.get(launch.launch_id) || [];
    if (!rows.length) continue;
    filteredConstraintsByLaunch.set(launch.launch_id, rows);
    filteredConstraintRowsLoaded += rows.length;
  }

  return {
    launches: boundedLaunches.filter((launch) => allowedLaunchIds.has(launch.launch_id)),
    constraintsByLaunch: filteredConstraintsByLaunch,
    constraintRowsLoaded: filteredConstraintRowsLoaded,
    constraintLaunchIdsLoaded: allowedLaunchIds.size
  };
}

function compareIsoDesc(leftIso: string | null, rightIso: string | null) {
  const leftMs = typeof leftIso === 'string' ? Date.parse(leftIso) : NaN;
  const rightMs = typeof rightIso === 'string' ? Date.parse(rightIso) : NaN;
  const safeLeft = Number.isFinite(leftMs) ? leftMs : -Infinity;
  const safeRight = Number.isFinite(rightMs) ? rightMs : -Infinity;
  return safeRight - safeLeft;
}

function deriveLaunchDirectionalSample({
  launch,
  constraints
}: {
  launch: LaunchRow;
  constraints: ConstraintRow[];
}): LaunchDirectionalSample | null {
  const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : NaN;
  const padLon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : NaN;
  if (!Number.isFinite(padLat) || !Number.isFinite(padLon)) return null;

  const site = classifyLaunchSite({
    padLat,
    padLon,
    padName: launch.pad_name,
    locationName: launch.location_name
  });
  const missionClass = classifyMission({
    orbitName: launch.mission_orbit,
    missionName: launch.mission_name,
    vehicleName: launch.vehicle
  });
  const heuristic = pickAzimuthEstimate({ site, missionClass, padName: launch.pad_name, padLat });

  const landingSignal = pickLandingSignal({ constraints, padLat, padLon });
  const hazardSignal = pickHazardSignal({
    padLat,
    padLon,
    netIso: launch.net,
    expectedAzDeg: landingSignal?.azDeg ?? heuristic?.azDeg ?? null,
    clampMinDeg: heuristic?.clampMin ?? null,
    clampMaxDeg: heuristic?.clampMax ?? null,
    hazards: constraints.filter((constraint) => constraint.constraint_type === 'hazard_area' && constraint.geometry)
  });

  const orbitPreferredAz = weightedCircularMeanDeg(
    [landingSignal, hazardSignal].filter((signal): signal is DirectionSignal => signal != null).map((signal) => ({
      azDeg: signal.azDeg,
      weight: Math.max(0.1, signal.weight / Math.max(1, signal.sigmaDeg))
    }))
  );
  const orbitSignal = pickOrbitSignal({
    constraints,
    padLat,
    site,
    missionClass,
    padName: launch.pad_name,
    preferredAzDeg: orbitPreferredAz ?? heuristic?.azDeg ?? null
  });

  const fused = fuseDirectionalSignals([orbitSignal, hazardSignal, landingSignal].filter((signal): signal is DirectionSignal => signal != null));
  if (!fused) return null;

  return {
    azDeg: fused.azDeg,
    weight: clamp(0.45 + directionSignalVectorWeight(fused.primary) * 220, 0.45, 1.8),
    signalKinds: Array.from(new Set(fused.signals.map((signal) => signal.kind))),
    primaryKind: fused.primary.kind
  };
}

function pickOrbitSignal({
  constraints,
  padLat,
  site,
  missionClass,
  padName,
  preferredAzDeg
}: {
  constraints: ConstraintRow[];
  padLat: number;
  site: LaunchSite;
  missionClass: MissionClass;
  padName?: string | null;
  preferredAzDeg?: number | null;
}): DirectionSignal | null {
  const heuristic = pickAzimuthEstimate({ site, missionClass, padName, padLat });
  const clampMin = heuristic?.clampMin ?? 0;
  const clampMax = heuristic?.clampMax ?? 360;

  const ranked = constraints
    .filter((constraint) => constraint.constraint_type === 'target_orbit')
    .map((constraint) => ({
      constraint,
      score: rankOrbitConstraint(constraint)
    }))
    .sort((a, b) => b.score - a.score);

  for (const entry of ranked) {
    const targetOrbit = entry.constraint.data;
    const flightAz = typeof targetOrbit?.flight_azimuth_deg === 'number' ? targetOrbit.flight_azimuth_deg : null;
    if (flightAz != null && Number.isFinite(flightAz)) {
      return {
        kind: 'orbit',
        azDeg: wrapAzDeg(flightAz),
        sigmaDeg: 3,
        weight: 1.8
      };
    }

    const incDeg = typeof targetOrbit?.inclination_deg === 'number' ? targetOrbit.inclination_deg : null;
    if (incDeg == null || !Number.isFinite(incDeg) || incDeg <= 0 || incDeg >= 180) continue;

    const ratio = Math.cos((incDeg * Math.PI) / 180) / Math.cos((padLat * Math.PI) / 180);
    if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) continue;

    const aDeg = (Math.asin(clamp(ratio, -1, 1)) * 180) / Math.PI;
    const candidates = [wrapAzDeg(aDeg), wrapAzDeg(180 - aDeg)];
    const preferred =
      typeof preferredAzDeg === 'number' && Number.isFinite(preferredAzDeg)
        ? wrapAzDeg(preferredAzDeg)
        : heuristic?.azDeg ?? candidates[0];
    const viable = candidates.filter((candidate) => candidate >= clampMin && candidate <= clampMax);
    const azDeg = (viable.length ? viable : candidates).sort(
      (a, b) => angularDiffDeg(a, preferred) - angularDiffDeg(b, preferred)
    )[0];

    return {
      kind: 'orbit',
      azDeg,
      sigmaDeg: viable.length ? 8 : 12,
      weight: 1.35
    };
  }

  return null;
}

function rankOrbitConstraint(constraint: ConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as Record<string, unknown>) : null;
  const hasFlightAzimuth = typeof data?.flight_azimuth_deg === 'number';
  const hasInclination = typeof data?.inclination_deg === 'number';
  const sourceTier = String(data?.sourceTier || '').toLowerCase();
  const derived = data?.derived === true;
  const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0.6;
  const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;

  return (
    (hasFlightAzimuth ? 120 : 0) +
    (hasInclination ? 70 : 0) +
    (sourceTier === 'truth' ? 28 : 0) +
    (String(constraint.source || '').toLowerCase() === 'partner_feed' ? 40 : 0) +
    (derived ? -18 : 12) +
    confidence * 20 +
    (Number.isFinite(fetchedAtMs) ? fetchedAtMs / 1e13 : 0)
  );
}

function pickHazardSignal({
  padLat,
  padLon,
  hazards,
  netIso,
  expectedAzDeg,
  clampMinDeg,
  clampMaxDeg
}: {
  padLat: number;
  padLon: number;
  hazards: ConstraintRow[];
  netIso?: string | null;
  expectedAzDeg?: number | null;
  clampMinDeg?: number | null;
  clampMaxDeg?: number | null;
}): DirectionSignal | null {
  const netMs = typeof netIso === 'string' ? Date.parse(netIso) : NaN;
  let best: { signal: DirectionSignal; score: number } | null = null;

  for (const hazard of hazards) {
    const points = pointsFromGeoJson(hazard.geometry);
    if (!points.length) {
      const centroid = centroidFromGeoJson(hazard.geometry);
      if (centroid) points.push(centroid);
    }
    if (!points.length) continue;

    const samples: Array<{ azDeg: number; distKm: number }> = [];
    let maxDistKm = 0;
    for (const point of points) {
      const distKm = haversineKm(padLat, padLon, point.lat, point.lon);
      if (!Number.isFinite(distKm) || distKm < 10) continue;
      const azDeg = bearingDeg(padLat, padLon, point.lat, point.lon);
      samples.push({ azDeg, distKm });
      if (distKm > maxDistKm) maxDistKm = distKm;
    }
    if (!samples.length || !(maxDistKm > 0)) continue;

    const azDeg = weightedCircularMeanDeg(samples.map((sample) => ({ azDeg: sample.azDeg, weight: Math.max(1, sample.distKm * sample.distKm) })));
    const deviations = samples.map((sample) => angularDiffDeg(sample.azDeg, azDeg)).sort((a, b) => a - b);
    const p80 = deviations.length ? deviations[Math.min(deviations.length - 1, Math.floor(0.8 * (deviations.length - 1)))] : 0;
    const sigmaDeg = clamp(Math.max(6, p80 + 4), 6, 18);

    const startMs = hazard?.data?.validStartUtc ? Date.parse(String(hazard.data.validStartUtc)) : NaN;
    const endMs = hazard?.data?.validEndUtc ? Date.parse(String(hazard.data.validEndUtc)) : NaN;
    let timeScore = 0;
    if (Number.isFinite(netMs) && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      const bufferMs = 12 * 60 * 60 * 1000;
      if (netMs >= startMs && netMs <= endMs) timeScore = 80;
      else if (netMs >= startMs - bufferMs && netMs <= endMs + bufferMs) timeScore = 40;
      else continue;
    }

    const expected = typeof expectedAzDeg === 'number' && Number.isFinite(expectedAzDeg) ? wrapAzDeg(expectedAzDeg) : null;
    const inClamp =
      typeof clampMinDeg === 'number' &&
      Number.isFinite(clampMinDeg) &&
      typeof clampMaxDeg === 'number' &&
      Number.isFinite(clampMaxDeg)
        ? azDeg >= clampMinDeg && azDeg <= clampMaxDeg
        : true;
    const score = maxDistKm + timeScore - (expected != null ? angularDiffDeg(azDeg, expected) * 2 : 0) - (inClamp ? 0 : 250);

    const signal = {
      kind: 'hazard' as const,
      azDeg,
      sigmaDeg,
      weight: 1.1
    };

    if (!best || score > best.score) best = { signal, score };
  }

  return best?.signal ?? null;
}

function landingTypeText(value: unknown) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const obj = value as Record<string, unknown>;
  return [obj.abbrev, obj.name, obj.description]
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean)
    .join(' ');
}

function classifyLandingDirectionKind(value: unknown): LandingDirectionKind {
  const text = landingTypeText(value);
  if (!text) return 'unknown';
  if (text.includes('rtls')) return 'rtls';
  if (text.includes('drone') || text.includes('ship') || text.includes('asds') || text.includes('barge')) return 'drone_ship';
  if (text.includes('splash') || text.includes('ocean') || text.includes('sea') || text.includes('water')) return 'splashdown';
  if (text.includes('land') || text.includes('lz')) return 'land_pad';
  return 'unknown';
}

function pickLandingSignal({
  constraints,
  padLat,
  padLon
}: {
  constraints: ConstraintRow[];
  padLat: number;
  padLon: number;
}): DirectionSignal | null {
  const candidates = constraints
    .filter((constraint) => constraint.constraint_type === 'landing')
    .map((constraint) => {
      const loc = constraint?.data?.landing_location;
      const lat = typeof loc?.latitude === 'number' ? loc.latitude : NaN;
      const lon = typeof loc?.longitude === 'number' ? loc.longitude : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const role = String(constraint?.data?.landing_role || '').trim().toLowerCase();
      const kind = classifyLandingDirectionKind(constraint?.data?.landing_type);
      const attempt = typeof constraint?.data?.attempt === 'boolean' ? constraint.data.attempt : null;
      if (attempt === false) return null;

      let weight = role === 'booster' ? 0.75 : role === 'unknown' ? 0.5 : 0.18;
      let sigmaDeg = role === 'booster' ? 10 : role === 'unknown' ? 13 : 18;
      if (kind === 'drone_ship') {
        weight += 0.15;
        sigmaDeg = Math.max(8, sigmaDeg - 1);
      } else if (kind === 'rtls') {
        weight *= 0.45;
        sigmaDeg = Math.max(sigmaDeg, 20);
      } else if (kind === 'splashdown') {
        weight *= role === 'booster' ? 0.75 : 0.4;
        sigmaDeg = Math.max(sigmaDeg, 16);
      }

      const distKm = haversineKm(padLat, padLon, lat, lon);
      if (distKm < 30) {
        weight *= 0.35;
        sigmaDeg = Math.max(sigmaDeg, 20);
      } else if (distKm < 80) {
        weight *= 0.7;
        sigmaDeg = Math.max(sigmaDeg, 15);
      }

      const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0.7;
      weight *= clamp(0.55 + confidence * 0.45, 0.45, 1);

      return {
        kind: 'landing' as const,
        azDeg: bearingDeg(padLat, padLon, lat, lon),
        sigmaDeg: clamp(sigmaDeg, 8, 24),
        weight: clamp(weight, 0.08, 1.25),
        priority:
          (role === 'booster' ? 3 : role === 'unknown' ? 2 : 1) +
          (kind === 'drone_ship' ? 2 : kind === 'land_pad' ? 1 : 0) +
          confidence
      };
    })
    .filter((candidate): candidate is LandingSignalCandidate => candidate != null)
    .sort((a, b) => b.priority - a.priority);

  if (!candidates.length) return null;
  const { priority: _priority, ...signal } = candidates[0];
  return signal;
}

function signalAuthorityRank(kind: DirectionSignalKind) {
  if (kind === 'orbit') return 5;
  if (kind === 'hazard') return 4;
  return 3;
}

function directionSignalVectorWeight(signal: DirectionSignal) {
  if (!(signal.weight > 0) || !(signal.sigmaDeg > 0)) return 0;
  return signal.weight / Math.max(4, signal.sigmaDeg * signal.sigmaDeg);
}

function fuseDirectionalSignals(signals: DirectionSignal[]) {
  if (!signals.length) return null;

  const rankedSignals = [...signals].sort((a, b) => {
    const authorityDelta = signalAuthorityRank(b.kind) - signalAuthorityRank(a.kind);
    if (authorityDelta) return authorityDelta;
    const weightDelta = directionSignalVectorWeight(b) - directionSignalVectorWeight(a);
    if (weightDelta) return weightDelta;
    return b.weight - a.weight;
  });
  const primary = rankedSignals[0];
  const hasAuthoritativeDirectional = rankedSignals.some((signal) => signal.kind === 'orbit' || signal.kind === 'hazard');
  const consensusSignals = hasAuthoritativeDirectional
    ? rankedSignals.filter((signal) => {
        if (signal === primary) return true;
        if (signal.kind === 'orbit' || signal.kind === 'hazard') return true;
        const toleranceDeg = clamp(primary.sigmaDeg * 2.25 + signal.sigmaDeg, 14, 36);
        return angularDiffDeg(signal.azDeg, primary.azDeg) <= toleranceDeg;
      })
    : rankedSignals;

  const azDeg = weightedCircularMeanDeg(
    consensusSignals.map((signal) => ({
      azDeg: signal.azDeg,
      weight: directionSignalVectorWeight(signal)
    }))
  );
  const sigmaFloor = consensusSignals.reduce((min, signal) => Math.min(min, signal.sigmaDeg), Number.POSITIVE_INFINITY);
  const dispersionDeg = weightedAngularRmsDeg(consensusSignals, azDeg);
  const sigmaDeg = clamp(Math.max(sigmaFloor * (consensusSignals.length >= 2 ? 0.9 : 1.05), dispersionDeg * 1.35, 5), 4, 24);

  return {
    azDeg,
    sigmaDeg,
    primary,
    signals: consensusSignals
  };
}

function weightedCircularMeanDeg(values: Array<{ azDeg: number; weight: number }>) {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const value of values) {
    if (!Number.isFinite(value.azDeg) || !(value.weight > 0)) continue;
    const rad = (wrapAzDeg(value.azDeg) * Math.PI) / 180;
    sumSin += Math.sin(rad) * value.weight;
    sumCos += Math.cos(rad) * value.weight;
    totalWeight += value.weight;
  }
  if (!(totalWeight > 0)) return 0;
  return wrapAzDeg((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
}

function weightedAngularRmsDeg(signals: DirectionSignal[], centerAzDeg: number) {
  let totalWeight = 0;
  let totalSquared = 0;
  for (const signal of signals) {
    const weight = directionSignalVectorWeight(signal);
    if (!(weight > 0)) continue;
    const diff = angularDiffDeg(signal.azDeg, centerAzDeg);
    totalSquared += diff * diff * weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return Math.sqrt(totalSquared / totalWeight);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function wrapAzDeg(az: number) {
  return ((az % 360) + 360) % 360;
}

function wrapLonDeg(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function angularDiffDeg(a: number, b: number) {
  const da = wrapAzDeg(a);
  const db = wrapAzDeg(b);
  const d = Math.abs(da - db);
  return Math.min(d, 360 - d);
}

function bearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1Deg * toRad;
  const phi2 = lat2Deg * toRad;
  const dLambda = (lon2Deg - lon1Deg) * toRad;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (theta * toDeg + 360) % 360;
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const R = 6371;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointsFromGeoJson(geometry: unknown): Array<{ lat: number; lon: number }> {
  const out: Array<{ lat: number; lon: number }> = [];
  const geom = geometry as any;
  const type = typeof geom?.type === 'string' ? geom.type : null;
  const coords = geom?.coordinates;
  const pushRing = (ring: unknown) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const maxPoints = 72;
    const stride = Math.max(1, Math.ceil(ring.length / maxPoints));
    for (let i = 0; i < ring.length; i += stride) {
      const point = (ring as any)[i] as any;
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ lat, lon: wrapLonDeg(lon) });
    }
  };

  if (type === 'Polygon') {
    pushRing(Array.isArray(coords) ? coords[0] : null);
  } else if (type === 'MultiPolygon') {
    for (const poly of Array.isArray(coords) ? coords : []) {
      pushRing(Array.isArray(poly) ? poly[0] : null);
    }
  }

  return out;
}

function centroidFromGeoJson(geometry: unknown): { lat: number; lon: number } | null {
  const geom = geometry as any;
  const type = typeof geom?.type === 'string' ? geom.type : null;
  const coords = geom?.coordinates;
  if (!type || !coords) return null;

  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  const push = (point: any) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    sumLat += lat;
    sumLon += lon;
    count += 1;
  };

  if (type === 'Polygon') {
    for (const ring of Array.isArray(coords) ? coords : []) {
      for (const point of Array.isArray(ring) ? ring : []) push(point);
    }
  } else if (type === 'MultiPolygon') {
    for (const poly of Array.isArray(coords) ? coords : []) {
      for (const ring of Array.isArray(poly) ? poly : []) {
        for (const point of Array.isArray(ring) ? ring : []) push(point);
      }
    }
  }

  if (!count) return null;
  return { lat: sumLat / count, lon: wrapLonDeg(sumLon / count) };
}

function pickAzimuthEstimate({
  site,
  missionClass,
  padName,
  padLat
}: {
  site: LaunchSite;
  missionClass: MissionClass;
  padName?: string | null;
  padLat?: number | null;
}): { azDeg: number; clampMin: number; clampMax: number } | null {
  if (site === 'cape') {
    if (missionClass === 'ISS_CREW' || missionClass === 'LEO_GENERIC') return { azDeg: 50, clampMin: 35, clampMax: 75 };
    if (missionClass === 'GTO_GEO') return { azDeg: 100, clampMin: 80, clampMax: 125 };
    if (missionClass === 'SSO_POLAR') return { azDeg: 155, clampMin: 130, clampMax: 170 };
    return { azDeg: 90, clampMin: 35, clampMax: 125 };
  }

  if (site === 'vandenberg') {
    const pad = (padName || '').toLowerCase();
    const azDeg = pad.includes('slc-2') ? 200 : pad.includes('slc-6') ? 190 : 188;
    return { azDeg, clampMin: 160, clampMax: 210 };
  }

  if (site === 'starbase') {
    return { azDeg: 110, clampMin: 60, clampMax: 150 };
  }

  const hemisphere = typeof padLat === 'number' && Number.isFinite(padLat) ? (padLat >= 0 ? 'north' : 'south') : null;
  return {
    azDeg: missionClass === 'SSO_POLAR' ? (hemisphere === 'south' ? 0 : 180) : 90,
    clampMin: 0,
    clampMax: 360
  };
}

function sortObjectKeys(value: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) out[key] = value[key];
  return out;
}

function classifyLaunchSite({
  padLat,
  padLon,
  padName,
  locationName
}: {
  padLat: number;
  padLon: number;
  padName?: string | null;
  locationName?: string | null;
}): LaunchSite {
  const name = `${padName || ''} ${locationName || ''}`.toLowerCase();

  if (
    (padLat >= 25.5 && padLat <= 26.6 && padLon >= -98.2 && padLon <= -96.4) ||
    name.includes('starbase') ||
    name.includes('boca chica')
  ) {
    return 'starbase';
  }

  if (
    (padLat >= 27.0 && padLat <= 29.6 && padLon >= -82.5 && padLon <= -79.0) ||
    name.includes('cape canaveral') ||
    name.includes('kennedy') ||
    name.includes('ksc')
  ) {
    return 'cape';
  }

  if (
    (padLat >= 33.0 && padLat <= 35.8 && padLon >= -121.9 && padLon <= -119.0) ||
    name.includes('vandenberg')
  ) {
    return 'vandenberg';
  }

  return 'unknown';
}

function classifyMission({
  orbitName,
  missionName,
  vehicleName
}: {
  orbitName?: string | null;
  missionName?: string | null;
  vehicleName?: string | null;
}): MissionClass {
  const orbit = (orbitName || '').toLowerCase();
  const mission = (missionName || '').toLowerCase();
  const vehicle = (vehicleName || '').toLowerCase();

  const hasAny = (haystack: string, needles: string[]) => needles.some((needle) => haystack.includes(needle));

  if (hasAny(orbit, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar']) || hasAny(mission, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar'])) {
    return 'SSO_POLAR';
  }
  if (hasAny(orbit, ['gto', 'geo', 'geostationary'])) return 'GTO_GEO';
  if (hasAny(mission, ['iss', 'crew', 'dragon', 'crs'])) {
    return 'ISS_CREW';
  }
  if (hasAny(orbit, ['leo', 'low earth'])) return 'LEO_GENERIC';

  return 'UNKNOWN';
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (!runId) return;
  const update: Record<string, unknown> = {
    success,
    ended_at: new Date().toISOString()
  };
  if (stats) update.stats = stats;
  if (error) update.error = error;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = attempt === 0 ? supabase : createSupabaseAdminClient();
    const { error: upsertError } = await client.from('ingestion_runs').update(update).eq('id', runId);
    if (!upsertError) return;
    lastError = upsertError.message;
    await waitForMs(150 * (attempt + 1));
  }
  console.warn('Failed to update ingestion_runs record', { runId, error: lastError });
}

function waitForMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
