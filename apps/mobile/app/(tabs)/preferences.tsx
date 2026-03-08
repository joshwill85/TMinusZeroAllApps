import { Text } from 'react-native';
import { useFilterPresetsQuery, useNotificationPreferencesQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { SignInPrompt } from '@/src/components/SignInPrompt';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { formatBooleanState } from '@/src/utils/format';

export default function PreferencesScreen() {
  const { accessToken, theme } = useMobileBootstrap();
  const notificationPreferencesQuery = useNotificationPreferencesQuery();
  const filterPresetsQuery = useFilterPresetsQuery();

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Account settings"
        title="Preferences"
        description="Notification preferences and launch filters are loaded from the shared API contracts."
      />

      {!accessToken ? (
        <SignInPrompt body="Preferences depend on an authenticated viewer session, so this shell shows the signed-out state until auth flows are wired in." />
      ) : (
        <>
          {notificationPreferencesQuery.isPending ? (
            <LoadingStateCard title="Notification preferences" body="Fetching /api/v1/me/notification-preferences." />
          ) : notificationPreferencesQuery.isError ? (
            <ErrorStateCard
              title="Notification preferences unavailable"
              body={notificationPreferencesQuery.error.message}
            />
          ) : (
            <SectionCard
              title="Notification preferences"
              description="Current read-only state from the backend."
            >
              <Text style={{ color: theme.foreground, fontSize: 15, lineHeight: 24 }}>
                Push: {formatBooleanState(notificationPreferencesQuery.data.pushEnabled)}
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 15, lineHeight: 24 }}>
                Email: {formatBooleanState(notificationPreferencesQuery.data.emailEnabled)}
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 15, lineHeight: 24 }}>
                SMS: {formatBooleanState(notificationPreferencesQuery.data.smsEnabled)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22, marginTop: 8 }}>
                Launch-day email: {formatBooleanState(notificationPreferencesQuery.data.launchDayEmailEnabled ?? false)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>
                Quiet hours: {formatBooleanState(notificationPreferencesQuery.data.quietHoursEnabled ?? false)}
              </Text>
            </SectionCard>
          )}

          {filterPresetsQuery.isPending ? (
            <LoadingStateCard title="Filter presets" body="Fetching /api/v1/me/filter-presets." />
          ) : filterPresetsQuery.isError ? (
            <ErrorStateCard title="Filter presets unavailable" body={filterPresetsQuery.error.message} />
          ) : filterPresetsQuery.data.presets.length === 0 ? (
            <EmptyStateCard title="No filter presets" body="Saved presets will appear here once those flows are used on web or mobile." />
          ) : (
            <SectionCard title="Filter presets" description="Read-only preview of saved launch filter presets.">
              {filterPresetsQuery.data.presets.map((preset) => (
                <SectionCard key={preset.id} title={preset.name} compact>
                  <Text style={{ color: theme.muted, fontSize: 14 }}>
                    {Object.keys(preset.filters).length} filter key{Object.keys(preset.filters).length === 1 ? '' : 's'}
                    {preset.isDefault ? ' · default' : ''}
                  </Text>
                </SectionCard>
              ))}
            </SectionCard>
          )}
        </>
      )}
    </AppScreen>
  );
}
