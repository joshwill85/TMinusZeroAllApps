import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import {
  fetchArtemisContentViewModel,
  parseArtemisContentCursor,
  parseArtemisContentKindFilter,
  parseArtemisContentLimit,
  parseArtemisContentMissionFilter,
  parseArtemisContentTierFilter
} from '@/lib/server/artemisContent';
import { BRAND_NAME } from '@/lib/brand';
import type { ArtemisContentItem, ArtemisContentKindFilter, ArtemisContentMissionFilter, ArtemisContentTierFilter } from '@/lib/types/artemis';
import { hasPresentSearchParams, readSearchParam, type RouteSearchParams } from '@/lib/utils/searchParams';

export const revalidate = 60 * 10; // 10 minutes

const PAGE_LIMIT_DEFAULT = 24;

const KIND_OPTIONS: Array<{ value: ArtemisContentKindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'article', label: 'Articles' },
  { value: 'photo', label: 'Photos' },
  { value: 'social', label: 'Social' },
  { value: 'data', label: 'Data' }
];

const TIER_OPTIONS: Array<{ value: ArtemisContentTierFilter; label: string }> = [
  { value: 'all', label: 'All tiers' },
  { value: 'tier1', label: 'Tier 1' },
  { value: 'tier2', label: 'Tier 2' }
];

const MISSION_OPTIONS: Array<{ value: ArtemisContentMissionFilter; label: string }> = [
  { value: 'all', label: 'All missions' },
  { value: 'program', label: 'Program' },
  { value: 'artemis-i', label: 'Artemis I' },
  { value: 'artemis-ii', label: 'Artemis II' },
  { value: 'artemis-iii', label: 'Artemis III' },
  { value: 'artemis-iv', label: 'Artemis IV' },
  { value: 'artemis-v', label: 'Artemis V' },
  { value: 'artemis-vi', label: 'Artemis VI' },
  { value: 'artemis-vii', label: 'Artemis VII' }
];

type SearchParams = RouteSearchParams;

export async function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const title = `Artemis Content Feed | ${BRAND_NAME}`;
  const description = 'Browse authority-ranked Artemis articles, photos, social links, and program data with mission and source-tier filters.';
  return {
    title,
    description,
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined,
    alternates: {
      canonical: '/artemis/content'
    }
  };
}

export default async function ArtemisContentPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const mission = parseArtemisContentMissionFilter(readSearchParam(searchParams, 'mission')) ?? 'all';
  const kind = parseArtemisContentKindFilter(readSearchParam(searchParams, 'kind')) ?? 'all';
  const tier = parseArtemisContentTierFilter(readSearchParam(searchParams, 'tier')) ?? 'all';
  const rawCursor = readSearchParam(searchParams, 'cursor');
  const cursor = parseArtemisContentCursor(rawCursor);
  const rawLimit = parseArtemisContentLimit(readSearchParam(searchParams, 'limit'));
  const limit = rawLimit ?? PAGE_LIMIT_DEFAULT;
  const cursorOffset = decodeCursor(cursor);

  const content = await fetchArtemisContentViewModel({
    mission,
    kind,
    tier,
    limit,
    cursor
  });

  const nextHref = content.nextCursor
    ? buildContentHref({
        mission,
        kind,
        tier,
        limit,
        cursor: content.nextCursor
      })
    : null;
  const previousOffset = cursorOffset > 0 ? Math.max(0, cursorOffset - limit) : null;
  const previousHref =
    previousOffset != null
      ? buildContentHref({
          mission,
          kind,
          tier,
          limit,
          cursor: previousOffset > 0 ? String(previousOffset) : null
        })
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <ProgramHubBackLink program="artemis" />
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold text-text1">Artemis Content Feed</h1>
        <p className="max-w-3xl text-sm text-text2">
          Cursor-paged feed of authority-ranked Artemis items from articles, NASA media assets, social posts, and structured program data.
        </p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {KIND_OPTIONS.map((option) => (
            <FilterChip
              key={`kind-${option.value}`}
              href={buildContentHref({ mission, kind: option.value, tier, limit, cursor: null })}
              active={kind === option.value}
              label={option.label}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {TIER_OPTIONS.map((option) => (
            <FilterChip
              key={`tier-${option.value}`}
              href={buildContentHref({ mission, kind, tier: option.value, limit, cursor: null })}
              active={tier === option.value}
              label={option.label}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {MISSION_OPTIONS.map((option) => (
            <FilterChip
              key={`mission-${option.value}`}
              href={buildContentHref({ mission: option.value, kind, tier, limit, cursor: null })}
              active={mission === option.value}
              label={option.label}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Generated: {formatUpdatedLabel(content.generatedAt)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Source: {content.sourceCoverage.generatedFrom}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Items in page: {content.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Tier 1: {content.sourceCoverage.tier1Items}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Tier 2: {content.sourceCoverage.tier2Items}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {content.items.length === 0 ? (
          <p className="text-sm text-text3">No items found for the selected filters.</p>
        ) : (
          <ul className="space-y-3">
            {content.items.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text3">
                  <span>
                    {item.sourceTier.toUpperCase()} • {item.sourceLabel}
                  </span>
                  <span>{item.publishedAt ? formatUpdatedLabel(item.publishedAt) : 'Date n/a'}</span>
                </div>
                <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-text1 hover:text-primary">
                  {item.title}
                </a>
                {isRenderableImageUrl(item.imageUrl) ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-stroke bg-surface-1">
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      width={640}
                      height={360}
                      unoptimized
                      className="h-auto w-full object-cover"
                    />
                  </a>
                ) : null}
                {item.summary ? <p className="mt-2 text-sm text-text2">{truncateText(item.summary, 260)}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  <span className="rounded-full border border-stroke px-2 py-0.5">{item.missionLabel}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5">{item.kind}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5">{item.sourceClass.replace(/_/g, ' ')}</span>
                  <span className="rounded-full border border-stroke px-2 py-0.5">Score {Math.round(item.score.overall * 100)}</span>
                </div>
                {item.dataLabel || item.dataValue != null ? (
                  <p className="mt-2 text-xs text-text3">
                    {item.dataLabel || 'Data point'}
                    {item.dataValue != null ? `: ${formatDataValue(item.dataValue, item.dataUnit)}` : ''}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-text3">Why shown: {item.whyShown}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        {previousHref ? (
          <Link href={previousHref} className="inline-flex rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1">
            Newer
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link href={nextHref} className="inline-flex rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3 hover:text-text1">
            Older
          </Link>
        ) : (
          <span className="text-xs text-text3">No older pages</span>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  href,
  active,
  label
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.08em] transition ${
        active ? 'border-primary text-primary' : 'border-stroke text-text3 hover:text-text1'
      }`}
    >
      {label}
    </Link>
  );
}

function buildContentHref({
  mission,
  kind,
  tier,
  limit,
  cursor
}: {
  mission: ArtemisContentMissionFilter;
  kind: ArtemisContentKindFilter;
  tier: ArtemisContentTierFilter;
  limit: number;
  cursor: string | null;
}) {
  const search = new URLSearchParams();
  if (mission !== 'all') search.set('mission', mission);
  if (kind !== 'all') search.set('kind', kind);
  if (tier !== 'all') search.set('tier', tier);
  if (limit !== PAGE_LIMIT_DEFAULT) search.set('limit', String(limit));
  if (cursor) search.set('cursor', cursor);
  const query = search.toString();
  return query ? `/artemis/content?${query}` : '/artemis/content';
}

function decodeCursor(cursor: string | null) {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function formatUpdatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function isRenderableImageUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDataValue(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}
