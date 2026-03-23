import { useLocalSearchParams } from 'expo-router';
import { BlueOriginEngineDetailScreen, normalizeBlueOriginEngineParam } from '@/src/features/programHubs/blueOriginDetailScreens';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';

export default function BlueOriginEngineDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeBlueOriginEngineParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="blue-origin-engine-invalid-screen">
        <CustomerShellPanel title="Engine unavailable" description="The requested Blue Origin engine profile is not valid." />
      </AppScreen>
    );
  }

  return <BlueOriginEngineDetailScreen slug={slug} />;
}
