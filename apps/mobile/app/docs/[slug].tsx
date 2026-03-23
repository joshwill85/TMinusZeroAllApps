import { useLocalSearchParams } from 'expo-router';
import { DocsPageRouteScreen } from '@/src/features/customerRoutes/docs';

export default function DocsPageRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] ?? '' : params.slug ?? '';

  return <DocsPageRouteScreen slug={slug} />;
}
