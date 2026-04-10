import { normalizeNonEmptyString } from './faa.ts';

export type TrajectoryConstraintRow = {
  launch_id: string;
  source: string | null;
  source_id: string | null;
  constraint_type: string;
  data: any;
  confidence: number | null;
  fetched_at: string | null;
  geometry?: any;
};

export type DirectionalLaunchRow = {
  id: string;
  mission_name: string | null;
  mission_orbit: string | null;
  pad_name: string | null;
  location_name: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  vehicle: string | null;
};

type LaunchSite = 'cape' | 'vandenberg' | 'starbase' | 'unknown';
type MissionClass = 'SSO_POLAR' | 'GTO_GEO' | 'ISS_CREW' | 'LEO_GENERIC' | 'UNKNOWN';
type DirectionSignalKind = 'orbit' | 'landing' | 'heuristic';
type LandingDirectionKind = 'rtls' | 'drone_ship' | 'splashdown' | 'land_pad' | 'unknown';

type DirectionSignal = {
  kind: DirectionSignalKind;
  azDeg: number;
  sigmaDeg: number;
  weight: number;
  confidence: number;
  source: string | null;
  sourceId: string | null;
};

type LandingSignalCandidate = DirectionSignal & {
  kind: 'landing';
  priority: number;
};

export type DirectionalPrior = {
  azDeg: number;
  sigmaDeg: number;
  confidence: number;
  provenance: DirectionSignalKind;
  source: string | null;
  sourceId: string | null;
  reasons: string[];
};

export function buildDirectionalPriorsByLaunch(
  launches: DirectionalLaunchRow[],
  constraints: TrajectoryConstraintRow[]
): Map<string, DirectionalPrior> {
  const constraintsByLaunch = new Map<string, TrajectoryConstraintRow[]>();
  for (const constraint of constraints) {
    if (!isSafeTrajectoryConstraintForFaaMatch(constraint)) continue;
    const bucket = constraintsByLaunch.get(constraint.launch_id) || [];
    bucket.push(constraint);
    constraintsByLaunch.set(constraint.launch_id, bucket);
  }

  const out = new Map<string, DirectionalPrior>();
  for (const launch of launches) {
    const prior = deriveDirectionalPrior(launch, constraintsByLaunch.get(launch.id) || []);
    if (prior) out.set(launch.id, prior);
  }

  return out;
}

export function deriveDirectionalPrior(
  launch: DirectionalLaunchRow,
  constraints: TrajectoryConstraintRow[]
): DirectionalPrior | null {
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
  const heuristicEstimate = pickAzimuthEstimate({ site, missionClass, padName: launch.pad_name, padLat });

  const orbitSignal = pickOrbitSignal({
    constraints,
    padLat,
    site,
    missionClass,
    padName: launch.pad_name,
    preferredAzDeg: heuristicEstimate?.azDeg ?? null
  });
  const landingSignal = pickLandingSignal({
    constraints,
    padLat,
    padLon
  });

  const fused = fuseDirectionalSignals([orbitSignal, landingSignal].filter((signal): signal is DirectionSignal => signal != null));
  if (fused) {
    const primary = fused.primary;
    return {
      azDeg: fused.azDeg,
      sigmaDeg: fused.sigmaDeg,
      confidence: clamp(primary.confidence, 0.2, 0.98),
      provenance: primary.kind,
      source: primary.source,
      sourceId: primary.sourceId,
      reasons: fused.signals.map((signal) => `${signal.kind}:${signal.source || 'unknown'}`)
    };
  }

  if (!heuristicEstimate) return null;
  return {
    azDeg: heuristicEstimate.azDeg,
    sigmaDeg: 34,
    confidence: 0.28,
    provenance: 'heuristic',
    source: 'launch_heuristic',
    sourceId: null,
    reasons: [`heuristic:${site}:${missionClass}`]
  };
}

export function isSafeTrajectoryConstraintForFaaMatch(constraint: TrajectoryConstraintRow) {
  if (constraint.constraint_type === 'landing') {
    return normalizeNonEmptyString(constraint.source) === 'll2';
  }

  if (constraint.constraint_type !== 'target_orbit') return false;

  const source = normalizeNonEmptyString(constraint.source);
  const orbitType = normalizeNonEmptyString(constraint?.data?.orbitType);
  if (source === 'faa_tfr' || source === 'navcen_bnm' || source === 'trajectory_templates_v1') {
    return false;
  }
  if (orbitType === 'hazard_azimuth_estimate') {
    return false;
  }

  return true;
}

function pickOrbitSignal({
  constraints,
  padLat,
  site,
  missionClass,
  padName,
  preferredAzDeg
}: {
  constraints: TrajectoryConstraintRow[];
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
    const confidence = typeof entry.constraint.confidence === 'number' && Number.isFinite(entry.constraint.confidence)
      ? entry.constraint.confidence
      : 0.7;
    const flightAz = typeof targetOrbit?.flight_azimuth_deg === 'number' ? targetOrbit.flight_azimuth_deg : null;
    if (flightAz != null && Number.isFinite(flightAz)) {
      return {
        kind: 'orbit',
        azDeg: wrapAzDeg(flightAz),
        sigmaDeg: 4,
        weight: 1.8,
        confidence: clamp(confidence, 0.5, 0.99),
        source: entry.constraint.source,
        sourceId: entry.constraint.source_id
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
      (left, right) => angularDiffDeg(left, preferred) - angularDiffDeg(right, preferred)
    )[0];

    return {
      kind: 'orbit',
      azDeg,
      sigmaDeg: viable.length ? 10 : 14,
      weight: 1.2,
      confidence: clamp(confidence, 0.35, 0.9),
      source: entry.constraint.source,
      sourceId: entry.constraint.source_id
    };
  }

  return null;
}

function rankOrbitConstraint(constraint: TrajectoryConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as Record<string, unknown>) : null;
  const hasFlightAzimuth = typeof data?.flight_azimuth_deg === 'number';
  const hasInclination = typeof data?.inclination_deg === 'number';
  const source = String(constraint.source || '').toLowerCase();
  const orbitType = String(data?.orbitType || '').toLowerCase();
  const derived = data?.derived === true;
  const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0.6;
  const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;

  return (
    (hasFlightAzimuth ? 120 : 0) +
    (hasInclination ? 75 : 0) +
    (source.includes('celestrak') ? 30 : 0) +
    (source === 'launch_orbit_prior' ? 18 : 0) +
    (source === 'spacex_derived' ? 10 : 0) +
    (orbitType.includes('supgp') ? 18 : 0) +
    (derived ? -10 : 10) +
    confidence * 20 +
    (Number.isFinite(fetchedAtMs) ? fetchedAtMs / 1e13 : 0)
  );
}

function pickLandingSignal({
  constraints,
  padLat,
  padLon
}: {
  constraints: TrajectoryConstraintRow[];
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

      const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence)
        ? constraint.confidence
        : 0.7;
      weight *= clamp(0.55 + confidence * 0.45, 0.45, 1);

      return {
        kind: 'landing' as const,
        azDeg: bearingDeg(padLat, padLon, lat, lon),
        sigmaDeg: clamp(sigmaDeg, 8, 24),
        weight: clamp(weight, 0.08, 1.25),
        confidence: clamp(confidence, 0.4, 0.99),
        source: constraint.source,
        sourceId: constraint.source_id,
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

function fuseDirectionalSignals(signals: DirectionSignal[]) {
  if (!signals.length) return null;

  const rankedSignals = [...signals].sort((left, right) => {
    const authorityDelta = signalAuthorityRank(right.kind) - signalAuthorityRank(left.kind);
    if (authorityDelta) return authorityDelta;
    const weightDelta = directionSignalVectorWeight(right) - directionSignalVectorWeight(left);
    if (weightDelta) return weightDelta;
    return right.weight - left.weight;
  });

  const primary = rankedSignals[0];
  const hasOrbit = rankedSignals.some((signal) => signal.kind === 'orbit');
  const consensusSignals = hasOrbit
    ? rankedSignals.filter((signal) => {
        if (signal === primary) return true;
        if (signal.kind === 'orbit') return true;
        const toleranceDeg = clamp(primary.sigmaDeg * 2.2 + signal.sigmaDeg, 14, 36);
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
  const sigmaDeg = clamp(Math.max(sigmaFloor * (consensusSignals.length >= 2 ? 0.95 : 1.05), dispersionDeg * 1.35, 5), 4, 30);

  return {
    azDeg,
    sigmaDeg,
    primary,
    signals: consensusSignals
  };
}

function signalAuthorityRank(kind: DirectionSignalKind) {
  if (kind === 'orbit') return 4;
  if (kind === 'landing') return 3;
  return 1;
}

function directionSignalVectorWeight(signal: DirectionSignal) {
  if (!(signal.weight > 0) || !(signal.sigmaDeg > 0)) return 0;
  return signal.weight / Math.max(4, signal.sigmaDeg * signal.sigmaDeg);
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

  if (
    hasAny(orbit, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar']) ||
    hasAny(mission, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar'])
  ) {
    return 'SSO_POLAR';
  }
  if (hasAny(orbit, ['gto', 'geo', 'geostationary', 'geotransfer']) || hasAny(mission, ['gto', 'geo', 'geostationary', 'geotransfer'])) {
    return 'GTO_GEO';
  }
  if (hasAny(mission, ['crew', 'dragon', 'cygnus', 'cargo dragon', 'iss']) || orbit.includes('iss')) {
    return 'ISS_CREW';
  }
  if (hasAny(orbit, ['leo']) || hasAny(vehicle, ['falcon 9', 'electron', 'new glenn'])) {
    return 'LEO_GENERIC';
  }
  return 'UNKNOWN';
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function wrapAzDeg(az: number) {
  return ((az % 360) + 360) % 360;
}

function wrapLonDeg(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function angularDiffDeg(a: number, b: number) {
  const left = wrapAzDeg(a);
  const right = wrapAzDeg(b);
  const delta = Math.abs(left - right);
  return Math.min(delta, 360 - delta);
}

export function bearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
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

export function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const radiusKm = 6371;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function weightedCircularMeanDeg(values: Array<{ azDeg: number; weight: number }>) {
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

export function pointsFromGeoJson(geometry: unknown): Array<{ lat: number; lon: number }> {
  const out: Array<{ lat: number; lon: number }> = [];
  const geom = geometry as any;
  const type = typeof geom?.type === 'string' ? geom.type : null;
  const coords = geom?.coordinates;

  const pushRing = (ring: unknown) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const maxPoints = 72;
    const stride = Math.max(1, Math.ceil(ring.length / maxPoints));
    for (let index = 0; index < ring.length; index += stride) {
      const point = (ring as any)[index] as any;
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
