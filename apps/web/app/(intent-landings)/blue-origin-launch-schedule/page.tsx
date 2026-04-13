import {
  buildLaunchIntentLandingMetadata,
  INTENT_LANDING_REVALIDATE_SECONDS,
  renderLaunchIntentLandingPage
} from '@/lib/server/launchIntentLanding';

export const revalidate = INTENT_LANDING_REVALIDATE_SECONDS;

export function generateMetadata() {
  return buildLaunchIntentLandingMetadata('blue-origin-launch-schedule');
}

export default async function BlueOriginLaunchSchedulePage() {
  return renderLaunchIntentLandingPage('blue-origin-launch-schedule');
}
