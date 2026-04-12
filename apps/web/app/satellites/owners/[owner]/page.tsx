import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSatelliteOwnerProfile } from '@/lib/server/satellites';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  buildSatelliteHref,
  buildSatelliteOwnerHref,
  formatSatelliteOwnerLabel,
  parseSatelliteOwnerParam
} from '@/lib/utils/satelliteLinks';

export const revalidate = 60 * 10; // 10 minutes

type Params = {
  owner: string;
};

function resolveOwner(ownerParam: string) {
  return parseSatelliteOwnerParam(ownerParam);
}

export async function generateMetadata({
  params
}: {
  params: Params;
}): Promise<Metadata> {
  const owner = resolveOwner(params.owner);
  if (!owner) {
    return {
      title: `Not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const profile = await fetchSatelliteOwnerProfile(owner, {
    satellitesLimit: 40,
    satellitesOffset: 0,
    launchesLimit: 16
  });
  if (!profile) {
    return {
      title: `Not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const canonical = buildSatelliteOwnerHref(profile.owner);
  if (!canonical) {
    return {
      title: `Not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const ownerLabel = formatSatelliteOwnerLabel(profile.owner) || profile.owner;
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const siteMeta = buildSiteMeta();
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${ownerLabel} Satellites | ${BRAND_NAME}`;
  const description =
    `${ownerLabel} satellite profile with ${profile.ownerSatelliteCount} catalog object` +
    `${profile.ownerSatelliteCount === 1 ? '' : 's'}, related launches, and SATCAT-derived object types.`;

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
      images: [
        {
          url: siteMeta.ogImage,
          alt: SITE_META.ogImageAlt
        }
      ]
    }
  };
}

export default async function SatelliteOwnerProfilePage({
  params
}: {
  params: Params;
}) {
  const owner = resolveOwner(params.owner);
  if (!owner) return notFound();

  const canonicalHref = buildSatelliteOwnerHref(owner);
  if (!canonicalHref) return notFound();

  const canonicalOwnerParam = canonicalHref.split('/').pop() || '';
  if (params.owner !== canonicalOwnerParam) {
    permanentRedirect(canonicalHref);
  }

  const profile = await fetchSatelliteOwnerProfile(owner, {
    satellitesLimit: 120,
    satellitesOffset: 0,
    launchesLimit: 40
  });
  if (!profile) return notFound();

  const ownerLabel = formatSatelliteOwnerLabel(profile.owner) || profile.owner;
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const pageUrl = `${siteUrl}${canonicalHref}`;

  const launchRows = profile.relatedLaunches.map((launch) => ({
    ...launch,
    href: buildLaunchHref({
      id: launch.launchId,
      name: launch.launchName || 'Launch',
      slug: launch.launchSlug || undefined
    })
  }));

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Satellites',
          item: `${siteUrl}/satellites`
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Owners',
          item: `${siteUrl}/satellites/owners`
        },
        { '@type': 'ListItem', position: 4, name: ownerLabel, item: pageUrl }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      '@id': pageUrl,
      url: pageUrl,
      name: `${ownerLabel} Satellite Profile`,
      description:
        `${ownerLabel} satellite profile with ${profile.ownerSatelliteCount} catalog object` +
        `${profile.ownerSatelliteCount === 1 ? '' : 's'}, related launches, and SATCAT-derived object types.`,
      mainEntity: {
        '@type': 'Organization',
        name: ownerLabel
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${pageUrl}#satellites`,
      numberOfItems: profile.satellites.length,
      itemListElement: profile.satellites.slice(0, 200).map((sat, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Thing',
          name: sat.name || `NORAD ${sat.noradCatId}`,
          url: `${siteUrl}${buildSatelliteHref(sat.noradCatId)}`
        }
      }))
    }
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={jsonLd as any} />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-text3">
          <Link
            href="/satellites"
            className="rounded-full border border-stroke px-3 py-1 hover:text-text1"
          >
            Satellites
          </Link>
          <Link
            href="/satellites/owners"
            className="rounded-full border border-stroke px-3 py-1 hover:text-text1"
          >
            Owner index
          </Link>
        </div>
        <h1 className="text-3xl font-semibold text-text1">{ownerLabel}</h1>
        <p className="max-w-3xl text-sm text-text2">
          SATCAT objects attributed to this owner, with related launch links and
          object-type distribution.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            {profile.ownerSatelliteCount} satellite
            {profile.ownerSatelliteCount === 1 ? '' : 's'}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            PAY: {profile.typeCounts.PAY}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            RB: {profile.typeCounts.RB}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            DEB: {profile.typeCounts.DEB}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            UNK: {profile.typeCounts.UNK}
          </span>
          {profile.lastSatcatUpdatedAt ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              Updated: {profile.lastSatcatUpdatedAt}
            </span>
          ) : null}
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Related Launches</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {launchRows.length} launches
          </span>
        </div>
        {launchRows.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {launchRows.map((launch) => (
              <li
                key={launch.launchId}
                className="rounded-xl border border-stroke bg-surface-0 p-3"
              >
                <Link
                  href={launch.href}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {launch.launchName || launch.launchId}
                </Link>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text3">
                  {launch.launchProvider ? (
                    <span>{launch.launchProvider}</span>
                  ) : null}
                  {launch.launchVehicle ? (
                    <span>{launch.launchVehicle}</span>
                  ) : null}
                </div>
                {launch.launchNet ? (
                  <div className="mt-1 text-[11px] text-text3">
                    {launch.launchNet}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">
            No associated launches have been resolved for this owner yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Satellites</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {profile.satellites.length} listed
          </span>
        </div>
        {profile.satellites.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {profile.satellites.map((sat) => (
              <li
                key={sat.noradCatId}
                className="rounded-xl border border-stroke bg-surface-0 p-3"
              >
                <Link
                  href={buildSatelliteHref(sat.noradCatId)}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {sat.name || `NORAD ${sat.noradCatId}`}
                </Link>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text3">
                  <span>NORAD {sat.noradCatId}</span>
                  {sat.intlDes ? <span>{sat.intlDes}</span> : null}
                  {sat.objectType ? <span>{sat.objectType}</span> : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text3">
                  {typeof sat.perigeeKm === 'number' &&
                  Number.isFinite(sat.perigeeKm) ? (
                    <span>Perigee: {Math.round(sat.perigeeKm)} km</span>
                  ) : null}
                  {typeof sat.apogeeKm === 'number' &&
                  Number.isFinite(sat.apogeeKm) ? (
                    <span>Apogee: {Math.round(sat.apogeeKm)} km</span>
                  ) : null}
                  {typeof sat.inclinationDeg === 'number' &&
                  Number.isFinite(sat.inclinationDeg) ? (
                    <span>Inc: {sat.inclinationDeg.toFixed(2)}°</span>
                  ) : null}
                  {sat.satcatUpdatedAt ? (
                    <span>Updated: {sat.satcatUpdatedAt}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">
            No satellites are currently available for this owner profile.
          </p>
        )}
      </section>
    </div>
  );
}
