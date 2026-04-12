import type { Metadata } from 'next';
import { ArtemisPlannedMissionPage } from '@/components/artemis/ArtemisPlannedMissionPage';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 5; // 5 minutes

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis-vii';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis VII (Artemis 7) Launch Schedule & Mission Plan | ${BRAND_NAME}`;
  const description =
    'Artemis VII mission planning coverage with launch schedule signals, timeline context, and related Artemis mission links.';
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

export default async function ArtemisVIIMissionPage() {
  return (
    <ArtemisPlannedMissionPage
      missionKey="artemis-vii"
      heading="Artemis VII (Artemis 7)"
      canonicalPath="/artemis-vii"
      snapshotText="Artemis VII is the longest-range currently tracked Artemis mission placeholder; this page surfaces schedule signals, evidence links, and program context as data sources update."
    />
  );
}
