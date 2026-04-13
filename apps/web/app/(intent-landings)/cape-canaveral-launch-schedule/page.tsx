import {
  buildLaunchIntentLandingMetadata,
  INTENT_LANDING_REVALIDATE_SECONDS,
  renderLaunchIntentLandingPage
} from '@/lib/server/launchIntentLanding';

export const revalidate = INTENT_LANDING_REVALIDATE_SECONDS;

export function generateMetadata() {
  return buildLaunchIntentLandingMetadata('cape-canaveral-launch-schedule');
}

export default async function CapeCanaveralLaunchSchedulePage() {
  return renderLaunchIntentLandingPage('cape-canaveral-launch-schedule');
}
