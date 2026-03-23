'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { XTweetEmbed } from '@/components/XTweetEmbed';
import type { ArtemisContentItem, ArtemisContentKind } from '@/lib/types/artemis';
import { buildArtemisContentIdentityKey } from '@/lib/utils/artemisDedupe';
import { resolveXPostId } from '@/lib/utils/xSocial';
import { formatUpdatedLabel, isRenderableImageUrl, parseDateOrZero, truncateText } from './formatters';
import { MissionControlCard } from './MissionControlCard';
import { MissionControlEmptyState } from './MissionControlEmptyState';
import type { ArtemisMissionControlProps } from './types';

type ContentKindFilter = ArtemisContentKind | 'all';

const KIND_FILTERS: Array<{ value: ContentKindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'article', label: 'Article' },
  { value: 'photo', label: 'Photo' },
  { value: 'social', label: 'Social' },
  { value: 'data', label: 'Data' }
];

export function ViewIntel({
  articleItems,
  photoItems,
  socialItems,
  dataItems
}: Pick<ArtemisMissionControlProps, 'articleItems' | 'photoItems' | 'socialItems' | 'dataItems'>) {
  const [tierFilter, setTierFilter] = useState<'all' | 'tier1'>('all');
  const [kindFilter, setKindFilter] = useState<ContentKindFilter>('all');

  const allItems = useMemo(() => {
    const merged = [...articleItems, ...photoItems, ...socialItems, ...dataItems].sort((a, b) => {
      const scoreDiff = (b.score?.overall || 0) - (a.score?.overall || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return parseDateOrZero(b.publishedAt || b.capturedAt) - parseDateOrZero(a.publishedAt || a.capturedAt);
    });

    const dedupedByIdentity = new Map<string, ArtemisContentItem>();
    for (const item of merged) {
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

      if (!dedupedByIdentity.has(key)) {
        dedupedByIdentity.set(key, item);
      }
    }

    return [...dedupedByIdentity.values()];
  }, [articleItems, dataItems, photoItems, socialItems]);

  const filteredItems = allItems.filter((item) => {
    if (tierFilter === 'tier1' && item.sourceTier !== 'tier1') return false;
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    return true;
  });

  const tier1Count = allItems.filter((item) => item.sourceTier === 'tier1').length;
  const tier2Count = allItems.filter((item) => item.sourceTier === 'tier2').length;

  return (
    <MissionControlCard
      title="Intelligence Feed"
      subtitle="Authority-ranked stream of Artemis media, data, and source-linked updates"
      action={<span>{filteredItems.length} visible</span>}
      className="xl:h-full xl:overflow-hidden"
      bodyClassName="xl:h-full xl:overflow-y-auto xl:pr-1"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label="All tiers"
          active={tierFilter === 'all'}
          onClick={() => setTierFilter('all')}
        />
        <FilterPill
          label="Tier 1 only"
          active={tierFilter === 'tier1'}
          onClick={() => setTierFilter('tier1')}
        />
        <span className="ml-auto rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-text3">
          Tier 1: {tier1Count} • Tier 2: {tier2Count}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {KIND_FILTERS.map((filter) => (
          <FilterPill
            key={filter.value}
            label={filter.label}
            active={kindFilter === filter.value}
            onClick={() => setKindFilter(filter.value)}
          />
        ))}
        <Link href={buildContentHref(kindFilter)} className="ml-auto text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
          Open full content index
        </Link>
      </div>

      {filteredItems.length ? (
        <div className="mt-4 columns-1 gap-4 md:columns-2 2xl:columns-3">
          {filteredItems.map((item) => {
            const xPostId = item.kind === 'social' ? resolveXPostId(item.externalId, item.url) : null;

            return (
              <article key={item.id} className="mb-4 break-inside-avoid rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text4">
                  <span>{item.kind} • {item.sourceLabel}</span>
                  <span>{item.publishedAt ? formatUpdatedLabel(item.publishedAt) : 'Date n/a'}</span>
                </div>

                {xPostId ? (
                  <div className="mt-2 overflow-hidden rounded-lg border border-stroke bg-surface-1/40 p-1">
                    <XTweetEmbed tweetId={xPostId} tweetUrl={item.url} theme="dark" conversation="none" />
                  </div>
                ) : (
                  <>
                    <div className="mt-1 text-sm font-semibold text-text1">{item.title}</div>
                    {isRenderableImageUrl(item.imageUrl) ? (
                      <div className="mt-2 overflow-hidden rounded-lg border border-stroke bg-surface-1">
                        <Image
                          src={item.imageUrl}
                          alt={item.title}
                          width={640}
                          height={360}
                          unoptimized
                          className="h-auto w-full object-cover"
                        />
                      </div>
                    ) : null}
                    {item.summary ? <p className="mt-2 text-xs text-text2">{truncateText(item.summary, 180)}</p> : null}
                    <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs text-primary hover:text-primary/80">
                      Source
                    </a>
                  </>
                )}

                {item.kind === 'data' && (item.dataLabel || item.dataValue != null) ? (
                  <p className="mt-2 text-xs text-text3">
                    {item.dataLabel || 'Data point'}
                    {item.dataValue != null ? `: ${formatDataValue(item.dataValue, item.dataUnit)}` : ''}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  <span className="rounded-full border border-stroke px-2 py-0.5">{item.sourceTier.toUpperCase()}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5">{item.missionLabel}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5">Score {Math.round(item.score.overall * 100)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4">
          <MissionControlEmptyState
            title="No intelligence rows for this filter"
            detail="Try broadening the tier or content-type filters to view more signals."
          />
        </div>
      )}
    </MissionControlCard>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-text1'
          : 'rounded-full border border-stroke bg-surface-0 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-text3 hover:border-primary/50 hover:text-text1'
      }
    >
      {label}
    </button>
  );
}

function buildContentHref(kind: ContentKindFilter) {
  const search = new URLSearchParams();
  if (kind !== 'all') search.set('kind', kind);
  const query = search.toString();
  return query ? `/artemis/content?${query}` : '/artemis/content';
}

function formatDataValue(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}
