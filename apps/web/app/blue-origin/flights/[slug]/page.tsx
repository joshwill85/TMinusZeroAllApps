import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { fetchBlueOriginFlightHubData } from '@/lib/server/blueOriginFlightHub';
import { parseBlueOriginFlightSlug } from '@/lib/utils/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const revalidate = 60 * 10;

type Params = {
  slug: string;
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = parseBlueOriginFlightSlug(params.slug);
  if (!parsed) {
    return {
      title: `Blue Origin Flight | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  return {
    title: `Blue Origin ${parsed.toUpperCase()} | ${BRAND_NAME}`,
    robots: { index: false, follow: false }
  };
}

export default async function BlueOriginFlightRedirectPage({ params }: { params: Params }) {
  const parsed = parseBlueOriginFlightSlug(params.slug);
  if (!parsed) notFound();

  if (params.slug !== parsed) {
    permanentRedirect(`/blue-origin/flights/${parsed}`);
  }

  const hub = await fetchBlueOriginFlightHubData(parsed);
  if (!hub?.snapshot?.launch) notFound();

  permanentRedirect(buildLaunchHref(hub.snapshot.launch));
}
