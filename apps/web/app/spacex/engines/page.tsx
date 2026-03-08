import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXEngines } from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex/engines';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Engines: Raptor, Merlin, Draco | ${BRAND_NAME}`;
  const description = 'SpaceX engine catalog with dedicated pages and linked vehicle context.';

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
    twitter: { card: 'summary_large_image', title, description, images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }] }
  };
}

export default async function SpaceXEnginesPage() {
  const response = await fetchSpaceXEngines('all');
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex/engines`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: 'Engines', item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Engine Catalog</p>
        <h1 className="text-3xl font-semibold text-text1">SpaceX Engines</h1>
        <p className="max-w-3xl text-sm text-text2">Engine-level catalog for Raptor, Merlin, and Dragon propulsion systems.</p>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <ul className="grid gap-3 md:grid-cols-2">
          {response.items.map((engine) => (
            <li key={engine.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/spacex/engines/${engine.engineSlug}`} className="text-base font-semibold text-text1 hover:text-primary">
                    {engine.displayName}
                  </Link>
                  <p className="mt-1 text-xs text-text3">{engine.status || 'Status TBD'}</p>
                </div>
                <span className="text-xs text-text3">{engine.cycle || 'Cycle N/A'}</span>
              </div>
              {engine.description ? <p className="mt-2 text-sm text-text2">{engine.description}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
