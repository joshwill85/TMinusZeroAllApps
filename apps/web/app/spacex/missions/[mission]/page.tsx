import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { SpaceXMissionPage } from '@/components/spacex/SpaceXMissionPage';
import { BRAND_NAME } from '@/lib/brand';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { getSiteUrl } from '@/lib/server/env';
import type { SpaceXMissionKey } from '@/lib/types/spacexProgram';

export const revalidate = 60 * 10;

type Params = {
  mission: string;
};

type MissionConfig = {
  heading: string;
  summary: string;
  title: string;
  description: string;
};

type SpaceXRoutedMissionKey = Exclude<SpaceXMissionKey, 'spacex-program'>;

const MISSION_CONFIG: Record<SpaceXRoutedMissionKey, MissionConfig> = {
  starship: {
    heading: 'Starship',
    summary: 'Starship mission hub with integrated flight-test cadence, launch updates, and source-linked mission context.',
    title: `SpaceX Starship Mission Tracker | ${BRAND_NAME}`,
    description: 'Starship mission hub with flights, timeline signals, passenger/payload context, and contracts intelligence.'
  },
  'falcon-9': {
    heading: 'Falcon 9',
    summary: 'Falcon 9 mission hub for reusable launch cadence, mission updates, and manifest-linked records.',
    title: `SpaceX Falcon 9 Mission Tracker | ${BRAND_NAME}`,
    description: 'Falcon 9 mission hub with launch schedule, payload records, and contracts context.'
  },
  'falcon-heavy': {
    heading: 'Falcon Heavy',
    summary: 'Falcon Heavy mission hub for heavy-lift launch windows, milestones, and mission-linked evidence.',
    title: `SpaceX Falcon Heavy Mission Tracker | ${BRAND_NAME}`,
    description: 'Falcon Heavy mission hub with schedule visibility, payload context, and contracts links.'
  },
  dragon: {
    heading: 'Dragon',
    summary: 'Dragon mission hub for crew and cargo transportation updates, passenger records, and mission-linked context.',
    title: `SpaceX Dragon Mission Tracker | ${BRAND_NAME}`,
    description: 'Dragon mission hub with passenger/crew context, launch tracking, and contracts references.'
  }
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const resolved = resolveMission(params.mission);
  if (!resolved) {
    return {
      title: `SpaceX Mission | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/spacex/missions/${resolved.slug}`;
  const pageUrl = `${siteUrl}${canonical}`;

  return {
    title: resolved.config.title,
    description: resolved.config.description,
    alternates: { canonical },
    openGraph: {
      title: resolved.config.title,
      description: resolved.config.description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [{ url: siteMeta.ogImage, width: 1200, height: 630, alt: SITE_META.ogImageAlt, type: 'image/jpeg' }]
    },
    twitter: {
      card: 'summary_large_image',
      title: resolved.config.title,
      description: resolved.config.description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default function SpaceXMissionRoutePage({ params }: { params: Params }) {
  const resolved = resolveMission(params.mission);
  if (!resolved) {
    if (normalize(params.mission) === 'spacex-program' || normalize(params.mission) === 'spacex') permanentRedirect('/spacex');
    notFound();
  }

  if (params.mission !== resolved.slug) permanentRedirect(`/spacex/missions/${resolved.slug}`);

  return (
    <SpaceXMissionPage
      missionKey={resolved.slug}
      canonicalPath={`/spacex/missions/${resolved.slug}`}
      heading={resolved.config.heading}
      summary={resolved.config.summary}
    />
  );
}

function resolveMission(value: string) {
  const slug = normalize(value);
  if (!slug) return null;
  if (slug === 'falcon9' || slug === 'f9') {
    return { slug: 'falcon-9' as SpaceXRoutedMissionKey, config: MISSION_CONFIG['falcon-9'] };
  }
  if (slug === 'falconheavy' || slug === 'fh') {
    return { slug: 'falcon-heavy' as SpaceXRoutedMissionKey, config: MISSION_CONFIG['falcon-heavy'] };
  }
  if (!isSpaceXRoutedMissionKey(slug)) return null;
  return { slug, config: MISSION_CONFIG[slug] };
}

function normalize(value: string | null | undefined) {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
}

function isSpaceXRoutedMissionKey(value: string): value is SpaceXRoutedMissionKey {
  return value in MISSION_CONFIG;
}
