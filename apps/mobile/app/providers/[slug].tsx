import { useLocalSearchParams } from 'expo-router';
import { ProviderDetailRouteScreen } from '@/src/features/entityRoutes/EntityDetailScreen';
import { readRouteParam } from '@/src/features/entityRoutes/utils';

export default function ProviderScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = readRouteParam(params.slug);
  return <ProviderDetailRouteScreen slug={slug} testID="provider-screen" />;
}
