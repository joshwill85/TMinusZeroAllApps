import { useLocalSearchParams } from 'expo-router';
import { CatalogDetailRouteScreen } from '@/src/features/customerRoutes/catalog';

export default function CatalogDetailRoute() {
  const params = useLocalSearchParams<{ entity?: string | string[]; entityId?: string | string[] }>();
  const entity = Array.isArray(params.entity) ? params.entity[0] ?? '' : params.entity ?? '';
  const entityId = Array.isArray(params.entityId) ? params.entityId[0] ?? '' : params.entityId ?? '';

  return <CatalogDetailRouteScreen entity={entity} entityId={entityId} />;
}
