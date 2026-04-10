import { normalizeNonEmptyString, pointInBoundingBox, pointInGeometry, type GeoPoint, type GeometryBBox } from './faa.ts';
import {
  angularDiffDeg,
  bearingDeg,
  haversineKm,
  pointsFromGeoJson,
  type DirectionalPrior
} from './trajectoryDirection.ts';

const BBOX_PADDING_DEG = 0.15;
const MATCHED_SCORE_MIN = 68;
const MATCHED_SCORE_GAP_MIN = 8;
const AMBIGUOUS_SCORE_MIN = 60;
const MIN_CORRIDOR_DISTANCE_KM = 24;
const CORRIDOR_SCORING_DISTANCE_KM = 50;

export type LaunchRow = {
  id: string;
  name: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  provider: string | null;
  vehicle: string | null;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_state: string | null;
  pad_country_code: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  location_name: string | null;
};

export type TfrRecordRow = {
  id: string;
  source_key: string;
  notam_id: string | null;
  facility: string | null;
  state: string | null;
  type: string | null;
  legal: string | null;
  title: string | null;
  description: string | null;
  valid_start: string | null;
  valid_end: string | null;
  mod_at: string | null;
  status: 'active' | 'expired' | 'manual';
  has_shape: boolean;
};

export type ShapeRow = {
  id: string;
  faa_tfr_record_id: string;
  geometry: Record<string, unknown> | null;
  bbox_min_lat: number | null;
  bbox_min_lon: number | null;
  bbox_max_lat: number | null;
  bbox_max_lon: number | null;
};

export type LaunchWindow = {
  startMs: number | null;
  endMs: number | null;
  netMs: number | null;
};

type RecordTypeClass = 'space_ops' | 'sensitive_non_launch' | 'general';

export type CandidateScore = {
  launch: LaunchRow;
  score: number;
  reasons: string[];
  shapeId: string | null;
  shapeContainsPad: boolean;
  shapeBBoxHit: boolean;
  shapeCorridorHit: boolean;
  shapeCorridorDiffDeg: number | null;
  directionalAzDeg: number | null;
  directionalSigmaDeg: number | null;
  directionalSource: string | null;
  directionalProvenance: string | null;
  hasSpatialEvidence: boolean;
  hasTextEvidence: boolean;
  timeOverlap: boolean;
  deltaHours: number | null;
  recordTypeClass: RecordTypeClass;
};

export type MatchDecision = {
  matchStatus: 'matched' | 'ambiguous' | 'unmatched';
  launchId: string | null;
  shapeId: string | null;
  matchConfidence: number | null;
  matchScore: number | null;
  best: CandidateScore | null;
  second: CandidateScore | null;
  scoreGap: number | null;
};

export function computeLaunchWindow(launch: LaunchRow): LaunchWindow {
  const netMs = launch.net ? Date.parse(launch.net) : NaN;
  const startMsRaw = launch.window_start ? Date.parse(launch.window_start) : NaN;
  const endMsRaw = launch.window_end ? Date.parse(launch.window_end) : NaN;

  const net = Number.isFinite(netMs) ? netMs : null;
  const start = Number.isFinite(startMsRaw) ? startMsRaw : net;
  const end = Number.isFinite(endMsRaw) ? endMsRaw : net;

  return {
    startMs: start,
    endMs: end,
    netMs: net
  };
}

export function scoreLaunchCandidate({
  launch,
  launchWindow,
  record,
  shapes,
  nowMs,
  directionalPrior
}: {
  launch: LaunchRow;
  launchWindow: LaunchWindow;
  record: TfrRecordRow;
  shapes: ShapeRow[];
  nowMs: number;
  directionalPrior: DirectionalPrior | null;
}): CandidateScore {
  let score = 0;
  const reasons: string[] = [];

  const recordWindow = computeRecordWindow(record);
  const timeResult = scoreTimeAlignment({ launchWindow, recordWindow, nowMs });
  score += timeResult.score;
  if (timeResult.reason) reasons.push(timeResult.reason);

  const stateMatch = isSameToken(record.state, launch.pad_state);
  if (stateMatch) {
    score += 8;
    reasons.push('state_match');
  }

  const recordText = [record.facility, record.type, record.title, record.legal, record.description]
    .map((value) => normalizeNonEmptyString(value)?.toLowerCase() || '')
    .join(' ');
  const typeClass = classifyRecordType(recordText);
  if (typeClass === 'space_ops') {
    score += 10;
    reasons.push('space_ops_type');
  } else if (typeClass === 'sensitive_non_launch') {
    score -= 16;
    reasons.push('non_launch_type_penalty');
  }

  const padTokens = [launch.pad_short_code, launch.pad_name]
    .map((value) => normalizeToken(value))
    .filter(Boolean) as string[];
  if (padTokens.some((token) => token.length >= 3 && recordText.includes(token))) {
    score += 14;
    reasons.push('pad_text_match');
  }

  const providerToken = normalizeToken(launch.provider);
  if (providerToken && providerToken.length >= 4 && recordText.includes(providerToken)) {
    score += 8;
    reasons.push('provider_text_match');
  }

  const vehicleToken = normalizeToken(launch.vehicle);
  if (vehicleToken && vehicleToken.length >= 4 && recordText.includes(vehicleToken)) {
    score += 8;
    reasons.push('vehicle_text_match');
  }

  const launchNameToken = normalizeToken(launch.name);
  if (launchNameToken && launchNameToken.length >= 6 && recordText.includes(launchNameToken)) {
    score += 10;
    reasons.push('launch_name_text_match');
  }

  let shapeId: string | null = null;
  let shapeContainsPad = false;
  let shapeBBoxHit = false;
  let shapeCorridorHit = false;
  let shapeCorridorDiffDeg: number | null = null;

  const hasPadPoint =
    typeof launch.pad_latitude === 'number' &&
    Number.isFinite(launch.pad_latitude) &&
    typeof launch.pad_longitude === 'number' &&
    Number.isFinite(launch.pad_longitude);
  if (hasPadPoint && shapes.length > 0) {
    const point: GeoPoint = { lat: Number(launch.pad_latitude), lon: Number(launch.pad_longitude) };
    let bestShapeScore = 0;
    let bestShapePenalty = 0;

    for (const shape of shapes) {
      const bbox = toBBox(shape);
      const bboxHit = pointInBoundingBox(point, bbox, BBOX_PADDING_DEG);
      const containsPad = shape.geometry ? pointInGeometry(point, shape.geometry) : false;
      const padShapeScore = containsPad ? 36 : bboxHit ? 8 : 0;
      const corridorAlignment = scoreShapeDirectionalAlignment({
        launch,
        shape,
        directionalPrior,
        typeClass
      });
      const shapeScore = padShapeScore + corridorAlignment.score;

      if (shapeScore <= 0) {
        if (shapeScore < bestShapePenalty) {
          bestShapePenalty = shapeScore;
          shapeCorridorDiffDeg = corridorAlignment.diffDeg;
        }
        continue;
      }
      if (shapeScore <= bestShapeScore) continue;

      bestShapeScore = shapeScore;
      shapeId = shape.id;
      shapeContainsPad = containsPad;
      shapeBBoxHit = bboxHit;
      shapeCorridorHit = corridorAlignment.hit;
      shapeCorridorDiffDeg = corridorAlignment.diffDeg;
    }

    if (bestShapeScore > 0) {
      score += bestShapeScore;
      if (shapeContainsPad) reasons.push('shape_contains_pad');
      else if (shapeBBoxHit) reasons.push('shape_bbox_hit');
      if (shapeCorridorHit) reasons.push('shape_corridor_alignment');
    } else if (bestShapePenalty < 0) {
      score += bestShapePenalty;
      reasons.push('shape_off_corridor');
    }
  }

  const hasTextEvidence = reasons.some((reason) =>
    ['pad_text_match', 'provider_text_match', 'vehicle_text_match', 'launch_name_text_match'].includes(reason)
  );
  const hasSpatialEvidence = shapeContainsPad || shapeBBoxHit || shapeCorridorHit;

  score = Math.min(100, Math.max(0, score));

  return {
    launch,
    score,
    reasons,
    shapeId,
    shapeContainsPad,
    shapeBBoxHit,
    shapeCorridorHit,
    shapeCorridorDiffDeg,
    directionalAzDeg: directionalPrior?.azDeg ?? null,
    directionalSigmaDeg: directionalPrior?.sigmaDeg ?? null,
    directionalSource: directionalPrior?.source ?? null,
    directionalProvenance: directionalPrior?.provenance ?? null,
    hasSpatialEvidence,
    hasTextEvidence,
    timeOverlap: timeResult.overlap,
    deltaHours: timeResult.deltaHours,
    recordTypeClass: typeClass
  };
}

export function decideLaunchMatch(ranked: CandidateScore[]): MatchDecision {
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const scoreGap = best && second ? best.score - second.score : null;

  if (!best) {
    return {
      matchStatus: 'unmatched',
      launchId: null,
      shapeId: null,
      matchConfidence: null,
      matchScore: null,
      best: null,
      second,
      scoreGap: null
    };
  }

  const roundedScore = Math.round(best.score);
  const confidence = clampInt(roundedScore, 0, 100);
  const matchScore = Number(best.score.toFixed(2));
  const evidenceOkay =
    best.recordTypeClass === 'space_ops'
      ? best.hasSpatialEvidence || best.hasTextEvidence
      : best.hasSpatialEvidence && best.hasTextEvidence;
  const ambiguousEvidenceOkay =
    best.recordTypeClass === 'space_ops'
      ? best.hasSpatialEvidence || best.hasTextEvidence || best.timeOverlap
      : best.hasSpatialEvidence && best.hasTextEvidence;

  if (best.score >= MATCHED_SCORE_MIN && (scoreGap == null || scoreGap >= MATCHED_SCORE_GAP_MIN) && evidenceOkay) {
    return {
      matchStatus: 'matched',
      launchId: best.launch.id,
      shapeId: best.shapeId,
      matchConfidence: confidence,
      matchScore,
      best,
      second,
      scoreGap
    };
  }

  if (best.score >= AMBIGUOUS_SCORE_MIN && ambiguousEvidenceOkay) {
    return {
      matchStatus: 'ambiguous',
      launchId: best.launch.id,
      shapeId: best.shapeId,
      matchConfidence: confidence,
      matchScore,
      best,
      second,
      scoreGap
    };
  }

  return {
    matchStatus: 'unmatched',
    launchId: null,
    shapeId: null,
    matchConfidence: confidence,
    matchScore,
    best,
    second,
    scoreGap
  };
}

function classifyRecordType(recordText: string): RecordTypeClass {
  if (
    ['space operations', 'space operation', 'space launch', 'launch operations', '91.143'].some((needle) => recordText.includes(needle))
  ) {
    return 'space_ops';
  }

  if (
    ['security', 'vip', 'air show', 'airshow', 'stadium', 'sporting', 'fireworks', 'special security', 'president'].some((needle) =>
      recordText.includes(needle)
    )
  ) {
    return 'sensitive_non_launch';
  }

  return 'general';
}

function scoreShapeDirectionalAlignment({
  launch,
  shape,
  directionalPrior,
  typeClass
}: {
  launch: LaunchRow;
  shape: ShapeRow;
  directionalPrior: DirectionalPrior | null;
  typeClass: RecordTypeClass;
}) {
  const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : NaN;
  const padLon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : NaN;
  if (!Number.isFinite(padLat) || !Number.isFinite(padLon)) {
    return { score: 0, hit: false, diffDeg: null as number | null };
  }
  if (!directionalPrior || !shape.geometry) {
    return { score: 0, hit: false, diffDeg: null as number | null };
  }

  const samples = pointsFromGeoJson(shape.geometry);
  if (!samples.length) {
    return { score: 0, hit: false, diffDeg: null as number | null };
  }

  let minDiff = Number.POSITIVE_INFINITY;
  let maxDistKm = 0;
  for (const sample of samples) {
    const distKm = haversineKm(padLat, padLon, sample.lat, sample.lon);
    if (!Number.isFinite(distKm) || distKm < MIN_CORRIDOR_DISTANCE_KM) continue;
    const azDeg = bearingDeg(padLat, padLon, sample.lat, sample.lon);
    const diffDeg = angularDiffDeg(azDeg, directionalPrior.azDeg);
    minDiff = Math.min(minDiff, diffDeg);
    maxDistKm = Math.max(maxDistKm, distKm);
  }

  if (!Number.isFinite(minDiff) || !(maxDistKm >= MIN_CORRIDOR_DISTANCE_KM)) {
    return { score: 0, hit: false, diffDeg: null as number | null };
  }

  const toleranceDeg = corridorToleranceDeg(directionalPrior);
  if (minDiff <= toleranceDeg && maxDistKm >= CORRIDOR_SCORING_DISTANCE_KM) {
    let score = directionalPrior.provenance === 'heuristic' ? 10 : directionalPrior.provenance === 'orbit' ? 20 : 16;
    if (typeClass === 'space_ops') score += 2;
    if (directionalPrior.confidence >= 0.85) score += 2;
    return {
      score,
      hit: true,
      diffDeg: Number(minDiff.toFixed(2))
    };
  }

  if (
    typeClass === 'space_ops' &&
    directionalPrior.provenance !== 'heuristic' &&
    minDiff >= toleranceDeg * 1.75 &&
    maxDistKm >= CORRIDOR_SCORING_DISTANCE_KM
  ) {
    return {
      score: -6,
      hit: false,
      diffDeg: Number(minDiff.toFixed(2))
    };
  }

  return {
    score: 0,
    hit: false,
    diffDeg: Number.isFinite(minDiff) ? Number(minDiff.toFixed(2)) : null
  };
}

function corridorToleranceDeg(directionalPrior: DirectionalPrior) {
  if (directionalPrior.provenance === 'heuristic') {
    return clamp(directionalPrior.sigmaDeg * 1.4, 26, 52);
  }
  return clamp(directionalPrior.sigmaDeg * 2.1 + 8, 18, 42);
}

function computeRecordWindow(record: TfrRecordRow) {
  const startMsRaw = record.valid_start ? Date.parse(record.valid_start) : NaN;
  const endMsRaw = record.valid_end ? Date.parse(record.valid_end) : NaN;

  const startMs = Number.isFinite(startMsRaw) ? startMsRaw : null;
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw : null;

  return { startMs, endMs };
}

function scoreTimeAlignment({
  launchWindow,
  recordWindow,
  nowMs
}: {
  launchWindow: LaunchWindow;
  recordWindow: { startMs: number | null; endMs: number | null };
  nowMs: number;
}) {
  const launchStart = launchWindow.startMs;
  const launchEnd = launchWindow.endMs;
  const launchNet = launchWindow.netMs;
  const recordStart = recordWindow.startMs;
  const recordEnd = recordWindow.endMs;

  if (recordStart != null && recordEnd != null && launchStart != null && launchEnd != null) {
    const overlaps = launchStart <= recordEnd && launchEnd >= recordStart;
    if (overlaps) {
      return {
        score: 44,
        reason: 'time_overlap',
        overlap: true,
        deltaHours: 0
      };
    }

    const deltaMs = Math.min(Math.abs(launchStart - recordEnd), Math.abs(recordStart - launchEnd));
    const deltaHours = deltaMs / (60 * 60 * 1000);
    if (deltaHours <= 6) return { score: 26, reason: 'time_near_6h', overlap: false, deltaHours };
    if (deltaHours <= 24) return { score: 14, reason: 'time_near_24h', overlap: false, deltaHours };
    if (deltaHours <= 72) return { score: 6, reason: 'time_near_72h', overlap: false, deltaHours };
    return { score: 0, reason: null, overlap: false, deltaHours };
  }

  if (launchNet != null && recordStart != null && recordEnd == null) {
    if (launchNet >= recordStart) {
      const deltaHours = (launchNet - recordStart) / (60 * 60 * 1000);
      if (deltaHours <= 24) return { score: 12, reason: 'time_after_open_start', overlap: false, deltaHours };
    }
  }

  if (launchNet != null && recordEnd != null && recordStart == null) {
    if (launchNet <= recordEnd) {
      const deltaHours = (recordEnd - launchNet) / (60 * 60 * 1000);
      if (deltaHours <= 24) return { score: 12, reason: 'time_before_open_end', overlap: false, deltaHours };
    }
  }

  if (launchNet != null && recordStart == null && recordEnd == null) {
    const deltaHours = Math.abs(nowMs - launchNet) / (60 * 60 * 1000);
    if (deltaHours <= 24) return { score: 8, reason: 'time_recent_launch', overlap: false, deltaHours };
  }

  return { score: 0, reason: null, overlap: false, deltaHours: null as number | null };
}

function toBBox(shape: ShapeRow): GeometryBBox | null {
  const minLat = typeof shape.bbox_min_lat === 'number' ? shape.bbox_min_lat : NaN;
  const minLon = typeof shape.bbox_min_lon === 'number' ? shape.bbox_min_lon : NaN;
  const maxLat = typeof shape.bbox_max_lat === 'number' ? shape.bbox_max_lat : NaN;
  const maxLon = typeof shape.bbox_max_lon === 'number' ? shape.bbox_max_lon : NaN;

  if (![minLat, minLon, maxLat, maxLon].every((value) => Number.isFinite(value))) return null;

  return {
    minLat,
    minLon,
    maxLat,
    maxLon
  };
}

function normalizeToken(value: string | null | undefined) {
  return normalizeNonEmptyString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSameToken(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeToken(left);
  const normalizedRight = normalizeToken(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
