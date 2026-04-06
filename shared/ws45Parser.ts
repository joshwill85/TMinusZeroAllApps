export type ParsedScenario = {
  label?: string;
  povPercent?: number;
  primaryConcerns?: string[];
  weatherVisibility?: string;
  tempF?: number;
  humidityPercent?: number;
  liftoffWinds?: { directionDeg?: number; speedMphMin?: number; speedMphMax?: number; raw?: string };
  additionalRiskCriteria?: {
    upperLevelWindShear?: string;
    boosterRecoveryWeather?: string;
    solarActivity?: string;
  };
  clouds?: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }>;
  rawSection?: string;
};

export type ParsedForecast = {
  productName?: string;
  missionName?: string;
  missionNameNormalized?: string;
  missionTokens?: string[];
  issuedAtUtc?: string;
  validStartUtc?: string;
  validEndUtc?: string;
  forecastDiscussion?: string;
  launchDay?: ParsedScenario;
  delay24h?: ParsedScenario;
  launchDayPovPercent?: number;
  launchDayPrimaryConcerns?: string[];
  delay24hPovPercent?: number;
  delay24hPrimaryConcerns?: string[];
};

export function parseWs45ForecastText(text: string): ParsedForecast {
  const compact = normalizeText(text);

  const productName = compact.includes('Launch Mission Execution Forecast') ? 'Launch Mission Execution Forecast' : undefined;
  const missionNameRaw =
    matchGroup(compact, /Mission\s*:\s*(.+?)\s+Issued\s*:/i) ?? matchGroup(compact, /Mission\s*:\s*(.+?)\s+Valid\s*:/i);
  const missionName = missionNameRaw ? repairMissionName(missionNameRaw) : null;
  const missionNameNormalized = missionName ? normalizeMissionName(missionName) : undefined;
  const missionTokens = missionName ? tokenizeMissionName(missionName) : undefined;

  const issued = parseIssuedUtc(compact);
  const valid = parseValidUtc(compact);
  const forecastDiscussion = matchGroup(compact, /Forecast\s+Discuss(?:ion|io\s*n)\s*:\s*(.+?)\s+Launch\s+Day\b/i);

  const delay24Header = /\b24\s*(?:-\s*)?Hour\s+Delay\b/i;
  const delay48Header = /\b48\s*(?:-\s*)?Hour\s+Delay\b/i;
  const delay72Header = /\b72\s*(?:-\s*)?Hour\s+Delay\b/i;
  const sectionTailHeaders = [/\bNotes\b/i, /\bNext Forecast\b/i];

  const launchDaySection = sliceBetweenAny(compact, /\bLaunch Day\b/i, [
    delay24Header,
    delay48Header,
    delay72Header,
    ...sectionTailHeaders
  ]);
  const delay24Section = sliceBetweenAny(compact, delay24Header, [delay48Header, delay72Header, ...sectionTailHeaders]);
  const delay48Section = sliceBetweenAny(compact, delay48Header, [delay72Header, ...sectionTailHeaders]);
  const delay72Section = sliceBetweenAny(compact, delay72Header, sectionTailHeaders);
  const delaySelection = delay24Section
    ? { section: delay24Section, label: '24-Hour Delay' }
    : delay48Section
      ? { section: delay48Section, label: '48-Hour Delay' }
      : delay72Section
        ? { section: delay72Section, label: '72-Hour Delay' }
        : null;

  const launchDay = launchDaySection ? parseScenario(launchDaySection) : undefined;
  const delay24h = delaySelection ? parseScenario(delaySelection.section) : undefined;
  if (delay24h && delaySelection) delay24h.label = delaySelection.label;

  return {
    productName,
    missionName: missionName || undefined,
    missionNameNormalized,
    missionTokens,
    issuedAtUtc: issued ?? undefined,
    validStartUtc: valid?.start ?? undefined,
    validEndUtc: valid?.end ?? undefined,
    forecastDiscussion: forecastDiscussion || undefined,
    launchDay,
    delay24h,
    launchDayPovPercent: launchDay?.povPercent,
    launchDayPrimaryConcerns: launchDay?.primaryConcerns,
    delay24hPovPercent: delay24h?.povPercent,
    delay24hPrimaryConcerns: delay24h?.primaryConcerns
  };
}

export function normalizeMissionName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeMissionName(name: string) {
  const base = normalizeMissionName(name);
  const tokens = base.split(' ').filter(Boolean);
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    if (token.includes('-')) token.split('-').filter(Boolean).forEach((part) => expanded.add(part));
  }
  return Array.from(expanded);
}

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function matchGroup(text: string, re: RegExp) {
  const match = text.match(re);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function sliceBetweenAny(text: string, start: RegExp, endPatterns: RegExp[]) {
  const startMatch = text.match(start);
  if (startMatch?.index == null) return null;
  const startIndex = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIndex);
  let endIndex = rest.length;

  for (const pattern of endPatterns) {
    const match = rest.match(pattern);
    if (match?.index == null) continue;
    if (match.index < endIndex) endIndex = match.index;
  }

  const sliced = rest.slice(0, endIndex).trim();
  return sliced || null;
}

function parseIssuedUtc(compact: string) {
  const issuedBlock = sliceBetweenAny(compact, /Issued\s*:/i, [/\bValid\s*:/i]);
  if (!issuedBlock) return null;

  const match = issuedBlock.match(/(.+?)\s*\/\s*([0-9](?:\s*[0-9]){2,3})\s*L\s*\(\s*([0-9](?:\s*[0-9]){2,3})\s*Z\s*\)/i);
  if (!match) return null;
  const date = parseDayMonthYear(match[1]);
  if (!date) return null;
  const localMinutes = parseTimeMinutes(match[2]);
  const utcMinutes = parseTimeMinutes(match[3]);
  if (localMinutes == null || utcMinutes == null) return null;
  const offsetMinutes = inferOffsetMinutes(localMinutes, utcMinutes);
  return buildUtcTimestamp(date, localMinutes, offsetMinutes).toISOString();
}

function parseValidUtc(compact: string) {
  const validBlock = sliceBetweenAny(compact, /Valid\s*:/i, [/\bForecast\s+Discuss(?:ion|io\s*n)\b/i, /\bLaunch Day\b/i]);
  if (!validBlock) return null;

  const match = validBlock.match(/(.+?)\s*\/\s*([^()]+?)\s*\(\s*([^)]+?)\s*\)/i);
  if (!match) return null;

  const date = parseDayMonthYear(match[1]);
  if (!date) return null;

  const localRange = parseWs45TimeRange(match[2], 'L');
  const utcRange = parseWs45TimeRange(match[3], 'Z');
  if (!localRange || !utcRange) return null;

  const localStartMinutes = localRange.start.minutes;
  const localEndMinutes = localRange.end.minutes;
  const utcStartMinutes = utcRange.start.minutes;
  if (localStartMinutes == null || localEndMinutes == null || utcStartMinutes == null) return null;

  const offsetMinutes = inferOffsetMinutes(localStartMinutes, utcStartMinutes);

  const startBase = localRange.start.day != null ? resolveWs45Day(date, localRange.start.day) : date;
  const start = buildUtcTimestamp(startBase, localStartMinutes, offsetMinutes);

  let endBase: { y: number; m: number; d: number };
  if (localRange.end.day != null) {
    endBase = resolveWs45Day(startBase, localRange.end.day);
  } else {
    endBase = localEndMinutes < localStartMinutes ? addDaysUtc(startBase, 1) : startBase;
  }
  const end = buildUtcTimestamp(endBase, localEndMinutes, offsetMinutes);

  if (end.getTime() <= start.getTime()) {
    return { start: start.toISOString(), end: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function parseWs45TimeRange(raw: string, zone: 'L' | 'Z') {
  let cleaned = raw.trim().replace(/\s+/g, ' ');
  cleaned = cleaned.replace(new RegExp(`\\s*${zone}\\s*$`, 'i'), '').trim();
  cleaned = cleaned.replace(/\bUTC\b\s*$/i, '').trim();

  const parts = cleaned.split(/\s*-\s*/);
  if (parts.length < 2) return null;
  const startRaw = parts[0]?.trim() ?? '';
  const endRaw = parts.slice(1).join('-').trim();

  return {
    start: parseWs45DayTimeToken(startRaw),
    end: parseWs45DayTimeToken(endRaw)
  };
}

function parseWs45DayTimeToken(raw: string): { raw: string; day: number | null; minutes: number | null } {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { raw, day: null, minutes: null };

  const slashIndex = cleaned.indexOf('/');
  if (slashIndex >= 0) {
    const left = cleaned.slice(0, slashIndex);
    const right = cleaned.slice(slashIndex + 1);
    const parsedDay = parseSpacedInt(left);
    const day = parsedDay != null && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : null;
    return { raw: cleaned, day, minutes: parseTimeMinutes(right) };
  }

  const digits = cleaned.replace(/[^0-9]/g, '');
  if (digits.length > 4 && digits.length <= 6) {
    const dayDigits = digits.slice(0, digits.length - 4);
    const timeDigits = digits.slice(-4);
    const dayCandidate = Number(dayDigits);
    const day = Number.isFinite(dayCandidate) && dayCandidate >= 1 && dayCandidate <= 31 ? dayCandidate : null;
    const minutes = parseTimeMinutes(timeDigits);
    if (day != null && minutes != null) return { raw: cleaned, day, minutes };
  }

  return { raw: cleaned, day: null, minutes: parseTimeMinutes(cleaned) };
}

function resolveWs45Day(base: { y: number; m: number; d: number }, targetDay: number, maxLookaheadDays = 2) {
  if (!Number.isFinite(targetDay) || targetDay < 1 || targetDay > 31) return base;
  const day = Math.trunc(targetDay);
  for (let offset = 0; offset <= maxLookaheadDays; offset += 1) {
    const candidate = addDaysUtc(base, offset);
    if (candidate.d === day) return candidate;
  }
  return base;
}

function parseScenario(section: string): ParsedScenario {
  const scenario: ParsedScenario = { rawSection: section };

  const pov = parsePovPercent(section);
  if (pov != null) scenario.povPercent = pov;

  const concerns = matchGroup(
    section,
    /Primary Concerns\s*:\s*(.+?)(?:Weather Conditions|Weather\/Visibility\s*:|Weather\s*:|Temp\/Humidity\s*:)/i
  );
  if (concerns) {
    const parts = concerns
      .split(/[;,]/g)
      .map((part) => part.trim())
      .filter(Boolean);
    scenario.primaryConcerns = parts.length ? parts : [concerns.trim()];
  }

  const wxVisLegacy = matchGroup(
    section,
    /Weather\/Visibility\s*:\s*(.+?)(?:Clouds|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  const weather = matchGroup(
    section,
    /Weather\s*:\s*(.+?)(?:Visibility\s*:|Clouds(?:\s+Type)?|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  const visibility = matchGroup(
    section,
    /Visibility\s*:\s*(.+?)(?:Clouds(?:\s+Type)?|(?:Towering\s+)?Cumulus|Cirrus|Cirrostratus|Cirrocumulus|Stratus|Altocumulus|Altostratus|Cumulonimbus|Anvil|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  if (wxVisLegacy) {
    scenario.weatherVisibility = wxVisLegacy.trim();
  } else {
    const wxParts = [weather?.trim(), visibility?.trim()].filter(Boolean) as string[];
    if (wxParts.length) scenario.weatherVisibility = wxParts.join(' • ');
  }

  const tempHumidity = section.match(/Temp\/Humidity\s*:\s*([0-9]{1,3})\s*\u00b0?\s*F\s*\/\s*([0-9]{1,3})\s*%/i);
  if (tempHumidity) {
    scenario.tempF = clampInt(Number(tempHumidity[1]), -80, 160);
    scenario.humidityPercent = clampInt(Number(tempHumidity[2]), 0, 100);
  }

  const winds = parseLiftoffWinds(section);
  if (winds) scenario.liftoffWinds = winds;

  const upperShear = matchGroup(section, /Upper-Level Wind Shear\s*:\s*([A-Za-z]+)/i);
  const booster = matchGroup(section, /Booster Recovery Weather\s*:\s*([A-Za-z]+)/i);
  const solar = matchGroup(section, /Solar Activity\s*:\s*([A-Za-z]+)/i);
  if (upperShear || booster || solar) {
    scenario.additionalRiskCriteria = {
      upperLevelWindShear: upperShear || undefined,
      boosterRecoveryWeather: booster || undefined,
      solarActivity: solar || undefined
    };
  }

  const clouds = parseCloudLayers(section);
  if (clouds.length) scenario.clouds = clouds;

  return scenario;
}

function parseLiftoffWinds(section: string): ParsedScenario['liftoffWinds'] | null {
  const cleaned = section.replace(/[\u2019\u2032]/g, "'");
  const match = cleaned.match(
    /Liftoff Winds\s*\(200'\)\s*:\s*([0-9](?:\s*[0-9]){0,2})\s*\u00b0?\s*([0-9](?:\s*[0-9])?)\s*-\s*([0-9](?:\s*[0-9])?)\s*mph/i
  );
  if (match?.[1] && match?.[2] && match?.[3]) {
    const direction = Number(match[1].replace(/[^0-9]/g, ''));
    const min = Number(match[2].replace(/[^0-9]/g, ''));
    const max = Number(match[3].replace(/[^0-9]/g, ''));
    return {
      directionDeg: Number.isFinite(direction) ? clampInt(direction, 0, 360) : undefined,
      speedMphMin: Number.isFinite(min) ? clampInt(min, 0, 200) : undefined,
      speedMphMax: Number.isFinite(max) ? clampInt(max, 0, 200) : undefined,
      raw: match[0]
    };
  }

  const singleMatch = cleaned.match(
    /Liftoff Winds\s*\(200'\)\s*:\s*([0-9](?:\s*[0-9]){0,2})\s*\u00b0?\s*([0-9](?:\s*[0-9])?)\s*mph/i
  );
  if (!singleMatch?.[1] || !singleMatch?.[2]) return null;
  const direction = Number(singleMatch[1].replace(/[^0-9]/g, ''));
  const speed = Number(singleMatch[2].replace(/[^0-9]/g, ''));
  return {
    directionDeg: Number.isFinite(direction) ? clampInt(direction, 0, 360) : undefined,
    speedMphMin: Number.isFinite(speed) ? clampInt(speed, 0, 200) : undefined,
    speedMphMax: Number.isFinite(speed) ? clampInt(speed, 0, 200) : undefined,
    raw: singleMatch[0]
  };
}

function parseCloudLayers(section: string) {
  const layers: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }> = [];
  const re =
    /((?:Towering\s+)?Cumulus|Cirrus|Cirrostratus|Cirrocumulus|Stratus|Altocumulus|Altostratus|Cumulonimbus|Anvil)\s+(Few|Scattered|Broken|Overcast|FEW|SCT|BKN|OVC|Br|BR)\s*([0-9]{1,3}(?:\s*,\s*[0-9]{3})?)\s+([0-9]{1,3}(?:\s*,\s*[0-9]{3})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section))) {
    layers.push({
      type: match[1],
      coverage: normalizeCloudCoverage(match[2]),
      baseFt: parseCommaNumber(match[3]),
      topsFt: parseCommaNumber(match[4]),
      raw: match[0]
    });
  }
  return layers;
}

function normalizeCloudCoverage(value: string) {
  const raw = value.trim().toUpperCase();
  if (raw === 'FEW') return 'Few';
  if (raw === 'SCATTERED' || raw === 'SCT') return 'Scattered';
  if (raw === 'BROKEN' || raw === 'BKN' || raw === 'BR') return 'Broken';
  if (raw === 'OVERCAST' || raw === 'OVC') return 'Overcast';
  return value.trim();
}

function parseCommaNumber(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function repairMissionName(name: string) {
  return collapseSplitShortAlphaTokens(name)
    .replace(/\s+/g, ' ')
    .trim();
}

function inferOffsetMinutes(localMinutes: number, utcMinutes: number) {
  const delta = utcMinutes - localMinutes;
  return ((delta % 1440) + 1440) % 1440;
}

function parseTimeMinutes(raw: string) {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const normalized = digits.length > 4 ? digits.slice(-4) : digits;
  const padded = normalized.padStart(4, '0');
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2, 4));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parsePovPercent(section: string): number | null {
  const leadingPercent = section.match(/^\s*([0-9](?:\s*[0-9]){0,2})\s*%\s*Primary Concerns/i);
  if (leadingPercent?.[1]) {
    const value = parseSpacedInt(leadingPercent[1]);
    if (value != null) return clampInt(value, 0, 100);
  }

  const snippet =
    sliceBetweenAny(section, /Probability of Violating Weather Constraints/i, [
      /Primary Concerns/i,
      /Weather Conditions/i,
      /Weather\/Visibility/i,
      /Weather\s*:/i,
      /Temp\/Humidity/i,
      /Liftoff Winds/i,
      /Pad Escape Winds/i,
      /Ascent Corridor Weather/i
    ]) ?? null;
  if (!snippet) return null;

  const arrow = snippet.match(/\u2192|->/);
  if (!arrow) {
    const value = parsePercentValueFromSnippet(snippet);
    if (value == null) return null;
    return clampInt(value, 0, 100);
  }

  const [before, after = ''] = snippet.split(/\u2192|->/);
  const candidates: number[] = [];

  for (const match of before.matchAll(/[0-9]{1,3}/g)) {
    const parsed = Number(match[0]);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }

  for (const match of before.matchAll(/([0-9])\s+([0-9])/g)) {
    const parsed = Number(`${match[1]}${match[2]}`);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }

  const startVal = candidates.length ? Math.max(...candidates) : null;
  const endVal = parsePercentValueFromSnippet(after);
  const values = [startVal, endVal].filter((value): value is number => value != null && value >= 0 && value <= 100);
  if (!values.length) return null;
  return clampInt(Math.max(...values), 0, 100);
}

function parsePercentValueFromSnippet(snippet: string): number | null {
  const percentIndex = snippet.indexOf('%');
  if (percentIndex < 0) return null;
  const prefix = snippet.slice(0, percentIndex).trim();
  if (!prefix) return null;

  const spacedThree = prefix.match(/([0-9])\s+([0-9])\s+([0-9])\s*$/);
  if (spacedThree) {
    const value = parseSpacedInt(`${spacedThree[1]}${spacedThree[2]}${spacedThree[3]}`);
    if (value != null) return value;
  }

  const spacedTwo = prefix.match(/([0-9])\s+([0-9])\s*$/);
  if (spacedTwo) {
    const value = parseSpacedInt(`${spacedTwo[1]}${spacedTwo[2]}`);
    if (value != null) return value;
  }

  const contiguous = prefix.match(/([0-9]{1,3})\s*$/);
  if (contiguous?.[1]) {
    const value = parseSpacedInt(contiguous[1]);
    if (value != null) return value;
  }

  return null;
}

function buildUtcTimestamp(date: { y: number; m: number; d: number }, localMinutes: number, offsetMinutes: number) {
  const total = localMinutes + offsetMinutes;
  const dayShift = Math.floor(total / 1440);
  const mins = ((total % 1440) + 1440) % 1440;
  const shifted = addDaysUtc(date, dayShift);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return new Date(Date.UTC(shifted.y, shifted.m, shifted.d, hours, minutes));
}

function addDaysUtc(date: { y: number; m: number; d: number }, days: number) {
  const base = Date.UTC(date.y, date.m, date.d);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

function parseDayMonthYear(value: string): { y: number; m: number; d: number } | null {
  const cleaned = value
    .trim()
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');
  const normalized = collapseSplitShortAlphaTokens(cleaned);
  const match = normalized.match(/^([0-9](?:\s*[0-9])?)[-\s]+([A-Za-z]+)\.?[-\s]+([0-9](?:\s*[0-9]){1,3})$/i);
  if (!match) return null;
  const day = parseSpacedInt(match[1]);
  const year = normalizeWs45Year(parseSpacedInt(match[3]));
  const month = monthIndex(match[2].toLowerCase());
  if (month == null || day == null || year == null) return null;
  return { y: year, m: month, d: day };
}

function parseSpacedInt(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function collapseSplitShortAlphaTokens(value: string) {
  let current = value;
  let previous: string | null = null;
  while (current !== previous) {
    previous = current;
    current = current.replace(/\b([A-Za-z]{1,2})\s+([A-Za-z]{1,2})\b/g, '$1$2');
  }
  return current;
}

function normalizeWs45Year(year: number | null) {
  if (year == null) return null;
  return year < 100 ? 2000 + year : year;
}

function monthIndex(month: string) {
  const map: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  };
  return map[month] ?? null;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
