import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { ApiClientError } from '@tminuszero/api-client';
import { getDefaultMobilePushPrelaunchOffsets, getMobilePushMaxPrelaunchOffsets, getMobilePushPrelaunchOptions } from '@tminuszero/domain';
import {
  useDeleteMobilePushRuleMutation,
  useMobilePushLaunchPreferenceQuery,
  useUpsertMobilePushLaunchPreferenceMutation
} from '@/src/api/queries';
import { SectionCard } from '@/src/components/SectionCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';

type LaunchAlertsPanelProps = {
  launchId: string;
  installationId: string | null;
  deviceSecret: string | null;
  isPremium: boolean;
  isPushRegistered: boolean;
  onOpenUpgrade: () => void;
  onOpenPreferences: () => void;
};

type LaunchAlertDraft = {
  prelaunchOffsetsMinutes: number[];
  notifyStatusChanges: boolean;
  notifyNetChanges: boolean;
};

const DEFAULT_LAUNCH_ALERT_DRAFT: LaunchAlertDraft = {
  prelaunchOffsetsMinutes: getDefaultMobilePushPrelaunchOffsets('launch'),
  notifyStatusChanges: false,
  notifyNetChanges: false
};

export function LaunchAlertsPanel({
  launchId,
  installationId,
  deviceSecret,
  isPremium,
  isPushRegistered,
  onOpenUpgrade,
  onOpenPreferences
}: LaunchAlertsPanelProps) {
  const { theme } = useMobileBootstrap();
  const { enablePush, isSyncing: isPushSyncing, lastError: pushError, permissionStatus } = useMobilePush();
  const context = installationId ? { installationId, deviceSecret } : null;
  const preferenceQuery = useMobilePushLaunchPreferenceQuery(launchId, context);
  const upsertRuleMutation = useUpsertMobilePushLaunchPreferenceMutation();
  const deleteRuleMutation = useDeleteMobilePushRuleMutation();
  const [draft, setDraft] = useState<LaunchAlertDraft>(DEFAULT_LAUNCH_ALERT_DRAFT);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | null; text: string }>({ tone: null, text: '' });
  const rule = preferenceQuery.data?.rule ?? null;
  const access = preferenceQuery.data?.access ?? null;
  const canManageLaunchNotifications = access?.basicAllowed !== false;
  const canUseAdvancedNotifications = access?.advancedAllowed ?? isPremium;
  const maxOffsets =
    access?.maxPrelaunchOffsets ??
    getMobilePushMaxPrelaunchOffsets({
      advancedAllowed: canUseAdvancedNotifications,
      scopeKind: 'launch'
    });
  const offsetOptions = getMobilePushPrelaunchOptions(canUseAdvancedNotifications);
  const requiresPushGate = !isPushRegistered;

  useEffect(() => {
    if (!rule) {
      setDraft(DEFAULT_LAUNCH_ALERT_DRAFT);
      setMessage({ tone: null, text: '' });
      return;
    }

    setDraft({
      prelaunchOffsetsMinutes: Array.from(new Set(rule.settings.prelaunchOffsetsMinutes ?? [])).sort((left, right) => left - right),
      notifyStatusChanges: (rule.settings.statusChangeTypes ?? []).length > 0,
      notifyNetChanges: rule.settings.notifyNetChanges === true
    });
    setMessage({ tone: null, text: '' });
  }, [rule]);

  const validationError = useMemo(() => {
    if (!canManageLaunchNotifications || requiresPushGate) return null;
    if (draft.prelaunchOffsetsMinutes.length === 0 && !draft.notifyStatusChanges && !draft.notifyNetChanges) {
      return 'Choose at least one notification.';
    }
    if (draft.prelaunchOffsetsMinutes.length > maxOffsets) {
      return `Choose at most ${maxOffsets} reminder time${maxOffsets === 1 ? '' : 's'}.`;
    }
    return null;
  }, [canManageLaunchNotifications, draft.notifyNetChanges, draft.notifyStatusChanges, draft.prelaunchOffsetsMinutes.length, maxOffsets, requiresPushGate]);

  const helperText = canUseAdvancedNotifications
    ? 'Choose up to three push reminders before liftoff and decide whether launch or NET changes should trigger a push.'
    : `Choose up to ${maxOffsets} push reminder${maxOffsets === 1 ? '' : 's'} before liftoff on this device. Premium adds launch-change and NET-change alerts.`;

  return (
    <SectionCard
      title="Launch alerts"
      description={
        requiresPushGate
          ? rule
            ? 'Enable push on this device to resume or edit alerts for this launch.'
            : 'Enable push on this device before you create launch alerts.'
          : canUseAdvancedNotifications
            ? 'Customize reminder times and change alerts for this launch on this device.'
            : 'Set launch-specific reminder times for this device. Premium unlocks change alerts.'
      }
    >
      {!installationId ? (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Preparing device push settings…</Text>
      ) : preferenceQuery.isPending ? (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading launch alert settings…</Text>
      ) : preferenceQuery.isError ? (
        <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{preferenceQuery.error.message}</Text>
      ) : requiresPushGate ? (
        <View style={{ gap: 12 }}>
          <View
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              padding: 14,
              gap: 8
            }}
          >
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Turn on push first</Text>
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
              {permissionStatus === 'denied'
                ? 'Notifications are disabled for this device. Turn them back on in system settings before choosing reminder times or launch changes.'
                : 'Launch alerts only work after this device is registered for push notifications.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <PanelActionButton
                label={
                  permissionStatus === 'denied'
                    ? 'Open device settings'
                    : isPushSyncing
                      ? 'Enabling…'
                      : 'Enable push on this device'
                }
                onPress={() => {
                  void handleEnablePush();
                }}
                disabled={isPushSyncing}
              />
              <PanelActionButton label="Open preferences" onPress={onOpenPreferences} variant="secondary" />
            </View>
          </View>

          {message.text ? (
            <Text style={{ color: message.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>{message.text}</Text>
          ) : pushError ? (
            <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{pushError}</Text>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Reminder times</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{helperText}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {offsetOptions.map((value) => {
                const active = draft.prelaunchOffsetsMinutes.includes(value);
                return (
                  <SelectChip
                    key={value}
                    label={formatReminderLabel(value)}
                    active={active}
                    disabled={!canManageLaunchNotifications}
                    onPress={() => {
                      if (!canManageLaunchNotifications) {
                        onOpenPreferences();
                        return;
                      }
                      setDraft((current) => {
                        if (current.prelaunchOffsetsMinutes.includes(value)) {
                          return {
                            ...current,
                            prelaunchOffsetsMinutes: current.prelaunchOffsetsMinutes.filter((entry) => entry !== value)
                          };
                        }
                        if (current.prelaunchOffsetsMinutes.length >= maxOffsets) {
                          setMessage({
                            tone: 'error',
                            text: `Choose at most ${maxOffsets} reminder times.`
                          });
                          return current;
                        }
                        return {
                          ...current,
                          prelaunchOffsetsMinutes: [...current.prelaunchOffsetsMinutes, value].sort((left, right) => left - right)
                        };
                      });
                    }}
                  />
                );
              })}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Change alerts</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {canUseAdvancedNotifications
                ? 'Premium can notify you for any launch status change and for NET or launch-window changes.'
                : 'Launch-change and NET-change notifications are Premium.'}
            </Text>
            <View style={{ gap: 8 }}>
              <ToggleRow
                title="Launch changes"
                description="Send a push for any status change on this launch."
                active={draft.notifyStatusChanges}
                locked={!canUseAdvancedNotifications}
                onPress={() => {
                  if (!canUseAdvancedNotifications) {
                    onOpenUpgrade();
                    return;
                  }
                  setDraft((current) => ({ ...current, notifyStatusChanges: !current.notifyStatusChanges }));
                }}
              />
              <ToggleRow
                title="NET changes"
                description="Send a push when the launch time or window changes."
                active={draft.notifyNetChanges}
                locked={!canUseAdvancedNotifications}
                onPress={() => {
                  if (!canUseAdvancedNotifications) {
                    onOpenUpgrade();
                    return;
                  }
                  setDraft((current) => ({ ...current, notifyNetChanges: !current.notifyNetChanges }));
                }}
              />
            </View>
          </View>

          {!canUseAdvancedNotifications && canManageLaunchNotifications ? (
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
              Basic launch reminders are available on this device. Premium adds multiple reminder windows plus launch-change and NET-change alerts.
            </Text>
          ) : null}

          {message.text ? (
            <Text style={{ color: message.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>{message.text}</Text>
          ) : validationError ? (
            <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{validationError}</Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <PanelActionButton
              label={upsertRuleMutation.isPending ? 'Saving…' : rule ? 'Save notifications' : 'Create notifications'}
              onPress={() => {
                void saveLaunchAlerts();
              }}
              disabled={upsertRuleMutation.isPending || deleteRuleMutation.isPending || Boolean(validationError)}
            />
            <PanelActionButton
              label="Clear"
              variant="secondary"
              onPress={() => {
                void clearLaunchAlerts();
              }}
              disabled={upsertRuleMutation.isPending || deleteRuleMutation.isPending || !rule}
            />
          </View>
        </View>
      )}
    </SectionCard>
  );

  async function handleEnablePush() {
    setMessage({ tone: null, text: '' });

    if (permissionStatus === 'denied') {
      await Linking.openSettings();
      return;
    }

    try {
      await enablePush();
      setMessage({ tone: 'success', text: 'Push enabled. Launch alerts are ready on this device.' });
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message === 'Notification permission was not granted.'
          ? 'Enable notifications in system settings to continue.'
          : describeLaunchAlertError(error);
      setMessage({
        tone: 'error',
        text: errorMessage
      });
    }
  }

  async function saveLaunchAlerts() {
    if (!installationId) return;
    if (!canManageLaunchNotifications) {
      onOpenPreferences();
      setMessage({ tone: 'error', text: 'Enable push on this device before saving launch notifications.' });
      return;
    }
    if (validationError) {
      setMessage({ tone: 'error', text: validationError });
      return;
    }
    if (requiresPushGate) {
      setMessage({ tone: 'error', text: 'Enable push on this device before saving launch notifications.' });
      return;
    }

    setMessage({ tone: null, text: '' });
    try {
      await upsertRuleMutation.mutateAsync({
        launchId,
        payload: {
          installationId,
          deviceSecret,
          scopeKind: 'launch',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          prelaunchOffsetsMinutes: draft.prelaunchOffsetsMinutes,
          dailyDigestLocalTime: null,
          statusChangeTypes: canUseAdvancedNotifications && draft.notifyStatusChanges ? ['any'] : [],
          notifyNetChanges: canUseAdvancedNotifications ? draft.notifyNetChanges : false
        }
      });
      setMessage({ tone: 'success', text: 'Launch alerts updated.' });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: describeLaunchAlertError(error)
      });
    }
  }

  async function clearLaunchAlerts() {
    if (!installationId || !rule) {
      return;
    }
    if (!canManageLaunchNotifications) {
      onOpenPreferences();
      setMessage({ tone: 'error', text: 'Enable push on this device before changing launch notifications.' });
      return;
    }

    try {
      await deleteRuleMutation.mutateAsync({
        ruleId: rule.id,
        context: {
          installationId,
          deviceSecret
        }
      });
      setDraft(DEFAULT_LAUNCH_ALERT_DRAFT);
      setMessage({ tone: 'success', text: 'Launch alerts cleared.' });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: describeLaunchAlertError(error)
      });
    }
  }
}

function PanelActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: isPrimary ? theme.accent : theme.stroke,
        backgroundColor: isPrimary ? theme.accent : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 16,
        paddingVertical: 12,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: isPrimary ? theme.background : theme.foreground, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function SelectChip({
  label,
  active,
  disabled = false,
  onPress
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({
  title,
  description,
  active,
  locked = false,
  onPress
}: {
  title: string;
  description: string;
  active: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.09)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: pressed ? 0.88 : 1
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 14, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{description}</Text>
        </View>
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: locked ? 'rgba(255, 255, 255, 0.08)' : active ? `${theme.accent}66` : theme.stroke,
            backgroundColor: locked ? 'rgba(255, 255, 255, 0.04)' : active ? 'rgba(34, 211, 238, 0.16)' : 'rgba(255, 255, 255, 0.04)',
            paddingHorizontal: 10,
            paddingVertical: 5
          }}
        >
          <Text style={{ color: locked ? theme.muted : active ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '700' }}>
            {locked ? 'Premium' : active ? 'On' : 'Off'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function formatReminderLabel(value: number) {
  if (value >= 1440) return '1 day';
  if (value >= 60) return `${Math.round(value / 60)} hr`;
  return `${value} min`;
}

function describeLaunchAlertError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'payment_required') {
      return 'That notification setup needs Premium.';
    }
    if (error.code === 'push_not_registered') {
      return 'Enable push on this device before saving launch alerts.';
    }
    if (error.code === 'invalid_guest_device') {
      return 'This device push session expired. Enable push again to refresh it.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to update launch alerts.';
}
