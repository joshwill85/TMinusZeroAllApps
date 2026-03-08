import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { BlueOriginMissionPage } from '@/components/blueorigin/BlueOriginMissionPage';
import { BRAND_NAME } from '@/lib/brand';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { getSiteUrl } from '@/lib/server/env';
import type { BlueOriginMissionKey } from '@/lib/utils/blueOrigin';

export const revalidate = 60 * 10;

type Params = {
  mission: string;
};

type MissionPageConfig = {
  missionKey: Exclude<BlueOriginMissionKey, 'blue-origin-program'>;
  heading: string;
  summary: string;
  title: string;
  description: string;
};

const MISSION_CONFIG: Record<string, MissionPageConfig> = {
  'new-shepard': {
    missionKey: 'new-shepard',
    heading: 'New Shepard',
    summary:
      "New Shepard is Blue Origin's suborbital program. This hub tracks notable missions, who flew, payload manifests, launch schedule changes, and official mission evidence.",
    title: `New Shepard Flights, Crew & Payloads | ${BRAND_NAME}`,
    description:
      'New Shepard mission hub with notable flights, crew records, payload manifests, timeline updates, and official-source links.'
  },
  'new-glenn': {
    missionKey: 'new-glenn',
    heading: 'New Glenn',
    summary:
      "New Glenn is Blue Origin's orbital launch program. This hub tracks mission cadence, launch windows, contracts and government records, and notable flight updates.",
    title: `New Glenn Launch Timeline & Mission Tracking | ${BRAND_NAME}`,
    description:
      'New Glenn mission hub with launch schedule signals, timeline evidence, contracts context, and notable flight tracking.'
  },
  'blue-moon': {
    missionKey: 'blue-moon',
    heading: 'Blue Moon',
    summary:
      "Blue Moon is Blue Origin's lunar lander architecture. This hub tracks NASA-linked milestones, contract records, and program timeline updates.",
    title: `Blue Moon Lunar Program Timeline & Contracts | ${BRAND_NAME}`,
    description:
      'Blue Moon mission hub with lunar program milestones, contract signals, and timeline evidence for Blue Origin lunar systems.'
  },
  'blue-ring': {
    missionKey: 'blue-ring',
    heading: 'Blue Ring',
    summary:
      "Blue Ring is Blue Origin's in-space logistics platform. This page tracks key milestones, supporting program events, and source-backed mission updates.",
    title: `Blue Ring Program Timeline & Mission Signals | ${BRAND_NAME}`,
    description:
      'Blue Ring mission hub with in-space logistics program updates, timeline evidence, and related mission signals.'
  },
  'be-4': {
    missionKey: 'be-4',
    heading: 'BE-4',
    summary:
      "BE-4 is Blue Origin's methane-oxygen engine program. This page tracks public milestones, deployment context, and related evidence for launch-system integration.",
    title: `BE-4 Engine Program Timeline & Deployment Context | ${BRAND_NAME}`,
    description:
      'BE-4 mission and engine-program hub with timeline milestones, deployment context, and supporting contracts evidence.'
  }
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const resolved = resolveMissionConfig(params.mission);
  if (!resolved) {
    return {
      title: `Blue Origin Mission | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/blue-origin/missions/${resolved.slug}`;
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

export default async function BlueOriginMissionRoutePage({ params }: { params: Params }) {
  const resolved = resolveMissionConfig(params.mission);
  if (!resolved) {
    if (normalizeMission(params.mission) === 'blue-origin-program') permanentRedirect('/blue-origin');
    notFound();
  }

  if (params.mission !== resolved.slug) {
    permanentRedirect(`/blue-origin/missions/${resolved.slug}`);
  }

  return (
    <BlueOriginMissionPage
      missionKey={resolved.config.missionKey}
      canonicalPath={`/blue-origin/missions/${resolved.slug}`}
      heading={resolved.config.heading}
      summary={resolved.config.summary}
    />
  );
}

function resolveMissionConfig(value: string) {
  const normalized = normalizeMission(value);
  if (!normalized) return null;
  const config = MISSION_CONFIG[normalized];
  if (!config) return null;
  return { slug: normalized, config };
}

function normalizeMission(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  if (normalized === 'blue-origin-program' || normalized === 'blue-origin' || normalized === 'program') return 'blue-origin-program';
  return null;
}
