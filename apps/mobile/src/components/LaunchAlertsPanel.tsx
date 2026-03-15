import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ApiClientError } from '@tminuszero/api-client';
import {
  useLaunchNotificationPreferenceQuery,
  useUpdateLaunchNotificationPreferenceMutation
} from '@/src/api/queries';
import { SectionCard } from '@/src/components/SectionCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

const DEFAULT_T_MINUS_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 120] as const;

type LaunchAlertsPanelProps = {
  launchId: string;
  isAuthed: boolean;
  canUseBasicAlertRules: boolean;
  canUseAdvancedAlertRules: boolean;
  onOpenSignIn: () => void;
  onOpenUpgrade: () => void;
  onOpenPreferences: () => void;
};

type LaunchAlertDraft = {
  mode: 't_minus' | 'local_time';
  tMinusMinutes: number[];
  localTimeOne: string;
  localTimeTwo: string;
  notifyStatusChange: boolean;
  notifyNetChange: boolean;
};

const DEFAULT_DRAFT: LaunchAlertDraft = {
  mode: 't_minus',
  tMinusMinutes: [30],
  localTimeOne: '',
  localTimeTwo: '',
  notifyStatusChange: true,
  notifyNetChange: true
};

export function LaunchAlertsPanel({
  launchId,
  isAuthed,
  canUseBasicAlertRules,
  canUseAdvancedAlertRules,
  onOpenSignIn,
  onOpenUpgrade,
  onOpenPreferences
}: LaunchAlertsPanelProps) {
  const { theme } = useMobileBootstrap();
  const [channel, setChannel] = useState<'push' | 'sms'>('push');
  const [draft, setDraft] = useState<LaunchAlertDraft>(DEFAULT_DRAFT);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | null; text: string }>({ tone: null, text: '' });
  const preferenceQuery = useLaunchNotificationPreferenceQuery(launchId, channel);
  const updatePreferenceMutation = useUpdateLaunchNotificationPreferenceMutation();
  const preference = preferenceQuery.data ?? null;

  useEffect(() => {
    if (!canUseAdvancedAlertRules && channel === 'sms') {
      setChannel('push');
    }
  }, [canUseAdvancedAlertRules, channel]);

  useEffect(() => {
    if (!preference) {
      return;
    }

    const localTimes = preference.preference.localTimes ?? [];
    setDraft({
      mode: preference.preference.mode === 'local_time' ? 'local_time' : 't_minus',
      tMinusMinutes: Array.from(new Set(preference.preference.tMinusMinutes ?? [])).sort((left, right) => left - right),
      localTimeOne: localTimes[0] ?? '',
      localTimeTwo: localTimes[1] ?? '',
      notifyStatusChange: preference.preference.notifyStatusChange === true,
      notifyNetChange: preference.preference.notifyNetChange === true
    });
    setMessage({ tone: null, text: '' });
  }, [preference]);

  const normalizedLocalTimes = useMemo(() => {
    const values = [draft.localTimeOne, draft.localTimeTwo]
      .map((value) => normalizeLocalTime(value))
      .filter((value): value is string => value != null);
    return Array.from(new Set(values)).slice(0, 2);
  }, [draft.localTimeOne, draft.localTimeTwo]);

  const isPushBlocked =
    channel === 'push' &&
    (!preference?.pushStatus?.enabled || !preference?.pushStatus?.subscribed);
  const isSmsBlocked =
    channel === 'sms' &&
    (!canUseAdvancedAlertRules ||
      preference?.smsStatus?.systemEnabled === false ||
      !preference?.smsStatus?.verified ||
      !preference?.smsStatus?.enabled);

  const validationError = validateDraft(draft, normalizedLocalTimes);
  const isAllOff =
    (draft.mode === 't_minus' ? draft.tMinusMinutes.length === 0 : normalizedLocalTimes.length === 0) &&
    !draft.notifyStatusChange &&
    !draft.notifyNetChange;

  if (!isAuthed) {
    return (
      <SectionCard title="Launch alerts" description="Sign in to keep launch-specific alert schedules on this account.">
        <PanelActionButton label="Sign in to configure alerts" onPress={onOpenSignIn} />
      </SectionCard>
    );
  }

  if (!canUseBasicAlertRules) {
    return (
      <SectionCard title="Launch alerts" description="This account tier cannot configure launch-specific alerts yet.">
        <PanelActionButton label="Open upgrade options" onPress={onOpenUpgrade} />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Launch alerts"
      description="Set push or SMS reminders for this launch and keep launch-specific NET or status change updates on the account."
    >
      {preferenceQuery.isPending ? (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading launch alert preferences…</Text>
      ) : preferenceQuery.isError ? (
        <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{preferenceQuery.error.message}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Channel</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <SelectChip label="Push" active={channel === 'push'} onPress={() => setChannel('push')} />
              <SelectChip
                label="SMS"
                active={channel === 'sms'}
                disabled={!canUseAdvancedAlertRules}
                onPress={() => setChannel('sms')}
              />
            </View>
            {channel === 'push' ? (
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                {preference?.pushStatus?.enabled
                  ? preference?.pushStatus?.subscribed
                    ? 'Push is enabled and this account has a registered destination.'
                    : 'Push is enabled, but no mobile destination is registered yet.'
                  : 'Enable push in Settings before saving launch-specific push alerts.'}
              </Text>
            ) : (
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                {preference?.smsStatus?.systemEnabled === false
                  ? 'SMS delivery is not configured right now.'
                  : preference?.smsStatus?.verified && preference?.smsStatus?.enabled
                    ? 'SMS is verified and enabled for this account.'
                    : 'Verify a phone number and enable SMS in Settings before saving launch-specific SMS alerts.'}
              </Text>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Schedule mode</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <SelectChip
                label="T- minus"
                active={draft.mode === 't_minus'}
                onPress={() => {
                  setDraft((current) => ({ ...current, mode: 't_minus' }));
                  setMessage({ tone: null, text: '' });
                }}
              />
              <SelectChip
                label="Local time"
                active={draft.mode === 'local_time'}
                onPress={() => {
                  setDraft((current) => ({ ...current, mode: 'local_time' }));
                  setMessage({ tone: null, text: '' });
                }}
              />
            </View>
          </View>

          {draft.mode === 't_minus' ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Reminder times</Text>
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Choose up to two offsets before liftoff.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {DEFAULT_T_MINUS_OPTIONS.map((value) => {
                  const active = draft.tMinusMinutes.includes(value);
                  return (
                    <SelectChip
                      key={value}
                      label={`T-${value}m`}
                      active={active}
                      onPress={() => {
                        setDraft((current) => {
                          if (current.tMinusMinutes.includes(value)) {
                            return {
                              ...current,
                              tMinusMinutes: current.tMinusMinutes.filter((entry) => entry !== value)
                            };
                          }
                          if (current.tMinusMinutes.length >= 2) {
                            setMessage({ tone: 'error', text: 'Choose at most two alert times.' });
                            return current;
                          }
                          return {
                            ...current,
                            tMinusMinutes: [...current.tMinusMinutes, value].sort((left, right) => left - right)
                          };
                        });
                      }}
                    />
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Local delivery times</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TimeInput
                  label="Time 1"
                  value={draft.localTimeOne}
                  onChangeText={(value) => {
                    setDraft((current) => ({ ...current, localTimeOne: value }));
                    setMessage({ tone: null, text: '' });
                  }}
                />
                <TimeInput
                  label="Time 2"
                  value={draft.localTimeTwo}
                  onChangeText={(value) => {
                    setDraft((current) => ({ ...current, localTimeTwo: value }));
                    setMessage({ tone: null, text: '' });
                  }}
                />
              </View>
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Use `HH:MM` in your local timezone. Leave blanks to clear the schedule.</Text>
            </View>
          )}

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Change events</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <SelectChip
                label="NET changes"
                active={draft.notifyNetChange}
                onPress={() => {
                  setDraft((current) => ({ ...current, notifyNetChange: !current.notifyNetChange }));
                  setMessage({ tone: null, text: '' });
                }}
              />
              <SelectChip
                label="Status changes"
                active={draft.notifyStatusChange}
                onPress={() => {
                  setDraft((current) => ({ ...current, notifyStatusChange: !current.notifyStatusChange }));
                  setMessage({ tone: null, text: '' });
                }}
              />
            </View>
          </View>

          {message.text ? (
            <Text style={{ color: message.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>{message.text}</Text>
          ) : validationError ? (
            <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{validationError}</Text>
          ) : null}

          {(isPushBlocked || isSmsBlocked) && !validationError && !isAllOff ? (
            <PanelActionButton label="Open alert settings" onPress={onOpenPreferences} variant="secondary" />
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <PanelActionButton
              label={updatePreferenceMutation.isPending ? 'Saving…' : preference?.enabled ? 'Save launch alerts' : 'Create launch alerts'}
              onPress={() => {
                void saveLaunchAlerts();
              }}
              disabled={updatePreferenceMutation.isPending || Boolean(validationError) || ((!isAllOff && isPushBlocked) || (!isAllOff && isSmsBlocked))}
            />
            <PanelActionButton
              label="Clear"
              variant="secondary"
              onPress={() => {
                setDraft((current) => ({
                  ...current,
                  tMinusMinutes: [],
                  localTimeOne: '',
                  localTimeTwo: '',
                  notifyStatusChange: false,
                  notifyNetChange: false
                }));
                setMessage({ tone: null, text: '' });
              }}
              disabled={updatePreferenceMutation.isPending}
            />
          </View>
        </View>
      )}
    </SectionCard>
  );

  async function saveLaunchAlerts() {
    if (validationError) {
      setMessage({ tone: 'error', text: validationError });
      return;
    }
    if (!isAllOff && (isPushBlocked || isSmsBlocked)) {
      setMessage({
        tone: 'error',
        text: channel === 'push' ? 'Enable push and register a device in Settings first.' : 'Finish SMS verification in Settings first.'
      });
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setMessage({ tone: null, text: '' });

    try {
      const payload = await updatePreferenceMutation.mutateAsync({
        launchId,
        payload: {
          channel,
          mode: draft.mode,
          timezone,
          tMinusMinutes: draft.mode === 't_minus' ? draft.tMinusMinutes : [],
          localTimes: draft.mode === 'local_time' ? normalizedLocalTimes : [],
          notifyStatusChange: draft.notifyStatusChange,
          notifyNetChange: draft.notifyNetChange
        }
      });

      setMessage({
        tone: 'success',
        text: payload.enabled ? 'Launch alerts updated.' : 'Launch alerts cleared.'
      });
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

function TimeInput({
  label,
  value,
  onChangeText
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="09:30"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          color: theme.foreground,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: 15
        }}
      />
    </View>
  );
}

function validateDraft(draft: LaunchAlertDraft, normalizedLocalTimes: string[]) {
  if (draft.mode === 't_minus') {
    return null;
  }

  const allRawValues = [draft.localTimeOne, draft.localTimeTwo]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (allRawValues.some((value) => normalizeLocalTime(value) == null)) {
    return 'Use `HH:MM` for local-time alerts.';
  }
  if (normalizedLocalTimes.length > 2) {
    return 'Choose at most two local alert times.';
  }
  return null;
}

function normalizeLocalTime(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  if (!/^(\d{2}):(\d{2})$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function describeLaunchAlertError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'push_not_enabled') {
      return 'Enable push in Settings before saving launch-specific push alerts.';
    }
    if (error.code === 'push_not_subscribed') {
      return 'Register a push destination in Settings before saving launch-specific push alerts.';
    }
    if (error.code === 'sms_not_verified') {
      return 'Verify a phone number in Settings before saving SMS launch alerts.';
    }
    if (error.code === 'sms_not_enabled') {
      return 'Enable SMS in Settings before saving SMS launch alerts.';
    }
    if (error.code === 'sms_system_disabled') {
      return 'SMS delivery is not configured right now.';
    }
    if (error.code === 'payment_required') {
      return 'This plan cannot configure that launch-alert channel yet.';
    }
    if (error.code === 'invalid_t_minus') {
      return 'Use supported reminder offsets only.';
    }
  }

  return error instanceof Error && error.message ? error.message : 'Unable to update launch alerts.';
}
