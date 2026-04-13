import {
  buildLaunchIntentLandingMetadata,
  INTENT_LANDING_REVALIDATE_SECONDS,
  renderLaunchIntentLandingPage
} from '@/lib/server/launchIntentLanding';

export const revalidate = INTENT_LANDING_REVALIDATE_SECONDS;

export function generateMetadata() {
  return buildLaunchIntentLandingMetadata('spacex-launch-schedule');
}

export default async function SpaceXLaunchSchedulePage() {
  return renderLaunchIntentLandingPage('spacex-launch-schedule');
}
