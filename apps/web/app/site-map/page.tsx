import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { LAUNCH_INTENT_LANDING_KEYS, getLaunchIntentLandingConfig } from '@/lib/server/launchIntentLandingConfig';
import { fetchProviders } from '@/lib/server/providers';
import { fetchSatelliteOwnerIndexBatch } from '@/lib/server/satellites';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';
import {
  buildCatalogCollectionPath,
  catalogEntityOptions
} from '@/lib/utils/catalog';
import {
  buildSatelliteOwnerHref,
  formatSatelliteOwnerLabel
} from '@/lib/utils/satelliteLinks';

export const revalidate = 60 * 60 * 6; // 6 hours

const SITE_MAP_CANONICAL = '/site-map';
const SITE_MAP_TITLE = `HTML Sitemap | Rocket Launch Schedule, Space News & Program Hubs | ${BRAND_NAME}`;
const SITE_MAP_DESCRIPTION =
  'Browse the HTML sitemap for launch schedules, program hubs, providers, catalogs, satellites, docs, and legal pages on T-Minus Zero.';

const coreLinks = [
  {
    href: '/',
    label: 'Launch schedule',
    detail: 'Upcoming launches, countdowns, and launch detail pages.'
  },
  {
    href: '/news',
    label: 'Rocket launch news',
    detail: 'Space news and mission-linked coverage.'
  },
  {
    href: '/launch-providers',
    label: 'Launch providers',
    detail: 'Provider schedule hubs for SpaceX, NASA, ULA, and more.'
  },
  {
    href: '/info',
    label: 'Spaceflight reference database',
    detail: 'Agencies, astronauts, pads, vehicles, and other reference data.'
  },
  {
    href: '/catalog',
    label: 'Catalog browser',
    detail: 'Searchable entity collections from the LL2 dataset.'
  },
  {
    href: '/satellites',
    label: 'Satellite catalog',
    detail: 'Satellite pages, owner hubs, and launch associations.'
  }
] as const;

const programLinks = [
  { href: '/artemis', label: 'Artemis program hub' },
  { href: '/artemis-i', label: 'Artemis I' },
  { href: '/artemis-ii', label: 'Artemis II' },
  { href: '/artemis-iii', label: 'Artemis III' },
  { href: '/artemis-iv', label: 'Artemis IV' },
  { href: '/artemis-v', label: 'Artemis V' },
  { href: '/artemis-vi', label: 'Artemis VI' },
  { href: '/artemis-vii', label: 'Artemis VII' },
  { href: '/spacex', label: 'SpaceX hub' },
  { href: '/starship', label: 'Starship hub' },
  { href: '/blue-origin', label: 'Blue Origin hub' }
] as const;

const docsLinks = [
  { href: '/about', label: 'About T-Minus Zero' },
  { href: '/support', label: 'Support' },
  { href: '/docs/about', label: 'Docs: About' },
  { href: '/docs/faq', label: 'Docs: FAQ' },
  { href: '/docs/roadmap', label: 'Docs: Roadmap' },
  { href: '/legal/privacy', label: 'Privacy notice' },
  { href: '/legal/terms', label: 'Terms of service' },
  { href: '/legal/data', label: 'Data and attribution' }
] as const;

export const metadata: Metadata = buildPageMetadata({
  title: SITE_MAP_TITLE,
  description: SITE_MAP_DESCRIPTION,
  canonical: SITE_MAP_CANONICAL
});

export default async function SiteMapPage() {
  const [providers, ownerRows] = await Promise.all([
    fetchProviders(),
    fetchSatelliteOwnerIndexBatch(60, 0)
  ]);

  const providerLinks = providers
    .map((provider) => ({
      slug: provider.slug,
      name: provider.name,
      scheduleHref: `/launch-providers/${encodeURIComponent(provider.slug)}`,
      coverageHref: `/providers/${encodeURIComponent(provider.slug)}`
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const priorityLandingLinks = LAUNCH_INTENT_LANDING_KEYS.map((key) => {
    const config = getLaunchIntentLandingConfig(key);
    return {
      href: config.path,
      label: config.title,
      detail: config.description
    };
  }).sort((left, right) => left.label.localeCompare(right.label));

  const satelliteOwnerLinks = ownerRows
    .map((row) => ({
      href: buildSatelliteOwnerHref(row.owner),
      label: formatSatelliteOwnerLabel(row.owner) || row.owner,
      count: row.satelliteCount
    }))
    .filter((row) => row.href != null)
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label)
    );

  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'HTML Sitemap', item: SITE_MAP_CANONICAL }
    ]),
    buildWebPageJsonLd({
      canonical: SITE_MAP_CANONICAL,
      name: 'HTML Sitemap',
      description: SITE_MAP_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-8">
      <JsonLd data={jsonLd} />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">
          Discover
        </p>
        <h1 className="text-3xl font-semibold text-text1">HTML Sitemap</h1>
        <p className="max-w-3xl text-sm text-text2">
          Browse launch schedules, program hubs, provider coverage, catalog
          families, satellite indexes, and the core docs that support
          {` ${BRAND_NAME}`}.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SiteMapSection title="Core pages">
          {coreLinks.map((link) => (
            <li
              key={link.href}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={link.href}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {link.label}
              </Link>
              <p className="mt-1 text-xs text-text3">{link.detail}</p>
            </li>
          ))}
        </SiteMapSection>

        <SiteMapSection title="Program hubs">
          {programLinks.map((link) => (
            <li
              key={link.href}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={link.href}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </SiteMapSection>

        <SiteMapSection title="Catalog families">
          {catalogEntityOptions.map((option) => (
            <li
              key={option.value}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={buildCatalogCollectionPath(option.value)}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {option.label}
              </Link>
              <p className="mt-1 text-xs text-text3">{option.description}</p>
            </li>
          ))}
        </SiteMapSection>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <SiteMapSection title="Priority landing pages">
          {priorityLandingLinks.map((link) => (
            <li
              key={link.href}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={link.href}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {link.label}
              </Link>
              <p className="mt-1 text-xs text-text3">{link.detail}</p>
            </li>
          ))}
        </SiteMapSection>

        <SiteMapSection title="Provider schedule pages">
          {providerLinks.map((provider) => (
            <li
              key={provider.scheduleHref}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={provider.scheduleHref}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {provider.name}
              </Link>
              <p className="mt-1 text-xs text-text3">
                Schedule hub ·{' '}
                <Link
                  href={provider.coverageHref}
                  className="text-primary hover:underline"
                >
                  coverage page
                </Link>
              </p>
            </li>
          ))}
        </SiteMapSection>

        <SiteMapSection title="Satellite owner hubs">
          {satelliteOwnerLinks.length ? (
            satelliteOwnerLinks.map((owner) => (
              <li
                key={owner.href}
                className="rounded-xl border border-stroke bg-surface-0 p-3"
              >
                <Link
                  href={owner.href || '/satellites/owners'}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {owner.label}
                </Link>
                <p className="mt-1 text-xs text-text3">
                  {owner.count} satellites
                </p>
              </li>
            ))
          ) : (
            <li className="rounded-xl border border-stroke bg-surface-0 p-3 text-sm text-text3">
              Satellite owner index data is not available yet.
            </li>
          )}
        </SiteMapSection>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-text1">Docs and legal</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {docsLinks.map((link) => (
            <li
              key={link.href}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <Link
                href={link.href}
                className="text-sm font-semibold text-text1 hover:text-primary"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SiteMapSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <h2 className="text-xl font-semibold text-text1">{title}</h2>
      <ul className="mt-4 grid gap-3">{children}</ul>
    </section>
  );
}
