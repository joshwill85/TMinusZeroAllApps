import type { ArtemisProgramBudgetLine, ArtemisProgramProcurementAward } from '@/lib/server/artemisProgramIntel';
import {
  buildArtemisBudgetIdentityKey,
  buildArtemisProcurementIdentityKey,
  normalizeArtemisText,
  normalizeArtemisDateBucket
} from '@/lib/utils/artemisDedupe';

export function dedupeBudgetLinesForDisplay(lines: ArtemisProgramBudgetLine[]) {
  const grouped = new Map<string, ArtemisProgramBudgetLine[]>();

  for (const line of lines) {
    const key = buildArtemisBudgetIdentityKey({
      fiscalYear: line.fiscalYear,
      agency: line.agency,
      program: line.program,
      lineItem: line.lineItem,
      amountRequested: line.amountRequested,
      amountEnacted: line.amountEnacted,
      announcedTime: line.announcedTime,
      sourceClass: line.sourceClass,
      amountType: line.amountType,
      sourceUrl: line.sourceUrl,
      sourceTitle: line.sourceTitle,
      detail: line.detail
    });

    const list = grouped.get(key) || [];
    list.push(line);
    grouped.set(key, list);
  }

  const deduped: ArtemisProgramBudgetLine[] = [];
  for (const list of grouped.values()) {
    deduped.push(pickBestBudgetLine(list));
  }

  return deduped;
}

export function dedupeProcurementAwardsForDisplay(rows: ArtemisProgramProcurementAward[]) {
  const grouped = new Map<string, ArtemisProgramProcurementAward[]>();

  for (const row of rows) {
    const key = buildArtemisProcurementIdentityKey({
      awardId: row.awardId,
      title: row.title,
      recipient: row.recipient,
      obligatedAmount: row.obligatedAmount,
      awardedOn: row.awardedOn,
      missionKey: row.missionKey,
      sourceUrl: row.sourceUrl,
      sourceTitle: row.sourceTitle,
      detail: row.detail
    });

    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  const deduped: ArtemisProgramProcurementAward[] = [];
  for (const list of grouped.values()) {
    deduped.push(pickBestProcurementAward(list));
  }

  return deduped;
}

export function dedupeBudgetLinesForSparkline(lines: ArtemisProgramBudgetLine[]) {
  const grouped = new Map<string, ArtemisProgramBudgetLine[]>();

  for (const line of lines) {
    const key = buildBudgetSparklineIdentityKey(line);
    const list = grouped.get(key) || [];
    list.push(line);
    grouped.set(key, list);
  }

  const deduped: ArtemisProgramBudgetLine[] = [];
  for (const list of grouped.values()) {
    deduped.push(pickBestBudgetLine(list));
  }

  return deduped;
}

function pickBestBudgetLine(lines: ArtemisProgramBudgetLine[]) {
  return lines.slice().sort(compareBudgetLinePriority)[0] || lines[0];
}

function compareBudgetLinePriority(a: ArtemisProgramBudgetLine, b: ArtemisProgramBudgetLine) {
  const dateDiff = parseDateOrZero(b.announcedTime) - parseDateOrZero(a.announcedTime);
  if (dateDiff !== 0) return dateDiff;

  const sourceScoreDiff = scoreBudgetSource(b) - scoreBudgetSource(a);
  if (sourceScoreDiff !== 0) return sourceScoreDiff;

  const detailDiff = textLength(b.detail) - textLength(a.detail);
  if (detailDiff !== 0) return detailDiff;

  return (normalizeArtemisText(a.lineItem) || '').localeCompare(normalizeArtemisText(b.lineItem) || '');
}

function pickBestProcurementAward(rows: ArtemisProgramProcurementAward[]) {
  return rows.slice().sort(compareProcurementPriority)[0] || rows[0];
}

function compareProcurementPriority(a: ArtemisProgramProcurementAward, b: ArtemisProgramProcurementAward) {
  const dateDiff = parseDateOrZero(b.awardedOn) - parseDateOrZero(a.awardedOn);
  if (dateDiff !== 0) return dateDiff;

  const amountDiff = (b.obligatedAmount || 0) - (a.obligatedAmount || 0);
  if (amountDiff !== 0) return amountDiff;

  const sourceScoreDiff = scoreProcurementSource(b) - scoreProcurementSource(a);
  if (sourceScoreDiff !== 0) return sourceScoreDiff;

  return (normalizeArtemisText(a.awardId) || '').localeCompare(normalizeArtemisText(b.awardId) || '');
}

function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreBudgetSource(line: ArtemisProgramBudgetLine) {
  const sourceClass = normalizeArtemisText(line.sourceClass);
  const sourceUrl = normalizeArtemisText(line.sourceUrl);
  const dateBucket = normalizeArtemisDateBucket(line.announcedTime);
  let score = 0;
  if (sourceClass === 'nasa-budget-document') score += 2;
  if (sourceClass === 'usaspending-budgetary-resources') score += 1;
  if (sourceUrl) score += 1;
  if (dateBucket !== 'na') score += 1;
  return score;
}

function scoreProcurementSource(row: ArtemisProgramProcurementAward) {
  let score = 0;
  if (row.contractStory) score += 2;
  if (normalizeArtemisText(row.sourceUrl)) score += 1;
  if (normalizeArtemisText(row.sourceTitle)) score += 1;
  if (normalizeArtemisText(row.detail)) score += 1;
  return score;
}

function textLength(value: string | null | undefined) {
  return normalizeArtemisText(value).length;
}

function buildBudgetSparklineIdentityKey(line: ArtemisProgramBudgetLine) {
  return [
    line.fiscalYear ?? 'na',
    normalizeArtemisText(line.agency) || 'na',
    normalizeArtemisText(line.program) || 'na',
    normalizeArtemisText(line.lineItem) || 'na',
    normalizeArtemisText(line.amountType) || 'na'
  ].join('|');
}
