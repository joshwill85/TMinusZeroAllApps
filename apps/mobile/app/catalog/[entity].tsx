import { useLocalSearchParams } from 'expo-router';
import { CatalogCollectionRouteScreen } from '@/src/features/customerRoutes/catalog';

export default function CatalogCollectionRoute() {
  const params = useLocalSearchParams<{ entity?: string | string[] }>();
  const entity = Array.isArray(params.entity) ? params.entity[0] ?? '' : params.entity ?? '';

  return <CatalogCollectionRouteScreen entity={entity} />;
}
