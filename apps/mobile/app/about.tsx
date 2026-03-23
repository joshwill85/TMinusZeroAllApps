import { ContentPageRouteScreen, ABOUT_FALLBACK_PAGE } from '@/src/features/customerRoutes/content';

export default function AboutRoute() {
  return <ContentPageRouteScreen testID="about-screen" slug="about" fallbackPage={ABOUT_FALLBACK_PAGE} />;
}
