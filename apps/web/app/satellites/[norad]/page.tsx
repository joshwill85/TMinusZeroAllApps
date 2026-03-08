import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { fetchLaunchByDesignator, intlDesToLaunchDesignator } from '@/lib/server/satellites';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildSatelliteOwnerHref, formatSatelliteOwnerLabel } from '@/lib/utils/satelliteLinks';

type OrbitSummary = {
  source?: string | null;
  epoch?: string | null;
  inclination_deg?: number | null;
  raan_deg?: number | null;
  eccentricity?: number | null;
  arg_perigee_deg?: number | null;
  mean_anomaly_deg?: number | null;
  mean_motion_rev_per_day?: number | null;
  bstar?: number | null;
  fetched_at?: string | null;
};

type SatelliteDetail = {
  norad_cat_id: number;
  intl_des?: string | null;
  name?: string | null;
  object_type?: string | null;
  ops_status_code?: string | null;
  owner?: string | null;
  launch_date?: string | null;
  launch_site?: string | null;
  decay_date?: string | null;
  period_min?: number | null;
  inclination_deg?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  rcs_m2?: number | null;
  satcat_updated_at?: string | null;
  orbit?: OrbitSummary | null;
  groups?: string[] | null;
};

function parseNorad(value: string): number | null {
  const raw = value.trim();
  if (!/^[0-9]{1,9}$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const norad = Math.trunc(parsed);
  if (norad <= 0) return null;
  return norad;
}

const fetchSatelliteDetail = cache(async (noradCatId: number): Promise<SatelliteDetail | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_satellite_detail', { norad_cat_id_in: noradCatId });
  if (error || data == null) return null;

  const normalized = (() => {
    if (typeof data === 'object') return data as SatelliteDetail;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === 'object' ? (parsed as SatelliteDetail) : null;
      } catch {
        return null;
      }
    }
    return null;
  })();

  if (!normalized || typeof normalized.norad_cat_id !== 'number') return null;
  return normalized;
});

export async function generateMetadata({ params }: { params: { norad: string } }): Promise<Metadata> {
  const norad = parseNorad(params.norad);
  if (norad == null) {
    return { title: `Not found | ${SITE_META.siteName}`, robots: { index: false, follow: false } };
  }

  const sat = await fetchSatelliteDetail(norad);
  if (!sat) {
    return { title: `Not found | ${SITE_META.siteName}`, robots: { index: false, follow: false } };
  }

  const ownerLabel = formatSatelliteOwnerLabel(sat.owner);
  const launchDesignator = intlDesToLaunchDesignator(sat.intl_des);
  const associatedLaunch = launchDesignator ? await fetchLaunchByDesignator(launchDesignator) : null;
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const siteMeta = buildSiteMeta();
  const canonicalPath = `/satellites/${encodeURIComponent(String(norad))}`;
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const name = sat.name || `NORAD ${norad}`;
  const title = `${name} (NORAD ${norad}) | ${BRAND_NAME}`;

  const descriptionParts = [
    sat.intl_des ? `International designator ${sat.intl_des}.` : null,
    ownerLabel ? `Owner ${ownerLabel}.` : null,
    sat.object_type ? `Object type ${sat.object_type}.` : null,
    associatedLaunch ? `Associated launch ${associatedLaunch.name}.` : null
  ].filter(Boolean) as string[];
  const description = descriptionParts.length ? descriptionParts.join(' ') : 'Satellite catalog entry.';
  const imageAlt = `Satellite ${name} profile`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
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
          alt: imageAlt,
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
          alt: imageAlt
        }
      ]
    }
  };
}

export default async function SatellitePage({ params }: { params: { norad: string } }) {
  const norad = parseNorad(params.norad);
  if (norad == null) return notFound();

  const sat = await fetchSatelliteDetail(norad);
  if (!sat) return notFound();

  const number = new Intl.NumberFormat('en-US');
  const title = sat.name || `NORAD ${norad}`;
  const orbit = sat.orbit || null;
  const groups = Array.isArray(sat.groups) ? sat.groups : [];
  const ownerLabel = formatSatelliteOwnerLabel(sat.owner);
  const ownerHref = sat.owner ? buildSatelliteOwnerHref(sat.owner) : null;
  const launchDesignator = intlDesToLaunchDesignator(sat.intl_des);
  const associatedLaunch = launchDesignator ? await fetchLaunchByDesignator(launchDesignator) : null;
  const associatedLaunchHref = associatedLaunch
    ? buildLaunchHref({
        id: associatedLaunch.launchId,
        name: associatedLaunch.name,
        slug: associatedLaunch.slug || undefined
      })
    : null;
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const pageUrl = `${siteUrl}/satellites/${encodeURIComponent(String(norad))}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Satellites', item: `${siteUrl}/satellites` },
        { '@type': 'ListItem', position: 3, name: title, item: pageUrl }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: title,
      description: [sat.object_type ? `Object type ${sat.object_type}.` : null, ownerLabel ? `Owner ${ownerLabel}.` : null]
        .filter(Boolean)
        .join(' '),
      identifier: [
        { '@type': 'PropertyValue', propertyID: 'NORAD Catalog Number', value: String(norad) },
        sat.intl_des ? { '@type': 'PropertyValue', propertyID: 'International Designator', value: sat.intl_des } : null
      ].filter(Boolean),
      url: pageUrl,
      subjectOf:
        associatedLaunch && associatedLaunchHref
          ? {
              '@type': 'Event',
              name: associatedLaunch.name,
              startDate: associatedLaunch.net || undefined,
              url: `${siteUrl}${associatedLaunchHref}`
            }
          : undefined
    }
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <JsonLd data={jsonLd as any} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Satellite</div>
          <h1 className="mt-2 break-words text-2xl font-semibold text-text1">{title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text3">
            {sat.intl_des ? <span className="break-words">{sat.intl_des}</span> : null}
            <span className="break-words">NORAD {norad}</span>
            {ownerLabel ? (
              <span className="break-words">
                {ownerHref ? (
                  <Link href={ownerHref} className="text-primary hover:underline">
                    {ownerLabel}
                  </Link>
                ) : (
                  ownerLabel
                )}
              </span>
            ) : null}
            {sat.ops_status_code ? <span className="break-words">Ops: {sat.ops_status_code}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-sm">
          <Link href="/satellites" className="rounded-md border border-stroke px-3 py-1 text-text2 transition hover:text-text1">
            All satellites
          </Link>
          <Link href="/" className="rounded-md border border-stroke px-3 py-1 text-text2 transition hover:text-text1">
            Back to launch list
          </Link>
        </div>
      </div>

      {associatedLaunch && associatedLaunchHref ? (
        <section className="mt-5 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Associated launch</div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={associatedLaunchHref} className="text-base font-semibold text-text1 hover:text-primary">
                {associatedLaunch.name}
              </Link>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text3">
                {launchDesignator ? <span>COSPAR {launchDesignator}</span> : null}
                {associatedLaunch.provider ? <span>{associatedLaunch.provider}</span> : null}
                {associatedLaunch.vehicle ? <span>{associatedLaunch.vehicle}</span> : null}
              </div>
            </div>
            {associatedLaunch.net ? <div className="text-xs text-text3">{associatedLaunch.net}</div> : null}
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Catalog</div>
          <div className="mt-3 grid gap-y-2 text-sm text-text2">
            {ownerLabel ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Owner</span>
                <span className="text-text1">
                  {ownerHref ? (
                    <Link href={ownerHref} className="text-primary hover:underline">
                      {ownerLabel}
                    </Link>
                  ) : (
                    ownerLabel
                  )}
                </span>
              </div>
            ) : null}
            {sat.object_type ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Object type</span>
                <span className="text-text1">{sat.object_type}</span>
              </div>
            ) : null}
            {sat.launch_site ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Launch site</span>
                <span className="text-text1">{sat.launch_site}</span>
              </div>
            ) : null}
            {sat.launch_date ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Launch date</span>
                <span className="text-text1">{sat.launch_date}</span>
              </div>
            ) : null}
            {launchDesignator ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Launch designator</span>
                <span className="text-text1">{launchDesignator}</span>
              </div>
            ) : null}
            {typeof sat.period_min === 'number' && Number.isFinite(sat.period_min) ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Period</span>
                <span className="text-text1">{sat.period_min.toFixed(2)} min</span>
              </div>
            ) : null}
            {typeof sat.inclination_deg === 'number' && Number.isFinite(sat.inclination_deg) ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Inclination</span>
                <span className="text-text1">{sat.inclination_deg.toFixed(2)}°</span>
              </div>
            ) : null}
            {typeof sat.perigee_km === 'number' || typeof sat.apogee_km === 'number' ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">Altitude</span>
                <span className="text-text1">
                  {typeof sat.perigee_km === 'number' && Number.isFinite(sat.perigee_km) ? `${number.format(Math.round(sat.perigee_km))} km` : '?'} →{' '}
                  {typeof sat.apogee_km === 'number' && Number.isFinite(sat.apogee_km) ? `${number.format(Math.round(sat.apogee_km))} km` : '?'}
                </span>
              </div>
            ) : null}
            {typeof sat.rcs_m2 === 'number' && Number.isFinite(sat.rcs_m2) ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">RCS</span>
                <span className="text-text1">{sat.rcs_m2.toFixed(3)} m²</span>
              </div>
            ) : null}
            {sat.satcat_updated_at ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text3">SATCAT updated</span>
                <span className="text-text1">{sat.satcat_updated_at}</span>
              </div>
            ) : null}
          </div>

          {groups.length ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Groups</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-text2">
                {groups.map((code) => (
                  <span key={code} className="rounded-md border border-stroke bg-black/20 px-2 py-1">
                    {code}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Orbit (latest)</div>
          {orbit ? (
            <div className="mt-3 grid gap-y-2 text-sm text-text2">
              {orbit.epoch ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Epoch</span>
                  <span className="text-text1">{orbit.epoch}</span>
                </div>
              ) : null}
              {typeof orbit.inclination_deg === 'number' && Number.isFinite(orbit.inclination_deg) ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Inclination</span>
                  <span className="text-text1">{orbit.inclination_deg.toFixed(4)}°</span>
                </div>
              ) : null}
              {typeof orbit.raan_deg === 'number' && Number.isFinite(orbit.raan_deg) ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">RAAN</span>
                  <span className="text-text1">{orbit.raan_deg.toFixed(4)}°</span>
                </div>
              ) : null}
              {typeof orbit.eccentricity === 'number' && Number.isFinite(orbit.eccentricity) ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Eccentricity</span>
                  <span className="text-text1">{orbit.eccentricity.toFixed(7)}</span>
                </div>
              ) : null}
              {typeof orbit.mean_motion_rev_per_day === 'number' && Number.isFinite(orbit.mean_motion_rev_per_day) ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Mean motion</span>
                  <span className="text-text1">{orbit.mean_motion_rev_per_day.toFixed(6)} rev/day</span>
                </div>
              ) : null}
              {orbit.source ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Source</span>
                  <span className="text-text1">{orbit.source}</span>
                </div>
              ) : null}
              {orbit.fetched_at ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text3">Fetched</span>
                  <span className="text-text1">{orbit.fetched_at}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-sm text-text3">No orbit elements found yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}
