import type { Metadata } from 'next';
import { ArtemisPlannedMissionPage } from '@/components/artemis/ArtemisPlannedMissionPage';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 5; // 5 minutes

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis-iv';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis IV (Artemis 4) Launch Schedule & Mission Plan | ${BRAND_NAME}`;
  const description = 'Artemis IV mission planning coverage with launch schedule signals, timeline context, and related Artemis mission links.';
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

export default async function ArtemisIVMissionPage() {
  return (
    <ArtemisPlannedMissionPage
      missionKey="artemis-iv"
      heading="Artemis IV (Artemis 4)"
      canonicalPath="/artemis-iv"
      snapshotText="Artemis IV extends sustained lunar campaign planning with mission architecture, gateway integration, and launch-window readiness signals that continue to evolve as program milestones are refined."
    />
  );
}
