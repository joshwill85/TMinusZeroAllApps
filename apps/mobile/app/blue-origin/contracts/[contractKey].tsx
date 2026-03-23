import { useLocalSearchParams } from 'expo-router';
import { BlueOriginContractDetailScreen, normalizeBlueOriginContractParam } from '@/src/features/programHubs/blueOriginDetailScreens';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';

export default function BlueOriginContractDetailRoute() {
  const params = useLocalSearchParams<{ contractKey?: string | string[] }>();
  const contractKey = normalizeBlueOriginContractParam(params.contractKey);

  if (!contractKey) {
    return (
      <AppScreen testID="blue-origin-contract-invalid-screen">
        <CustomerShellPanel title="Contract unavailable" description="The requested Blue Origin contract record is not valid." />
      </AppScreen>
    );
  }

  return <BlueOriginContractDetailScreen slug={contractKey} />;
}
