import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildSpaceXContractSlug,
  fetchSpaceXContractDetailBySlug,
  parseSpaceXContractSlug
} from '@/lib/server/spacexProgram';
import { buildCanonicalContractHrefForSeed } from '@/lib/server/contracts';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { getSpaceXMissionLabel } from '@/lib/utils/spacexProgram';

export const revalidate = 60 * 10;

type Params = {
  contractKey: string;
};

const MISSION_HREFS: Record<string, string> = {
  'spacex-program': '/spacex',
  starship: '/spacex/missions/starship',
  'falcon-9': '/spacex/missions/falcon-9',
  'falcon-heavy': '/spacex/missions/falcon-heavy',
  dragon: '/spacex/missions/dragon'
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = parseSpaceXContractSlug(params.contractKey);
  if (!parsed) {
    return {
      title: `SpaceX Contract | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const detail = await fetchSpaceXContractDetailBySlug(parsed);
  if (!detail) {
    return {
      title: `SpaceX Contract | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = buildCanonicalContractHrefForSeed({
    scope: 'spacex',
    contractKey: detail.contract.contractKey,
    sourceUrl: detail.contract.sourceUrl,
    metadata: detail.contract.metadata
  });
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${detail.contract.title} | SpaceX Contract Detail | ${BRAND_NAME}`;
  const description = `${detail.contract.title} contract detail with award actions and obligation trend signals.`;

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
      images: [{ url: siteMeta.ogImage, width: 1200, height: 630, alt: SITE_META.ogImageAlt, type: 'image/jpeg' }]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function SpaceXContractDetailPage({ params }: { params: Params }) {
  const parsed = parseSpaceXContractSlug(params.contractKey);
  if (!parsed) notFound();

  const detail = await fetchSpaceXContractDetailBySlug(parsed);
  if (!detail) notFound();

  const canonicalSlug = buildSpaceXContractSlug(detail.contract.contractKey);
  if (parsed !== canonicalSlug || params.contractKey !== canonicalSlug) {
    permanentRedirect(`/spacex/contracts/${canonicalSlug}`);
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/contracts/${canonicalSlug}`;
  const canonicalEntityPath = buildCanonicalContractHrefForSeed({
    scope: 'spacex',
    contractKey: detail.contract.contractKey,
    sourceUrl: detail.contract.sourceUrl,
    metadata: detail.contract.metadata
  });
  const missionHref = MISSION_HREFS[detail.contract.missionKey] || '/spacex';

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Contracts', item: `${siteUrl}/spacex/contracts` },
      { '@type': 'ListItem', position: 4, name: detail.contract.contractKey, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Contract Detail</p>
        <h1 className="text-3xl font-semibold text-text1">{detail.contract.title}</h1>
        <p className="max-w-4xl text-sm text-text2">{detail.contract.description || 'No contract description is currently available.'}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Contract key: {detail.contract.contractKey}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Mission: {getSpaceXMissionLabel(detail.contract.missionKey)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Actions: {detail.actions.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Spending points: {detail.spending.length}</span>
          {detail.story ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              SAM story: {detail.story.actions.length} actions / {detail.story.notices.length} notices
            </span>
          ) : null}
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Award profile</h2>
        <dl className="mt-3 grid gap-2 text-sm text-text2 md:grid-cols-2">
          <div className="rounded-lg border border-stroke bg-surface-0 p-3">
            <dt className="text-xs uppercase tracking-[0.08em] text-text3">Awarded</dt>
            <dd className="mt-1 text-text1">{detail.contract.awardedOn || 'Date pending'}</dd>
          </div>
          <div className="rounded-lg border border-stroke bg-surface-0 p-3">
            <dt className="text-xs uppercase tracking-[0.08em] text-text3">Amount</dt>
            <dd className="mt-1 text-text1">{detail.contract.amount != null ? formatCurrency(detail.contract.amount) : 'Not disclosed'}</dd>
          </div>
          <div className="rounded-lg border border-stroke bg-surface-0 p-3">
            <dt className="text-xs uppercase tracking-[0.08em] text-text3">Agency</dt>
            <dd className="mt-1 text-text1">{detail.contract.agency || 'N/A'}</dd>
          </div>
          <div className="rounded-lg border border-stroke bg-surface-0 p-3">
            <dt className="text-xs uppercase tracking-[0.08em] text-text3">Customer</dt>
            <dd className="mt-1 text-text1">{detail.contract.customer || 'N/A'}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
          <Link href={missionHref} className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1">
            Mission hub
          </Link>
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
          <Link
            href={canonicalEntityPath}
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1"
          >
            Canonical entity
          </Link>
        </div>
      </section>

      {detail.story ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Contract story snapshot</h2>
          <p className="mt-1 text-sm text-text2">Artemis records stitched from SAM endpoints for this award family.</p>
          <dl className="mt-3 grid gap-2 text-sm text-text2 md:grid-cols-2">
            <div className="rounded-lg border border-stroke bg-surface-0 p-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-text3">PIID</dt>
              <dd className="mt-1 text-text1">{detail.story.piid}</dd>
            </div>
            <div className="rounded-lg border border-stroke bg-surface-0 p-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-text3">Family members</dt>
              <dd className="mt-1 text-text1">{detail.story.members}</dd>
            </div>
            <div className="rounded-lg border border-stroke bg-surface-0 p-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-text3">Bidders</dt>
              <dd className="mt-1 text-text1">{detail.story.bidders.length ? detail.story.bidders.join(', ') : 'Not available yet'}</dd>
            </div>
            <div className="rounded-lg border border-stroke bg-surface-0 p-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-text3">Story endpoint rows</dt>
              <dd className="mt-1 text-text1">
                {detail.story.actions.length} actions • {detail.story.notices.length} notices • {detail.story.spending.length} spending points
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link href={detail.story.storyHref} className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.12em] hover:text-text1">
              Open full Artemis story
            </Link>
          </div>
          {detail.story.notices.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-text1">Opportunity notices</h3>
              <ul className="mt-2 space-y-2 text-sm text-text2">
                {detail.story.notices.map((notice) => (
                  <li key={notice.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                    <p className="font-semibold text-text1">{notice.title || notice.noticeId}</p>
                    <p className="mt-1 text-xs text-text3">
                      Posted: {notice.postedDate || 'Date pending'} • Award: {notice.awardAmount != null ? formatCurrency(notice.awardAmount) : 'N/A'}
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
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Award actions</h2>
          {detail.actions.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {detail.actions.map((action) => (
                <li key={action.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text1">Mod {action.modNumber || '0'}</span>
                    <span className="text-xs text-text3">{action.actionDate || 'Date pending'}</span>
                  </div>
                  <p className="mt-1 text-xs text-text3">
                    Delta: {action.obligationDelta != null ? formatCurrency(action.obligationDelta) : 'N/A'} •
                    Cumulative: {action.obligationCumulative != null ? formatCurrency(action.obligationCumulative) : 'N/A'}
                  </p>
                  <p className="mt-1 text-xs text-text3">Source: {action.source}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No contract action records are currently available.</p>
          )}
        </section>

        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Spending trend</h2>
          {detail.spending.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {detail.spending.map((entry) => (
                <li key={entry.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text1">
                      FY {entry.fiscalYear} M{String(entry.fiscalMonth).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-text3">{entry.source}</span>
                  </div>
                  <p className="mt-1 text-xs text-text3">
                    Obligations: {entry.obligations != null ? formatCurrency(entry.obligations) : 'N/A'} •
                    Outlays: {entry.outlays != null ? formatCurrency(entry.outlays) : 'N/A'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No spending time-series points are currently available.</p>
          )}
        </section>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          All contracts
        </Link>
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
        <Link href="/blue-origin" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Blue Origin Program
        </Link>
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Program
        </Link>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
