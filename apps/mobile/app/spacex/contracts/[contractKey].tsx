import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXContractParam, SpaceXContractDetailScreen } from '@/src/features/programHubs/spacexDetailScreens';

export default function SpaceXContractDetailRoute() {
  const params = useLocalSearchParams<{ contractKey?: string | string[] }>();
  const contractKey = normalizeSpaceXContractParam(params.contractKey);

  if (!contractKey) {
    return (
      <AppScreen testID="spacex-contract-invalid-screen">
        <CustomerShellPanel title="Contract unavailable" description="The requested SpaceX contract record is not valid." />
      </AppScreen>
    );
  }

  return <SpaceXContractDetailScreen slug={contractKey} />;
}
