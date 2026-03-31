import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiClientError } from '@tminuszero/api-client';
import {
  useDeleteMobilePushRuleMutation,
  useMobilePushLaunchPreferenceQuery,
  useUpsertMobilePushLaunchPreferenceMutation
} from '@/src/api/queries';
import { SectionCard } from '@/src/components/SectionCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

const PREMIUM_OFFSET_OPTIONS = [10, 30, 60, 120, 360, 720, 1440] as const;
const STATUS_OPTIONS = [
  { key: 'any', label: 'Any change' },
  { key: 'go', label: 'Go' },
  { key: 'hold', label: 'Hold' },
  { key: 'scrubbed', label: 'Scrubbed' },
  { key: 'tbd', label: 'TBD' }
] as const;

type LaunchAlertsPanelProps = {
  launchId: string;
  installationId: string | null;
  deviceSecret: string | null;
  isPremium: boolean;
  isPushRegistered: boolean;
  onOpenUpgrade: () => void;
  onOpenPreferences: () => void;
};

type LaunchAlertStatusChangeType = (typeof STATUS_OPTIONS)[number]['key'];

type LaunchAlertDraft = {
  prelaunchOffsetsMinutes: number[];
  statusChangeTypes: LaunchAlertStatusChangeType[];
  notifyNetChanges: boolean;
};

const DEFAULT_PREMIUM_DRAFT: LaunchAlertDraft = {
  prelaunchOffsetsMinutes: [60],
  statusChangeTypes: [],
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
  const context = installationId ? { installationId, deviceSecret } : null;
  const preferenceQuery = useMobilePushLaunchPreferenceQuery(launchId, context);
  const upsertRuleMutation = useUpsertMobilePushLaunchPreferenceMutation();
  const deleteRuleMutation = useDeleteMobilePushRuleMutation();
  const [draft, setDraft] = useState<LaunchAlertDraft>(DEFAULT_PREMIUM_DRAFT);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | null; text: string }>({ tone: null, text: '' });
  const rule = preferenceQuery.data?.rule ?? null;
  const access = preferenceQuery.data?.access ?? null;
  const canManageLaunchNotifications = access?.basicAllowed !== false;
  const canUseAdvancedNotifications = access?.advancedAllowed === true;
  const maxOffsets = access?.maxPrelaunchOffsets ?? (isPremium ? 3 : 1);
  const offsetOptions = canUseAdvancedNotifications ? PREMIUM_OFFSET_OPTIONS : ([10, 60] as const);

  useEffect(() => {
    if (!rule) {
      setDraft(DEFAULT_PREMIUM_DRAFT);
      setMessage({ tone: null, text: '' });
      return;
    }

    setDraft({
      prelaunchOffsetsMinutes: Array.from(new Set(rule.settings.prelaunchOffsetsMinutes ?? [])).sort((left, right) => left - right),
      statusChangeTypes: Array.from(new Set(rule.settings.statusChangeTypes ?? [])),
      notifyNetChanges: rule.settings.notifyNetChanges === true
    });
    setMessage({ tone: null, text: '' });
  }, [isPremium, rule]);

  const validationError = useMemo(() => {
    if (!canManageLaunchNotifications) return null;
    if (draft.prelaunchOffsetsMinutes.length === 0 && (draft.statusChangeTypes.length === 0 && !draft.notifyNetChanges)) {
      return 'Choose at least one notification.';
    }
    if (draft.prelaunchOffsetsMinutes.length > maxOffsets) {
      return `Choose at most ${maxOffsets} reminder time${maxOffsets === 1 ? '' : 's'}.`;
    }
    return null;
  }, [canManageLaunchNotifications, draft.notifyNetChanges, draft.prelaunchOffsetsMinutes.length, draft.statusChangeTypes.length, maxOffsets]);

  return (
    <SectionCard
      title="Launch notifications"
      description={
        canUseAdvancedNotifications
          ? 'Set reminder times for this launch and choose which timing or status changes should trigger push notifications.'
          : canManageLaunchNotifications
            ? 'Set basic push notifications for this launch. Premium adds more reminder windows and change notifications.'
            : rule
              ? 'Stored launch notifications stay visible on this device, but push must be enabled before you can edit them.'
              : 'Enable push on this device before you create launch notifications.'
      }
    >
      {!installationId ? (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Preparing device push settings…</Text>
      ) : preferenceQuery.isPending ? (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading launch notification settings…</Text>
      ) : preferenceQuery.isError ? (
        <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{preferenceQuery.error.message}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Reminder times</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {canUseAdvancedNotifications
                ? 'Choose up to three push reminders before liftoff.'
                : `Choose up to ${maxOffsets} push reminder${maxOffsets === 1 ? '' : 's'} before liftoff. Premium unlocks change notifications.`}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {offsetOptions.map((value) => {
                const active = draft.prelaunchOffsetsMinutes.includes(value);
                return (
                  <SelectChip
                    key={value}
                    label={value >= 1440 ? '1 day' : value >= 60 ? `${Math.round(value / 60)} hr` : `${value} min`}
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
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Launch changes</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {canUseAdvancedNotifications
                ? 'Choose which status changes should trigger notifications, and whether NET or window changes should send a push.'
                : 'Status-change and NET-change notifications are Premium.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {STATUS_OPTIONS.map((option) => {
                const active = draft.statusChangeTypes.includes(option.key);
                return (
                  <SelectChip
                    key={option.key}
                    label={option.label}
                    active={active}
                    disabled={!canUseAdvancedNotifications}
                    onPress={() => {
                      if (!canUseAdvancedNotifications) {
                        onOpenUpgrade();
                        return;
                      }
                      setDraft((current) => {
                        if (option.key === 'any') {
                          return {
                            ...current,
                            statusChangeTypes: current.statusChangeTypes.includes('any') ? [] : ['any']
                          };
                        }

                        const next = current.statusChangeTypes.filter((entry) => entry !== 'any');
                        if (next.includes(option.key)) {
                          return {
                            ...current,
                            statusChangeTypes: next.filter((entry) => entry !== option.key)
                          };
                        }
                        return {
                          ...current,
                          statusChangeTypes: [...next, option.key]
                        };
                      });
                    }}
                  />
                );
              })}
              <SelectChip
                label="NET changes"
                active={draft.notifyNetChanges}
                disabled={!canUseAdvancedNotifications}
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

          {!isPushRegistered ? (
            <PanelActionButton label="Enable push on this device" onPress={onOpenPreferences} variant="secondary" />
          ) : null}

          {!canUseAdvancedNotifications && canManageLaunchNotifications ? (
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
              Basic launch notifications are available on this device. Premium adds multiple reminders plus NET and status-change notifications.
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
              disabled={upsertRuleMutation.isPending || deleteRuleMutation.isPending || !isPushRegistered || Boolean(validationError)}
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
    if (!isPushRegistered) {
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
          statusChangeTypes: canUseAdvancedNotifications ? draft.statusChangeTypes : [],
          notifyNetChanges: canUseAdvancedNotifications ? draft.notifyNetChanges : false
        }
      });
      setMessage({ tone: 'success', text: 'Launch notifications updated.' });
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
      setDraft(DEFAULT_PREMIUM_DRAFT);
      setMessage({ tone: 'success', text: 'Launch notifications cleared.' });
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

function describeLaunchAlertError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'payment_required') {
      return 'That notification setup needs Premium.';
    }
    if (error.code === 'push_not_registered') {
      return 'Enable push on this device before saving launch notifications.';
    }
    if (error.code === 'invalid_guest_device') {
      return 'This device push session expired. Enable push again to refresh it.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to update launch notifications.';
}
