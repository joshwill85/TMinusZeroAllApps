import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXEngineParam, SpaceXEngineDetailScreen } from '@/src/features/programHubs/spacexDetailScreens';

export default function SpaceXEngineDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeSpaceXEngineParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="spacex-engine-invalid-screen">
        <CustomerShellPanel title="Engine unavailable" description="The requested SpaceX engine profile is not valid." />
      </AppScreen>
    );
  }

  return <SpaceXEngineDetailScreen slug={slug} />;
}
