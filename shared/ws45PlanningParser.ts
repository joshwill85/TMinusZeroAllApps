export type Ws45PlanningProductKind = 'planning_24h' | 'weekly_planning';

export type ParsedWs45PlanningForecast = {
  productKind: Ws45PlanningProductKind;
  issuedAtUtc: string | null;
  validStartUtc: string | null;
  validEndUtc: string | null;
  headline: string | null;
  summary: string | null;
  highlights: string[];
  documentFamily: string | null;
  parseStatus: 'parsed' | 'partial' | 'failed';
  parseConfidence: number;
  publishEligible: boolean;
  quarantineReasons: string[];
};

export function parseWs45PlanningForecast(input: {
  text: string;
  productKind: Ws45PlanningProductKind;
  sourceLabel?: string | null;
  fetchedAt?: string | null;
}): ParsedWs45PlanningForecast {
  const normalizedText = normalizePlanningText(input.text);
  const sentences = extractCandidateSentences(normalizedText);
  const issuedAtUtc = parseIssuedAtUtc({
    text: normalizedText,
    sourceLabel: input.sourceLabel ?? null,
    fetchedAt: input.fetchedAt ?? null
  });
  const validStartUtc = issuedAtUtc;
  const validEndUtc = issuedAtUtc ? addHoursIso(issuedAtUtc, input.productKind === 'planning_24h' ? 24 : 24 * 7) : null;
  const headline = pickHeadline(sentences, input.productKind);
  const highlights = pickHighlights(sentences, input.productKind);
  const summary = buildSummary(sentences, highlights, headline);
  const documentFamily = detectDocumentFamily(normalizedText, input.productKind);

  const parseStatus =
    normalizedText.length < 40
      ? 'failed'
      : headline && summary
        ? 'parsed'
        : normalizedText.length >= 40
          ? 'partial'
          : 'failed';
  const quarantineReasons = [
    normalizedText.length < 40 ? 'raw_text_too_short' : null,
    !headline ? 'missing_headline' : null,
    !summary ? 'missing_summary' : null,
    !issuedAtUtc ? 'missing_issue_time' : null
  ].filter(Boolean) as string[];
  const parseConfidence =
    parseStatus === 'parsed'
      ? issuedAtUtc
        ? 88
        : 76
      : parseStatus === 'partial'
        ? 58
        : 18;

  return {
    productKind: input.productKind,
    issuedAtUtc,
    validStartUtc,
    validEndUtc,
    headline,
    summary,
    highlights,
    documentFamily,
    parseStatus,
    parseConfidence,
    publishEligible: parseStatus !== 'failed' && Boolean(summary),
    quarantineReasons
  };
}

function normalizePlanningText(text: string) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
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
  const keyword = productKind === 'planning_24h' ? /\b(today|tonight|through|winds?|showers?|storms?|clouds?|weather)\b/i : /\b(week|weekly|trend|pattern|front|showers?|storms?|winds?)\b/i;
  return sentences.find((sentence) => keyword.test(sentence)) ?? sentences[0] ?? null;
}

function pickHighlights(sentences: string[], productKind: Ws45PlanningProductKind) {
  const keyword = productKind === 'planning_24h'
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

function parseIssuedAtUtc(input: { text: string; sourceLabel: string | null; fetchedAt: string | null }) {
  const localMatch = findDateAndTime(`${input.sourceLabel || ''}\n${input.text}`);
  if (localMatch) return localMatch;
  return normalizeIso(input.fetchedAt);
}

function findDateAndTime(text: string) {
  const patterns = [
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

function parseLooseDate(raw: string) {
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

  let match = compact.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
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

  return null;
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
