export type NormalizedCmsAsset = {
  url: string;
  previewUrl?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  hash?: string | null;
  ext?: string | null;
};

export const SPACEX_MISSION_INFOGRAPHIC_PARSE_RULE_ID = 'spacex_content_mission_infographic_v2';
export const SPACEX_MISSION_INFOGRAPHIC_PARSER_VERSION = 'v2';
export const SPACEX_LANDING_HINT_PARSE_RULE_ID = 'spacex_content_landing_hint_v1';
export const SPACEX_LANDING_HINT_PARSER_VERSION = 'v1';

export function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeUrl(value: unknown) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.toString();
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickPreviewUrl(value: Record<string, unknown>) {
  const direct = normalizeUrl(value.previewUrl);
  if (direct) return direct;

  const formats = value.formats;
  if (!formats || typeof formats !== 'object' || Array.isArray(formats)) return null;
  const record = formats as Record<string, unknown>;
  for (const key of ['thumbnail', 'small', 'medium', 'large']) {
    const candidate = record[key];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const url = normalizeUrl((candidate as Record<string, unknown>).url);
    if (url) return url;
  }

  return null;
}

export function normalizeCmsAsset(asset: unknown): NormalizedCmsAsset | null {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null;
  const row = asset as Record<string, unknown>;
  const url = normalizeUrl(row.url);
  if (!url) return null;

  return {
    url,
    previewUrl: pickPreviewUrl(row),
    mime: normalizeOptionalString(row.mime),
    width: toFiniteNumber(row.width),
    height: toFiniteNumber(row.height),
    hash: normalizeOptionalString(row.hash),
    ext: normalizeOptionalString(row.ext)
  };
}

export function buildSpaceXLaunchPageUrl(missionId: string | null | undefined) {
  const safe = normalizeOptionalString(missionId);
  return safe ? `https://www.spacex.com/launches/${encodeURIComponent(safe)}` : null;
}

export async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildMissionInfographicConstraintRow({
  launchId,
  missionId,
  missionTitle,
  confidence,
  launchPageUrl,
  match,
  infographicDesktop,
  infographicMobile,
  fetchedAt
}: {
  launchId: string;
  missionId: string;
  missionTitle: string | null;
  confidence: number;
  launchPageUrl: string | null;
  match: Record<string, unknown> | null;
  infographicDesktop: NormalizedCmsAsset | null;
  infographicMobile: NormalizedCmsAsset | null;
  fetchedAt: string;
}) {
  if (!infographicDesktop?.url && !infographicMobile?.url) return null;

  const data = {
    missionId,
    missionTitle,
    launchPageUrl,
    match,
    infographicDesktop,
    infographicMobile
  };

  return {
    launch_id: launchId,
    source: 'spacex_website',
    source_id: missionId,
    constraint_type: 'mission_infographic',
    confidence,
    source_hash: await sha256Hex(JSON.stringify(data)),
    extracted_field_map: {
      infographicDesktop: Boolean(infographicDesktop?.url),
      infographicMobile: Boolean(infographicMobile?.url),
      launchPageUrl: Boolean(launchPageUrl)
    },
    parse_rule_id: SPACEX_MISSION_INFOGRAPHIC_PARSE_RULE_ID,
    parser_version: SPACEX_MISSION_INFOGRAPHIC_PARSER_VERSION,
    license_class: 'public_web_api',
    data,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

export async function buildLandingHintConstraintRow({
  launchId,
  missionId,
  missionTitle,
  confidence,
  launchPageUrl,
  match,
  returnSite,
  returnDateTime,
  fetchedAt
}: {
  launchId: string;
  missionId: string;
  missionTitle: string | null;
  confidence: number;
  launchPageUrl: string | null;
  match: Record<string, unknown> | null;
  returnSite: string | null;
  returnDateTime: string | null;
  fetchedAt: string;
}) {
  if (!returnSite && !returnDateTime) return null;

  const data = {
    missionId,
    missionTitle,
    launchPageUrl,
    returnSite,
    returnDateTime,
    match
  };

  return {
    launch_id: launchId,
    source: 'spacex_content',
    source_id: missionId,
    constraint_type: 'landing_hint',
    confidence: Math.min(confidence, 0.72),
    source_hash: await sha256Hex(JSON.stringify(data)),
    extracted_field_map: {
      returnSite: Boolean(returnSite),
      returnDateTime: Boolean(returnDateTime),
      launchPageUrl: Boolean(launchPageUrl)
    },
    parse_rule_id: SPACEX_LANDING_HINT_PARSE_RULE_ID,
    parser_version: SPACEX_LANDING_HINT_PARSER_VERSION,
    license_class: 'public_web_api',
    data,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}
