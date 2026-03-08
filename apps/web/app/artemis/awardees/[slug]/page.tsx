import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import {
  fetchArtemisAwardeeBySlug,
  fetchRelatedArtemisAwardees
} from '@/lib/server/artemisAwardees';
import { buildArtemisContractHref } from '@/lib/server/artemisContracts';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildArtemisAwardeeHref } from '@/lib/utils/artemisAwardees';

export const revalidate = 60 * 10; // 10 minutes
export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function generateMetadata({
  params
}: {
  params: Params;
}): Promise<Metadata> {
  const profile = await fetchArtemisAwardeeBySlug(params.slug, { includeDraft: true });
  if (!profile) {
    return {
      title: `Awardee Not Found | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = buildArtemisAwardeeHref(profile.slug);
  const pageUrl = `${siteUrl}${canonical}`;

  const title = `${profile.recipientName} Artemis Awards and Contracts | ${BRAND_NAME}`;
  const description =
    `${profile.recipientName} Artemis procurement profile with ${profile.awardCount} tracked award` +
    `${profile.awardCount === 1 ? '' : 's'}, mission alignment, and source-backed contract context.`;

  return {
    title,
    description,
    alternates: { canonical },
    ...(profile.seoApprovalState !== 'approved'
      ? {
          robots: { index: false, follow: false } as Metadata['robots']
        }
      : {}),
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

export default async function ArtemisAwardeeDetailPage({
  params
}: {
  params: Params;
}) {
  const profile = await fetchArtemisAwardeeBySlug(params.slug, { includeDraft: true });
  if (!profile) {
    notFound();
  }

  if (params.slug !== profile.slug) {
    permanentRedirect(buildArtemisAwardeeHref(profile.slug));
  }

  const related = await fetchRelatedArtemisAwardees(profile.recipientKey, { limit: 6 });
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${buildArtemisAwardeeHref(profile.slug)}`;
  const topAwardSources = profile.sourceUrls.slice(0, 8);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Awardees', item: `${siteUrl}/artemis/awardees` },
      { '@type': 'ListItem', position: 4, name: profile.recipientName, item: pageUrl }
    ]
  };

  const profilePageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${profile.recipientName} Artemis Awardee Profile`,
    description: profile.summary,
    mainEntity: {
      '@type': 'Organization',
      name: profile.recipientName,
      sameAs: topAwardSources.length ? topAwardSources : undefined
    }
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${pageUrl}#awards`,
    numberOfItems: Math.min(profile.awards.length, 100),
    itemListElement: profile.awards.slice(0, 100).map((award, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'CreativeWork',
        name: award.title || award.awardId || `Artemis award ${index + 1}`,
        url: award.sourceUrl || undefined,
        datePublished: award.awardedOn || undefined
      }
    }))
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: [
      {
        '@type': 'Question',
        name: `What Artemis work is ${profile.recipientName} associated with?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: profile.summary
        }
      },
      {
        '@type': 'Question',
        name: `How many Artemis awards are tracked for ${profile.recipientName}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `${profile.recipientName} has ${profile.awardCount} tracked Artemis procurement award${profile.awardCount === 1 ? '' : 's'} in this index.`
        }
      },
      {
        '@type': 'Question',
        name: `Where does this ${profile.recipientName} Artemis data come from?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'This page is sourced from Artemis procurement records with source-backed links to authoritative budget and award documentation.'
        }
      }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, profilePageJsonLd, itemListJsonLd, faqJsonLd]} />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-text3">
          <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
            Artemis Program
          </Link>
          <Link href="/artemis/awardees" className="rounded-full border border-stroke px-3 py-1 hover:text-text1">
            Awardee Index
          </Link>
        </div>

        <h1 className="text-3xl font-semibold text-text1">{profile.recipientName}</h1>
        <p className="max-w-3xl text-sm text-text2">{profile.summary}</p>
        {profile.seoApprovalState !== 'approved' ? (
          <p className="text-xs text-text3">
            This recipient page is available for transparency but remains excluded from search indexing until editorial approval is complete.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Awards: {profile.awardCount}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Total obligated: {formatCurrencyCompact(profile.totalObligatedAmount)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">First award: {formatDateLabel(profile.firstAwardedOn)}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Last award: {formatDateLabel(profile.lastAwardedOn)}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission Alignment</h2>
        {profile.missionBreakdown.length ? (
          <ul className="mt-3 space-y-2">
            {profile.missionBreakdown.map((mission) => (
              <li key={`${profile.recipientKey}-${mission.missionKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text2">
                <span className="font-semibold text-text1">{mission.label}</span>
                <span>{mission.awardCount} award{mission.awardCount === 1 ? '' : 's'} · {formatCurrencyCompact(mission.obligatedAmount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text2">Mission-level breakdown will populate as recipient-linked procurement rows expand.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Tracked Awards</h2>
        {profile.awards.length ? (
          <ul className="mt-3 space-y-3">
            {profile.awards.slice(0, 120).map((award, index) => (
              <li key={`${award.awardId || award.title || 'award'}-${index}`} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text1">{award.title || 'Artemis award entry'}</p>
                    <p className="mt-1 text-xs text-text3">
                      {award.missionKey.replace('-', ' ')} · Award ID: {award.awardId || 'n/a'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{formatCurrency(award.obligatedAmount)}</div>
                    <div>{formatDateLabel(award.awardedOn)}</div>
                  </div>
                </div>
                {award.detail ? <p className="mt-2 text-sm text-text2">{truncateText(award.detail, 320)}</p> : null}
                {award.sourceUrl ? (
                  <a href={award.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs text-primary hover:text-primary/80">
                    {award.sourceTitle || 'Source document'}
                  </a>
                ) : null}
                {award.piid ? (
                  <Link href={buildArtemisContractHref(award.piid)} className="mt-2 inline-flex text-xs text-primary hover:text-primary/80">
                    Review contract family
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text2">No award rows are currently attached to this approved recipient profile.</p>
        )}
      </section>

      {related.length ? (
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Related Artemis Awardees</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {related.map((row) => (
              <li key={row.recipientKey} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <Link href={buildArtemisAwardeeHref(row.slug)} className="text-sm font-semibold text-text1 hover:text-primary">
                  {row.recipientName}
                </Link>
                <p className="mt-1 text-xs text-text3">
                  {row.awardCount} award{row.awardCount === 1 ? '' : 's'} · {formatCurrencyCompact(row.totalObligatedAmount)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function formatCurrency(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Amount n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatCurrencyCompact(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
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

function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
