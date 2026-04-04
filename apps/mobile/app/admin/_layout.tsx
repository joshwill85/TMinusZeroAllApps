import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import NotFoundScreen from '../+not-found';
import { useViewerSessionQuery } from '@/src/api/queries';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function AdminLayout() {
  const { theme } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();

  if (sessionQuery.isPending) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background
        }}
      >
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (sessionQuery.data?.role !== 'admin') {
    return <NotFoundScreen />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: theme.background }
      }}
    />
  );
}
