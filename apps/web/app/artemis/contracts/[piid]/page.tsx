import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildArtemisContractHref,
  fetchArtemisContractStoryByPiid,
  parseArtemisContractPiid
} from '@/lib/server/artemisContracts';
import { buildCanonicalContractHrefForSeed } from '@/lib/server/contracts';
import { getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import { getSiteUrl } from '@/lib/server/env';
import { buildIndexQualityNoIndexRobots } from '@/lib/server/indexing';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { ARTEMIS_MISSION_HUB_KEYS, type ArtemisMissionHubKey } from '@/lib/types/artemis';

type Params = {
  piid: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const normalizedPiid = parseArtemisContractPiid(params.piid);
  if (!normalizedPiid) {
    return {
      title: `Artemis Contract Story | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const story = await fetchArtemisContractStoryByPiid(normalizedPiid);
  if (!story || story.members.length === 0) {
    return {
      title: `Artemis Contract Story | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const primary = story.members[0];
  const canonical = buildCanonicalContractHrefForSeed({
    scope: 'artemis',
    contractKey: primary?.contractKey || story.piid,
    piid: story.piid,
    metadata: primary?.metadata || null
  });
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${primary.contractKey} Contract Family Story | Artemis | ${BRAND_NAME}`;
  const description =
    `${primary.description || 'Artemis procurement record family'} (` +
    `${story.members.length} contract record${story.members.length === 1 ? '' : 's'}, ${story.actions.length} action` +
    `${story.actions.length === 1 ? '' : 's'}, and ${story.notices.length} opportunity notice` +
    `${story.notices.length === 1 ? '' : 's'} returned).`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: buildIndexQualityNoIndexRobots(),
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

export default async function ArtemisContractDetailPage({ params }: { params: Params }) {
  const normalizedPiid = parseArtemisContractPiid(params.piid);
  if (!normalizedPiid) notFound();

  const story = await fetchArtemisContractStoryByPiid(normalizedPiid, {
    contractLimit: 250,
    actionLimit: 1200,
    noticeLimit: 800,
    spendingLimit: 1200
  });
  if (!story) notFound();

  const canonicalPath = buildArtemisContractHref(story.piid);
  if (canonicalPath !== `/artemis/contracts/${params.piid}`) {
    permanentRedirect(canonicalPath);
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const primary = story.members[0];
  const canonicalEntityPath = buildCanonicalContractHrefForSeed({
    scope: 'artemis',
    contractKey: primary.contractKey,
    piid: story.piid,
    metadata: primary.metadata
  });
  const keyDates = getKeyDates(story);
  const missionLabel = resolveMissionLabel(primary.missionKey);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Contracts', item: `${siteUrl}/artemis/contracts` },
      { '@type': 'ListItem', position: 4, name: primary.piid, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Contract Story</p>
        <h1 className="text-3xl font-semibold text-text1">{primary.contractKey}</h1>
        <p className="max-w-4xl text-sm text-text2">{primary.description || 'No description available.'}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">PIID: {primary.piid}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Mission: {missionLabel}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Family size: {story.members.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Actions: {story.actions.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Notices: {story.notices.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Bidders: {story.bidders.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Contract Family</h2>
        {story.members.length ? (
          <ul className="mt-3 space-y-3">
            {story.members.map((member) => (
              <li key={member.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text1">{member.contractKey}</p>
                    <p className="mt-1 text-xs text-text3">
                      Awardee: {member.awardeeName || 'Unknown'} · Base award: {formatDateLabel(member.baseAwardDate)}
                    </p>
                  </div>
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-xs uppercase tracking-[0.08em] text-text3">
                    {member.contractType || 'Contract'}
                  </span>
                </div>
                {member.description ? <p className="mt-2 text-xs text-text2">{member.description}</p> : null}
                <dl className="mt-2 grid gap-1 text-xs text-text3 sm:grid-cols-2">
                  <div>
                    <dt className="inline text-text3">Parent award:</dt>{' '}
                    <dd className="inline text-text2">{member.parentAwardId || 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text3">Referenced IDV:</dt>{' '}
                    <dd className="inline text-text2">{member.referencedIdvPiid || 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text3">Agency code:</dt>{' '}
                    <dd className="inline text-text2">{member.agencyCode || 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text3">Subtier code:</dt>{' '}
                    <dd className="inline text-text2">{member.subtierCode || 'n/a'}</dd>
                  </div>
                  {member.awardeeUei ? <div className="sm:col-span-2">UEI: {member.awardeeUei}</div> : null}
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text3">No contract-family rows are available.</p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Action Timeline</h2>
          {story.actions.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {story.actions.map((action) => (
                <li key={action.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text1">Mod {action.modNumber || '0'}</span>
                    <span className="text-xs text-text3">{action.actionDate || 'Date pending'}</span>
                  </div>
                  <p className="mt-1 text-xs text-text3">
                    Delta: {formatCurrency(action.obligationDelta)} • Cumulative: {formatCurrency(action.obligationCumulative)}
                  </p>
                  <p className="mt-1 text-xs text-text3">Source: {action.source || 'n/a'}</p>
                  {action.solicitationId ? <p className="mt-1 text-xs text-text3">Solicitation: {action.solicitationId}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text3">No action records are currently available.</p>
          )}
        </section>

        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Opportunity & Bidding Signals</h2>
          <p className="mt-1 text-sm text-text2">Who is or was on the solicitation thread, with opportunity notices and awardee names.</p>
          {story.bidders.length ? (
            <p className="mt-3 text-xs text-text3">Participants: {story.bidders.join(', ')}</p>
          ) : null}
          {story.notices.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {story.notices.map((notice) => (
                <li key={notice.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <p className="font-semibold text-text1">{notice.title || notice.noticeId}</p>
                  <p className="mt-1 text-xs text-text3">
                    Posted: {notice.postedDate || 'Date pending'} • Solicitation: {notice.solicitationId || 'n/a'}
                  </p>
                  <p className="mt-1 text-xs text-text3">
                    Bidder: {notice.awardeeName || 'n/a'} • Award: {formatCurrency(notice.awardAmount)}
                  </p>
                  {notice.noticeUrl ? (
                    <a href={notice.noticeUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:text-primary/80">
                      View notice
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text3">No notices are currently linked to this PIID.</p>
          )}
        </section>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Funding Trend</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
          <span>First action: {keyDates.firstActionDate || 'n/a'}</span>
          <span>Latest action: {keyDates.lastActionDate || 'n/a'}</span>
          <span>Total obligations points: {story.spending.length}</span>
        </div>
        {story.spending.length ? (
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {story.spending.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text1">
                    FY {entry.fiscalYear} M{String(entry.fiscalMonth ?? 0).padStart(2, '0')}
                  </span>
                  <span className="text-xs text-text3">{entry.source || 'n/a'}</span>
                </div>
                <p className="mt-1 text-xs text-text3">
                  Obligations: {formatCurrency(entry.obligations)} • Outlays: {formatCurrency(entry.outlays)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No spending time-series points are currently available.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/artemis/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          All Artemis Contracts
        </Link>
        <Link href={canonicalEntityPath} className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Canonical Entity
        </Link>
        <Link href="/artemis/awardees" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Awardees
        </Link>
        <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Contracts
        </Link>
        <Link href="/blue-origin/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Blue Origin Contracts
        </Link>
      </div>
    </div>
  );
}

function getKeyDates(story: {
  actions: Array<{ actionDate: string | null; updatedAt: string | null }>;
  spending: Array<{ fiscalYear: number; fiscalMonth: number | null }>;
}) {
  const actionDates = story.actions
    .map((action) => (action.actionDate ? Date.parse(action.actionDate) : NaN))
    .filter((value) => Number.isFinite(value));

  return {
    firstActionDate: actionDates.length
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(Math.min(...actionDates)))
      : null,
    lastActionDate: actionDates.length
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(Math.max(...actionDates)))
      : null
  };
}

function resolveMissionLabel(missionKey: string | null) {
  if (!missionKey) return 'Artemis Program';
  const isArtemisMission = (value: string | null): value is ArtemisMissionHubKey => {
    return value !== null && (ARTEMIS_MISSION_HUB_KEYS as readonly string[]).includes(value);
  };
  const mission = isArtemisMission(missionKey)
    ? getArtemisMissionProfileDefault(missionKey).shortLabel
    : missionKey;
  return mission || 'Artemis Program';
}

function formatCurrency(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatDateLabel(value: string | null) {
  if (!value) return 'n/a';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(parsed));
}
