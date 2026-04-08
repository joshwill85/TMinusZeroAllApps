export const DEFAULT_JEP_V6_MODEL_VERSION = 'jep_v6';
export const DEFAULT_JEP_V6_FEATURE_FAMILY = 'core_visibility';
export const DEFAULT_JEP_V6_OBSERVER_FEATURE_CELL_DEG = 0.02;

export const DEFAULT_JEP_V6_SETTINGS = {
  shadowEnabled: false,
  publicEnabled: false,
  sourceJobsEnabled: false,
  featureJobsEnabled: false,
  modelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
  observerFeatureCellDeg: DEFAULT_JEP_V6_OBSERVER_FEATURE_CELL_DEG
} as const;

export const JEP_V6_SETTINGS_KEYS = [
  'jep_v6_shadow_enabled',
  'jep_v6_public_enabled',
  'jep_v6_source_jobs_enabled',
  'jep_v6_feature_jobs_enabled',
  'jep_v6_model_version',
  'jep_v6_observer_feature_cell_deg'
] as const;

export type JepV6SettingKey = (typeof JEP_V6_SETTINGS_KEYS)[number];

export type JepV6Settings = {
  shadowEnabled: boolean;
  publicEnabled: boolean;
  sourceJobsEnabled: boolean;
  featureJobsEnabled: boolean;
  modelVersion: string;
  observerFeatureCellDeg: number;
};

export type JepV6ObserverFeatureCell = {
  key: string;
  latCell: number;
  lonCell: number;
  cellDeg: number;
};

export function readJepV6Settings(map: Record<string, unknown> = {}): JepV6Settings {
  return {
    shadowEnabled: readBoolean(map.jep_v6_shadow_enabled, DEFAULT_JEP_V6_SETTINGS.shadowEnabled),
    publicEnabled: readBoolean(map.jep_v6_public_enabled, DEFAULT_JEP_V6_SETTINGS.publicEnabled),
    sourceJobsEnabled: readBoolean(map.jep_v6_source_jobs_enabled, DEFAULT_JEP_V6_SETTINGS.sourceJobsEnabled),
    featureJobsEnabled: readBoolean(map.jep_v6_feature_jobs_enabled, DEFAULT_JEP_V6_SETTINGS.featureJobsEnabled),
    modelVersion: readString(map.jep_v6_model_version, DEFAULT_JEP_V6_SETTINGS.modelVersion),
    observerFeatureCellDeg: normalizeFeatureCellDeg(
      readNumber(map.jep_v6_observer_feature_cell_deg, DEFAULT_JEP_V6_SETTINGS.observerFeatureCellDeg)
    )
  };
}

export function deriveJepV6ObserverFeatureCell(
  latDeg: number,
  lonDeg: number,
  cellDeg = DEFAULT_JEP_V6_OBSERVER_FEATURE_CELL_DEG
): JepV6ObserverFeatureCell | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if (latDeg < -90 || latDeg > 90 || lonDeg < -180 || lonDeg > 180) return null;

  const normalizedCellDeg = normalizeFeatureCellDeg(cellDeg);
  const latCell = bucket(latDeg, normalizedCellDeg, -90, 90, 4);
  const lonCell = bucket(lonDeg, normalizedCellDeg, -180, 180, 4);
  const payload = `${normalizedCellDeg.toFixed(3)}:${latCell.toFixed(4)},${lonCell.toFixed(4)}`;

  return {
    key: hashText(payload, 24),
    latCell,
    lonCell,
    cellDeg: normalizedCellDeg
  };
}

export function buildJepV6SourceVersionKey({
  sourceKey,
  externalVersion,
  contentHash,
  storageUri,
  requestUrl
}: {
  sourceKey: string;
  externalVersion?: string | null;
  contentHash?: string | null;
  storageUri?: string | null;
  requestUrl?: string | null;
}) {
  const normalizedSourceKey = normalizeToken(sourceKey);
  if (!normalizedSourceKey) return '';

  const payload = stableStringify({
    sourceKey: normalizedSourceKey,
    externalVersion: normalizeToken(externalVersion),
    contentHash: normalizeToken(contentHash),
    storageUri: normalizeToken(storageUri),
    requestUrl: normalizeToken(requestUrl)
  });
  return `${normalizedSourceKey}:${hashText(payload, 32)}`;
}

export function buildJepV6FeatureSnapshotInputHash({
  launchId,
  observerFeatureCellKey,
  featureFamily = DEFAULT_JEP_V6_FEATURE_FAMILY,
  modelVersion = DEFAULT_JEP_V6_MODEL_VERSION,
  inputs
}: {
  launchId: string;
  observerFeatureCellKey: string;
  featureFamily?: string | null;
  modelVersion?: string | null;
  inputs: Record<string, unknown>;
}) {
  return hashText(
    stableStringify({
      launchId: normalizeToken(launchId),
      observerFeatureCellKey: normalizeToken(observerFeatureCellKey),
      featureFamily: normalizeToken(featureFamily) || DEFAULT_JEP_V6_FEATURE_FAMILY,
      modelVersion: normalizeToken(modelVersion) || DEFAULT_JEP_V6_MODEL_VERSION,
      inputs
    }),
    32
  );
}

function readBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return fallback;
}

function readNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readString(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeFeatureCellDeg(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_JEP_V6_OBSERVER_FEATURE_CELL_DEG;
  return clamp(round(value, 3), 0.001, 1);
}

function normalizeToken(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function bucket(value: number, step: number, min: number, max: number, digits: number) {
  const snapped = Math.round(value / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return round(clamped, digits);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashText(value: string, length: number) {
  let output = '';
  let round = 0;
  while (output.length < length) {
    const payload = round === 0 ? value : `${round}:${value}`;
    output += [
      fnv1a(payload, 0x811c9dc5),
      fnv1a(payload, 0x01000193),
      fnv1a(payload, 0x27d4eb2d),
      fnv1a(payload, 0x165667b1)
    ]
      .map((part) => part.toString(16).padStart(8, '0'))
      .join('');
    round += 1;
  }
  return output.slice(0, length);
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
