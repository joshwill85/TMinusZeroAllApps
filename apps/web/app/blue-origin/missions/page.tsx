import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';

export const revalidate = 60 * 10;

const MISSION_ITEMS = [
  {
    slug: 'new-shepard',
    title: 'New Shepard',
    summary:
      'Suborbital crewed and research missions with passenger and payload-level tracking.'
  },
  {
    slug: 'new-glenn',
    title: 'New Glenn',
    summary:
      'Orbital launch cadence, schedule movement, and government/commercial mission context.'
  },
  {
    slug: 'blue-moon',
    title: 'Blue Moon',
    summary:
      'Lunar systems timeline, Artemis-linked milestones, and contract evidence.'
  },
  {
    slug: 'blue-ring',
    title: 'Blue Ring',
    summary:
      'In-space logistics mission development and supporting timeline updates.'
  },
  {
    slug: 'be-4',
    title: 'BE-4',
    summary:
      'Engine-program mission context tied to launch integration and public milestones.'
  }
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/blue-origin/missions';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Blue Origin Mission Hubs | ${BRAND_NAME}`;
  const description =
    'Mission hub index for New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4.';

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

export default async function BlueOriginMissionsIndexPage() {
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/blue-origin/missions`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blue Origin',
        item: `${siteUrl}/blue-origin`
      },
      { '@type': 'ListItem', position: 3, name: 'Mission Hubs', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Mission Index
        </p>
        <h1 className="text-3xl font-semibold text-text1">
          Blue Origin Mission Hubs
        </h1>
        <p className="max-w-3xl text-sm text-text2">
          Start at mission family level, then drill into flights, passengers,
          payloads, contracts, and timeline evidence.
        </p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <ul className="grid gap-3 md:grid-cols-2">
          {MISSION_ITEMS.map((mission) => (
            <li
              key={mission.slug}
              className="rounded-xl border border-stroke bg-surface-0 p-4"
            >
              <BlueOriginRouteTraceLink
                href={`/blue-origin/missions/${mission.slug}`}
                traceLabel={`${mission.title} mission hub`}
                className="text-base font-semibold text-text1 hover:text-primary"
              >
                {mission.title}
              </BlueOriginRouteTraceLink>
              <p className="mt-2 text-sm text-text2">{mission.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <BlueOriginRouteTraceLink
          href="/blue-origin"
          traceLabel="Blue Origin Program"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Program
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/vehicles"
          traceLabel="Blue Origin Vehicles"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Vehicles
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/engines"
          traceLabel="Blue Origin Engines"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Engines
        </BlueOriginRouteTraceLink>
      </div>
    </div>
  );
}
