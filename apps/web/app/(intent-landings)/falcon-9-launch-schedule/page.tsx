import {
  buildLaunchIntentLandingMetadata,
  INTENT_LANDING_REVALIDATE_SECONDS,
  renderLaunchIntentLandingPage
} from '@/lib/server/launchIntentLanding';

export const revalidate = INTENT_LANDING_REVALIDATE_SECONDS;

export function generateMetadata() {
  return buildLaunchIntentLandingMetadata('falcon-9-launch-schedule');
}

export default async function Falcon9LaunchSchedulePage() {
  return renderLaunchIntentLandingPage('falcon-9-launch-schedule');
}
