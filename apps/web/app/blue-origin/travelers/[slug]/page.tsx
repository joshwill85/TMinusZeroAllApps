import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { fetchBlueOriginTravelerDetailBySlug } from '@/lib/server/blueOriginTravelers';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { parseBlueOriginTravelerSlug } from '@/lib/utils/blueOrigin';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const dynamic = 'force-static';
export const dynamicParams = true;
export const revalidate = 60 * 60 * 6;

type Params = {
  slug: string;
};

export async function generateStaticParams(): Promise<Params[]> {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsedSlug = parseBlueOriginTravelerSlug(params.slug);
  if (!parsedSlug) {
    return {
      title: `Blue Origin Crew | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const detail = await fetchBlueOriginTravelerDetailBySlug(parsedSlug);
  if (!detail) {
    return {
      title: `Blue Origin Crew | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/blue-origin/travelers/${detail.canonicalSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const seo = buildTravelerSeoContext(detail);
  const title = seo.title;
  const description = seo.description;
  const roleSummary = detail.roles.length ? detail.roles.join(', ') : 'Crew';

  return {
    title,
    description,
    keywords: seo.keywords,
    alternates: { canonical },
    openGraph: {
      title,
      description: `${roleSummary} profile and mission history. ${seo.flightSnippet}`,
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

export default async function BlueOriginTravelerProfilePage({ params }: { params: Params }) {
  const parsedSlug = parseBlueOriginTravelerSlug(params.slug);
  if (!parsedSlug) notFound();

  const detail = await fetchBlueOriginTravelerDetailBySlug(parsedSlug);
  if (!detail) notFound();

  if (parsedSlug !== detail.canonicalSlug || params.slug !== detail.canonicalSlug) {
    permanentRedirect(`/blue-origin/travelers/${detail.canonicalSlug}`);
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/travelers/${detail.canonicalSlug}`;
  const primaryImageUrl = detail.imageUrls[0] || null;
  const primaryProfileUrl = detail.profileUrls[0] || null;
  const seo = buildTravelerSeoContext(detail);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blue Origin', item: `${siteUrl}/blue-origin` },
      { '@type': 'ListItem', position: 3, name: 'Crew', item: `${siteUrl}/blue-origin/travelers` },
      { '@type': 'ListItem', position: 4, name: detail.name, item: pageUrl }
    ]
  };
  const personJsonLd = buildTravelerPersonJsonLd(detail, pageUrl, primaryImageUrl, seo);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, personJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Crew Profile</p>
        <h1 className="text-3xl font-semibold text-text1">{detail.name}</h1>
        <p className="max-w-4xl text-sm text-text2">
          {seo.intro}
        </p>
        <p className="max-w-4xl text-xs text-text3">
          {'Includes Blue Origin New Shepard flight references. "New Shepherd" is a common misspelling of New Shepard.'}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Flights tracked: {detail.flights.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Profile links: {detail.profileUrls.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Images: {detail.imageUrls.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Confidence: {detail.confidence}</span>
          {detail.roles.length ? (
            <span className="rounded-full border border-stroke px-3 py-1">Roles: {detail.roles.join(', ')}</span>
          ) : null}
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-text3">Image</h2>
          {primaryImageUrl ? (
            <div className="mt-3 space-y-2">
              <a href={primaryImageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-stroke bg-surface-0">
                <img
                  src={primaryImageUrl}
                  alt={detail.name}
                  className="h-64 w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </a>
              {primaryProfileUrl ? (
                <a href={primaryProfileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:text-primary/80">
                  Primary profile link
                </a>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-text3">No crew image link is currently available.</p>
          )}
        </section>

        <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Profile summary</h2>
          {detail.bio ? (
            <p className="mt-2 text-sm text-text2">{detail.bio}</p>
          ) : (
            <p className="mt-2 text-sm text-text3">No profile summary is currently available for this crew member.</p>
          )}

          {detail.nationalities.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
              {detail.nationalities.map((nationality) => (
                <span key={nationality} className="rounded-full border border-stroke px-3 py-1">
                  {nationality}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            <h3 className="text-xs uppercase tracking-[0.1em] text-text3">Profile links</h3>
            {detail.profileUrls.length ? (
              <ul className="mt-2 space-y-2 text-sm text-text2">
                {detail.profileUrls.map((url) => (
                  <li key={url} className="rounded-lg border border-stroke bg-surface-1/40 p-2">
                    <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-text1 hover:text-primary">
                      {formatSourceHost(url)}
                    </a>
                    <p className="mt-1 break-all text-xs text-text3">{url}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-text3">No external profile links are currently available.</p>
            )}
          </div>
        </section>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Flight history</h2>
        {detail.flights.length ? (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {detail.flights.map((flight) => (
              <li key={flight.key} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  {flight.launchHref ? (
                    <Link href={flight.launchHref} className="text-sm font-semibold text-text1 hover:text-primary">
                      {flight.launchName || `Blue Origin ${flight.flightCode?.toUpperCase() || 'Mission'}`}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-text1">
                      {flight.launchName || `Blue Origin ${flight.flightCode?.toUpperCase() || 'Mission'}`}
                    </span>
                  )}
                  <span className="text-xs text-text3">{formatDate(flight.launchDate)}</span>
                </div>
                <p className="mt-1 text-xs text-text3">
                  {flight.flightCode ? flight.flightCode.toUpperCase() : 'Flight code pending'}
                </p>
                {flight.roles.length ? (
                  <p className="mt-1 text-xs text-text3">Role: {flight.roles.join(', ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No flight history is currently available for this crew member.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <BlueOriginRouteTraceLink
          href="/blue-origin"
          traceLabel="Blue Origin Program"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Blue Origin Hub
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/missions/new-shepard"
          traceLabel="New Shepard Mission Hub"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          New Shepard
        </BlueOriginRouteTraceLink>
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Date pending';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(parsed));
}

function formatSourceHost(value: string) {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, '');
    return host || value;
  } catch {
    return value;
  }
}

function buildTravelerSeoContext(detail: {
  name: string;
  bio: string | null;
  flights: Array<{ flightCode: string | null; launchName: string | null }>;
}) {
  const flightCodes = dedupeFlightCodes(detail.flights.map((flight) => flight.flightCode));
  const flightLabels = flightCodes.map((code) => code.toUpperCase());
  const flightSnippet = buildFlightSnippet(flightLabels);

  const title = flightLabels.length
    ? `${detail.name} | Blue Origin New Shepard ${flightLabels[0]} Crew Profile | ${BRAND_NAME}`
    : `${detail.name} | Blue Origin New Shepard Crew Profile | ${BRAND_NAME}`;

  const descriptionBase = detail.bio
    ? `${detail.name} went to space with Blue Origin on ${flightSnippet}. ${detail.bio}`
    : `${detail.name} went to space with Blue Origin on ${flightSnippet}. See mission links, launch dates, source profiles, and New Shepard flight history.`;
  const description = truncateText(descriptionBase, 320);

  const keywords = dedupeKeywords([
    detail.name,
    `${detail.name} Blue Origin`,
    `${detail.name} New Shepard`,
    `${detail.name} New Shepherd`,
    `${detail.name} goes to space`,
    `${detail.name} went to space`,
    'Blue Origin crew',
    'New Shepard crew',
    ...flightLabels.flatMap((code) => [
      `${code} ${detail.name}`,
      `Blue Origin ${code} ${detail.name}`,
      `New Shepard ${code} ${detail.name}`,
      `New Shepherd ${code} ${detail.name}`
    ])
  ]);

  const intro = `${detail.name} Blue Origin crew profile with mission-linked sources, biography, and New Shepard flight history. ${detail.name} went to space on ${flightSnippet}.`;

  return {
    title,
    description,
    keywords,
    intro,
    flightSnippet
  };
}

function buildTravelerPersonJsonLd(
  detail: {
    name: string;
    profileUrls: string[];
    flights: Array<{
      launchName: string | null;
      launchDate: string | null;
      launchHref: string | null;
      flightCode: string | null;
    }>;
  },
  pageUrl: string,
  imageUrl: string | null,
  seo: { description: string }
) {
  const subjectOf = detail.flights.slice(0, 16).map((flight) => {
    const launchName = flight.launchName || (flight.flightCode ? `New Shepard ${flight.flightCode.toUpperCase()}` : 'Blue Origin launch');
    return {
      '@type': 'Event',
      name: launchName,
      startDate: flight.launchDate || undefined,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      organizer: {
        '@type': 'Organization',
        name: 'Blue Origin'
      },
      url: flight.launchHref ? `${getSiteUrl().replace(/\/$/, '')}${flight.launchHref}` : undefined
    };
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: detail.name,
    url: pageUrl,
    image: imageUrl || undefined,
    description: seo.description,
    sameAs: detail.profileUrls.slice(0, 12),
    subjectOf
  };
}

function dedupeFlightCodes(items: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of items) {
    const normalized = String(item || '').trim().toLowerCase();
    if (!/^(ns|ng)-\d{1,3}$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values.sort((left, right) => compareFlightCodes(left, right));
}

function compareFlightCodes(left: string, right: string) {
  const leftNumber = Number(left.replace(/^[a-z]+-/i, ''));
  const rightNumber = Number(right.replace(/^[a-z]+-/i, ''));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function buildFlightSnippet(flightLabels: string[]) {
  if (!flightLabels.length) return 'Blue Origin New Shepard missions';
  if (flightLabels.length === 1) return `Blue Origin New Shepard ${flightLabels[0]}`;
  if (flightLabels.length === 2) return `Blue Origin New Shepard ${flightLabels[0]} and ${flightLabels[1]}`;
  return `Blue Origin New Shepard ${flightLabels.slice(0, 3).join(', ')}`;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function dedupeKeywords(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output.slice(0, 28);
}
