import { Tabs } from 'expo-router';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function TabsLayout() {
  const { theme } = useMobileBootstrap();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
        tabBarStyle: {
          display: 'none'
        },
        tabBarButton: () => null
      }}
    >
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
      <Tabs.Screen name="preferences" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="profile" options={{ title: 'Account' }} />
    </Tabs>
  );
}
