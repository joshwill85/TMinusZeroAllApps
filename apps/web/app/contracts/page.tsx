import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { resolveContractsCanonicalFaq } from '@/lib/content/faq/resolvers';
import {
  fetchCanonicalContractsPage,
  type CanonicalContractScope
} from '@/lib/server/contracts';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;
const CONTRACTS_PAGE_LIMIT = 100;

type SearchParams = {
  q?: string | string[];
  scope?: string | string[];
  page?: string | string[];
};

export async function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/contracts';
  const pageUrl = `${siteUrl}${canonical}`;
  const query = normalizeQuery(getSingle(searchParams?.q));
  const scope = parseScope(getSingle(searchParams?.scope));
  const page = parsePage(getSingle(searchParams?.page));
  const hasFacet = Boolean(query) || (scope != null && scope !== 'all') || page > 1;

  const title = `US Government Contract Intelligence (USAspending + SAM.gov) | ${BRAND_NAME}`;
  const description =
    'US government contract rows across SpaceX, Blue Origin, and Artemis, with exact joined stories surfaced first and pending rows retained until story joins land.';

  return {
    title,
    description,
    alternates: { canonical },
    robots: hasFacet ? { index: false, follow: true } : undefined,
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
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function ContractsIndexPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const query = normalizeQuery(getSingle(searchParams?.q));
  const scope = parseScope(getSingle(searchParams?.scope)) || 'all';
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/contracts`;
  const requestedPage = parsePage(getSingle(searchParams?.page));
  let contractsPage = await fetchCanonicalContractsPage({
    scope,
    query,
    limit: CONTRACTS_PAGE_LIMIT,
    offset: (requestedPage - 1) * CONTRACTS_PAGE_LIMIT
  });
  let totalPages = Math.max(1, Math.ceil(Math.max(contractsPage.totalRows, 1) / contractsPage.limit));
  if (requestedPage > totalPages && contractsPage.totalRows > 0) {
    contractsPage = await fetchCanonicalContractsPage({
      scope,
      query,
      limit: CONTRACTS_PAGE_LIMIT,
      offset: (totalPages - 1) * CONTRACTS_PAGE_LIMIT
    });
    totalPages = Math.max(1, Math.ceil(Math.max(contractsPage.totalRows, 1) / contractsPage.limit));
  }

  const contracts = contractsPage.items;
  const totals = contractsPage.totals;
  const currentPage = Math.min(requestedPage, totalPages);
  const rangeStart = contractsPage.totalRows > 0 ? contractsPage.offset + 1 : 0;
  const rangeEnd = contractsPage.totalRows > 0 ? contractsPage.offset + contracts.length : 0;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Contracts', item: pageUrl }
    ]
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Government contract stories and pending rows',
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: contracts.length,
    itemListElement: contracts.slice(0, 300).map((contract, index) => ({
      '@type': 'ListItem',
      position: contractsPage.offset + index + 1,
      url: `${siteUrl}${contract.canonicalPath}`,
      name: contract.title
    }))
  };

  const faq = resolveContractsCanonicalFaq('index');
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer }
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, itemListJsonLd, faqJsonLd]} />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Exact-First Contracts Layer
        </p>
        <h1 className="text-3xl font-semibold text-text1">
          Government Contracts
        </h1>
        <p className="max-w-4xl text-sm text-text2">
          Exact joined contract stories are shown first. Contracts that still need a full story join
          remain visible here as pending rows so the shared contracts index, API, sitemap, and search
          stay complete.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Total rows: {totals.all}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Exact stories: {totals.exact}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Pending rows: {totals.pending}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            SpaceX: {totals.spacex}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Blue Origin: {totals.blueOrigin}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Artemis: {totals.artemis}
          </span>
          {query ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              Query: {query}
            </span>
          ) : null}
          <span className="rounded-full border border-stroke px-3 py-1">
            Showing: {rangeStart}-{rangeEnd} of {contractsPage.totalRows}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <form action="/contracts" method="get" className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <label className="text-sm text-text2">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-text3">
              Search contract text
            </span>
            <input
              type="search"
              name="q"
              defaultValue={query || ''}
              placeholder="award id, PIID, contract key, mission, agency"
              className="w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none focus:border-primary"
            />
          </label>

          <label className="text-sm text-text2">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-text3">
              Program scope
            </span>
            <select
              name="scope"
              defaultValue={scope}
              className="w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none focus:border-primary"
            >
              <option value="all">All programs</option>
              <option value="spacex">SpaceX</option>
              <option value="blue-origin">Blue Origin</option>
              <option value="artemis">Artemis</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-text1 hover:text-primary"
            >
              Apply
            </button>
            <Link
              href="/contracts"
              className="rounded-lg border border-stroke px-4 py-2 text-sm text-text2 hover:text-text1"
            >
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        {contracts.length ? (
          <div className="space-y-4">
            <ul className="space-y-3">
              {contracts.map((contract) => (
                <li
                  key={contract.uid}
                  className="rounded-xl border border-stroke bg-surface-0 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <Link
                        href={contract.canonicalPath}
                        className="text-base font-semibold text-text1 hover:text-primary"
                      >
                        {contract.title}
                      </Link>
                      <p className="text-sm text-text2">
                        {contract.description || 'No description available.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {contract.story?.storyKey ? (
                        <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs uppercase tracking-[0.08em] text-success">
                          Exact story
                        </span>
                      ) : (
                        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                          Story pending
                        </span>
                      )}
                      <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                        {contract.scope}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
                    <span>Contract key: {contract.contractKey}</span>
                    {contract.usaspendingAwardId ? (
                      <span>Award ID: {contract.usaspendingAwardId}</span>
                    ) : null}
                    {contract.piid ? <span>PIID: {contract.piid}</span> : null}
                    <span>Mission: {contract.missionLabel}</span>
                    <span>Awarded: {contract.awardedOn || 'n/a'}</span>
                    {contract.amount != null ? (
                      <span>Amount: {formatCurrency(contract.amount)}</span>
                    ) : null}
                    {contract.story?.storyKey ? (
                      <>
                        <span>
                          {contract.story.actionCount} actions / {contract.story.noticeCount} notices / {contract.story.spendingPointCount} spending points
                        </span>
                        <span>{contract.story.bidderCount} bidders</span>
                      </>
                    ) : (
                      <span>Story join pending</span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
                    <Link href={contract.canonicalPath} className="text-primary hover:text-primary/80">
                      Canonical detail
                    </Link>
                    <Link href={contract.programPath} className="text-primary hover:text-primary/80">
                      Program detail
                    </Link>
                    {contract.sourceUrl ? (
                      <a
                        href={contract.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:text-primary/80"
                      >
                        Source record
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-4 text-sm text-text2">
                <div>
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={buildContractsIndexHref({
                        query,
                        scope,
                        page: currentPage - 1
                      })}
                      className="rounded-lg border border-stroke px-4 py-2 hover:text-text1"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-stroke px-4 py-2 text-text3">
                      Previous
                    </span>
                  )}
                  {contractsPage.hasMore ? (
                    <Link
                      href={buildContractsIndexHref({
                        query,
                        scope,
                        page: currentPage + 1
                      })}
                      className="rounded-lg border border-stroke px-4 py-2 hover:text-text1"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-stroke px-4 py-2 text-text3">
                      Next
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-text3">
            No contracts match this filter.
          </p>
        )}
      </section>

      <section id="faq" className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Contracts FAQ</h2>
        <p className="mt-1 text-sm text-text2">
          SEO-focused answers for contract discovery terms and identifier-based searches.
        </p>
        <dl className="mt-3 space-y-3">
          {faq.map((item) => (
            <div key={item.question} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <dt className="text-sm font-semibold text-text1">{item.question}</dt>
              <dd className="mt-1 text-sm text-text2">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link
          href="/spacex/contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          SpaceX Contracts
        </Link>
        <Link
          href="/blue-origin/contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Blue Origin Contracts
        </Link>
        <Link
          href="/artemis/contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Artemis Contracts
        </Link>
      </div>
    </div>
  );
}

function getSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function parseScope(value: string | null): CanonicalContractScope | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'all') return 'all';
  if (normalized === 'spacex') return 'spacex';
  if (
    normalized === 'blue-origin' ||
    normalized === 'blue_origin' ||
    normalized === 'blueorigin'
  ) {
    return 'blue-origin';
  }
  if (normalized === 'artemis') return 'artemis';
  return null;
}

function normalizeQuery(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.slice(0, 160);
}

function parsePage(value: string | null) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function buildContractsIndexHref(input: {
  query: string | null;
  scope: CanonicalContractScope | 'all';
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query);
  if (input.scope !== 'all') params.set('scope', input.scope);
  if (input.page > 1) params.set('page', String(input.page));
  const query = params.toString();
  return query ? `/contracts?${query}` : '/contracts';
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}
