import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

const MISSION_ITEMS = [
  {
    slug: 'starship',
    title: 'Starship',
    summary: 'Integrated flight-test missions, cadence shifts, and launch-system maturation.'
  },
  {
    slug: 'falcon-9',
    title: 'Falcon 9',
    summary: 'Reusable launch cadence across commercial, NASA, and national security manifests.'
  },
  {
    slug: 'falcon-heavy',
    title: 'Falcon Heavy',
    summary: 'Heavy-lift mission schedule, range updates, and launch-window monitoring.'
  },
  {
    slug: 'dragon',
    title: 'Dragon',
    summary: 'Crew and cargo transportation context with passenger and payload details.'
  }
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex/missions';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Mission Hubs | ${BRAND_NAME}`;
  const description = 'Mission index for Starship, Falcon 9, Falcon Heavy, and Dragon.';

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

export default async function SpaceXMissionIndexPage() {
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/missions`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Mission Hubs', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Index</p>
        <h1 className="text-3xl font-semibold text-text1">SpaceX Mission Hubs</h1>
        <p className="max-w-3xl text-sm text-text2">
          Start at mission-family level, then drill into flights, passengers, payloads, contracts, and finance proxies.
        </p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <ul className="grid gap-3 md:grid-cols-2">
          {MISSION_ITEMS.map((mission) => (
            <li key={mission.slug} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <Link href={`/spacex/missions/${mission.slug}`} className="text-base font-semibold text-text1 hover:text-primary">
                {mission.title}
              </Link>
              <p className="mt-2 text-sm text-text2">{mission.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
