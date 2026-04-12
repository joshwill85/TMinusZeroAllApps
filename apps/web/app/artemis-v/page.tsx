import type { Metadata } from 'next';
import { ArtemisPlannedMissionPage } from '@/components/artemis/ArtemisPlannedMissionPage';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 5; // 5 minutes

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis-v';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis V (Artemis 5) Launch Schedule & Mission Plan | ${BRAND_NAME}`;
  const description =
    'Artemis V mission planning coverage with launch schedule signals, timeline context, and related Artemis mission links.';
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

export default async function ArtemisVMissionPage() {
  return (
    <ArtemisPlannedMissionPage
      missionKey="artemis-v"
      heading="Artemis V (Artemis 5)"
      canonicalPath="/artemis-v"
      snapshotText="Artemis V continues long-range lunar campaign sequencing with mission planning updates tied to hardware readiness, integrated operations, and launch-window refinements."
    />
  );
}
