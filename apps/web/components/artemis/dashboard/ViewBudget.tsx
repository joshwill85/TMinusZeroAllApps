'use client';

import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ProgramContractDiscoveryList } from '@/components/contracts/ProgramContractDiscoveryList';
import type { ContractStoryDetail } from '@/lib/types/contractsStory';
import {
  buildArtemisAwardeeHref,
  buildArtemisAwardeeRecipientKey,
  buildArtemisAwardeeSlug,
  normalizeArtemisAwardeeName
} from '@/lib/utils/artemisAwardees';
import { formatCurrency, formatCurrencyCompact, formatUpdatedLabel } from './formatters';
import { MissionControlCard } from './MissionControlCard';
import { MissionControlEmptyState } from './MissionControlEmptyState';
import { dedupeBudgetLinesForDisplay, dedupeProcurementAwardsForDisplay } from './budgetLineUtils';
import type { ArtemisMissionControlProps } from './types';

type BudgetSortKey = 'fiscalYear' | 'requested' | 'enacted' | 'lineItem';
type RecipientOption = { value: string; label: string; count: number };
const CLAMPED_TEXT_STYLE = {
  display: '-webkit-box' as CSSProperties['display'],
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden'
} as CSSProperties;

export function ViewBudget({ programIntel }: Pick<ArtemisMissionControlProps, 'programIntel'>) {
  const [sortKey, setSortKey] = useState<BudgetSortKey>('fiscalYear');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [budgetFiscalYearFilter, setBudgetFiscalYearFilter] = useState<string>('all');
  const [budgetSearch, setBudgetSearch] = useState('');
  const [budgetDocumentsExpanded, setBudgetDocumentsExpanded] = useState(false);

  const [procurementFiscalYearFilter, setProcurementFiscalYearFilter] = useState<string>('all');
  const [procurementAwardFamilyFilter, setProcurementAwardFamilyFilter] = useState<string>('all');
  const [procurementMissionFilter, setProcurementMissionFilter] = useState<string>('all');
  const [procurementRecipientFilter, setProcurementRecipientFilter] = useState<string>('all');
  const [procurementSearch, setProcurementSearch] = useState('');
  const [procurementAmountDirection, setProcurementAmountDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedAwardDetails, setExpandedAwardDetails] = useState<Record<string, boolean>>({});
  const [procurementRowsExpanded, setProcurementRowsExpanded] = useState(false);
  const [expandedStoryRows, setExpandedStoryRows] = useState<Record<string, boolean>>({});
  const [storyDetails, setStoryDetails] = useState<Record<string, ContractStoryDetail | null>>({});
  const [storyLoading, setStoryLoading] = useState<Record<string, boolean>>({});
  const [storyErrors, setStoryErrors] = useState<Record<string, string>>({});

  const budgetLineItems = useMemo(() => {
    const lines = programIntel.budgetLines.filter((line) => {
      if (line.sourceClass === 'usaspending-budgetary-resources') return false;
      return line.amountRequested != null || line.amountEnacted != null;
    });
    return dedupeBudgetLinesForDisplay(lines);
  }, [programIntel.budgetLines]);

  const budgetDocumentRows = useMemo(() => {
    return programIntel.budgetLines.filter((line) => line.sourceClass === 'nasa-budget-document');
  }, [programIntel.budgetLines]);

  const procurementAwardItems = useMemo(() => {
    return dedupeProcurementAwardsForDisplay(programIntel.procurementAwards);
  }, [programIntel.procurementAwards]);

  const sortedBudgetDocuments = useMemo(() => {
    return [...budgetDocumentRows].sort((a, b) => {
      const yearDiff = (b.fiscalYear || 0) - (a.fiscalYear || 0);
      if (yearDiff !== 0) return yearDiff;
      const dateDiff = Date.parse(b.announcedTime || '') - Date.parse(a.announcedTime || '');
      if (Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff;
      return (a.lineItem || '').localeCompare(b.lineItem || '');
    });
  }, [budgetDocumentRows]);

  const filteredBudgetDocuments = useMemo(() => {
    const normalizedSearch = budgetSearch.trim().toLowerCase();
    return sortedBudgetDocuments.filter((doc) => {
      const matchesYear = budgetFiscalYearFilter === 'all' || String(doc.fiscalYear || '') === budgetFiscalYearFilter;
      if (!matchesYear) return false;
      if (!normalizedSearch) return true;
      const haystack = [doc.lineItem || '', doc.detail || '', doc.sourceTitle || '', doc.sourceUrl || '', String(doc.fiscalYear || '')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [budgetFiscalYearFilter, budgetSearch, sortedBudgetDocuments]);

  const budgetAgencyTotals = useMemo(() => {
    const agencyLines = programIntel.budgetLines.filter((line) => line.sourceClass === 'usaspending-budgetary-resources');
    const byYear = new Map<number, { fiscalYear: number; budgetaryResources?: number; totalObligated?: number; totalOutlayed?: number; sourceUrl?: string | null; sourceTitle?: string | null }>();

    for (const line of agencyLines) {
      const fy = line.fiscalYear;
      if (typeof fy !== 'number') continue;
      const current = byYear.get(fy) || { fiscalYear: fy, sourceUrl: line.sourceUrl, sourceTitle: line.sourceTitle };
      const amountType = (line.amountType || '').toLowerCase();

      if (amountType === 'agency_budgetary_resources') {
        if (typeof line.amountRequested === 'number') current.budgetaryResources = line.amountRequested;
        if (typeof line.amountEnacted === 'number') current.totalObligated = line.amountEnacted;
      } else if (amountType === 'agency_total_obligated') {
        if (typeof line.amountRequested === 'number') current.totalObligated = line.amountRequested;
        if (typeof line.amountEnacted === 'number') current.totalOutlayed = line.amountEnacted;
      } else if (amountType === 'agency_total_outlayed') {
        if (typeof line.amountRequested === 'number') current.totalOutlayed = line.amountRequested;
      }

      byYear.set(fy, current);
    }

    return [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear);
  }, [programIntel.budgetLines]);

  const budgetFiscalYearOptions = useMemo(() => {
    return [...new Set(budgetLineItems.map((line) => line.fiscalYear).filter((value): value is number => typeof value === 'number'))].sort((a, b) => b - a);
  }, [budgetLineItems]);

  const budgetSearchSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    for (const line of budgetLineItems) {
      if (line.lineItem) suggestions.add(line.lineItem);
      if (line.program) suggestions.add(line.program);
      if (line.agency) suggestions.add(line.agency);
      if (line.sourceTitle) suggestions.add(line.sourceTitle);
    }
    return [...suggestions].filter(Boolean).sort().slice(0, 120);
  }, [budgetLineItems]);

  const filteredBudget = useMemo(() => {
    const normalizedSearch = budgetSearch.trim().toLowerCase();

    return budgetLineItems.filter((line) => {
      const matchesYear = budgetFiscalYearFilter === 'all' || String(line.fiscalYear || '') === budgetFiscalYearFilter;
      if (!matchesYear) return false;

      if (!normalizedSearch) return true;

      const haystack = [
        line.lineItem || '',
        line.program || '',
        line.agency || '',
        line.detail || '',
        line.sourceTitle || '',
        line.sourceUrl || '',
        String(line.fiscalYear || '')
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [budgetFiscalYearFilter, budgetSearch, budgetLineItems]);

  const sortedBudget = useMemo(() => {
    return [...filteredBudget].sort((a, b) => {
      if (sortKey === 'requested' || sortKey === 'enacted') {
        const leftValue = toSortableAmount(sortKey === 'requested' ? a.amountRequested : a.amountEnacted);
        const rightValue = toSortableAmount(sortKey === 'requested' ? b.amountRequested : b.amountEnacted);
        const leftMissing = leftValue == null;
        const rightMissing = rightValue == null;

        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
        if (leftValue != null && rightValue != null && leftValue !== rightValue) {
          return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
        }
        return (a.lineItem || '').localeCompare(b.lineItem || '');
      }

      const left = getBudgetSortValue(a, sortKey);
      const right = getBudgetSortValue(b, sortKey);
      if (left === right) return 0;
      if (direction === 'asc') return left > right ? 1 : -1;
      return left > right ? -1 : 1;
    });
  }, [direction, filteredBudget, sortKey]);

  const procurementFiscalYearOptions = useMemo(() => {
    return [
      ...new Set(
        procurementAwardItems
          .map((award) => resolveAwardFiscalYear(award.awardedOn))
          .filter((value): value is number => value != null)
      )
    ].sort((a, b) => b - a);
  }, [procurementAwardItems]);

  const procurementMissionOptions = useMemo(() => {
    return [...new Set(procurementAwardItems.map((award) => normalizeText(award.missionKey) || 'program'))].sort();
  }, [procurementAwardItems]);

  const procurementAwardFamilyOptions = useMemo(() => {
    return [
      ...new Set(
        procurementAwardItems
          .map((award) => normalizeText(award.awardFamily))
          .filter((value): value is string => value.length > 0)
      )
    ].sort();
  }, [procurementAwardItems]);

  const procurementRecipientOptions = useMemo((): RecipientOption[] => {
    const recipients = new Map<string, { total: number; labels: Map<string, number> }>();
    for (const award of procurementAwardItems) {
      const value = normalizeText(award.recipient);
      if (!value) continue;

      const label = (award.recipient || '').trim();
      const existing = recipients.get(value) || { total: 0, labels: new Map<string, number>() };
      existing.total += 1;
      if (label) existing.labels.set(label, (existing.labels.get(label) || 0) + 1);
      recipients.set(value, existing);
    }

    const options: RecipientOption[] = [];
    for (const [value, entry] of recipients.entries()) {
      let bestLabel = value;
      let bestCount = -1;
      for (const [candidate, count] of entry.labels.entries()) {
        if (count > bestCount || (count === bestCount && candidate.length > bestLabel.length)) {
          bestLabel = candidate;
          bestCount = count;
        }
      }
      options.push({ value, label: bestLabel, count: entry.total });
    }

    return options
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 60);
  }, [procurementAwardItems]);

  const procurementSearchSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    for (const award of procurementAwardItems) {
      if (award.recipient) suggestions.add(award.recipient);
      if (award.title) suggestions.add(award.title);
      if (award.awardId) suggestions.add(award.awardId);
      if (award.missionKey) suggestions.add(award.missionKey);
    }
    return [...suggestions].filter(Boolean).sort().slice(0, 140);
  }, [procurementAwardItems]);

  const topAwardeeLinks = useMemo(() => {
    const byRecipient = new Map<string, { recipient: string; slug: string; awardCount: number; obligatedAmount: number }>();

    for (const award of procurementAwardItems) {
      const recipient = normalizeArtemisAwardeeName(award.recipient);
      if (!recipient) continue;
      const recipientKey = buildArtemisAwardeeRecipientKey(recipient);
      if (!recipientKey) continue;

      const existing = byRecipient.get(recipientKey) || {
        recipient,
        slug: buildArtemisAwardeeSlug(recipient),
        awardCount: 0,
        obligatedAmount: 0
      };

      existing.awardCount += 1;
      existing.obligatedAmount += toSortableAmount(award.obligatedAmount) || 0;
      byRecipient.set(recipientKey, existing);
    }

    return [...byRecipient.values()]
      .sort((a, b) => b.obligatedAmount - a.obligatedAmount || b.awardCount - a.awardCount || a.recipient.localeCompare(b.recipient))
      .slice(0, 10);
  }, [procurementAwardItems]);

  const filteredProcurement = useMemo(() => {
    const needle = procurementSearch.trim().toLowerCase();

    return procurementAwardItems.filter((award) => {
      const fiscalYear = resolveAwardFiscalYear(award.awardedOn);
      const mission = normalizeText(award.missionKey) || 'program';
      const awardFamily = normalizeText(award.awardFamily) || 'unknown';
      const recipient = normalizeText(award.recipient);

      const matchesFiscalYear = procurementFiscalYearFilter === 'all' || String(fiscalYear || '') === procurementFiscalYearFilter;
      if (!matchesFiscalYear) return false;

      const matchesMission = procurementMissionFilter === 'all' || mission === procurementMissionFilter;
      if (!matchesMission) return false;

      const matchesAwardFamily =
        procurementAwardFamilyFilter === 'all' ||
        awardFamily === procurementAwardFamilyFilter;
      if (!matchesAwardFamily) return false;

      const matchesRecipient = procurementRecipientFilter === 'all' || (recipient || '') === procurementRecipientFilter;
      if (!matchesRecipient) return false;

      if (!needle) return true;

      const haystack = [
        award.title || '',
        award.awardId || '',
        award.recipient || '',
        award.detail || '',
        award.sourceTitle || '',
        award.sourceUrl || '',
        mission,
        String(fiscalYear || '')
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [
    procurementFiscalYearFilter,
    procurementAwardFamilyFilter,
    procurementMissionFilter,
    procurementRecipientFilter,
    procurementSearch,
    procurementAwardItems
  ]);

  const sortedProcurement = useMemo(() => {
    return [...filteredProcurement].sort((a, b) => {
      const left = toSortableAmount(a.obligatedAmount);
      const right = toSortableAmount(b.obligatedAmount);
      const leftMissing = left == null;
      const rightMissing = right == null;

      if (leftMissing !== rightMissing) {
        return leftMissing ? 1 : -1;
      }

      if (left != null && right != null && left !== right) {
        return procurementAmountDirection === 'asc' ? left - right : right - left;
      }

      const leftDate = Date.parse(a.awardedOn || '');
      const rightDate = Date.parse(b.awardedOn || '');
      const safeLeftDate = Number.isFinite(leftDate) ? leftDate : 0;
      const safeRightDate = Number.isFinite(rightDate) ? rightDate : 0;
      return safeRightDate - safeLeftDate;
    });
  }, [filteredProcurement, procurementAmountDirection]);

  const hasActiveProcurementFilters =
    procurementFiscalYearFilter !== 'all' ||
    procurementAwardFamilyFilter !== 'all' ||
    procurementMissionFilter !== 'all' ||
    procurementRecipientFilter !== 'all' ||
    procurementSearch.trim().length > 0;

  const DOCUMENT_ROW_LIMIT = 3;
  const PROCUREMENT_ROW_LIMIT = 200;
  const visibleBudgetDocuments = budgetDocumentsExpanded ? filteredBudgetDocuments : filteredBudgetDocuments.slice(0, DOCUMENT_ROW_LIMIT);
  const hasMoreBudgetDocuments = filteredBudgetDocuments.length > DOCUMENT_ROW_LIMIT;
  const visibleBudget = sortedBudget;
  const visibleProcurement = procurementRowsExpanded ? sortedProcurement : sortedProcurement.slice(0, PROCUREMENT_ROW_LIMIT);
  const hasMoreProcurementRows = sortedProcurement.length > PROCUREMENT_ROW_LIMIT;

  return (
    <div className="space-y-4">
      <MissionControlCard
        title="Awardee Discovery"
        subtitle="Recipient-level Artemis procurement detail pages for search and navigation"
        action={
          <Link href="/artemis/awardees" className="text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80">
            Open awardee index
          </Link>
        }
      >
        {topAwardeeLinks.length ? (
          <ul className="flex flex-wrap items-center gap-2">
            {topAwardeeLinks.map((row) => (
              <li key={row.slug}>
                <Link
                  href={buildArtemisAwardeeHref(row.slug)}
                  className="inline-flex rounded-full border border-stroke bg-surface-0 px-3 py-1 text-xs text-text2 hover:border-primary/60 hover:text-text1"
                >
                  {row.recipient} · {formatCurrencyCompact(row.obligatedAmount || null)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <MissionControlEmptyState
            title="Awardee links unavailable"
            detail="Recipient detail links will appear once procurement rows are present."
          />
        )}
      </MissionControlCard>

      <MissionControlCard
        title="Budget Table"
        subtitle="Requested (PBR) lines extracted from NASA budget documents, with enacted values only when a source provides them"
        action={
          <span>
            Showing {sortedBudget.length} rows • Refreshed:{' '}
            {programIntel.lastBudgetRefresh ? formatUpdatedLabel(programIntel.lastBudgetRefresh) : 'n/a'}
          </span>
        }
      >
        {budgetLineItems.length ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Fiscal Year</span>
                <select
                  value={budgetFiscalYearFilter}
                  onChange={(event) => setBudgetFiscalYearFilter(event.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2"
                >
                  <option value="all">All fiscal years</option>
                  {budgetFiscalYearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      FY {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Search</span>
                <input
                  value={budgetSearch}
                  onChange={(event) => setBudgetSearch(event.target.value)}
                  list="budget-search-suggestions"
                  placeholder="Line item, program, source..."
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2 placeholder:text-text4"
                />
                <datalist id="budget-search-suggestions">
                  {budgetSearchSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setBudgetFiscalYearFilter('all');
                    setBudgetSearch('');
                  }}
                  className="rounded-md border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1"
                >
                  Reset
                </button>
              </div>
            </div>

            {sortedBudget.length ? (
              <div className="space-y-2">
                <p className="text-xs text-text3">
                  Requested values are NASA budget request (PBR) amounts. Enacted values appear only when a source explicitly provides enacted totals.
                </p>

                <div className="overflow-x-auto rounded-xl border border-stroke bg-surface-0">
                  <table className="min-w-full divide-y divide-stroke text-sm">
                    <thead className="bg-surface-1/70 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <tr>
                        <SortableHeader
                          label="Line Item"
                          active={sortKey === 'lineItem'}
                          direction={direction}
                          onClick={() => toggleSort('lineItem', sortKey, direction, setSortKey, setDirection)}
                        />
                        <th className="px-3 py-2 text-left font-semibold">Program</th>
                        <SortableHeader
                          label="FY"
                          active={sortKey === 'fiscalYear'}
                          direction={direction}
                          onClick={() => toggleSort('fiscalYear', sortKey, direction, setSortKey, setDirection)}
                        />
                        <SortableHeader
                          label="Requested (PBR)"
                          active={sortKey === 'requested'}
                          direction={direction}
                          onClick={() => toggleSort('requested', sortKey, direction, setSortKey, setDirection)}
                          align="right"
                        />
                        <SortableHeader
                          label="Enacted"
                          active={sortKey === 'enacted'}
                          direction={direction}
                          onClick={() => toggleSort('enacted', sortKey, direction, setSortKey, setDirection)}
                          align="right"
                        />
                        <th className="px-3 py-2 text-left font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stroke/80">
                      {visibleBudget.map((line, index) => (
                        <tr key={`${line.lineItem || 'line'}-${index}`} className="text-text2">
                          <td className="px-3 py-2 text-text1">
                            <div>{line.lineItem || 'Budget line item'}</div>
                            {line.detail ? <p className="mt-1 text-xs text-text3">{line.detail}</p> : null}
                          </td>
                          <td className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">{line.program || 'n/a'}</td>
                          <td className="px-3 py-2">{line.fiscalYear || 'n/a'}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(line.amountRequested)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(line.amountEnacted)}</td>
                          <td className="px-3 py-2">
                            {line.sourceUrl ? (
                              <a href={line.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:text-primary/80">
                                {line.sourceTitle || 'Source document'}
                              </a>
                            ) : (
                              <span className="text-xs text-text4">n/a</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

              </div>
            ) : (
              <MissionControlEmptyState title="No budget lines match current filters" detail="Adjust the fiscal year or search filters." />
            )}
          </div>
        ) : (
          <MissionControlEmptyState
            title="No budget lines available"
            detail="Requested/enacted budget line items have not populated yet."
          />
        )}
      </MissionControlCard>

      <MissionControlCard
        title="Official Budget PDFs"
        subtitle="Documents discovered from NASA’s budget request hub (includes FY2026 Technical Supplement and Mission Fact Sheets)"
        action={<span>Showing {visibleBudgetDocuments.length} of {filteredBudgetDocuments.length}</span>}
      >
        {filteredBudgetDocuments.length ? (
          <div className="space-y-2">
            <ul className="space-y-2">
              {visibleBudgetDocuments.map((doc, index) => (
                <li key={`${doc.lineItem || 'doc'}-${index}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      {(() => {
                        const rawDetail = doc.detail || '';
                        const title = doc.lineItem || '';
                        const cleanedDetail =
                          title && rawDetail.toLowerCase().startsWith(title.toLowerCase())
                            ? rawDetail.slice(title.length).replace(/^[\s•]+/, '').trim()
                            : rawDetail;
                        return (
                          <>
                            <p className="truncate text-sm font-semibold text-text1">{doc.lineItem || 'Budget document'}</p>
                            <p className="mt-1 text-xs text-text3">
                              FY {doc.fiscalYear || 'n/a'}
                              {cleanedDetail ? ` • ${cleanedDetail}` : ''}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    {doc.sourceUrl ? (
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-md border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
                      >
                        Open PDF
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {hasMoreBudgetDocuments ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-text4">
                  Showing {visibleBudgetDocuments.length} of {filteredBudgetDocuments.length}
                </span>
                <button
                  type="button"
                  onClick={() => setBudgetDocumentsExpanded((value) => !value)}
                  className="rounded-md border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1"
                >
                  {budgetDocumentsExpanded ? 'Show less' : 'Show all'}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <MissionControlEmptyState title="No budget documents available" detail="NASA budget PDFs will appear here once discovered and ingested." />
        )}
      </MissionControlCard>

      <MissionControlCard
        title="NASA Agency Totals (USASpending)"
        subtitle="Official USASpending agency-level totals (not Artemis-specific; provided as context)"
        action={budgetAgencyTotals.length ? <span>{budgetAgencyTotals.length} fiscal years</span> : undefined}
      >
        {budgetAgencyTotals.length ? (
          <div className="overflow-x-auto rounded-xl border border-stroke bg-surface-0">
            <table className="min-w-full divide-y divide-stroke text-sm">
              <thead className="bg-surface-1/70 text-[11px] uppercase tracking-[0.08em] text-text3">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">FY</th>
                  <th className="px-3 py-2 text-right font-semibold">Budgetary Resources</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Obligated</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Outlayed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke/80 text-text2">
                {budgetAgencyTotals.map((row) => (
                  <tr key={row.fiscalYear}>
                    <td className="px-3 py-2">{row.fiscalYear}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrencyCompact(row.budgetaryResources ?? null)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrencyCompact(row.totalObligated ?? null)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrencyCompact(row.totalOutlayed ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <MissionControlEmptyState title="No USASpending totals available" detail="Agency totals will populate when the USASpending feed is ingested." />
        )}
      </MissionControlCard>

      <MissionControlCard
        title="Procurement Awards"
        subtitle="USASpending award feed with recipients, obligations, award-family tags, mission tags, and fiscal-year filters"
        action={
          <span>
            Showing {sortedProcurement.length} rows • Refreshed:{' '}
            {programIntel.lastProcurementRefresh ? formatUpdatedLabel(programIntel.lastProcurementRefresh) : 'n/a'}
          </span>
        }
      >
        {procurementAwardItems.length ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-6">
              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">FY Awarded</span>
                <select
                  value={procurementFiscalYearFilter}
                  onChange={(event) => setProcurementFiscalYearFilter(event.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2"
                >
                  <option value="all">All fiscal years</option>
                  {procurementFiscalYearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      FY {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Award Family</span>
                <select
                  value={procurementAwardFamilyFilter}
                  onChange={(event) => setProcurementAwardFamilyFilter(event.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2"
                >
                  <option value="all">All families</option>
                  {procurementAwardFamilyOptions.map((family) => (
                    <option key={family} value={family}>
                      {formatAwardFamilyLabel(family)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Mission</span>
                <select
                  value={procurementMissionFilter}
                  onChange={(event) => setProcurementMissionFilter(event.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2"
                >
                  <option value="all">All missions</option>
                  {procurementMissionOptions.map((mission) => (
                    <option key={mission} value={mission}>
                      {mission}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Recipient</span>
                <select
                  value={procurementRecipientFilter}
                  onChange={(event) => setProcurementRecipientFilter(event.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2"
                >
                  <option value="all">All recipients</option>
                  {procurementRecipientOptions.map((recipient) => (
                    <option key={recipient.value} value={recipient.value}>
                      {recipient.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-text3">
                <span className="mb-1 block uppercase tracking-[0.08em]">Search</span>
                <input
                  value={procurementSearch}
                  onChange={(event) => setProcurementSearch(event.target.value)}
                  list="procurement-search-suggestions"
                  placeholder="Recipient, award title, ID..."
                  className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1.5 text-sm text-text2 placeholder:text-text4"
                />
                <datalist id="procurement-search-suggestions">
                  {procurementSearchSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setProcurementFiscalYearFilter('all');
                    setProcurementAwardFamilyFilter('all');
                    setProcurementMissionFilter('all');
                    setProcurementRecipientFilter('all');
                    setProcurementSearch('');
                    setProcurementAmountDirection('desc');
                    setExpandedAwardDetails({});
                    setProcurementRowsExpanded(false);
                    setExpandedStoryRows({});
                    setStoryDetails({});
                    setStoryLoading({});
                    setStoryErrors({});
                  }}
                  className="rounded-md border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1"
                >
                  Reset
                </button>
              </div>
            </div>

            {sortedProcurement.length ? (
              <div className="space-y-2">
                <div className="overflow-x-auto rounded-xl border border-stroke bg-surface-0">
                  <table className="min-w-full divide-y divide-stroke text-sm">
                    <thead className="bg-surface-1/70 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Award</th>
                        <th className="px-3 py-2 text-left font-semibold">Recipient</th>
                        <SortableHeader
                          label="Amount"
                          active
                          direction={procurementAmountDirection}
                          onClick={() => setProcurementAmountDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
                          align="right"
                        />
                        <th className="px-3 py-2 text-left font-semibold">Awarded On</th>
                        <th className="px-3 py-2 text-left font-semibold">FY Awarded</th>
                        <th className="px-3 py-2 text-left font-semibold">Family</th>
                        <th className="px-3 py-2 text-left font-semibold">Mission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stroke/80 text-text2">
                      {visibleProcurement.map((award, index) => {
                        const rowKey = buildProcurementRowKey(award, index);
                        const detailExpanded = Boolean(expandedAwardDetails[rowKey]);
                        const storySummary = award.contractStory || null;
                        const storyPresentation = award.storyPresentation;
                        const storyExpanded = Boolean(expandedStoryRows[rowKey]);
                        const storyPending = Boolean(storyLoading[rowKey]);
                        const storyDetail = storyDetails[rowKey] || null;
                        const storyError = storyErrors[rowKey] || null;
                        const titleText = award.title || award.awardId || 'Award';
                        const detailText = resolveAwardDetail(titleText, award.detail);
                        const hasToggleableText = shouldClampAwardText(titleText) || shouldClampAwardText(detailText);
                        return (
                          <tr key={rowKey}>
                            <td className="px-3 py-2 text-text1">
                              <p
                                className="text-sm"
                                style={!detailExpanded && hasToggleableText ? CLAMPED_TEXT_STYLE : undefined}
                              >
                                {titleText}
                              </p>
                              {detailText ? (
                                <div className="mt-1">
                                  <p
                                    className="text-xs text-text3"
                                    style={!detailExpanded && hasToggleableText ? CLAMPED_TEXT_STYLE : undefined}
                                  >
                                    {detailText}
                                  </p>
                                  {hasToggleableText ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedAwardDetails((current) => ({
                                          ...current,
                                          [rowKey]: !current[rowKey]
                                        }))
                                      }
                                      className="mt-1 text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
                                    >
                                      {detailExpanded ? 'Show less' : 'Expand'}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {!detailText && hasToggleableText ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedAwardDetails((current) => ({
                                      ...current,
                                      [rowKey]: !current[rowKey]
                                    }))
                                  }
                                  className="mt-1 text-xs uppercase tracking-[0.08em] text-primary hover:text-primary/80"
                                >
                                  {detailExpanded ? 'Show less' : 'Expand'}
                                </button>
                              ) : null}
                              {award.sourceUrl ? (
                                <a
                                  href={award.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-xs text-primary hover:text-primary/80"
                                >
                                  {award.sourceTitle || 'Source document'}
                                </a>
                              ) : null}
                              {storySummary ? (
                                <div className="mt-2 rounded-md border border-stroke/70 bg-surface-1/40 p-2 text-[11px] text-text3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                                        Exact story
                                      </span>
                                      <span>
                                        {storySummary.actionCount} actions • {storySummary.noticeCount} notices
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={storyPending}
                                      onClick={() => void handleToggleStory(rowKey, storySummary.storyKey)}
                                      className="rounded border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text2 hover:text-text1 disabled:opacity-60"
                                    >
                                      {storyPending ? 'Loading…' : storyExpanded ? 'Hide story' : 'Open story'}
                                    </button>
                                  </div>
                                  {storyError ? (
                                    <p className="mt-1 text-warning">{storyError}</p>
                                  ) : null}
                                  {storyExpanded && storyDetail ? (
                                    <div className="mt-2 space-y-1">
                                      <p>
                                        Bidders: {storyDetail.bidders.length}
                                        {storyDetail.summary.latestActionDate ? ` • Last action ${storyDetail.summary.latestActionDate}` : ''}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-2">
                                        {storyDetail.links.usaspendingUrl ? (
                                          <a
                                            href={storyDetail.links.usaspendingUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary hover:text-primary/80"
                                          >
                                            USASpending
                                          </a>
                                        ) : null}
                                        {storyDetail.links.samSearchUrl ? (
                                          <a
                                            href={storyDetail.links.samSearchUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary hover:text-primary/80"
                                          >
                                            SAM
                                          </a>
                                        ) : null}
                                        {storyDetail.links.canonicalPath ? (
                                          <a href={storyDetail.links.canonicalPath} className="text-primary hover:text-primary/80">
                                            Full story
                                          </a>
                                        ) : null}
                                        {storyDetail.links.artemisStoryHref ? (
                                          <a href={storyDetail.links.artemisStoryHref} className="text-primary hover:text-primary/80">
                                            Contract page
                                          </a>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : storyPresentation?.state === 'lead' ? (
                                <p className="mt-2 text-[11px] text-text3">
                                  {storyPresentation.leadCount} related SAM lead{storyPresentation.leadCount === 1 ? '' : 's'} tracked separately until an exact story join lands.
                                </p>
                              ) : (
                                <p className="mt-2 text-[11px] text-text3">
                                  Story pending.
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2">{award.recipient || 'Unknown recipient'}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(award.obligatedAmount)}</td>
                            <td className="px-3 py-2 text-xs">{award.awardedOn || 'Date TBD'}</td>
                            <td className="px-3 py-2 text-xs">{resolveAwardFiscalYear(award.awardedOn) || 'n/a'}</td>
                            <td className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">{formatAwardFamilyLabel(award.awardFamily)}</td>
                            <td className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">{award.missionKey || 'program'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {hasMoreProcurementRows ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-text4">
                      Showing {visibleProcurement.length} of {sortedProcurement.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setProcurementRowsExpanded((value) => !value)}
                      className="rounded-md border border-stroke px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1"
                    >
                      {procurementRowsExpanded ? `Show first ${PROCUREMENT_ROW_LIMIT}` : `Expand to all (${sortedProcurement.length})`}
                    </button>
                  </div>
                ) : null}

              </div>
            ) : (
              <MissionControlEmptyState
                title={hasActiveProcurementFilters ? 'No awards match current filters' : 'No procurement awards available'}
                detail={
                  hasActiveProcurementFilters
                    ? 'Adjust fiscal year, mission, or search filters.'
                    : 'Award rows appear here when USASpending source updates are ingested.'
                }
              />
            )}
          </div>
        ) : (
          <MissionControlEmptyState
            title="No procurement awards available"
            detail="Award rows appear here when USASpending source updates are ingested."
          />
        )}
      </MissionControlCard>

      <ProgramContractDiscoveryList
        title="Related Procurement Leads"
        subtitle="Relevant SAM.gov awards and notices tracked for Artemis until an exact contract-story join lands."
        items={programIntel.discoveryItems}
        emptyMessage="Relevant SAM.gov leads will appear here when records are in scope for Artemis but not yet safely attached to an exact contract story."
      />
    </div>
  );

  async function handleToggleStory(rowKey: string, storyKey: string) {
    setExpandedStoryRows((current) => ({
      ...current,
      [rowKey]: !current[rowKey]
    }));

    if (storyDetails[rowKey] || storyLoading[rowKey]) return;

    setStoryLoading((current) => ({ ...current, [rowKey]: true }));
    setStoryErrors((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    try {
      const detail = await fetchContractStoryDetail(storyKey);
      setStoryDetails((current) => ({ ...current, [rowKey]: detail }));
    } catch (error) {
      console.error('artemis contract story detail error', error);
      setStoryErrors((current) => ({
        ...current,
        [rowKey]: 'Unable to load contract story detail right now.'
      }));
    } finally {
      setStoryLoading((current) => ({ ...current, [rowKey]: false }));
    }
  }
}

async function fetchContractStoryDetail(storyKey: string) {
  const res = await fetch(`/api/public/contracts/story/${encodeURIComponent(storyKey)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `http_${res.status}`
    );
  }
  return (await res.json()) as ContractStoryDetail;
}

function resolveAwardFiscalYear(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return month >= 10 ? year + 1 : year;
}

function toSortableAmount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function buildProcurementRowKey(
  award: ArtemisMissionControlProps['programIntel']['procurementAwards'][number],
  index: number
) {
  const parts = [
    normalizeKeyPart(award.awardId),
    normalizeKeyPart(award.missionKey),
    normalizeKeyPart(award.awardedOn),
    normalizeKeyPart(award.recipient),
    normalizeKeyPart(award.title),
    typeof award.obligatedAmount === 'number' && Number.isFinite(award.obligatedAmount) ? award.obligatedAmount.toFixed(2) : 'na'
  ];
  const key = parts.join('|');
  return key !== 'na|na|na|na|na|na' ? key : `award:${index}`;
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function normalizeKeyPart(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized || 'na';
}

function shouldClampAwardText(value: string | null | undefined) {
  if (!value) return false;
  return value.trim().length > 220;
}

function resolveAwardDetail(title: string | null | undefined, detail: string | null | undefined) {
  const normalizedTitle = normalizeText(title);
  const normalizedDetail = normalizeText(detail);
  if (!normalizedDetail) return null;
  if (normalizedTitle && normalizedTitle === normalizedDetail) return null;
  return detail?.trim() || null;
}

function formatAwardFamilyLabel(value: string | null | undefined) {
  const normalized = normalizeText(value) || 'unknown';
  if (normalized === 'contracts') return 'Contracts';
  if (normalized === 'idvs') return 'IDVs';
  if (normalized === 'grants') return 'Grants';
  if (normalized === 'loans') return 'Loans';
  if (normalized === 'direct_payments') return 'Direct Payments';
  if (normalized === 'other_financial_assistance') return 'Other Assistance';
  return 'Unclassified';
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
  align = 'left'
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th className={clsx('px-3 py-2 font-semibold', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'inline-flex items-center gap-1 rounded px-1 py-0.5 transition',
          active ? 'text-text1' : 'text-text3 hover:text-text1'
        )}
      >
        {label}
        {active ? <span>{direction === 'asc' ? '▲' : '▼'}</span> : null}
      </button>
    </th>
  );
}

function toggleSort(
  nextKey: BudgetSortKey,
  currentKey: BudgetSortKey,
  currentDirection: 'asc' | 'desc',
  setSortKey: (key: BudgetSortKey) => void,
  setDirection: (direction: 'asc' | 'desc') => void
) {
  if (nextKey === currentKey) {
    setDirection(currentDirection === 'asc' ? 'desc' : 'asc');
    return;
  }
  setSortKey(nextKey);
  setDirection(nextKey === 'lineItem' ? 'asc' : 'desc');
}

function getBudgetSortValue(
  line: ArtemisMissionControlProps['programIntel']['budgetLines'][number],
  key: BudgetSortKey
) {
  if (key === 'fiscalYear') return line.fiscalYear || 0;
  if (key === 'requested') return line.amountRequested || 0;
  if (key === 'enacted') return line.amountEnacted || 0;
  return (line.lineItem || '').toLowerCase();
}
