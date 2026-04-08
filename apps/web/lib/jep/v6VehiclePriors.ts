export const JEP_V6_VEHICLE_PRIOR_FEATURE_FAMILY = 'mission_profile';
export const JEP_V6_VEHICLE_PRIOR_SOURCE_KEY = 'curated_vehicle_prior';

export type JepV6VehiclePriorRow = {
  familyKey: string;
  familyLabel: string | null;
  ll2RocketConfigId: number | null;
  providerKey: string | null;
  padState: string | null;
  rocketFullNamePattern: string | null;
  rocketFamilyPattern: string | null;
  missionProfileFactor: number | null;
  analystConfidence: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceRevision: string | null;
  rationale: string | null;
  activeFromDate: string | null;
  activeToDate: string | null;
  metadata: Record<string, unknown> | null;
};

export type JepV6VehiclePriorLaunchContext = {
  launchId?: string | null;
  net?: string | null;
  provider?: string | null;
  padState?: string | null;
  vehicle?: string | null;
  rocketFamily?: string | null;
  rocketFullName?: string | null;
  ll2RocketConfigId?: number | null;
};

export type JepV6MissionProfileInput = {
  availability: string | null;
  source: 'vehicle_prior' | 'neutral';
  familyKey: string | null;
  familyLabel: string | null;
  matchMode: 'config_id' | 'family_key' | 'pattern' | 'none';
  missionProfileFactor: number | null;
  analystConfidence: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceRevision: string | null;
  rationale: string | null;
};

export type JepV6ResolvedVehiclePrior = JepV6MissionProfileInput & {
  derivedFamilyKey: string | null;
  ll2RocketConfigId: number | null;
  metadata: Record<string, unknown> | null;
};

export function deriveJepV6VehicleFamilyKey(context: JepV6VehiclePriorLaunchContext): string | null {
  const providerKey = normalizeProviderKey(context.provider);
  const padState = normalizeStateCode(context.padState);
  const rocketText = normalizeFreeText([context.rocketFullName, context.vehicle, context.rocketFamily].join(' '));

  if (providerKey !== 'spacex') return null;
  if (containsAllTokens(rocketText, ['falcon', 'heavy'])) return 'spacex_falcon_heavy';
  if (containsAnyToken(rocketText, ['starship', 'super heavy', 'superheavy'])) {
    return padState === 'TX' ? 'spacex_starship_tx' : 'spacex_starship';
  }
  if (containsAllTokens(rocketText, ['falcon', '9'])) {
    if (padState === 'FL') return 'spacex_falcon9_fl';
    if (padState === 'CA') return 'spacex_falcon9_ca';
    return 'spacex_falcon9';
  }

  return null;
}

export function resolveJepV6VehiclePrior(
  rows: JepV6VehiclePriorRow[],
  context: JepV6VehiclePriorLaunchContext
): JepV6ResolvedVehiclePrior {
  const derivedFamilyKey = deriveJepV6VehicleFamilyKey(context);
  const launchDateKey = normalizeDateKey(context.net);
  const providerKey = normalizeProviderKey(context.provider);
  const padState = normalizeStateCode(context.padState);
  const rocketFullName = normalizeFreeText(context.rocketFullName ?? context.vehicle ?? '');
  const rocketFamily = normalizeFreeText(context.rocketFamily ?? '');
  const ll2RocketConfigId = normalizeInteger(context.ll2RocketConfigId);

  let bestMatch:
    | {
        row: JepV6VehiclePriorRow;
        score: number;
        matchMode: JepV6ResolvedVehiclePrior['matchMode'];
      }
    | null = null;

  for (const row of rows) {
    if (!isWithinActiveDateRange(row, launchDateKey)) continue;

    const rowProviderKey = normalizeProviderKey(row.providerKey);
    const rowPadState = normalizeStateCode(row.padState);
    const rowConfigId = normalizeInteger(row.ll2RocketConfigId);
    const rowFamilyKey = normalizeLookupToken(row.familyKey);
    const fullNamePattern = normalizeFreeText(row.rocketFullNamePattern ?? '');
    const rocketFamilyPattern = normalizeFreeText(row.rocketFamilyPattern ?? '');

    if (rowProviderKey && rowProviderKey !== providerKey) continue;
    if (rowPadState && rowPadState !== padState) continue;

    const fullNamePatternMatch = fullNamePattern ? rocketFullName.includes(fullNamePattern) : true;
    const rocketFamilyPatternMatch = rocketFamilyPattern ? rocketFamily.includes(rocketFamilyPattern) : true;
    if (!fullNamePatternMatch || !rocketFamilyPatternMatch) continue;

    const configIdMatch = rowConfigId != null && ll2RocketConfigId != null && rowConfigId === ll2RocketConfigId;
    const familyKeyMatch = Boolean(rowFamilyKey && derivedFamilyKey && rowFamilyKey === derivedFamilyKey);
    const patternMatch = Boolean(
      !configIdMatch &&
        !familyKeyMatch &&
        (rowProviderKey || rowPadState || fullNamePattern || rocketFamilyPattern)
    );

    if (!configIdMatch && !familyKeyMatch && !patternMatch) continue;

    const matchMode = configIdMatch ? 'config_id' : familyKeyMatch ? 'family_key' : 'pattern';
    const score =
      (configIdMatch ? 1000 : 0) +
      (familyKeyMatch ? 400 : 0) +
      (rowProviderKey ? 60 : 0) +
      (rowPadState ? 40 : 0) +
      (fullNamePattern ? 30 : 0) +
      (rocketFamilyPattern ? 20 : 0);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        row,
        score,
        matchMode
      };
    }
  }

  if (!bestMatch) {
    return {
      availability: 'neutral_missing_vehicle_prior',
      source: 'neutral',
      familyKey: null,
      familyLabel: null,
      matchMode: 'none',
      missionProfileFactor: null,
      analystConfidence: null,
      sourceUrl: null,
      sourceTitle: null,
      sourceRevision: null,
      rationale: null,
      derivedFamilyKey,
      ll2RocketConfigId,
      metadata: null
    };
  }

  return {
    availability: bestMatch.row.missionProfileFactor != null ? 'ok' : 'missing_mission_profile_factor',
    source: 'vehicle_prior',
    familyKey: bestMatch.row.familyKey,
    familyLabel: bestMatch.row.familyLabel,
    matchMode: bestMatch.matchMode,
    missionProfileFactor: sanitizeFactor(bestMatch.row.missionProfileFactor),
    analystConfidence: normalizeLookupToken(bestMatch.row.analystConfidence) || null,
    sourceUrl: bestMatch.row.sourceUrl,
    sourceTitle: bestMatch.row.sourceTitle,
    sourceRevision: bestMatch.row.sourceRevision,
    rationale: bestMatch.row.rationale,
    derivedFamilyKey,
    ll2RocketConfigId,
    metadata: bestMatch.row.metadata ?? null
  };
}

function isWithinActiveDateRange(row: JepV6VehiclePriorRow, launchDateKey: string | null) {
  if (!launchDateKey) return true;
  const activeFromDate = normalizeDateKey(row.activeFromDate);
  const activeToDate = normalizeDateKey(row.activeToDate);
  if (activeFromDate && launchDateKey < activeFromDate) return false;
  if (activeToDate && launchDateKey > activeToDate) return false;
  return true;
}

function containsAllTokens(text: string, tokens: string[]) {
  return tokens.every((token) => text.includes(normalizeFreeText(token)));
}

function containsAnyToken(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(normalizeFreeText(token)));
}

function normalizeProviderKey(value: string | null | undefined) {
  return normalizeLookupToken(value);
}

function normalizeStateCode(value: string | null | undefined) {
  const normalized = normalizeLookupToken(value).toUpperCase();
  if (normalized.length === 2) return normalized;
  if (normalized === 'FLORIDA') return 'FL';
  if (normalized === 'CALIFORNIA') return 'CA';
  if (normalized === 'TEXAS') return 'TX';
  return normalized || '';
}

function normalizeLookupToken(value: string | null | undefined) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeFreeText(value: string | null | undefined) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInteger(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeDateKey(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1] ?? null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function sanitizeFactor(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
