import {
  buildLaunchIntentLandingMetadata,
  INTENT_LANDING_REVALIDATE_SECONDS,
  renderLaunchIntentLandingPage
} from '@/lib/server/launchIntentLanding';

export const revalidate = INTENT_LANDING_REVALIDATE_SECONDS;

export function generateMetadata() {
  return buildLaunchIntentLandingMetadata('florida-rocket-launch-schedule');
}

export default async function FloridaRocketLaunchSchedulePage() {
  return renderLaunchIntentLandingPage('florida-rocket-launch-schedule');
}
