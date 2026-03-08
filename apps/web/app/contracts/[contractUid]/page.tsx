import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { resolveContractsCanonicalFaq } from '@/lib/content/faq/resolvers';
import { buildArtemisContractHref } from '@/lib/server/artemisContracts';
import {
  buildCanonicalContractHref,
  fetchCanonicalContractDetailByUid,
  normalizeCanonicalContractUid
} from '@/lib/server/contracts';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

type Params = {
  contractUid: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const uid = normalizeCanonicalContractUid(params.contractUid);
  if (!uid) {
    return {
      title: `Contract Detail | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const detail = await fetchCanonicalContractDetailByUid(uid);
  if (!detail) {
    return {
      title: `Contract Detail | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = detail.contract.canonicalPath;
  const pageUrl = `${siteUrl}${canonical}`;
  const hasExactStory = Boolean(detail.contract.story?.storyKey);
  const title = `${detail.contract.title} | Contract Data Entity | ${BRAND_NAME}`;
  const description = [
    hasExactStory
      ? `${detail.contract.contractKey} exact contract story`
      : `${detail.contract.contractKey} contract row with story join pending`,
    detail.contract.usaspendingAwardId
      ? `award ${detail.contract.usaspendingAwardId}`
      : null,
    detail.contract.piid ? `PIID ${detail.contract.piid}` : null,
    `${detail.actionsCount} actions`,
    `${detail.noticesCount} notices`,
    `${detail.spendingCount} spending points`
  ]
    .filter((value): value is string => Boolean(value))
    .join(' • ');

  return {
    title,
    description,
    alternates: { canonical },
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

export default async function ContractDetailPage({ params }: { params: Params }) {
  const uid = normalizeCanonicalContractUid(params.contractUid);
  if (!uid) notFound();

  const detail = await fetchCanonicalContractDetailByUid(uid);
  if (!detail) notFound();

  const canonicalPath = buildCanonicalContractHref(detail.contract.uid);
  if (params.contractUid !== detail.contract.uid || uid !== detail.contract.uid) {
    permanentRedirect(canonicalPath);
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const hasExactStory = Boolean(detail.contract.story?.storyKey);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Contracts', item: `${siteUrl}/contracts` },
      { '@type': 'ListItem', position: 3, name: detail.contract.contractKey, item: pageUrl }
    ]
  };

  const datasetJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: detail.contract.title,
    description:
      detail.contract.description ||
      (hasExactStory
        ? `${detail.contract.contractKey} exact contract story`
        : `${detail.contract.contractKey} contract row with story join pending`),
    url: pageUrl,
    keywords: detail.contract.keywords,
    creator: {
      '@type': 'Organization',
      name: SITE_META.siteName
    },
    license: `${siteUrl}/legal/data`,
    isBasedOn: [detail.contract.sourceUrl, `${siteUrl}${detail.contract.programPath}`].filter(
      (value): value is string => Boolean(value)
    )
  };

  const dynamicIdentifierQuery = buildIdentifierQuery(detail.contract);
  const faq = [
    ...resolveContractsCanonicalFaq('detail'),
    {
      question: 'What exact terms should I search to verify this specific contract?',
      answer: dynamicIdentifierQuery
    }
  ];
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

  const storyHref = detail.contract.scope === 'artemis' && detail.contract.story?.primaryPiid
    ? buildArtemisContractHref(detail.contract.story.primaryPiid)
    : null;
  const exactSourceCount = detail.storyDetail?.sourceEvidence.reduce(
    (sum, group) => sum + group.items.length,
    0
  ) || 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, datasetJsonLd, faqJsonLd]} />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          {hasExactStory ? 'Exact Contract Story' : 'Contract Row Pending Story Join'}
        </p>
        <h1 className="text-3xl font-semibold text-text1">{detail.contract.title}</h1>
        <p className="max-w-4xl text-sm text-text2">
          {detail.contract.description || 'No description available.'}
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Status: {hasExactStory ? 'Exact story' : 'Story pending'}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Scope: {detail.contract.scope}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Contract key: {detail.contract.contractKey}
          </span>
          {detail.contract.usaspendingAwardId ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              Award ID: {detail.contract.usaspendingAwardId}
            </span>
          ) : null}
          {detail.contract.piid ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              PIID: {detail.contract.piid}
            </span>
          ) : null}
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Discovery Data</h2>
        <dl className="mt-3 grid gap-2 text-sm text-text2 md:grid-cols-2">
          <MetricItem label="Mission" value={detail.contract.missionLabel} />
          <MetricItem label="Awarded on" value={detail.contract.awardedOn || 'n/a'} />
          <MetricItem
            label="Obligated amount"
            value={
              detail.contract.amount != null
                ? formatCurrency(detail.contract.amount)
                : 'Not disclosed'
            }
          />
          <MetricItem label="Agency" value={detail.contract.agency || 'n/a'} />
          <MetricItem label="Customer" value={detail.contract.customer || 'n/a'} />
          <MetricItem label="Recipient" value={detail.contract.recipient || 'n/a'} />
          <MetricItem label="Actions" value={String(detail.actionsCount)} />
          <MetricItem label="Notices" value={String(detail.noticesCount)} />
          <MetricItem label="Spending points" value={String(detail.spendingCount)} />
          <MetricItem label="Bidders" value={String(detail.biddersCount)} />
          <MetricItem label="Exact source records" value={String(exactSourceCount)} />
        </dl>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Links</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
          <Link
            href={canonicalPath}
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1"
          >
            Canonical URL
          </Link>
          <Link
            href={detail.contract.programPath}
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1"
          >
            Program detail page
          </Link>
          {storyHref ? (
            <Link
              href={storyHref}
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1"
            >
              Artemis story page
            </Link>
          ) : null}
          {detail.contract.sourceUrl ? (
            <a
              href={detail.contract.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] text-primary hover:text-primary/80"
            >
              Source record
            </a>
          ) : null}
        </div>
      </section>

      {detail.storyDetail?.sourceEvidence.length ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Exact Source Evidence</h2>
          <p className="mt-1 text-sm text-text3">
            Exact external records already attached to this contract story.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {detail.storyDetail.sourceEvidence.map((group) => (
              <section key={group.sourceType} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text1">{group.label}</h3>
                  <span className="text-[11px] uppercase tracking-[0.08em] text-text3">
                    {group.items.length} linked
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {group.items.slice(0, 8).map((item) => (
                    <li key={item.id} className="rounded-lg border border-stroke bg-surface-1 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text1">
                            {item.title || item.summary || item.entityName || item.sourceRecordKey}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text3">
                            {item.entityName ? <span>{item.entityName}</span> : null}
                            {item.agencyName ? <span>{item.agencyName}</span> : null}
                            {item.noticeId || item.solicitationId || item.piid ? (
                              <span className="font-mono normal-case tracking-normal">
                                {item.noticeId || item.solicitationId || item.piid}
                              </span>
                            ) : null}
                            {item.publishedAt ? <span>{formatDateLabel(item.publishedAt)}</span> : null}
                          </div>
                        </div>
                        <div className="text-right text-xs text-text3">
                          {item.amount != null ? (
                            <p className="font-mono text-sm font-semibold text-text1">
                              {formatCurrency(item.amount)}
                            </p>
                          ) : null}
                          {item.sourceUrl ? (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-primary hover:text-primary/80"
                            >
                              Open source
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {detail.sourcePayload.scope === 'spacex' ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Latest Award Actions</h2>
            {detail.sourcePayload.detail.actions.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.detail.actions.slice(0, 15).map((action) => (
                  <li key={action.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">
                      Mod {action.modNumber || '0'} • {action.actionDate || 'Date pending'}
                    </p>
                    <p className="mt-1 text-xs text-text3">
                      Delta: {formatCurrencyMaybe(action.obligationDelta)} • Cumulative:{' '}
                      {formatCurrencyMaybe(action.obligationCumulative)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No action records available.</p>
            )}
          </section>

          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Spending Timeline</h2>
            {detail.sourcePayload.detail.spending.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.detail.spending.slice(0, 15).map((row) => (
                  <li key={row.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">
                      FY {row.fiscalYear} M{String(row.fiscalMonth).padStart(2, '0')}
                    </p>
                    <p className="mt-1 text-xs text-text3">
                      Obligations: {formatCurrencyMaybe(row.obligations)} • Outlays:{' '}
                      {formatCurrencyMaybe(row.outlays)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No spending points available.</p>
            )}
          </section>
        </section>
      ) : null}

      {detail.sourcePayload.scope === 'blue-origin' ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Latest Award Actions</h2>
            {detail.sourcePayload.detail.actions.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.detail.actions.slice(0, 15).map((action) => (
                  <li key={action.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">
                      Mod {action.modNumber || '0'} • {action.actionDate || 'Date pending'}
                    </p>
                    <p className="mt-1 text-xs text-text3">
                      Delta: {formatCurrencyMaybe(action.obligationDelta)} • Cumulative:{' '}
                      {formatCurrencyMaybe(action.obligationCumulative)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No action records available.</p>
            )}
          </section>

          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Vehicle/Engine Mapping</h2>
            {detail.sourcePayload.detail.vehicles.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.detail.vehicles.slice(0, 15).map((row) => (
                  <li key={row.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">
                      {row.vehicle?.displayName || row.vehicleSlug || 'Vehicle TBD'} •{' '}
                      {row.engine?.displayName || row.engineSlug || 'Engine TBD'}
                    </p>
                    <p className="mt-1 text-xs text-text3">
                      Method: {row.matchMethod} • Confidence:{' '}
                      {(row.confidence * 100).toFixed(0)}%
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No vehicle mappings available.</p>
            )}
          </section>
        </section>
      ) : null}

      {detail.sourcePayload.scope === 'artemis' ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Contract Family</h2>
            {detail.sourcePayload.story.members.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.story.members.slice(0, 20).map((member) => (
                  <li key={member.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">{member.contractKey}</p>
                    <p className="mt-1 text-xs text-text3">
                      Awardee: {member.awardeeName || 'n/a'} • Base award:{' '}
                      {member.baseAwardDate || 'n/a'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No family members available.</p>
            )}
          </section>

          <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
            <h2 className="text-xl font-semibold text-text1">Opportunity Notices</h2>
            {detail.sourcePayload.story.notices.length ? (
              <ul className="mt-3 space-y-2 text-sm text-text2">
                {detail.sourcePayload.story.notices.slice(0, 20).map((notice) => (
                  <li key={notice.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">
                      {notice.title || notice.noticeId}
                    </p>
                    <p className="mt-1 text-xs text-text3">
                      Posted: {notice.postedDate || 'n/a'} • Awardee:{' '}
                      {notice.awardeeName || 'n/a'}
                    </p>
                    {notice.noticeUrl ? (
                      <a
                        href={notice.noticeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-primary hover:text-primary/80"
                      >
                        Notice source
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-text3">No notices available.</p>
            )}
          </section>
        </section>
      ) : null}

      <section id="faq" className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Contract Detail FAQ</h2>
        <p className="mt-1 text-sm text-text2">
          Search-first answers for this contract entity and its source identifiers.
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
          href="/contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          All contract rows
        </Link>
        <Link
          href={detail.contract.programPath}
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Program view
        </Link>
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stroke bg-surface-0 p-3">
      <dt className="text-xs uppercase tracking-[0.08em] text-text3">{label}</dt>
      <dd className="mt-1 text-text1">{value}</dd>
    </div>
  );
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatCurrencyMaybe(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatCurrency(value)
    : 'N/A';
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

function buildIdentifierQuery(contract: {
  contractKey: string;
  usaspendingAwardId: string | null;
  piid: string | null;
}) {
  const tokens = [contract.contractKey, contract.usaspendingAwardId, contract.piid]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (!tokens.length) {
    return 'Search by contract key plus program name, then validate against the source record link on this page.';
  }

  return `Use these identifiers in search: ${tokens.join(' | ')}. Add terms like \"USAspending\", \"SAM.gov\", or the awardee name for faster exact matching.`;
}
