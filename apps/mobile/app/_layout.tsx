import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Href, Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { resolvePushHref } from '@tminuszero/navigation';
import { MobileDockingBay } from '@/src/components/MobileDockingBay';
import { AppProviders, useMobileBootstrap } from '@/src/providers/AppProviders';

SplashScreen.preventAutoHideAsync().catch(() => {});
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

function RootNavigator() {
  const router = useRouter();
  const { isReady, scheme, theme } = useMobileBootstrap();

  useEffect(() => {
    if (!isReady) return;
    SplashScreen.hideAsync().catch(() => {});
  }, [isReady]);

  useEffect(() => {
    async function handleResponse(response: Notifications.NotificationResponse | null) {
      if (!response) {
        return;
      }

      const data = response?.notification.request.content.data ?? {};
      const href = resolvePushHref({
        url: typeof data.url === 'string' ? data.url : null,
        launchId: typeof data.launchId === 'string' ? data.launchId : null,
        eventType: typeof data.eventType === 'string' ? data.eventType : null
      });
      router.push(href as Href);
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleResponse(response);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        void handleResponse(response);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [router]);

  if (!isReady) {
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

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: theme.background }
        }}
      />
      <MobileDockingBay />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </SafeAreaProvider>
  );
}
