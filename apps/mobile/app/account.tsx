import { Redirect } from 'expo-router';
import { buildMobileRoute } from '@tminuszero/navigation';

export default function AccountRedirectScreen() {
  return <Redirect href={buildMobileRoute('profile')} />;
}
