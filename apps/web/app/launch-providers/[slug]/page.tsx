import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { fetchProviderBySlug, type ProviderSummary } from '@/lib/server/providers';
import type { Launch } from '@/lib/types/launch';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref, toProviderSlug } from '@/lib/utils/launchLinks';
import { isDateOnlyNet } from '@/lib/time';

export const revalidate = 60 * 5; // 5 minutes

const FALLBACK_PROVIDERS: Record<string, { name: string }> = {
  spacex: { name: 'SpaceX' },
  nasa: { name: 'NASA' },
  'united-launch-alliance-ula': { name: 'United Launch Alliance (ULA)' },
  'rocket-lab': { name: 'Rocket Lab' },
  'blue-origin': { name: 'Blue Origin' }
};

type ProviderScheduleData = {
  provider: ProviderSummary | { name: string; slug: string };
  upcoming: Launch[];
  recent: Launch[];
};

type ProviderResolution = {
  provider: ProviderScheduleData['provider'];
};

async function resolveProviderBySlug(slug: string): Promise<ProviderScheduleData['provider'] | null> {
  const normalized = toProviderSlug(slug);
  if (!normalized) return null;

  if (isSupabaseConfigured()) {
    const provider = await fetchProviderBySlug(normalized);
    if (provider) return provider;
  }

  const fallback = FALLBACK_PROVIDERS[normalized];
  if (fallback) {
    return { name: fallback.name, slug: normalized };
  }

  return null;
}

function extractProviderSlugCandidates(slugParam: string) {
  const raw = safeDecode(slugParam).trim();
  if (!raw) return [] as string[];

  const seen = new Set<string>();
  const candidates: string[] = [];
  const pushCandidate = (value: string) => {
    const normalized = toProviderSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (raw.includes(':')) {
    const [left] = raw.split(':', 1);
    if (left?.trim()) pushCandidate(left.trim());
  }

  pushCandidate(raw);

  if (raw.includes(':')) {
    for (const segment of raw.split(':').map((part) => part.trim()).filter(Boolean)) {
      pushCandidate(segment);
    }
  }

  return candidates;
}

async function resolveProvider(slugParam: string): Promise<ProviderResolution | null> {
  const candidates = extractProviderSlugCandidates(slugParam);
  for (const candidate of candidates) {
    const provider = await resolveProviderBySlug(candidate);
    if (provider) {
      return { provider };
    }
  }
  return null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const resolution = await resolveProvider(params.slug);
  if (!resolution) {
    return {
      title: `Provider not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const { provider } = resolution;
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = `/launch-providers/${provider.slug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${provider.name} Launch Schedule (US) | ${SITE_META.siteName}`;
  const description = `Upcoming launches and recent history for ${provider.name} from US launch sites.`;
  const images = [
    {
      url: siteMeta.ogImage,
      width: 1200,
      height: 630,
      alt: SITE_META.ogImageAlt,
      type: 'image/jpeg'
    }
  ];

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
      images
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

export default async function ProviderSchedulePage({ params }: { params: { slug: string } }) {
  const resolution = await resolveProvider(params.slug);
  if (!resolution) return notFound();
  const { provider } = resolution;

  const canonicalSlug = provider.slug;
  if (params.slug !== canonicalSlug) permanentRedirect(`/launch-providers/${canonicalSlug}`);

  const { upcoming, recent } = await fetchProviderSchedule(provider.slug);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/launch-providers/${provider.slug}`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Launch providers', item: `${siteUrl}/launch-providers` },
      { '@type': 'ListItem', position: 3, name: provider.name, item: pageUrl }
    ]
  };

  const providerOrgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${pageUrl}#provider`,
    name: provider.name,
    url: pageUrl
  };

  const itemListJsonLd = upcoming.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': `${pageUrl}#upcoming-launches`,
        numberOfItems: Math.min(25, upcoming.length),
        itemListElement: upcoming.slice(0, 25).map((launch, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Event',
            name: launch.name,
            url: `${siteUrl}${buildLaunchHref(launch)}`,
            startDate: launch.net
          }
        }))
      }
    : null;

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${provider.name} launch schedule (US)`,
    description: `Upcoming launches and recent history for ${provider.name} from US launch sites.`,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: itemListJsonLd ? { '@id': itemListJsonLd['@id'] } : undefined
  };

  const providerNewsHref = `/providers/${encodeURIComponent(provider.slug)}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, providerOrgJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Launch provider</p>
          <h1 className="text-3xl font-semibold text-text1">{provider.name}</h1>
          <p className="text-sm text-text2">US launch schedule and recent history.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/launch-providers" className="btn-secondary w-fit rounded-lg px-3 py-2 text-sm">
            All providers
          </Link>
          <Link href="/#schedule" className="btn-secondary w-fit rounded-lg px-3 py-2 text-sm">
            Back to schedule
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
        Launch times are typically listed as NET (No Earlier Than) and can shift due to weather, range availability, or vehicle readiness.
        For coverage and more detail, open an individual launch page.
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text3">
          <Link href={providerNewsHref} className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
            Provider news →
          </Link>
        </div>
      </div>

      <LaunchList title="Upcoming launches" launches={upcoming} emptyLabel={`No upcoming ${provider.name} launches scheduled yet.`} />
      <LaunchList title="Recent launches" launches={recent} emptyLabel={`No recent ${provider.name} launch history available yet.`} />
    </div>
  );
}

async function fetchProviderSchedule(providerSlug: string): Promise<Pick<ProviderScheduleData, 'upcoming' | 'recent'>> {
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const url = new URL(`${siteUrl}/api/public/provider-schedule`);
  url.searchParams.set('slug', providerSlug);

  try {
    const res = await fetch(url.toString(), { next: { revalidate } });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('provider schedule api error', res.status, json);
      return { upcoming: [], recent: [] };
    }

    return {
      upcoming: Array.isArray(json?.upcoming) ? (json.upcoming as Launch[]) : [],
      recent: Array.isArray(json?.recent) ? (json.recent as Launch[]) : []
    };
  } catch (error) {
    console.error('provider schedule api error', error);
    return { upcoming: [], recent: [] };
  }
}

function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">{title}</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {launches.length} items
        </span>
      </div>
      {launches.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {launches.map((launch) => {
            const netLabel = formatLaunchDate(launch);
            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
            return (
              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                      {launch.name}
                    </Link>
                    <div className="mt-1 text-xs text-text3">
                      {launch.vehicle} • {launch.pad.shortCode}
                    </div>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{netLabel}</div>
                    {dateOnly && (
                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                        Time TBD
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-text3">
                  Launch site: {launch.pad.locationName || launch.pad.name} {launch.pad.state ? `(${launch.pad.state})` : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
    : {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
