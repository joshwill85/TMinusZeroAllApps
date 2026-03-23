import { ContentPageRouteScreen, JELLYFISH_FALLBACK_PAGE } from '@/src/features/customerRoutes/content';

export default function JellyfishEffectRoute() {
  return <ContentPageRouteScreen testID="jellyfish-effect-screen" slug="jellyfish-effect" fallbackPage={JELLYFISH_FALLBACK_PAGE} />;
}
