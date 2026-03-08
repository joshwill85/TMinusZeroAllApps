export type ParsedOrbitData = {
  inclination_deg: number | null;
  flight_azimuth_deg: number | null;
  altitude_km: number | null;
  apogee_km: number | null;
  perigee_km: number | null;
  orbit_class: string | null;
};

export type SupgpSearchLaunchInput = {
  provider?: string | null;
  vehicle?: string | null;
  name?: string | null;
  missionName?: string | null;
  missionOrbit?: string | null;
};

export type SupgpSearchPlan = {
  queryTerms: string[];
  providerAliases: string[];
  familyAliases: string[];
  exactAliases: string[];
};

export type SupgpSearchRow = {
  group_or_source?: string | null;
  raw_omm?: Record<string, unknown> | null;
};

export type SupgpRowMatch = {
  groupKey: string;
  label: string;
  score: number;
  quality: 'exact' | 'family';
  reasons: string[];
};

const FAMILY_ALIAS_PATTERNS: Array<{ re: RegExp; alias: string }> = [
  { re: /\bstarlink\b/i, alias: 'starlink' },
  { re: /\boneweb\b/i, alias: 'oneweb' },
  { re: /\bkuiper\b/i, alias: 'kuiper' },
  { re: /\bgps(?:\s*iii)?\b/i, alias: 'gpsiii' },
  { re: /\bgalileo\b/i, alias: 'galileo' },
  { re: /\bglobalstar\b/i, alias: 'globalstar' },
  { re: /\biridium\b/i, alias: 'iridium' },
  { re: /\bblacksky\b/i, alias: 'blacksky' },
  { re: /\bcapella\b/i, alias: 'capella' },
  { re: /\bhawk ?eye ?360\b/i, alias: 'hawkeye360' },
  { re: /\bplanet\b/i, alias: 'planet' },
  { re: /\bspire\b/i, alias: 'spire' },
  { re: /\bumbra\b/i, alias: 'umbra' },
  { re: /\bo3b\b/i, alias: 'o3b' },
  { re: /\beutelsat\b/i, alias: 'eutelsat' },
  { re: /\bqianfan\b/i, alias: 'qianfan' }
];

export function parsePublicOrbitData(text: string): ParsedOrbitData {
  const clean = String(text || '').replace(/\s+/g, ' ');

  const parseNumber = (rawValue: string, mode: 'deg' | 'km' | 'any' = 'any') => {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) return null;
    let normalized = trimmed.replace(/\s+/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.replace(/,/g, '');
    } else if (normalized.includes(',') && !normalized.includes('.')) {
      if (mode === 'deg') {
        normalized = normalized.replace(',', '.');
      } else if (mode === 'km') {
        if (/^\d{1,3}(?:,\d{3})+$/.test(normalized)) {
          normalized = normalized.replace(/,/g, '');
        } else {
          normalized = normalized.replace(',', '.');
        }
      } else {
        const parts = normalized.split(',');
        if (parts.length === 2 && parts[0].length >= 1 && parts[0].length <= 3 && parts[1].length === 3) {
          normalized = parts[0] + parts[1];
        } else {
          normalized = normalized.replace(',', '.');
        }
      }
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  const pickMatch = (re: RegExp, mode: 'deg' | 'km' | 'any') => {
    const m = clean.match(re);
    if (!m) return null;
    const raw = String(m[1] || '').trim();
    return parseNumber(raw, mode);
  };

  const pickMatchAny = (res: RegExp[], mode: 'deg' | 'km' | 'any') => {
    for (const re of res) {
      const v = pickMatch(re, mode);
      if (v != null) return v;
    }
    return null;
  };

  const degNumber = '([0-9]{1,3}(?:[\\.,][0-9]+)?)';
  const kmNumber = '([0-9]{1,3}(?:[\\s,][0-9]{3})*(?:[\\.,][0-9]+)?)';
  const degUnit = '(?:deg(?:ree)?s?|°)';
  const degMeasurement = `${degNumber}\\s*(?:-|\\s)*(?:${degUnit})`;

  const inclination = pickMatchAny(
    [
      new RegExp(`inclination[^0-9]{0,24}${degMeasurement}`, 'i'),
      new RegExp(`inclination\\s*\\(\\s*deg\\s*\\)[^0-9]{0,24}${degNumber}`, 'i'),
      new RegExp(`${degMeasurement}\\s*(?:of\\s*)?inclination`, 'i'),
      new RegExp(`inclined[^0-9]{0,16}${degMeasurement}`, 'i'),
      new RegExp(`(?:incl\\.?|inc\\.?)[^0-9]{0,16}${degMeasurement}`, 'i'),
      new RegExp(
        `${degMeasurement}\\s*(?:sun[- ]?synchronous|polar|low[- ]earth|geostationary|geosynchronous|transfer)?\\s*orbit`,
        'i'
      )
    ],
    'deg'
  );

  const azimuth = pickMatchAny(
    [
      new RegExp(`(?:flight\\s*)?azimuth[^0-9]{0,24}${degMeasurement}`, 'i'),
      new RegExp(`launch\\s*azimuth\\s*\\(\\s*deg\\s*\\)[^0-9]{0,24}${degNumber}`, 'i'),
      new RegExp(`azimuth\\s*\\(\\s*deg\\s*\\)[^0-9]{0,24}${degNumber}`, 'i'),
      new RegExp(`${degMeasurement}\\s*(?:of\\s*)?(?:launch\\s*)?(?:flight\\s*)?azimuth`, 'i')
    ],
    'deg'
  );

  let altitude = pickMatchAny(
    [
      new RegExp(`altitude[^0-9]{0,24}${kmNumber}\\s*(?:km|kilometers|kilometres)`, 'i'),
      new RegExp(`altitude\\s*\\(\\s*km\\s*\\)[^0-9]{0,24}${kmNumber}`, 'i'),
      new RegExp(`${kmNumber}\\s*(?:km|kilometers|kilometres)\\s+above\\s+(?:the\\s+)?earth`, 'i'),
      new RegExp(`(?:circular\\s+)?orbit[^0-9]{0,24}${kmNumber}\\s*(?:km|kilometers|kilometres)`, 'i'),
      new RegExp(`${kmNumber}\\s*(?:km|kilometers|kilometres)\\s*(?:circular\\s+)?orbit`, 'i')
    ],
    'km'
  );

  let apogee = pickMatchAny(
    [
      new RegExp(`apogee[^0-9]{0,24}${kmNumber}\\s*(?:km|kilometers|kilometres)`, 'i'),
      new RegExp(`apogee\\s*\\(\\s*km\\s*\\)[^0-9]{0,24}${kmNumber}`, 'i')
    ],
    'km'
  );

  let perigee = pickMatchAny(
    [
      new RegExp(`perigee[^0-9]{0,24}${kmNumber}\\s*(?:km|kilometers|kilometres)`, 'i'),
      new RegExp(`perigee\\s*\\(\\s*km\\s*\\)[^0-9]{0,24}${kmNumber}`, 'i')
    ],
    'km'
  );

  const pairedOrbit = clean.match(
    new RegExp(`${kmNumber}\\s*(?:x|×|by)\\s*${kmNumber}\\s*(?:km|kilometers|kilometres)`, 'i')
  );
  if (pairedOrbit) {
    const firstKm = parseNumber(String(pairedOrbit[1] || ''), 'km');
    const secondKm = parseNumber(String(pairedOrbit[2] || ''), 'km');
    if (firstKm != null && secondKm != null) {
      const lowKm = Math.min(firstKm, secondKm);
      const highKm = Math.max(firstKm, secondKm);
      if (lowKm === highKm) {
        if (altitude == null) altitude = lowKm;
      } else {
        if (perigee == null) perigee = lowKm;
        if (apogee == null) apogee = highKm;
      }
    }
  }

  let orbitClass: string | null = null;
  if (/\binternational\s+space\s+station\b/i.test(clean)) orbitClass = 'ISS';
  else if (/\b(?:geostationary|geosynchronous)\s+transfer(?:\s+orbit)?\b/i.test(clean)) orbitClass = 'GTO';
  else if (/\bgeostationary\b|\bgeosynchronous\b/i.test(clean)) orbitClass = 'GEO';
  else if (/\bmedium[- ]earth\s+orbit\b/i.test(clean)) orbitClass = 'MEO';
  else if (/\bsun[- ]?synchronous\b/i.test(clean)) orbitClass = 'SSO';
  else if (/\blow[- ]earth\s+orbit\b/i.test(clean)) orbitClass = 'LEO';
  else {
    const orbitClassMatch = clean.match(/\b(SSO|GTO|GEO|LEO|ISS|Polar|MEO)\b/i);
    orbitClass = orbitClassMatch ? String(orbitClassMatch[1]) : null;
  }

  return {
    inclination_deg: inclination,
    flight_azimuth_deg: azimuth,
    altitude_km: altitude,
    apogee_km: apogee,
    perigee_km: perigee,
    orbit_class: orbitClass
  };
}

export function buildSupgpSearchPlan(launch: SupgpSearchLaunchInput): SupgpSearchPlan {
  const missionCandidates = [launch.missionName, launch.name].filter((value): value is string => typeof value === 'string' && !!value.trim());
  const providerAliases = deriveProviderAliases(launch.provider, launch.vehicle);
  const familyAliases = new Set<string>();
  const exactAliases = new Set<string>();

  for (const mission of missionCandidates) {
    const compactMission = compactMatchValue(mission);
    if (looksLikeMissionAlias(compactMission)) exactAliases.add(compactMission);

    const starlink = parseStarlinkSupgpKey(mission);
    if (starlink) {
      familyAliases.add('starlink');
      exactAliases.add(starlink.keyCompact);
      exactAliases.add(starlink.groupCompact);
    }

    for (const { re, alias } of FAMILY_ALIAS_PATTERNS) {
      if (re.test(mission)) familyAliases.add(alias);
    }
  }

  const queryTerms = uniqueOrdered([
    ...providerAliases,
    ...[...familyAliases].filter((alias) => alias.length >= 4)
  ]).slice(0, 6);

  return {
    queryTerms,
    providerAliases,
    familyAliases: [...familyAliases],
    exactAliases: [...exactAliases]
  };
}

export function scoreSupgpOrbitRowMatch(plan: SupgpSearchPlan, row: SupgpSearchRow): SupgpRowMatch | null {
  const groupRaw = typeof row.group_or_source === 'string' ? row.group_or_source : '';
  const objectNameRaw = typeof row.raw_omm?.OBJECT_NAME === 'string' ? String(row.raw_omm.OBJECT_NAME) : '';
  const objectIdRaw = typeof row.raw_omm?.OBJECT_ID === 'string' ? String(row.raw_omm.OBJECT_ID) : '';

  const fields = [
    { label: 'object_name', compact: compactMatchValue(objectNameRaw) },
    { label: 'object_id', compact: compactMatchValue(objectIdRaw) },
    { label: 'source', compact: compactMatchValue(groupRaw) }
  ];

  let providerMatched = false;
  for (const alias of plan.providerAliases) {
    const compactAlias = compactMatchValue(alias);
    if (!compactAlias) continue;
    if (fields.some((field) => field.compact.includes(compactAlias))) {
      providerMatched = true;
      break;
    }
  }

  let bestExact: { alias: string; score: number; field: string } | null = null;
  for (const alias of plan.exactAliases) {
    const compactAlias = compactMatchValue(alias);
    if (!compactAlias) continue;
    for (const field of fields) {
      const score =
        field.label === 'object_id' && field.compact.includes(compactAlias)
          ? 1.35
          : field.label === 'object_name' && field.compact.includes(compactAlias)
            ? 1.2
            : field.label === 'source' && field.compact.includes(compactAlias)
              ? 0.9
              : 0;
      if (!score) continue;
      if (!bestExact || score > bestExact.score) bestExact = { alias: compactAlias, score, field: field.label };
    }
  }

  let bestFamily: { alias: string; score: number; field: string } | null = null;
  for (const alias of plan.familyAliases) {
    const compactAlias = compactMatchValue(alias);
    if (!compactAlias) continue;
    for (const field of fields) {
      const score =
        field.label === 'object_name' && field.compact.includes(compactAlias)
          ? 0.88
          : field.label === 'object_id' && field.compact.includes(compactAlias)
            ? 0.76
            : field.label === 'source' && field.compact.includes(compactAlias)
              ? 0.58
              : 0;
      if (!score) continue;
      if (!bestFamily || score > bestFamily.score) bestFamily = { alias: compactAlias, score, field: field.label };
    }
  }

  if (!bestExact && !bestFamily) return null;

  const matchQuality = bestExact && (!bestFamily || bestExact.score >= bestFamily.score + 0.2) ? 'exact' : 'family';
  const primary = matchQuality === 'exact' ? bestExact : bestFamily;
  if (!primary) return null;

  let score = primary.score;
  const reasons = [`${matchQuality}:${primary.alias}:${primary.field}`];

  if (providerMatched) {
    score += 0.18;
    reasons.push('provider_context');
  }

  if (
    bestExact &&
    bestFamily &&
    bestExact.alias !== bestFamily.alias &&
    (bestExact.field === 'object_name' || bestExact.field === 'object_id')
  ) {
    score += 0.08;
    reasons.push('family_consistency');
  }

  if (!providerMatched && matchQuality !== 'exact') {
    score -= 0.08;
  }

  const label = matchQuality === 'exact' ? primary.alias : primary.alias;
  const groupKey = `${matchQuality}:${primary.alias}`;
  if (score < 0.72) return null;

  return {
    groupKey,
    label,
    score,
    quality: matchQuality,
    reasons
  };
}

function deriveProviderAliases(provider: string | null | undefined, vehicle: string | null | undefined) {
  const rawProvider = String(provider || '').toLowerCase();
  const rawVehicle = String(vehicle || '').toLowerCase();
  const aliases = new Set<string>();

  const add = (...values: string[]) => {
    for (const value of values) {
      const trimmed = value.trim().toLowerCase();
      if (trimmed) aliases.add(trimmed);
    }
  };

  if (rawProvider.includes('spacex')) add('spacex', 'spacex-e', 'starlink');
  if (rawProvider.includes('united launch alliance') || rawProvider.includes('ula')) add('ula', 'united launch alliance');
  if (rawProvider.includes('rocket lab')) add('rocket lab', 'rocketlab', 'electron');
  if (rawProvider.includes('blue origin')) add('blue origin', 'new glenn');
  if (rawProvider.includes('isro')) add('isro');
  if (rawProvider.includes('arianespace')) add('arianespace', 'ariane');
  if (rawProvider.includes('ariane')) add('ariane');
  if (rawProvider.includes('jaxa')) add('jaxa', 'h3');
  if (rawProvider.includes('northrop')) add('northrop', 'cygnus', 'antares');
  if (rawProvider.includes('roscosmos')) add('roscosmos', 'soyuz');

  if (rawVehicle.includes('falcon')) add('spacex', 'spacex-e');
  if (rawVehicle.includes('new glenn')) add('new glenn');
  if (rawVehicle.includes('electron')) add('electron');
  if (rawVehicle.includes('atlas') || rawVehicle.includes('vulcan') || rawVehicle.includes('delta')) add('ula');
  if (rawVehicle.includes('ariane')) add('ariane');

  return [...aliases];
}

function looksLikeMissionAlias(value: string) {
  if (!value || value.length < 5 || value.length > 32) return false;
  if (!/[a-z]/.test(value) || !/\d/.test(value)) return false;
  return !/^(launch|mission|flight)\d+$/i.test(value);
}

function compactMatchValue(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function uniqueOrdered(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function parseStarlinkSupgpKey(value: string): { keyCompact: string; groupCompact: string } | null {
  const raw = value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw.includes('starlink')) return null;

  let match = raw.match(/starlink(?:\s*group)?\s*(?:g)?\s*([0-9]{1,2})\s*[-/]\s*([0-9]{1,2})/i);
  if (!match) match = raw.match(/\bg\s*([0-9]{1,2})\s*[-/]\s*([0-9]{1,2})\b/i);
  if (!match) return null;

  const shell = Number(match[1]);
  const mission = Number(match[2]);
  if (!Number.isFinite(shell) || !Number.isFinite(mission) || shell <= 0 || mission <= 0) return null;

  return {
    keyCompact: compactMatchValue(`starlink-g${shell}-${mission}`),
    groupCompact: compactMatchValue(`g${shell}-${mission}`)
  };
}
