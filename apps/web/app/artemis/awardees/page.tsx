import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchArtemisAwardeeIndex } from '@/lib/server/artemisAwardees';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildArtemisAwardeeHref } from '@/lib/utils/artemisAwardees';

export const revalidate = 60 * 10; // 10 minutes

type SearchParams = Record<string, string | string[] | undefined>;

function hasSearchParams(searchParams?: SearchParams) {
  return Object.values(searchParams ?? {}).some((value) => {
    if (Array.isArray(value)) {
      return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function readSearchParam(searchParams: SearchParams | undefined, key: string) {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim() || null;
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

export function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Metadata {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis/awardees';
  const pageUrl = `${siteUrl}${canonical}`;
  const hasParams = hasSearchParams(searchParams);
  const title = `Artemis Awardees and Contractors | ${BRAND_NAME}`;
  const description =
    'Editorially approved Artemis awardee pages covering recipient-level contracts, obligations, mission links, and source-backed procurement context.';

  return {
    title,
    description,
    alternates: { canonical },
    robots: hasParams ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [
        {
          url: siteMeta.ogImage,
          width: 1200,
          height: 630,
          alt: SITE_META.ogImageAlt,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: siteMeta.ogImage,
          alt: SITE_META.ogImageAlt
        }
      ]
    }
  };
}

export default async function ArtemisAwardeesPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/artemis/awardees`;
  const query = readSearchParam(searchParams, 'q');

  const rows = await fetchArtemisAwardeeIndex({
    query,
    includeDraft: false,
    limit: 250
  });

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Awardees', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'Artemis Awardees',
    description:
      'Editorially approved recipient pages covering Artemis procurement obligations, mission alignment, and source-backed award context.'
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${pageUrl}#awardees`,
    numberOfItems: rows.length,
    itemListElement: rows.slice(0, 100).map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${siteUrl}${buildArtemisAwardeeHref(row.slug)}`,
      name: row.recipientName
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, itemListJsonLd]} />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-text3">
          <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
            Artemis Program
          </Link>
          <span>Recipient Index</span>
        </div>
        <h1 className="text-3xl font-semibold text-text1">Artemis Awardees and Contractors</h1>
        <p className="max-w-3xl text-sm text-text2">
          Search-indexable Artemis recipient pages focused on contracts and obligations tied to NASA&apos;s Artemis program.
          This index includes only editorially approved recipient profiles.
        </p>
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input
            name="q"
            defaultValue={query || ''}
            placeholder="Search recipient, mission, or contract title"
            className="w-full max-w-lg rounded-full border border-stroke bg-surface-1 px-4 py-2 text-sm text-text1 placeholder:text-text4"
          />
          <button type="submit" className="rounded-full border border-primary bg-primary/10 px-3 py-2 text-xs uppercase tracking-[0.1em] text-text1">
            Search
          </button>
          {query ? (
            <Link
              href="/artemis/awardees"
              className="rounded-full border border-stroke px-3 py-2 text-xs uppercase tracking-[0.1em] text-text3 hover:text-text1"
            >
              Clear
            </Link>
          ) : null}
        </form>
        <p className="text-xs text-text3">
          {rows.length} recipient page{rows.length === 1 ? '' : 's'}{query ? ` matching "${query}"` : ''}.
        </p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {rows.length ? (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.recipientKey} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={buildArtemisAwardeeHref(row.slug)} className="text-lg font-semibold text-text1 hover:text-primary">
                      {row.recipientName}
                    </Link>
                    <p className="mt-1 text-sm text-text2">{row.summary}</p>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{row.awardCount} award{row.awardCount === 1 ? '' : 's'}</div>
                    <div>{formatCurrencyCompact(row.totalObligatedAmount)}</div>
                    <div>Latest: {formatDateLabel(row.lastAwardedOn)}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                  {row.missionBreakdown.slice(0, 4).map((entry) => (
                    <span key={`${row.recipientKey}-${entry.missionKey}`} className="rounded-full border border-stroke px-2 py-0.5">
                      {entry.label} · {entry.awardCount}
                    </span>
                  ))}
                </div>

                {row.aliases.length ? (
                  <p className="mt-2 text-xs text-text4">Also seen as: {row.aliases.slice(0, 4).join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text2">
            No approved awardee pages match this search right now. Try a broader query or check back after editorial review updates.
          </p>
        )}
      </section>
    </div>
  );
}

function formatCurrencyCompact(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Obligation n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

function formatDateLabel(value: string | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}
