import crypto from 'node:crypto';

export type PartnerTrajectoryFeedInput = {
  launchId: string;
  feedId: string;
  fetchedAt?: string | null;
  confidence?: number | null;
  flightAzimuthDeg?: number | null;
  inclinationDeg?: number | null;
  altitudeKm?: number | null;
  apogeeKm?: number | null;
  perigeeKm?: number | null;
  sourceUrl?: string | null;
  feedName?: string | null;
  notes?: string[];
  raw?: Record<string, unknown> | null;
};

export type PartnerTrajectoryConstraintRow = {
  launch_id: string;
  source: 'partner_feed';
  source_id: string;
  constraint_type: 'target_orbit';
  confidence: number;
  fetched_at: string;
  data: Record<string, unknown>;
  geometry: null;
  source_hash: string;
  extracted_field_map: Record<string, unknown>;
  parse_rule_id: 'partner_feed_v1';
  parser_version: 'v1';
  license_class: 'licensed_partner';
};

export function normalizePartnerTrajectoryFeedInput(raw: Record<string, unknown>): PartnerTrajectoryFeedInput | null {
  const launchId = readString(raw.launch_id ?? raw.launchId);
  const feedId = readString(raw.feed_id ?? raw.feedId) || (launchId ? `partner:${launchId}` : '');
  if (!launchId || !feedId) return null;

  const flightAzimuthDeg = readNumber(raw.flight_azimuth_deg ?? raw.flightAzimuthDeg);
  const inclinationDeg = readNumber(raw.inclination_deg ?? raw.inclinationDeg);
  const altitudeKm = readNumber(raw.altitude_km ?? raw.altitudeKm);
  const apogeeKm = readNumber(raw.apogee_km ?? raw.apogeeKm);
  const perigeeKm = readNumber(raw.perigee_km ?? raw.perigeeKm);
  const hasOrbitNumeric =
    flightAzimuthDeg != null || inclinationDeg != null || altitudeKm != null || apogeeKm != null || perigeeKm != null;
  if (!hasOrbitNumeric) return null;

  const fetchedAt = readIsoString(raw.fetched_at ?? raw.fetchedAt) ?? new Date().toISOString();
  const confidence = clamp(readNumber(raw.confidence) ?? 0.97, 0, 1);
  const sourceUrl = readString(raw.source_url ?? raw.sourceUrl);
  const feedName = readString(raw.feed_name ?? raw.feedName) || 'Licensed partner feed';
  const notes = normalizeNotes(raw.notes);
  const rawPayload = asObject(raw.raw) ?? null;

  return {
    launchId,
    feedId,
    fetchedAt,
    confidence,
    flightAzimuthDeg,
    inclinationDeg,
    altitudeKm,
    apogeeKm,
    perigeeKm,
    sourceUrl,
    feedName,
    notes,
    raw: rawPayload
  };
}

export function buildPartnerTrajectoryConstraintRow(input: PartnerTrajectoryFeedInput): PartnerTrajectoryConstraintRow {
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  const sourceHash = buildPartnerTrajectorySourceHash(input);
  const data = {
    flight_azimuth_deg: input.flightAzimuthDeg ?? undefined,
    inclination_deg: input.inclinationDeg ?? undefined,
    altitude_km: input.altitudeKm ?? undefined,
    apogee_km: input.apogeeKm ?? undefined,
    perigee_km: input.perigeeKm ?? undefined,
    orbitType: 'partner_feed',
    sourceTier: 'truth',
    derived: false,
    partnerFeed: true,
    partnerFeedName: input.feedName || 'Licensed partner feed',
    sourceUrl: input.sourceUrl ?? undefined,
    notes: input.notes && input.notes.length ? input.notes : undefined,
    raw: input.raw ?? undefined
  };

  return {
    launch_id: input.launchId,
    source: 'partner_feed',
    source_id: input.feedId,
    constraint_type: 'target_orbit',
    confidence: clamp(input.confidence ?? 0.97, 0, 1),
    fetched_at: fetchedAt,
    data,
    geometry: null,
    source_hash: sourceHash,
    extracted_field_map: {
      fieldPresence: {
        flight_azimuth_deg: input.flightAzimuthDeg != null,
        inclination_deg: input.inclinationDeg != null,
        altitude_km: input.altitudeKm != null,
        apogee_km: input.apogeeKm != null,
        perigee_km: input.perigeeKm != null
      },
      partnerFeedName: input.feedName || 'Licensed partner feed'
    },
    parse_rule_id: 'partner_feed_v1',
    parser_version: 'v1',
    license_class: 'licensed_partner'
  };
}

export function buildPartnerTrajectorySourceHash(input: PartnerTrajectoryFeedInput) {
  const payload = JSON.stringify({
    launchId: input.launchId,
    feedId: input.feedId,
    flightAzimuthDeg: input.flightAzimuthDeg ?? null,
    inclinationDeg: input.inclinationDeg ?? null,
    altitudeKm: input.altitudeKm ?? null,
    apogeeKm: input.apogeeKm ?? null,
    perigeeKm: input.perigeeKm ?? null,
    sourceUrl: input.sourceUrl ?? null,
    notes: input.notes ?? []
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizeNotes(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => readString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  const single = readString(value);
  return single ? [single] : [];
}

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readIsoString(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
