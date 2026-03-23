import { useLocalSearchParams } from 'expo-router';
import { SatelliteDetailScreen } from '@/src/features/customerRoutes/satellites';

export default function SatelliteDetailRouteScreen() {
  const params = useLocalSearchParams<{ norad?: string | string[] }>();
  const noradCatId = Array.isArray(params.norad) ? params.norad[0] ?? '' : params.norad ?? '';

  return <SatelliteDetailScreen noradCatId={noradCatId} />;
}
