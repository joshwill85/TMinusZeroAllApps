import { useLocalSearchParams } from 'expo-router';
import { ContractDetailScreen } from '@/src/features/customerRoutes/contracts';

export default function ContractDetailRouteScreen() {
  const params = useLocalSearchParams<{ contractUid?: string | string[] }>();
  const contractUid = Array.isArray(params.contractUid) ? params.contractUid[0] ?? '' : params.contractUid ?? '';

  return <ContractDetailScreen contractUid={contractUid} />;
}
