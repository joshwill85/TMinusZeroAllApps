export type Ws45PlanningProductKind = 'planning_24h' | 'weekly_planning';

export type Ws45PlanningLayoutPart = {
  text: string;
  x: number;
};

export type Ws45PlanningLayoutLine = {
  page: number;
  y: number;
  text: string;
  parts: Ws45PlanningLayoutPart[];
};

export type Ws45Planning24hPeriod = {
  label: string;
  dayLabel: string | null;
  skyCondition: string | null;
  precipitationProbabilityPct: number | null;
  lightningProbabilityPct: number | null;
  wind: string | null;
  temperatureLabel: string | null;
  temperatureMinF: number | null;
  temperatureMaxF: number | null;
  severeWeatherPotential: string | null;
};

export type Ws45Planning24hStructuredPayload = {
  kind: 'planning_24h';
  title: string | null;
  issueDateLabel: string | null;
  location: string | null;
  periods: Ws45Planning24hPeriod[];
  remarks: string[];
  sourceNotes: string[];
  preparedBy: string | null;
  sunriseZulu: string | null;
  sunsetZulu: string | null;
  coverageNote: string | null;
  contact: string | null;
};

export type Ws45PlanningWeeklyDayPart = {
  skyCondition: string | null;
  precipitationProbabilityPct: number | null;
  lightningProbabilityPct: number | null;
  wind: string | null;
};

export type Ws45PlanningWeeklyDay = {
  dateLabel: string;
  dayLabel: string | null;
  am: Ws45PlanningWeeklyDayPart;
  pm: Ws45PlanningWeeklyDayPart;
  minTempF: number | null;
  maxTempF: number | null;
  severeWeatherPotential: string | null;
};

export type Ws45PlanningWeeklyStructuredPayload = {
  kind: 'weekly_planning';
  title: string | null;
  issueDateLabel: string | null;
  location: string | null;
  postedLabel: string | null;
  days: Ws45PlanningWeeklyDay[];
  remarks: string[];
  sourceNotes: string[];
  preparedBy: string | null;
  contact: string | null;
  climate:
    | {
        rainProbabilityPct: number | null;
        lightningProbabilityPct: number | null;
        lowTempF: number | null;
        highTempF: number | null;
      }
    | null;
};

export type Ws45PlanningStructuredPayload = Ws45Planning24hStructuredPayload | Ws45PlanningWeeklyStructuredPayload;

export type ParsedWs45PlanningForecast = {
  productKind: Ws45PlanningProductKind;
  issuedAtUtc: string | null;
  validStartUtc: string | null;
  validEndUtc: string | null;
  headline: string | null;
  summary: string | null;
  highlights: string[];
  structuredPayload: Ws45PlanningStructuredPayload | null;
  documentFamily: string | null;
  parseStatus: 'parsed' | 'partial' | 'failed';
  parseConfidence: number;
  publishEligible: boolean;
  quarantineReasons: string[];
};

export function parseWs45PlanningForecast(input: {
  text: string;
  productKind: Ws45PlanningProductKind;
  layoutLines?: Ws45PlanningLayoutLine[] | null;
  sourceLabel?: string | null;
  fetchedAt?: string | null;
}): ParsedWs45PlanningForecast {
  const normalizedText = normalizePlanningText(input.text);
  const layoutLines = normalizeLayoutLines(input.layoutLines);
  const sentences = extractCandidateSentences(normalizedText);
  const structuredPayload =
    input.productKind === 'planning_24h'
      ? parsePlanning24hStructured(layoutLines)
      : parseWeeklyStructured(layoutLines);

  const issuedAtUtc = parseIssuedAtUtc({
    text: normalizedText,
    sourceLabel: input.sourceLabel ?? null,
    fetchedAt: input.fetchedAt ?? null,
    structuredPayload
  });
  const validStartUtc = issuedAtUtc;
  const validEndUtc = issuedAtUtc ? addHoursIso(issuedAtUtc, input.productKind === 'planning_24h' ? 24 : 24 * 7) : null;

  const derived = structuredPayload ? summarizeStructuredPayload(structuredPayload) : null;
  const fallbackHeadline = pickHeadline(sentences, input.productKind);
  const fallbackHighlights = pickHighlights(sentences, input.productKind);
  const fallbackSummary = buildSummary(sentences, fallbackHighlights, fallbackHeadline);

  const headline = derived?.headline ?? fallbackHeadline;
  const summary = derived?.summary ?? fallbackSummary;
  const highlights = derived?.highlights?.length ? derived.highlights : fallbackHighlights;
  const documentFamily = detectDocumentFamily(normalizedText, input.productKind);

  const structuredState = evaluateStructuredPayload(structuredPayload);
  const parseStatus =
    structuredState === 'parsed'
      ? 'parsed'
      : structuredState === 'partial'
        ? 'partial'
        : normalizedText.length < 40
          ? 'failed'
          : headline && summary
            ? 'partial'
            : normalizedText.length >= 40
              ? 'partial'
              : 'failed';
  const quarantineReasons = [
    normalizedText.length < 40 ? 'raw_text_too_short' : null,
    !headline ? 'missing_headline' : null,
    !summary ? 'missing_summary' : null,
    !issuedAtUtc ? 'missing_issue_time' : null,
    structuredState === 'failed' && layoutLines.length ? 'structured_parse_unavailable' : null
  ].filter(Boolean) as string[];
  const parseConfidence =
    parseStatus === 'parsed'
      ? issuedAtUtc
        ? 96
        : 90
      : parseStatus === 'partial'
        ? structuredPayload
          ? 78
          : 58
        : 18;

  return {
    productKind: input.productKind,
    issuedAtUtc,
    validStartUtc,
    validEndUtc,
    headline,
    summary,
    highlights,
    structuredPayload,
    documentFamily,
    parseStatus,
    parseConfidence,
    publishEligible: parseStatus !== 'failed' && Boolean(summary || structuredPayload),
    quarantineReasons
  };
}

function parsePlanning24hStructured(lines: Ws45PlanningLayoutLine[]): Ws45Planning24hStructuredPayload | null {
  return parsePlanning24hStructuredGrid(lines) ?? parsePlanning24hStructuredTransposed(lines);
}

function parsePlanning24hStructuredGrid(lines: Ws45PlanningLayoutLine[]): Ws45Planning24hStructuredPayload | null {
  if (!lines.length) return null;

  const title = findLineText(lines, /\b24 Hour Forecast\b/i);
  const issueDateLabel = findLineText(lines, /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/i);
  const location = findLineText(lines, /Cape Canaveral Space Force Station/i);
  const periodLine = findLine(lines, /\d{4}L-\d{4}L/i, 6);
  if (!periodLine) return null;

  const periodParts = periodLine.parts.filter((part) => /\d{4}L-\d{4}L/i.test(part.text));
  if (periodParts.length < 6) return null;

  const periodLabels = periodParts.map((part) => normalizeCellText(part.text)).filter(Boolean) as string[];
  const centers = periodParts.map((part) => part.x);
  const minX = centers[0] - 40;

  const dayLabels = extractLineBuckets(findLine(lines, /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i, 6), centers, minX);
  const skyValues = extractBucketsForLabel(lines, 'Sky Condition', centers, minX);
  const precipitationValues = extractBucketsForLabel(lines, 'Precipitation Probability', centers, minX);
  const lightningValues = extractBucketsForLabel(lines, 'Lightning Probability', centers, minX);
  const windValues = extractBucketsForLabel(lines, 'Surface Winds (KTS)', centers, minX);
  const temperatureValues = extractBucketsForLabel(lines, 'Temperature', centers, minX);
  const severeValues = extractBucketsForLabel(lines, 'Severe Weather Potential', centers, minX);

  const periods = periodLabels.map<Ws45Planning24hPeriod>((label, index) => {
    const temperature = parseTemperatureRange(temperatureValues[index]);
    return {
      label,
      dayLabel: dayLabels[index] || null,
      skyCondition: skyValues[index] || null,
      precipitationProbabilityPct: parsePercent(precipitationValues[index]),
      lightningProbabilityPct: parsePercent(lightningValues[index]),
      wind: normalizeWindLabel(windValues[index]),
      temperatureLabel: temperatureValues[index] || null,
      temperatureMinF: temperature?.min ?? null,
      temperatureMaxF: temperature?.max ?? null,
      severeWeatherPotential: severeValues[index] || null
    };
  });

  const sourceNotes = uniqueStrings([
    findLineText(lines, /\(Severe Weather is defined/i),
    findLineText(lines, /Percentages refer to the probability/i)
  ]);
  const preparedBy = extractLabelValue(lines, 'Prepared by:');
  const sunriseZulu = extractLabelValue(lines, 'Sunrise(Z):');
  const sunsetZulu = extractLabelValue(lines, 'Sunset(Z):');
  const coverageNote = findLineText(lines, /Percentages refer to the probability/i);
  const contact = uniqueStrings([
    findLineText(lines, /MDOC,\s*CCSFS/i),
    findLineText(lines, /DSN\s+\d+-\d+/i)
  ]).join(' • ') || null;
  const remarks = collectRemarks(lines);

  if (!periods.some(hasUseful24hData)) return null;

  return {
    kind: 'planning_24h',
    title,
    issueDateLabel,
    location,
    periods,
    remarks,
    sourceNotes,
    preparedBy,
    sunriseZulu,
    sunsetZulu,
    coverageNote,
    contact
  };
}

function parsePlanning24hStructuredTransposed(lines: Ws45PlanningLayoutLine[]): Ws45Planning24hStructuredPayload | null {
  if (!lines.length) return null;

  const periodMarkers = lines
    .flatMap((line) =>
      line.parts
        .map((part) => normalizeCellText(part.text))
        .filter((value): value is string => typeof value === 'string' && /^\d{4}L-\d{4}L$/i.test(value))
        .map((label) => ({
          label,
          page: line.page,
          y: line.y
        }))
    )
    .sort((a, b) => a.y - b.y);

  const dedupedMarkers: Array<{ label: string; page: number; y: number }> = [];
  for (const marker of periodMarkers) {
    const duplicate = dedupedMarkers.find(
      (existing) => existing.page === marker.page && existing.label === marker.label && Math.abs(existing.y - marker.y) <= 6
    );
    if (!duplicate) dedupedMarkers.push(marker);
  }

  if (dedupedMarkers.length < 4) return null;

  const title = findLineText(lines, /\b24 Hour Forecast\b/i);
  const issueDateLabel = findLineText(lines, /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/i);
  const location = findLineText(lines, /Cape Canaveral Space Force Station/i);

  const periods = dedupedMarkers.slice(0, 6).map<Ws45Planning24hPeriod>((marker) => {
    const zoneParts = collectTransposedZoneParts(lines, marker.page, marker.y - 18, marker.y + 80);
    const temperatures = extractTransposedTemperatures(zoneParts);

    return {
      label: marker.label,
      dayLabel: extractTransposedWeekday(zoneParts),
      skyCondition: extractTransposedSky(zoneParts),
      precipitationProbabilityPct: extractTransposedPercent(zoneParts, 210, 245),
      lightningProbabilityPct: extractTransposedPercent(zoneParts, 245, 280),
      wind: extractTransposedWind(zoneParts),
      temperatureLabel:
        temperatures.min != null && temperatures.max != null
          ? temperatures.min === temperatures.max
            ? `${temperatures.max}F`
            : `${temperatures.max}F - ${temperatures.min}F`
          : null,
      temperatureMinF: temperatures.min,
      temperatureMaxF: temperatures.max,
      severeWeatherPotential: extractTransposedSevere(zoneParts)
    };
  });

  const sourceNotes = uniqueStrings([
    findLineText(lines, /\(Severe Weather is defined/i),
    findLineText(lines, /Percentages refer to the probability/i)
  ]);
  const preparedBy = extractLabelValue(lines, 'Prepared by:');
  const sunriseZulu = extractLabelValue(lines, 'Sunrise(Z):');
  const sunsetZulu = extractLabelValue(lines, 'Sunset(Z):');
  const coverageNote = findLineText(lines, /Percentages refer to the probability/i);
  const contact = uniqueStrings([
    findLineText(lines, /MDOC,\s*CCSFS/i),
    findLineText(lines, /DSN\s+\d+-\d+/i)
  ]).join(' • ') || null;
  const remarks = collectRemarks(lines);

  if (!periods.some(hasUseful24hData)) return null;

  return {
    kind: 'planning_24h',
    title,
    issueDateLabel,
    location,
    periods,
    remarks,
    sourceNotes,
    preparedBy,
    sunriseZulu,
    sunsetZulu,
    coverageNote,
    contact
  };
}

function parseWeeklyStructured(lines: Ws45PlanningLayoutLine[]): Ws45PlanningWeeklyStructuredPayload | null {
  if (!lines.length) return null;

  const title = findLineText(lines, /\bWeekly Planning Forecast\b/i);
  const issueDateLabel = findLineText(lines, /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/i);
  const location = findLineText(lines, /Cape Canaveral Space Force Station/i);
  const postedLabel = findLineText(lines, /Posted by/i);
  const dayLine = findLine(lines, /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i, 6);
  const dateLine = findLine(lines, /\d{1,2}-[A-Za-z]+/i, 6);
  if (!dayLine || !dateLine) return null;

  const dateParts = dateLine.parts.filter((part) => /\d{1,2}-[A-Za-z]+/i.test(part.text));
  if (dateParts.length < 6) return null;
  const centers = dateParts.map((part) => part.x);
  const minX = centers[0] - 40;
  const dateLabels = dateParts.map((part) => normalizeCellText(part.text)).filter(Boolean) as string[];
  const dayLabels = extractLineBuckets(dayLine, centers, minX);

  const amPmMarkers = lines.filter((line) => {
    const firstPart = line.parts[0]?.text?.trim().toUpperCase() ?? '';
    return (firstPart === 'AM' || firstPart === 'PM') && line.parts[0].x < 240;
  });
  const skyAmLine = amPmMarkers[0] ?? null;
  const skyPmLine = amPmMarkers[1] ?? null;
  const precipitationAmLine = amPmMarkers[2] ?? null;
  const precipitationPmLine = amPmMarkers[3] ?? null;
  const lightningAmLine = amPmMarkers[4] ?? null;
  const lightningPmLine = amPmMarkers[5] ?? null;
  const windAmLine = amPmMarkers[6] ?? null;
  const windPmLine = amPmMarkers[7] ?? null;

  const minTemperatureLine = findLineStartingWith(lines, 'MIN');
  const maxTemperatureLine = findLineStartingWith(lines, 'MAX');
  const severeValuesLine = findLine(lines, /\bNone\b/i, 6);

  const skyAmValues = extractBucketsFromLineOrBelow(lines, skyAmLine, centers, minX);
  const skyPmValues = extractBucketsFromLineOrBelow(lines, skyPmLine, centers, minX);
  const precipitationAmValues = extractBucketsFromLineOrBelow(lines, precipitationAmLine, centers, minX);
  const precipitationPmValues = extractBucketsFromLineOrBelow(lines, precipitationPmLine, centers, minX);
  const lightningAmValues = extractBucketsFromLineOrBelow(lines, lightningAmLine, centers, minX);
  const lightningPmValues = extractBucketsFromLineOrBelow(lines, lightningPmLine, centers, minX);
  const windAmValues = extractBucketsFromLineOrBelow(lines, windAmLine, centers, minX);
  const windPmValues = extractBucketsFromLineOrBelow(lines, windPmLine, centers, minX);
  const minTemperatureValues = extractBucketsFromLineOrBelow(lines, minTemperatureLine, centers, minX);
  const maxTemperatureValues = extractBucketsFromLineOrBelow(lines, maxTemperatureLine, centers, minX);
  const severeValues = extractLineBuckets(severeValuesLine, centers, minX);

  const days = dateLabels.map<Ws45PlanningWeeklyDay>((dateLabel, index) => ({
    dateLabel,
    dayLabel: dayLabels[index] || null,
    am: {
      skyCondition: skyAmValues[index] || null,
      precipitationProbabilityPct: parsePercent(precipitationAmValues[index]),
      lightningProbabilityPct: parsePercent(lightningAmValues[index]),
      wind: normalizeWindLabel(windAmValues[index])
    },
    pm: {
      skyCondition: skyPmValues[index] || null,
      precipitationProbabilityPct: parsePercent(precipitationPmValues[index]),
      lightningProbabilityPct: parsePercent(lightningPmValues[index]),
      wind: normalizeWindLabel(windPmValues[index])
    },
    minTempF: parseTemperatureValue(minTemperatureValues[index]),
    maxTempF: parseTemperatureValue(maxTemperatureValues[index]),
    severeWeatherPotential: severeValues[index] || null
  }));

  const sourceNotes = uniqueStrings([
    findLineText(lines, /\(Severe Weather is Defined/i),
    findLineText(lines, /Percentages refer to the probability/i),
    findLineText(lines, /MONTHLY AVERAGES/i)
  ]);
  const preparedBy = extractLabelValue(lines, 'Prepared by');
  const contact = uniqueStrings([
    findLineText(lines, /MDOC,\s*CCSFS/i),
    findLineText(lines, /COMM\s+\d+-\d+/i),
    findLineText(lines, /DSN\s+\d+-\d+/i)
  ]).join(' • ') || null;
  const climate = parseWeeklyClimate(lines);
  const remarks = collectRemarks(lines);

  if (!days.some(hasUsefulWeeklyData)) return null;

  return {
    kind: 'weekly_planning',
    title,
    issueDateLabel,
    location,
    postedLabel,
    days,
    remarks,
    sourceNotes,
    preparedBy,
    contact,
    climate
  };
}

function summarizeStructuredPayload(payload: Ws45PlanningStructuredPayload) {
  return payload.kind === 'planning_24h' ? summarizePlanning24h(payload) : summarizeWeeklyPlanning(payload);
}

function summarizePlanning24h(payload: Ws45Planning24hStructuredPayload) {
  const skies = payload.periods.map((period) => normalizeSkySummary(period.skyCondition)).filter(Boolean) as string[];
  const primarySky = mostCommon(skies);
  const precipitationMax = maxNumber(payload.periods.map((period) => period.precipitationProbabilityPct));
  const lightningMax = maxNumber(payload.periods.map((period) => period.lightningProbabilityPct));
  const tempMin = minNumber(payload.periods.map((period) => period.temperatureMinF));
  const tempMax = maxNumber(payload.periods.map((period) => period.temperatureMaxF));
  const windSummary = summarizeWindSet(payload.periods.map((period) => period.wind));
  const severeValues = uniqueStrings(payload.periods.map((period) => period.severeWeatherPotential));
  const severeSummary =
    severeValues.length && severeValues.some((value) => !/none/i.test(value))
      ? severeValues.filter((value) => !/none/i.test(value)).join(', ')
      : null;

  const headline = primarySky ? `${primarySky} through the 24-hour planning window` : '24-hour Cape planning outlook';
  const clauses = [
    precipitationMax != null ? `Precipitation stays ${precipitationMax}% or lower` : null,
    lightningMax != null ? `lightning remains ${lightningMax}% or lower` : null,
    windSummary ? stripTrailingPeriod(windSummary) : null,
    tempMin != null && tempMax != null ? `temperatures range from ${tempMin}F to ${tempMax}F` : null,
    severeSummary ? `severe weather potential includes ${severeSummary}` : 'No severe weather potential is indicated'
  ].filter(Boolean) as string[];

  return {
    headline,
    summary: clauses.length ? `${clauses.join('. ')}.` : headline,
    highlights: [
      precipitationMax != null ? `Precip ${precipitationMax}% max` : null,
      lightningMax != null ? `Lightning ${lightningMax}% max` : null,
      windSummary ? stripTrailingPeriod(windSummary) : null,
      tempMin != null && tempMax != null ? `Temps ${tempMin}-${tempMax}F` : null,
      severeSummary ? `Severe ${severeSummary}` : 'Severe none'
    ].filter(Boolean) as string[]
  };
}

function summarizeWeeklyPlanning(payload: Ws45PlanningWeeklyStructuredPayload) {
  const skies = payload.days
    .flatMap((day) => [normalizeSkySummary(day.am.skyCondition), normalizeSkySummary(day.pm.skyCondition)])
    .filter(Boolean) as string[];
  const primarySky = mostCommon(skies);
  const precipitationMax = maxNumber(
    payload.days.flatMap((day) => [day.am.precipitationProbabilityPct, day.pm.precipitationProbabilityPct])
  );
  const lightningMax = maxNumber(payload.days.flatMap((day) => [day.am.lightningProbabilityPct, day.pm.lightningProbabilityPct]));
  const tempMin = minNumber(payload.days.map((day) => day.minTempF));
  const tempMax = maxNumber(payload.days.map((day) => day.maxTempF));
  const windSummary = summarizeWindSet(payload.days.flatMap((day) => [day.am.wind, day.pm.wind]));
  const severeValues = uniqueStrings(payload.days.map((day) => day.severeWeatherPotential));
  const severeSummary =
    severeValues.length && severeValues.some((value) => !/none/i.test(value))
      ? severeValues.filter((value) => !/none/i.test(value)).join(', ')
      : null;

  const headline = primarySky ? `${primarySky} pattern through the weekly planning window` : 'Weekly Cape planning outlook';
  const clauses = [
    precipitationMax != null ? `Daily rain chances stay ${precipitationMax}% or lower` : null,
    lightningMax != null ? `lightning remains ${lightningMax}% or lower` : null,
    windSummary ? stripTrailingPeriod(windSummary) : null,
    tempMin != null && tempMax != null ? `lows run ${tempMin}-${maxNumber(payload.days.map((day) => day.minTempF)) ?? tempMin}F and highs ${minNumber(payload.days.map((day) => day.maxTempF)) ?? tempMax}-${tempMax}F` : null,
    severeSummary ? `severe weather potential includes ${severeSummary}` : 'No severe weather potential is indicated'
  ].filter(Boolean) as string[];

  return {
    headline,
    summary: clauses.length ? `${clauses.join('. ')}.` : headline,
    highlights: [
      precipitationMax != null ? `Rain ${precipitationMax}% max` : null,
      lightningMax != null ? `Lightning ${lightningMax}% max` : null,
      windSummary ? stripTrailingPeriod(windSummary) : null,
      tempMin != null && tempMax != null ? `Temps ${tempMin}-${tempMax}F overall` : null,
      severeSummary ? `Severe ${severeSummary}` : 'Severe none'
    ].filter(Boolean) as string[]
  };
}

function evaluateStructuredPayload(payload: Ws45PlanningStructuredPayload | null) {
  if (!payload) return 'failed' as const;
  if (payload.kind === 'planning_24h') {
    const usefulPeriods = payload.periods.filter(hasUseful24hData);
    if (usefulPeriods.length >= 6) return 'parsed' as const;
    if (usefulPeriods.length > 0) return 'partial' as const;
    return 'failed' as const;
  }
  const usefulDays = payload.days.filter(hasUsefulWeeklyData);
  if (usefulDays.length >= 6) return 'parsed' as const;
  if (usefulDays.length > 0) return 'partial' as const;
  return 'failed' as const;
}

function hasUseful24hData(period: Ws45Planning24hPeriod) {
  return Boolean(
    period.skyCondition ||
      period.precipitationProbabilityPct != null ||
      period.lightningProbabilityPct != null ||
      period.wind ||
      period.temperatureMinF != null ||
      period.temperatureMaxF != null
  );
}

function hasUsefulWeeklyData(day: Ws45PlanningWeeklyDay) {
  return Boolean(
    day.am.skyCondition ||
      day.pm.skyCondition ||
      day.am.precipitationProbabilityPct != null ||
      day.pm.precipitationProbabilityPct != null ||
      day.am.lightningProbabilityPct != null ||
      day.pm.lightningProbabilityPct != null ||
      day.am.wind ||
      day.pm.wind ||
      day.minTempF != null ||
      day.maxTempF != null
  );
}

function normalizeLayoutLines(lines: Ws45PlanningLayoutLine[] | null | undefined) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      page: Number.isFinite(Number(line?.page)) ? Number(line.page) : 1,
      y: Number.isFinite(Number(line?.y)) ? Number(line.y) : 0,
      text: normalizeLineText(line?.text),
      parts: normalizeLayoutParts(line?.parts)
    }))
    .filter((line) => line.text && line.parts.length)
    .sort((a, b) => (a.page === b.page ? b.y - a.y : a.page - b.page));
}

function normalizeLayoutParts(parts: Ws45PlanningLayoutLine['parts'] | null | undefined): Ws45PlanningLayoutPart[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      const text = normalizeCellText(part?.text);
      if (!text) return null;
      return {
        text,
        x: Number.isFinite(Number(part?.x)) ? Number(part.x) : 0
      };
    })
    .filter((part): part is Ws45PlanningLayoutPart => Boolean(part))
    .sort((a, b) => a.x - b.x);
}

function findLine(lines: Ws45PlanningLayoutLine[], pattern: RegExp, minMatches = 1) {
  return (
    lines.find((line) => {
      const matches = line.parts.filter((part) => pattern.test(part.text)).length;
      return matches >= minMatches || (minMatches === 1 && pattern.test(line.text));
    }) ?? null
  );
}

function findLineText(lines: Ws45PlanningLayoutLine[], pattern: RegExp) {
  return lines.find((line) => pattern.test(line.text))?.text ?? null;
}

function findLineStartingWith(lines: Ws45PlanningLayoutLine[], label: string) {
  const normalizedLabel = label.toLowerCase();
  return lines.find((line) => line.text.toLowerCase().startsWith(normalizedLabel)) ?? null;
}

function extractLineBuckets(line: Ws45PlanningLayoutLine | null, centers: number[], minX: number) {
  if (!line || !centers.length) return centers.map(() => null);
  const step = computeTableStep(centers);
  const values = centers.map(() => [] as string[]);
  for (const part of line.parts) {
    if (part.x < minX) continue;
    const rawIndex = Math.floor((part.x - minX) / step);
    const bucketIndex = Math.max(0, Math.min(values.length - 1, rawIndex));
    values[bucketIndex].push(part.text || '');
  }
  return values.map((bucket) => normalizeCellText(bucket.join(' ')));
}

function extractBucketsForLabel(lines: Ws45PlanningLayoutLine[], label: string, centers: number[], minX: number) {
  return extractBucketsFromLineOrBelow(lines, findLineStartingWith(lines, label), centers, minX);
}

function extractBucketsFromLineOrBelow(
  lines: Ws45PlanningLayoutLine[],
  line: Ws45PlanningLayoutLine | null,
  centers: number[],
  minX: number
) {
  if (!line) return centers.map(() => null);
  const directValues = extractLineBuckets(line, centers, minX);
  if (directValues.some(Boolean)) return directValues;

  const lineIndex = lines.findIndex((entry) => entry.page === line.page && entry.y === line.y && entry.text === line.text);
  if (lineIndex === -1) return directValues;

  for (let index = lineIndex + 1; index < Math.min(lines.length, lineIndex + 4); index += 1) {
    const candidate = lines[index];
    if (!candidate || candidate.page !== line.page) break;
    if (line.y - candidate.y > 12) break;
    const candidateValues = extractLineBuckets(candidate, centers, minX);
    if (candidateValues.some(Boolean)) return candidateValues;
  }

  return directValues;
}

function computeTableStep(centers: number[]) {
  if (centers.length < 2) return 160;
  const diffs = centers
    .slice(1)
    .map((center, index) => center - centers[index])
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(diffs.length / 2);
  return diffs[middle] ?? diffs[0] ?? 160;
}

function extractLabelValue(lines: Ws45PlanningLayoutLine[], label: string) {
  const line = lines.find((entry) => entry.text.includes(label));
  if (!line) return null;
  const labelIndex = line.text.indexOf(label);
  if (labelIndex >= 0) {
    const suffix = normalizeCellText(line.text.slice(labelIndex + label.length));
    if (suffix) return suffix;
  }
  const labelPart = line.parts.find((part) => part.text.includes(label));
  if (!labelPart) return null;
  const suffixParts = line.parts.filter((part) => part.x > labelPart.x + labelPart.text.length * 2);
  return normalizeCellText(suffixParts.map((part) => part.text).join(' '));
}

function collectRemarks(lines: Ws45PlanningLayoutLine[]) {
  return uniqueStrings(
    lines
      .filter((line) => /^remarks\b/i.test(line.text))
      .map((line) => normalizeCellText(line.text.replace(/^remarks\b[:\s-]*/i, '')))
      .filter((value) => value && value.length >= 4 && /\s/.test(value))
  );
}

function parseWeeklyClimate(lines: Ws45PlanningLayoutLine[]) {
  const valueLine = lines.find((line) => line.parts.some((part) => part.text === '35%') && line.parts.some((part) => part.text === '20%'));
  const tempLine = lines.find((line) => line.parts.some((part) => part.text === '60') && line.parts.some((part) => part.text === '78'));
  if (!valueLine && !tempLine) return null;

  const values = (valueLine?.parts ?? []).map((part) => normalizeCellText(part.text)).filter(Boolean) as string[];
  const temps = (tempLine?.parts ?? []).map((part) => normalizeCellText(part.text)).filter(Boolean) as string[];

  return {
    rainProbabilityPct: parsePercent(values.find((value) => value.includes('%')) ?? null),
    lightningProbabilityPct: parsePercent(values.find((value, index) => index > 0 && value.includes('%')) ?? null),
    lowTempF: parseTemperatureValue(temps.find((value) => /^\d+$/.test(value)) ?? null),
    highTempF: parseTemperatureValue(temps.find((value, index) => index > 0 && /^\d+$/.test(value)) ?? null)
  };
}

function collectTransposedZoneParts(lines: Ws45PlanningLayoutLine[], page: number, minY: number, maxY: number) {
  return lines
    .filter((line) => line.page === page && line.y >= minY && line.y <= maxY)
    .flatMap((line) =>
      line.parts
        .map((part) => ({
          text: normalizeCellText(part.text) ?? '',
          x: part.x,
          y: line.y
        }))
        .filter((part) => part.text)
    );
}

function extractTransposedWeekday(parts: Array<{ text: string; x: number; y: number }>) {
  const exact = parts.find(
    (part) => part.x >= 110 && part.x < 150 && /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i.test(part.text)
  );
  if (exact) return exact.text;
  return (
    parts
      .map((part) => part.text.match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i)?.[1] ?? null)
      .find(Boolean) ?? null
  );
}

function extractTransposedSky(parts: Array<{ text: string; x: number; y: number }>) {
  const values = uniqueStrings(
    parts
      .filter((part) => part.x >= 170 && part.x < 220)
      .map((part) => part.text.replace(/[^A-Za-z\s/-]/g, ' '))
      .filter((value) => /[A-Za-z]/.test(value) && !/^sky condition$/i.test(value) && !/^forecast$/i.test(value))
  );
  return normalizeSkySummary(values.join(' '));
}

function extractTransposedPercent(parts: Array<{ text: string; x: number; y: number }>, minX: number, maxX: number) {
  const values = parts
    .filter((part) => part.x >= minX && part.x < maxX)
    .flatMap((part) => Array.from(part.text.matchAll(/(\d{1,3})\s*%/g), (match) => Number(match[1])))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values[0] ?? null;
}

function extractTransposedWind(parts: Array<{ text: string; x: number; y: number }>) {
  const windParts = parts.filter((part) => part.x >= 278 && part.x < 310).map((part) => part.text);
  const directions = uniqueStrings(
    windParts.filter((value) =>
      /^(N|S|E|W|NE|NW|SE|SW|ENE|ESE|WNW|WSW|NNE|NNW|SSE|SSW)$/i.test(value)
    )
  ).map((value) => value.toUpperCase());
  const numbers = windParts
    .flatMap((value) => Array.from(value.matchAll(/\b\d{1,3}\b/g), (match) => Number(match[0])))
    .filter((value) => Number.isFinite(value));

  const sustained = numbers.length ? Math.min(...numbers) : null;
  const gust = numbers.length > 1 ? Math.max(...numbers) : null;
  if (!directions.length && sustained == null) return null;
  return [directions[0] ?? null, sustained != null ? String(sustained) : null, gust != null && gust > (sustained ?? -1) ? 'G' : null, gust != null && gust > (sustained ?? -1) ? String(gust) : null]
    .filter(Boolean)
    .join(' ');
}

function extractTransposedTemperatures(parts: Array<{ text: string; x: number; y: number }>) {
  const values = parts
    .filter((part) => part.x >= 320 && part.x < 345)
    .flatMap((part) => Array.from(part.text.matchAll(/(\d{2,3})\s*F?/gi), (match) => Number(match[1])))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return { min: null, max: null };
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function extractTransposedSevere(parts: Array<{ text: string; x: number; y: number }>) {
  const values = uniqueStrings(
    parts
      .filter((part) => part.x >= 390 && part.x < 420)
      .map((part) => part.text)
      .filter((value) => /[A-Za-z]/.test(value) && !/^remarks$/i.test(value))
  );
  return values[0] ?? null;
}

function parsePercent(value: string | null | undefined) {
  const match = String(value || '').match(/(\d{1,3})\s*%/);
  return match ? Number(match[1]) : null;
}

function parseTemperatureRange(value: string | null | undefined) {
  const numbers = Array.from(String(value || '').matchAll(/(\d{2,3})\s*F?/gi), (match) => Number(match[1])).filter((entry) =>
    Number.isFinite(entry)
  );
  if (!numbers.length) return null;
  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }
  return { max: numbers[0], min: numbers[1] };
}

function parseTemperatureValue(value: string | null | undefined) {
  const match = String(value || '').match(/(\d{2,3})\s*F?/i);
  return match ? Number(match[1]) : null;
}

function normalizeWindLabel(value: string | null | undefined) {
  const cleaned = normalizeCellText(value);
  if (!cleaned) return null;
  return cleaned.replace(/\s+/g, ' ');
}

function summarizeWindSet(values: Array<string | null | undefined>) {
  const parsed = values.map(parseWindValue).filter(Boolean) as Array<{ direction: string; sustained: number; gust: number | null }>;
  if (!parsed.length) {
    const fallback = uniqueStrings(values).join(' / ');
    return fallback ? `Winds vary ${fallback}.` : null;
  }

  const directions = uniqueStrings(parsed.map((entry) => entry.direction));
  const sustained = parsed.map((entry) => entry.sustained);
  const gusts = parsed.map((entry) => entry.gust).filter((entry): entry is number => entry != null);
  const sustainedMin = minNumber(sustained);
  const sustainedMax = maxNumber(sustained);
  const gustMax = maxNumber(gusts);
  const directionLabel = directions.length ? `from ${directions.join('/')}` : '';

  return `Winds ${directionLabel} ${formatRangeLabel(sustainedMin, sustainedMax, 'kt')}${gustMax != null ? ` with gusts to ${gustMax} kt` : ''}.`
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWindValue(value: string | null | undefined) {
  const match = normalizeCellText(value)?.match(/^([A-Za-z]{1,3})\s+(\d{1,3})(?:\s+G\s+(\d{1,3}))?$/i);
  if (!match) return null;
  return {
    direction: String(match[1]).toUpperCase(),
    sustained: Number(match[2]),
    gust: match[3] ? Number(match[3]) : null
  };
}

function formatRangeLabel(min: number | null, max: number | null, unit: string) {
  if (min == null && max == null) return '';
  if (min != null && max != null) return min === max ? `${min} ${unit}` : `${min}-${max} ${unit}`;
  return `${min ?? max} ${unit}`;
}

function maxNumber(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => Number.isFinite(Number(value)));
  return filtered.length ? Math.max(...filtered) : null;
}

function minNumber(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => Number.isFinite(Number(value)));
  return filtered.length ? Math.min(...filtered) : null;
}

function mostCommon(values: string[]) {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let winner: string | null = null;
  let winnerCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const deduped: string[] = [];
  for (const value of values) {
    const cleaned = normalizeCellText(value);
    if (!cleaned) continue;
    if (!deduped.includes(cleaned)) deduped.push(cleaned);
  }
  return deduped;
}

function normalizePlanningText(text: string) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function normalizeLineText(value: string | null | undefined) {
  return normalizeCellText(value)?.replace(/\s+/g, ' ') ?? '';
}

function normalizeCellText(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[ ]+([,.)])/g, '$1')
    .trim();
  return cleaned || null;
}

function normalizeSkySummary(value: string | null | undefined) {
  const cleaned = normalizeCellText(value);
  if (!cleaned) return null;
  return cleaned.replace(/^🌤\s*/u, '').replace(/^🌦\s*/u, '').replace(/^⛅\s*/u, '');
}

function extractCandidateSentences(text: string) {
  const rawSentences = text
    .split(/(?:\n+|(?<=[.?!])\s+)/)
    .map((value) => value.trim())
    .filter(Boolean);

  return rawSentences.filter((sentence) => {
    const normalized = sentence.toLowerCase();
    if (normalized.length < 18) return false;
    if (normalized.length > 240) return false;
    if (/^\d{1,2}\s+[a-z]{3,9}\s+\d{2,4}$/i.test(normalized)) return false;
    return true;
  });
}

function pickHeadline(sentences: string[], productKind: Ws45PlanningProductKind) {
  const keyword =
    productKind === 'planning_24h'
      ? /\b(today|tonight|through|winds?|showers?|storms?|clouds?|weather)\b/i
      : /\b(week|weekly|trend|pattern|front|showers?|storms?|winds?)\b/i;
  return sentences.find((sentence) => keyword.test(sentence)) ?? sentences[0] ?? null;
}

function pickHighlights(sentences: string[], productKind: Ws45PlanningProductKind) {
  const keyword =
    productKind === 'planning_24h'
      ? /\b(wind|storm|rain|lightning|temperature|cloud|shower|thunder)\b/i
      : /\b(week|trend|front|breeze|storm|rain|cloud|temperature)\b/i;

  const highlights: string[] = [];
  for (const sentence of sentences) {
    if (!keyword.test(sentence)) continue;
    const cleaned = trimSentence(sentence);
    if (!cleaned) continue;
    if (highlights.includes(cleaned)) continue;
    highlights.push(cleaned);
    if (highlights.length >= 4) break;
  }
  return highlights;
}

function buildSummary(sentences: string[], highlights: string[], headline: string | null) {
  if (highlights.length >= 2) {
    return highlights.slice(0, 2).join(' ');
  }
  const candidates = sentences.filter((sentence) => sentence !== headline).slice(0, 2);
  if (headline && candidates.length) return [trimSentence(headline), ...candidates.map(trimSentence)].filter(Boolean).join(' ');
  return trimSentence(headline) || trimSentence(sentences[0]) || null;
}

function trimSentence(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function detectDocumentFamily(text: string, productKind: Ws45PlanningProductKind) {
  const normalized = text.toLowerCase();
  if (productKind === 'planning_24h') {
    if (normalized.includes('24 hour planning forecast')) return 'planning_24h_named';
    if (normalized.includes('planning forecast')) return 'planning_24h_generic';
    return 'planning_24h_unknown';
  }
  if (normalized.includes('weekly planning forecast')) return 'weekly_planning_named';
  if (normalized.includes('weekly')) return 'weekly_planning_generic';
  return 'weekly_planning_unknown';
}

function parseIssuedAtUtc(input: {
  text: string;
  sourceLabel: string | null;
  fetchedAt: string | null;
  structuredPayload: Ws45PlanningStructuredPayload | null;
}) {
  const titleAndText = `${input.sourceLabel || ''}\n${input.text}`;
  const directMatch = findDateAndTime(titleAndText);
  if (directMatch) return directMatch;

  const weeklyPostedMatch =
    input.structuredPayload?.kind === 'weekly_planning'
      ? buildPostedDailyIso(input.structuredPayload.issueDateLabel, input.structuredPayload.postedLabel)
      : null;
  if (weeklyPostedMatch) return weeklyPostedMatch;

  return normalizeIso(input.fetchedAt);
}

function findDateAndTime(text: string) {
  const patterns = [
    /(\d{1,2}[A-Za-z]{3}\d{2,4})[^0-9]{0,24}(\d{3,4})\s*(L|LT|LOCAL|EDT|EST|Z|UTC)\b/i,
    /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})[^0-9]{0,24}(\d{3,4})\s*(L|LT|LOCAL|EDT|EST|Z|UTC)\b/i,
    /(\d{1,2}-[A-Za-z]{3}-\d{2,4})[^0-9]{0,24}(\d{3,4})\s*(L|LT|LOCAL|EDT|EST|Z|UTC)\b/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})[^0-9]{0,24}(\d{3,4})\s*(L|LT|LOCAL|EDT|EST|Z|UTC)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const datePart = parseLooseDate(match[1]);
    const timePart = parseTimeParts(match[2]);
    const zone = String(match[3] || '').toUpperCase();
    if (!datePart || !timePart) continue;
    const iso =
      zone === 'Z' || zone === 'UTC'
        ? new Date(Date.UTC(datePart.year, datePart.month - 1, datePart.day, timePart.hour, timePart.minute)).toISOString()
        : buildEasternIso(datePart.year, datePart.month, datePart.day, timePart.hour, timePart.minute);
    if (iso) return iso;
  }

  return null;
}

function buildPostedDailyIso(issueDateLabel: string | null, postedLabel: string | null) {
  const datePart = parseVerboseDate(issueDateLabel);
  if (!datePart) return null;
  const timeMatch = String(postedLabel || '').match(/(\d{1,2})L\b/i);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  if (!Number.isFinite(hour)) return null;
  return buildEasternIso(datePart.year, datePart.month, datePart.day, hour, 0);
}

function parseLooseDate(raw: string): { day: number; month: number; year: number } | null {
  const compact = String(raw || '').trim();
  const monthNames: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };

  let match = compact.match(/^(\d{1,2})([A-Za-z]{3})(\d{2,4})$/);
  if (match) {
    const month = monthNames[String(match[2]).toLowerCase()];
    if (!month) return null;
    return { day: Number(match[1]), month, year: normalizeYear(Number(match[3])) };
  }

  match = compact.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (match) {
    const month = monthNames[String(match[2]).toLowerCase()];
    if (!month) return null;
    return { day: Number(match[1]), month, year: normalizeYear(Number(match[3])) };
  }

  match = compact.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (match) {
    const month = monthNames[String(match[2]).toLowerCase()];
    if (!month) return null;
    return { day: Number(match[1]), month, year: normalizeYear(Number(match[3])) };
  }

  match = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    return { month: Number(match[1]), day: Number(match[2]), year: normalizeYear(Number(match[3])) };
  }

  return parseVerboseDate(compact);
}

function parseVerboseDate(raw: string | null | undefined): { day: number; month: number; year: number } | null {
  const compact = String(raw || '').trim();
  const match = compact.match(/^[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const month = parseLooseDate(`1 ${match[1]} ${match[3]}`)?.month ?? null;
  if (!month) return null;
  return {
    day: Number(match[2]),
    month,
    year: Number(match[3])
  };
}

function parseTimeParts(raw: string) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return null;
  const value = digits.length === 3 ? `0${digits}` : digits;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2, 4));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildEasternIso(year: number, month: number, day: number, hour: number, minute: number) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, 'America/New_York');
  if (offsetMinutes == null) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000).toISOString();
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      year: 'numeric'
    });
    const part = formatter.formatToParts(date).find((entry) => entry.type === 'timeZoneName')?.value || '';
    const match = part.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2] || '0');
    const sign = hours < 0 ? -1 : 1;
    return hours * 60 + sign * minutes;
  } catch {
    return null;
  }
}

function addHoursIso(value: string, hours: number) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + hours * 60 * 60 * 1000).toISOString();
}

function normalizeIso(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeYear(year: number) {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function stripTrailingPeriod(value: string) {
  return value.replace(/\.$/, '');
}
