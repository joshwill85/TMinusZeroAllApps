import Link from 'next/link';
import { Countdown } from '@/components/Countdown';
import { TimeDisplay } from '@/components/TimeDisplay';
import { isDateOnlyNet } from '@/lib/time';
import { getArtemisMissionKeyFromLaunch } from '@/lib/utils/artemis';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { ArtemisContentItem } from '@/lib/types/artemis';
import {
  buildArtemisContentIdentityKey,
  buildArtemisUrlComparisonKey
} from '@/lib/utils/artemisDedupe';
import type { ArtemisTimelineEvent } from '@/components/artemis/ArtemisTimelineExplorer';
import { formatCurrencyCompact, formatUpdatedLabel, parseDateOrZero, truncateText } from './formatters';
import { dedupeBudgetLinesForDisplay, dedupeBudgetLinesForSparkline } from './budgetLineUtils';
import { MissionControlCard } from './MissionControlCard';
import { MissionControlEmptyState } from './MissionControlEmptyState';
import type { ArtemisMissionControlProps } from './types';

export function ViewOverview({
  programSnapshot,
  missionCards,
  timelineEvents,
  articleItems,
  programIntel
}: Pick<ArtemisMissionControlProps, 'programSnapshot' | 'missionCards' | 'timelineEvents' | 'articleItems' | 'programIntel'>) {
  const nextLaunch = programSnapshot.nextLaunch;
  const launchHref = nextLaunch ? buildLaunchHref(nextLaunch) : null;
  const missionKey = nextLaunch ? getArtemisMissionKeyFromLaunch(nextLaunch) : null;
  const missionCard = missionKey ? missionCards.find((entry) => entry.key === missionKey) : null;

  const quickPulse = [...timelineEvents]
    .filter((event) => event.confidence === 'high')
    .sort((a, b) => parseDateOrZero(b.eventTime || b.when) - parseDateOrZero(a.eventTime || a.when))
    .slice(0, 3);

  const quickPulseSourceComparisonKeys = new Set(
    quickPulse
      .map((event) => buildArtemisUrlComparisonKey(event.sourceHref))
      .filter((key) => key.length > 0)
  );
  const intelHighlights = resolveIntelHighlights(articleItems, {
    excludeUrlComparisonKeys: quickPulseSourceComparisonKeys
  });
  const budgetLineItems = dedupeBudgetLinesForSparkline(
    dedupeBudgetLinesForDisplay(
      programIntel.budgetLines.filter((line) => {
        if (line.sourceClass === 'usaspending-budgetary-resources') return false;
        if (line.sourceClass === 'nasa-budget-document') return false;
        return line.amountRequested != null || line.amountEnacted != null;
      })
    )
  );

  const latestBudgetYear = Math.max(...budgetLineItems.map((line) => line.fiscalYear || 0), 0);
  const currentYearLines = budgetLineItems
    .filter((line) => (line.fiscalYear || 0) === latestBudgetYear)
    .sort((a, b) => (b.amountRequested || 0) - (a.amountRequested || 0))
    .slice(0, 5);
  const showEnactedBars = currentYearLines.some((line) => typeof line.amountEnacted === 'number' && Number.isFinite(line.amountEnacted));
  const maxBudgetValue = Math.max(
    ...currentYearLines.flatMap((line) => [line.amountRequested || 0, showEnactedBars ? line.amountEnacted || 0 : 0]),
    1
  );

  return (
    <div className="space-y-4">
      <MissionControlCard
        title="Hero Status"
        subtitle="Next launch and active mission readiness"
        action={missionCard ? <span>{missionCard.mission}</span> : undefined}
        className="border-primary/35 bg-[linear-gradient(140deg,rgba(34,211,238,0.14),rgba(11,16,35,0.88))]"
      >
        {nextLaunch && launchHref ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-text4">Tracked launch window</p>
                <Link href={launchHref} className="mt-1 block text-lg font-semibold text-text1 hover:text-primary">
                  {nextLaunch.name}
                </Link>
                <p className="mt-1 text-sm text-text2">
                  {nextLaunch.provider} - {nextLaunch.vehicle}
                </p>
              </div>
              <div className="rounded-xl border border-stroke bg-surface-0 px-3 py-2 text-right">
                <p className="text-[10px] uppercase tracking-[0.12em] text-text4">Mission Status</p>
                <p className="text-sm font-semibold text-text1">{missionCard?.status || 'Tracking'}</p>
              </div>
            </div>
            {!isDateOnlyNet(nextLaunch.net, nextLaunch.netPrecision) ? (
              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-text4">Countdown</p>
                <p className="mt-1 text-sm text-text2">
                  <Countdown net={nextLaunch.net} />
                </p>
              </div>
            ) : null}
            <TimeDisplay net={nextLaunch.net} netPrecision={nextLaunch.netPrecision} fallbackTimeZone={nextLaunch.pad.timezone} />
          </div>
        ) : (
          <MissionControlEmptyState
            title="No tracked next launch"
            detail="The launch feed has no upcoming Artemis mission at the moment."
          />
        )}
      </MissionControlCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <MissionControlCard title="Quick Pulse" subtitle="Latest high-confidence timeline updates">
          {quickPulse.length ? (
            <ul className="space-y-2">
              {quickPulse.map((event) => (
                <li key={event.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <p className="text-sm font-semibold text-text1">{event.title}</p>
                  <p className="mt-1 text-xs text-text3">{event.mission || 'Artemis Program'} • {formatUpdatedLabel(event.when)}</p>
                  {event.summary ? <p className="mt-1 text-xs text-text2">{truncateText(event.summary, 170)}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <MissionControlEmptyState
              title="No high-confidence updates"
              detail="Timeline updates will appear as source confidence scores are ingested."
            />
          )}
        </MissionControlCard>

        <MissionControlCard title="Top Coverage" subtitle="Top Tier 1 updates from linked articles">
          {intelHighlights.length ? (
            <ul className="space-y-2">
              {intelHighlights.map((item) => (
                <li key={item.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text4">
                    <span>{item.sourceTier.toUpperCase()} • {item.sourceLabel}</span>
                    <span>{item.publishedAt ? formatUpdatedLabel(item.publishedAt) : 'Date n/a'}</span>
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-text1 hover:text-primary">
                    {item.title}
                  </a>
                  {item.summary ? <p className="mt-1 text-xs text-text2">{truncateText(item.summary, 170)}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <MissionControlEmptyState
              title="No source highlights"
              detail="Article highlights will appear when source rows are available."
            />
          )}
        </MissionControlCard>
      </div>

      <MissionControlCard
        title="Budget Sparkline"
        subtitle="Requested (PBR) amounts for the latest fiscal-year lines; enacted values shown only when available"
        action={latestBudgetYear > 0 ? <span>FY {latestBudgetYear}</span> : undefined}
      >
        {currentYearLines.length ? (
          <div className="space-y-2">
            {currentYearLines.map((line, index) => {
              const requested = typeof line.amountRequested === 'number' && Number.isFinite(line.amountRequested) ? line.amountRequested : null;
              const enacted = typeof line.amountEnacted === 'number' && Number.isFinite(line.amountEnacted) ? line.amountEnacted : null;
              return (
                <div key={`${line.lineItem || 'line'}-${index}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text2">
                    <span className="font-semibold text-text1">{line.lineItem || 'Budget line item'}</span>
                    <span>
                      Req {formatCurrencyCompact(line.amountRequested)} • Enacted{' '}
                      {enacted != null ? formatCurrencyCompact(enacted) : 'n/a'}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1">
                    <SparklineBar label="Requested" value={requested || 0} maxValue={maxBudgetValue} tone="requested" />
                    {showEnactedBars && enacted != null ? (
                      <SparklineBar label="Enacted" value={enacted} maxValue={maxBudgetValue} tone="enacted" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <MissionControlEmptyState
            title="Budget signals unavailable"
            detail="No current fiscal-year budget lines are available from source tables."
          />
        )}
      </MissionControlCard>

      <MissionControlCard title="Program FAQ" subtitle="Fast answers for common Artemis questions">
        {programSnapshot.faq.length ? (
          <dl className="space-y-3">
            {programSnapshot.faq.map((entry) => (
              <div key={entry.question} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
                <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <MissionControlEmptyState title="FAQ unavailable" detail="Program FAQ entries are not present in the current snapshot." />
        )}
      </MissionControlCard>
    </div>
  );
}

function SparklineBar({
  label,
  value,
  maxValue,
  tone
}: {
  label: string;
  value: number;
  maxValue: number;
  tone: 'requested' | 'enacted';
}) {
  const widthPercent = Math.max(0, Math.min(100, (value / maxValue) * 100));
  return (
    <div className="grid grid-cols-[82px_1fr] items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-text4">{label}</span>
      <div className="h-2 rounded-full bg-surface-2">
        <div
          className={
            tone === 'requested'
              ? 'h-full rounded-full bg-[linear-gradient(90deg,rgba(96,165,250,0.9),rgba(34,211,238,0.9))]'
              : 'h-full rounded-full bg-[linear-gradient(90deg,rgba(52,211,153,0.9),rgba(34,197,94,0.9))]'
          }
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}

function resolveIntelHighlights(
  items: ArtemisContentItem[],
  options: { excludeUrlComparisonKeys?: Set<string> } = {}
) {
  const deduped = dedupeIntelItems(items).filter((item) => {
    const comparisonKey = buildArtemisUrlComparisonKey(item.url);
    if (!comparisonKey) return true;
    return !options.excludeUrlComparisonKeys?.has(comparisonKey);
  });
  const tierOne = deduped.filter((item) => item.sourceTier === 'tier1');
  if (tierOne.length >= 2) return tierOne.slice(0, 2);
  return (tierOne.length ? tierOne : deduped).slice(0, 2);
}

function dedupeIntelItems(items: ArtemisContentItem[]) {
  const deduped = new Map<string, ArtemisContentItem>();
  for (const item of items) {
    const key = buildArtemisContentIdentityKey({
      kind: item.kind,
      missionKey: item.missionKey,
      title: item.title,
      url: item.url,
      sourceKey: item.sourceKey,
      externalId: item.externalId,
      platform: item.platform,
      imageUrl: item.imageUrl,
      dataLabel: item.dataLabel,
      dataValue: item.dataValue,
      dataUnit: item.dataUnit
    });
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()];
}
