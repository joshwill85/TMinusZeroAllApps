import { useLocalSearchParams } from 'expo-router';
import { NewsArticleRouteScreen } from '@/src/features/customerRoutes/newsDetail';

function getNewsId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function NewsArticleRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();

  return <NewsArticleRouteScreen articleId={getNewsId(params.id)} />;
}
