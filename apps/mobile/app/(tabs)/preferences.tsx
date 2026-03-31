import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { MobilePushRuleUpsertV1, MobilePushRuleV1, WatchlistRuleV1 } from '@tminuszero/api-client';
import {
  useDeleteMobilePushRuleMutation,
  useFilterPresetsQuery,
  useLaunchFilterOptionsQuery,
  useMobilePushRulesQuery,
  useUpsertMobilePushRuleMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';

const BASIC_OFFSET_OPTIONS = [10, 30, 60, 120] as const;
const PREMIUM_OFFSET_OPTIONS = [10, 30, 60, 120, 360, 720, 1440] as const;
const STATUS_OPTIONS = [
  { key: 'any', label: 'Any change' },
  { key: 'go', label: 'Go' },
  { key: 'hold', label: 'Hold' },
  { key: 'scrubbed', label: 'Scrubbed' },
  { key: 'tbd', label: 'TBD' }
] as const;

type NoticeTone = 'info' | 'success' | 'warning';
type Notice = { tone: NoticeTone; message: string } | null;
type NonLaunchMobilePushRuleV1 = Exclude<MobilePushRuleV1, { scopeKind: 'launch' }>;

export default function PreferencesScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const {
    installationId,
    deviceSecret,
    permissionStatus,
    isPushEnabled,
    isRegistered,
    isSyncing,
    lastError,
    lastTestQueuedAt,
    enablePush,
    disablePushAlerts,
    sendTestPush
  } = useMobilePush();
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const isPremium = entitlementsQuery.data?.tier === 'premium';
  const canUseAllUsLaunchAlerts = entitlementsQuery.data?.capabilities.canUseAllUsLaunchAlerts ?? false;
  const canUseStateLaunchAlerts = entitlementsQuery.data?.capabilities.canUseStateLaunchAlerts ?? false;
  const canUseSingleLaunchFollow = entitlementsQuery.data?.capabilities.canUseSingleLaunchFollow ?? false;
  const accessLabel = isPremium ? 'Premium' : isAuthed ? 'Signed in' : 'Public';
  const context = installationId ? { installationId, deviceSecret } : null;
  const rulesQuery = useMobilePushRulesQuery(context, {
    enabled: Boolean(installationId)
  });
  const filterOptionsQuery = useLaunchFilterOptionsQuery(
    {
      mode: 'public',
      range: 'all',
      region: 'all'
    },
    { enabled: true }
  );
  const watchlistsQuery = useWatchlistsQuery();
  const filterPresetsQuery = useFilterPresetsQuery();
  const upsertRuleMutation = useUpsertMobilePushRuleMutation();
  const deleteRuleMutation = useDeleteMobilePushRuleMutation();
  const [notice, setNotice] = useState<Notice>(null);

  const rules = rulesQuery.data?.rules ?? [];
  const scopeRules = rules.filter((rule): rule is NonLaunchMobilePushRuleV1 => rule.scopeKind !== 'launch');
  const launchRuleCount = rules.length - scopeRules.length;
  const allUsRule = scopeRules.find((rule) => rule.scopeKind === 'all_us') ?? null;
  const stateRules = scopeRules.filter((rule) => rule.scopeKind === 'state');
  const allLaunchesRule = scopeRules.find((rule) => rule.scopeKind === 'all_launches') ?? null;
  const presetRules = scopeRules.filter((rule) => rule.scopeKind === 'preset');
  const followRules = scopeRules.filter((rule) => rule.scopeKind === 'follow');
  const selectedStates = new Set(stateRules.map((rule) => normalizeToken(rule.scopeKind === 'state' ? rule.state : rule.label)));
  const availableStates = (filterOptionsQuery.data?.states ?? []).filter((state) => !selectedStates.has(normalizeToken(state)));
  const premiumFollowCandidates = useMemo(() => {
    const followRuleKeys = new Set(
      followRules.map((rule) => (rule.scopeKind === 'follow' ? buildFollowKey(rule.followRuleType, rule.followRuleValue) : ''))
    );

    return flattenWatchlistRules(watchlistsQuery.data?.watchlists ?? []).filter(
      (rule) => !followRuleKeys.has(buildFollowKey(rule.ruleType, rule.ruleValue))
    );
  }, [followRules, watchlistsQuery.data?.watchlists]);
  const premiumPresetCandidates = useMemo(() => {
    const presetRuleIds = new Set(presetRules.map((rule) => (rule.scopeKind === 'preset' ? rule.presetId : '')));
    return (filterPresetsQuery.data?.presets ?? []).filter((preset) => !presetRuleIds.has(preset.id));
  }, [filterPresetsQuery.data?.presets, presetRules]);
  const statusMessage = notice?.message ?? (rulesQuery.error instanceof Error ? rulesQuery.error.message : null) ?? lastError;
  const statusTone = notice?.tone ?? 'warning';

  function openPremiumGate() {
    router.push('/profile');
  }

  return (
    <AppScreen testID="preferences-screen">
      <CustomerShellHero
        eyebrow="Push alerts"
        title="Settings"
        description="Manage this device’s push registration and the mobile alert rules that should deliver to it."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={accessLabel} tone={isPremium ? 'accent' : 'default'} />
          <CustomerShellBadge label={formatPermissionLabel(permissionStatus)} tone={permissionStatus === 'granted' ? 'success' : 'warning'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Notification overview"
        description="Mobile notifications are push-only. Free includes one launch follow slot from launch detail plus `All U.S.` alerts here. Premium adds state alerts, saved follows, extra reminder windows, daily digests, and change alerts."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric
            label="Access"
            value={accessLabel}
            caption={isPremium ? 'All mobile alert scopes enabled' : canUseSingleLaunchFollow || canUseAllUsLaunchAlerts ? 'Free launch slot + All U.S.' : 'Limited mobile alerts'}
          />
          <CustomerShellMetric label="Push" value={isPushEnabled ? 'On' : 'Off'} caption={isRegistered ? 'This device is registered' : 'Device registration pending'} />
          <CustomerShellMetric label="Rules" value={String(scopeRules.length)} caption={launchRuleCount ? `${launchRuleCount} launch-specific alert${launchRuleCount === 1 ? '' : 's'} on launch detail` : 'No broad rules yet'} />
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel
        testID="preferences-push-section"
        title="Device push"
        description="Push registration is device-specific. Turning it off here stops alerts on this phone without changing any shared account rule."
      >
        <View style={{ gap: 10 }}>
          <PreferenceRow label="Permission" value={permissionStatus} />
          <PreferenceRow label="Push enabled" value={formatOnOff(isPushEnabled)} />
          <PreferenceRow label="Device registered" value={formatOnOff(isRegistered)} />
        </View>

        <View
          style={{
            gap: 6,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(234, 240, 255, 0.1)',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            paddingHorizontal: 14,
            paddingVertical: 14
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Installation id: {installationId ?? 'Loading...'}</Text>
          {lastTestQueuedAt ? (
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Last test queued: {lastTestQueuedAt}</Text>
          ) : null}
          {statusMessage ? (
            <Text style={{ color: statusTone === 'success' ? theme.accent : '#ff9087', fontSize: 13, lineHeight: 19 }}>{statusMessage}</Text>
          ) : null}
        </View>

        <CustomerShellActionButton
          label={isPushEnabled ? 'Push enabled' : 'Enable push alerts'}
          onPress={() => {
            setNotice(null);
            void enablePush()
              .then(() => {
                setNotice({ tone: 'success', message: 'Push is enabled on this device.' });
              })
              .catch(() => {});
          }}
          disabled={isSyncing || isPushEnabled}
        />

        <CustomerShellActionButton
          label="Send push test"
          variant="secondary"
          onPress={() => {
            setNotice(null);
            void sendTestPush()
              .then(() => {
                setNotice({ tone: 'success', message: 'Queued a mobile push test.' });
              })
              .catch(() => {});
          }}
          disabled={isSyncing || !isRegistered}
        />

        <Pressable
          onPress={() => {
            setNotice(null);
            void disablePushAlerts()
              .then(() => {
                setNotice({ tone: 'info', message: 'Push was disabled on this device.' });
              })
              .catch(() => {});
          }}
          disabled={isSyncing || (!isPushEnabled && !isRegistered)}
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.stroke,
            paddingHorizontal: 16,
            paddingVertical: 12,
            opacity: isSyncing || (!isPushEnabled && !isRegistered) ? 0.5 : pressed ? 0.86 : 1
          })}
        >
          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Disable push on this device</Text>
        </Pressable>
      </CustomerShellPanel>

      <CustomerShellPanel
        title="Alert rules"
        description="Free/basic can manage `All U.S.` launches here, and the single-launch free slot is handled from launch detail. State rules, saved presets, follows, digests, and change alerts stay Premium-only."
      >
        {!installationId ? (
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Preparing mobile push rules…</Text>
        ) : rulesQuery.isPending ? (
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading mobile push rules…</Text>
        ) : (
          <View style={{ gap: 12 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>All U.S.</Text>
              {allUsRule ? (
                <RuleEditorCard
                  rule={allUsRule}
                  isPremium={isPremium}
                  readOnly={!canUseAllUsLaunchAlerts}
                  busy={upsertRuleMutation.isPending || deleteRuleMutation.isPending}
                  onOpenUpgrade={openPremiumGate}
                  onSave={(payload) => {
                    void saveRule(payload);
                  }}
                  onDelete={() => {
                    void removeRule(allUsRule);
                  }}
                />
              ) : (
                canUseAllUsLaunchAlerts ? (
                  <AddRuleChip
                    label="Add All U.S. launches"
                    disabled={!isRegistered || upsertRuleMutation.isPending}
                    onPress={() => {
                      void createScopeRule({
                        scopeKind: 'all_us'
                      });
                    }}
                  />
                ) : (
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No stored all-U.S. rule on this account.</Text>
                )
              )}
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>States</Text>
              {stateRules.length ? (
                <View style={{ gap: 10 }}>
                  {stateRules.map((rule) => (
                    <RuleEditorCard
                      key={rule.id}
                      rule={rule}
                      isPremium={isPremium}
                      readOnly={!canUseStateLaunchAlerts}
                      busy={upsertRuleMutation.isPending || deleteRuleMutation.isPending}
                      onOpenUpgrade={openPremiumGate}
                      onSave={(payload) => {
                        void saveRule(payload);
                      }}
                      onDelete={() => {
                        void removeRule(rule);
                      }}
                    />
                  ))}
                </View>
              ) : (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No state rules yet.</Text>
              )}
              {filterOptionsQuery.isPending ? (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Loading state options…</Text>
              ) : canUseStateLaunchAlerts ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {availableStates.map((state) => (
                    <AddRuleChip
                      key={state}
                      label={state}
                      disabled={!isRegistered || upsertRuleMutation.isPending}
                      onPress={() => {
                        void createScopeRule({
                          scopeKind: 'state',
                          state
                        });
                      }}
                    />
                  ))}
                </View>
              ) : (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Upgrade to Premium to add state-based alert rules.</Text>
              )}
            </View>
          </View>
        )}
      </CustomerShellPanel>

      <CustomerShellPanel
        title="Premium sources"
        description="Premium can also watch all launches, saved filter presets, and anything followed from Saved or launch detail."
      >
        <View style={{ gap: 12 }}>
          {!isPremium ? (
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
              All launches, saved-filter alerts, follow alerts, daily digests, and change-alert controls are Premium on mobile.
            </Text>
          ) : null}

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>All launches</Text>
            {allLaunchesRule ? (
              <RuleEditorCard
                rule={allLaunchesRule}
                isPremium
                readOnly={!isPremium}
                busy={upsertRuleMutation.isPending || deleteRuleMutation.isPending}
                onOpenUpgrade={openPremiumGate}
                onSave={(payload) => {
                  void saveRule(payload);
                }}
                onDelete={() => {
                  void removeRule(allLaunchesRule);
                }}
              />
            ) : (
              <AddRuleChip
                label="Add All launches"
                disabled={isPremium ? !isRegistered || upsertRuleMutation.isPending : false}
                onPress={() => {
                  if (!isPremium) {
                    openPremiumGate();
                    return;
                  }
                  void createScopeRule({
                    scopeKind: 'all_launches'
                  });
                }}
              />
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Saved filter presets</Text>
            {isPremium ? (
              premiumPresetCandidates.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {premiumPresetCandidates.map((preset) => (
                    <AddRuleChip
                      key={preset.id}
                      label={preset.name}
                      disabled={!isRegistered || upsertRuleMutation.isPending}
                      onPress={() => {
                        void createScopeRule({
                          scopeKind: 'preset',
                          presetId: preset.id
                        });
                      }}
                    />
                  ))}
                </View>
              ) : (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No additional saved filters are available.</Text>
              )
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AddRuleChip label="Saved filter preset" onPress={openPremiumGate} />
              </View>
            )}
            {presetRules.map((rule) => (
              <RuleEditorCard
                key={rule.id}
                rule={rule}
                isPremium
                readOnly={!isPremium}
                busy={upsertRuleMutation.isPending || deleteRuleMutation.isPending}
                onOpenUpgrade={openPremiumGate}
                onSave={(payload) => {
                  void saveRule(payload);
                }}
                onDelete={() => {
                  void removeRule(rule);
                }}
              />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Follows</Text>
            {isPremium ? (
              premiumFollowCandidates.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {premiumFollowCandidates.map((rule) => (
                    <AddRuleChip
                      key={buildFollowKey(rule.ruleType, rule.ruleValue)}
                      label={formatFollowCandidate(rule)}
                      disabled={!isRegistered || upsertRuleMutation.isPending}
                      onPress={() => {
                        void createScopeRule({
                          scopeKind: 'follow',
                          followRuleType: rule.ruleType,
                          followRuleValue: rule.ruleValue
                        });
                      }}
                    />
                  ))}
                </View>
              ) : (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No additional follows are available.</Text>
              )
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AddRuleChip label="Followed providers" onPress={openPremiumGate} />
                <AddRuleChip label="Followed pads" onPress={openPremiumGate} />
                <AddRuleChip label="Followed launches" onPress={openPremiumGate} />
              </View>
            )}
            {followRules.map((rule) => (
              <RuleEditorCard
                key={rule.id}
                rule={rule}
                isPremium
                readOnly={!isPremium}
                busy={upsertRuleMutation.isPending || deleteRuleMutation.isPending}
                onOpenUpgrade={openPremiumGate}
                onSave={(payload) => {
                  void saveRule(payload);
                }}
                onDelete={() => {
                  void removeRule(rule);
                }}
              />
            ))}
          </View>
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );

  function buildBasePayload(): Pick<
    MobilePushRuleUpsertV1,
    'installationId' | 'deviceSecret' | 'timezone' | 'prelaunchOffsetsMinutes' | 'dailyDigestLocalTime' | 'statusChangeTypes' | 'notifyNetChanges'
  > {
    return {
      installationId: installationId ?? 'missing',
      deviceSecret,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      prelaunchOffsetsMinutes: [60],
      dailyDigestLocalTime: null,
      statusChangeTypes: [],
      notifyNetChanges: false
    };
  }

  async function createScopeRule(
    scope:
      | { scopeKind: 'all_us' }
      | { scopeKind: 'state'; state: string }
      | { scopeKind: 'all_launches' }
      | { scopeKind: 'preset'; presetId: string }
      | { scopeKind: 'follow'; followRuleType: WatchlistRuleV1['ruleType']; followRuleValue: string }
  ) {
    if (!installationId) return;
    if (scope.scopeKind === 'all_us' && !canUseAllUsLaunchAlerts) {
      setNotice({ tone: 'warning', message: 'All U.S. alerts are unavailable on this device.' });
      return;
    }
    if (scope.scopeKind === 'state' && !canUseStateLaunchAlerts) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to add state-based mobile alert rules.' });
      return;
    }
    if (scope.scopeKind !== 'all_us' && scope.scopeKind !== 'state' && !isPremium) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to add mobile alert rules.' });
      return;
    }
    setNotice(null);
    try {
      await upsertRuleMutation.mutateAsync({
        ...buildBasePayload(),
        ...scope
      } as MobilePushRuleUpsertV1);
      setNotice({ tone: 'success', message: 'Added a mobile push rule.' });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to add a mobile push rule.')
      });
    }
  }

  async function saveRule(payload: MobilePushRuleUpsertV1) {
    if (payload.scopeKind === 'all_us' && !canUseAllUsLaunchAlerts) {
      setNotice({ tone: 'warning', message: 'All U.S. alerts are unavailable on this device.' });
      return;
    }
    if (payload.scopeKind === 'state' && !canUseStateLaunchAlerts) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to edit state-based mobile alert rules.' });
      return;
    }
    if (payload.scopeKind !== 'all_us' && payload.scopeKind !== 'state' && !isPremium) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to edit mobile alert rules.' });
      return;
    }
    setNotice(null);
    try {
      await upsertRuleMutation.mutateAsync(payload);
      setNotice({ tone: 'success', message: 'Saved mobile push rule.' });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to save the mobile push rule.')
      });
    }
  }

  async function removeRule(rule: NonLaunchMobilePushRuleV1) {
    if (!context) return;
    if (rule.scopeKind === 'all_us' && !canUseAllUsLaunchAlerts) {
      setNotice({ tone: 'warning', message: 'All U.S. alerts are unavailable on this device.' });
      return;
    }
    if (rule.scopeKind === 'state' && !canUseStateLaunchAlerts) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to remove state-based mobile alert rules.' });
      return;
    }
    if (rule.scopeKind !== 'all_us' && rule.scopeKind !== 'state' && !isPremium) {
      openPremiumGate();
      setNotice({ tone: 'warning', message: 'Upgrade to Premium to remove mobile alert rules.' });
      return;
    }
    setNotice(null);
    try {
      await deleteRuleMutation.mutateAsync({
        ruleId: rule.id,
        context
      });
      setNotice({ tone: 'info', message: 'Removed mobile push rule.' });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to remove the mobile push rule.')
      });
    }
  }
}

function RuleEditorCard({
  rule,
  isPremium,
  readOnly = false,
  busy,
  onOpenUpgrade,
  onSave,
  onDelete
}: {
  rule: NonLaunchMobilePushRuleV1;
  isPremium: boolean;
  readOnly?: boolean;
  busy: boolean;
  onOpenUpgrade: () => void;
  onSave: (payload: MobilePushRuleUpsertV1) => void;
  onDelete: () => void;
}) {
  const { theme } = useMobileBootstrap();
  const { installationId, deviceSecret } = useMobilePush();
  const [offsets, setOffsets] = useState<number[]>(rule.settings.prelaunchOffsetsMinutes ?? []);
  const [dailyDigestLocalTime, setDailyDigestLocalTime] = useState(rule.settings.dailyDigestLocalTime ?? '');
  const [statusChangeTypes, setStatusChangeTypes] = useState<Array<(typeof STATUS_OPTIONS)[number]['key']>>(
    (rule.settings.statusChangeTypes ?? []) as Array<(typeof STATUS_OPTIONS)[number]['key']>
  );
  const [notifyNetChanges, setNotifyNetChanges] = useState(rule.settings.notifyNetChanges === true);
  const offsetOptions = readOnly || isPremium ? PREMIUM_OFFSET_OPTIONS : BASIC_OFFSET_OPTIONS;
  const maxOffsets = readOnly || isPremium ? 3 : 2;
  const canUseDailyDigest = isPremium || Boolean(rule.settings.dailyDigestLocalTime);

  return (
    <View
      style={{
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 14
      }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{rule.label}</Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {rule.scopeKind === 'all_us'
            ? 'All U.S. launches'
            : rule.scopeKind === 'state'
              ? 'State scope'
              : rule.scopeKind === 'all_launches'
                ? 'Premium all-launches scope'
                : rule.scopeKind === 'preset'
                  ? 'Premium saved-filter scope'
                  : 'Premium follow scope'}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Reminder times</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {offsetOptions.map((value) => {
            const active = offsets.includes(value);
            return (
              <AddRuleChip
                key={value}
                label={value >= 1440 ? '1 day' : value >= 60 ? `${Math.round(value / 60)} hr` : `${value} min`}
                active={active}
                disabled={busy || readOnly}
                onPress={() => {
                  if (readOnly) return;
                  if (active) {
                    setOffsets((current) => current.filter((entry) => entry !== value));
                    return;
                  }
                  if (offsets.length >= maxOffsets) {
                    return;
                  }
                  setOffsets((current) => [...current, value].sort((left, right) => left - right));
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Premium change alerts</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {STATUS_OPTIONS.map((option) => {
            const active = statusChangeTypes.includes(option.key);
            return (
              <AddRuleChip
                key={option.key}
                label={option.label}
                active={active}
                disabled={busy || readOnly || !isPremium}
                onPress={() => {
                  if (readOnly || !isPremium) {
                    onOpenUpgrade();
                    return;
                  }
                  if (option.key === 'any') {
                    setStatusChangeTypes((current) => (current.includes('any') ? [] : ['any']));
                    return;
                  }
                  setStatusChangeTypes((current) => {
                    const withoutAny = current.filter((entry) => entry !== 'any');
                    return withoutAny.includes(option.key)
                      ? withoutAny.filter((entry) => entry !== option.key)
                      : [...withoutAny, option.key];
                  });
                }}
              />
            );
          })}
          <AddRuleChip
            label="NET changes"
            active={notifyNetChanges}
            disabled={busy || readOnly || !isPremium}
            onPress={() => {
              if (readOnly || !isPremium) {
                onOpenUpgrade();
                return;
              }
              setNotifyNetChanges((current) => !current);
            }}
          />
        </View>
      </View>

      {canUseDailyDigest ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Daily digest time</Text>
          <TextInput
            value={dailyDigestLocalTime}
            onChangeText={setDailyDigestLocalTime}
            placeholder="08:00"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!readOnly}
            style={{
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              color: theme.foreground,
              paddingHorizontal: 12,
              paddingVertical: 10
            }}
          />
          <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Use `HH:MM` to send a daily push when launches match this rule.</Text>
        </View>
      ) : null}

      {readOnly ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
            Stored on this account. Upgrade to Premium to edit or reactivate this rule.
          </Text>
          <CustomerShellActionButton label="Upgrade to edit" onPress={onOpenUpgrade} disabled={busy} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellActionButton
            label="Save rule"
            onPress={() => {
              if (!installationId) return;
              onSave({
                ...buildRuleScopePayload(rule),
                installationId,
                deviceSecret,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                prelaunchOffsetsMinutes: offsets,
                dailyDigestLocalTime: isPremium ? normalizeLocalTime(dailyDigestLocalTime) : null,
                statusChangeTypes: isPremium ? statusChangeTypes : [],
                notifyNetChanges: isPremium ? notifyNetChanges : false
              } as MobilePushRuleUpsertV1);
            }}
            disabled={busy || offsets.length === 0 || offsets.length > maxOffsets}
          />
          <CustomerShellActionButton label="Remove" variant="secondary" onPress={onDelete} disabled={busy} />
        </View>
      )}
    </View>
  );
}

function buildRuleScopePayload(rule: NonLaunchMobilePushRuleV1) {
  if (rule.scopeKind === 'all_us') {
    return { scopeKind: 'all_us' as const };
  }
  if (rule.scopeKind === 'state') {
    return { scopeKind: 'state' as const, state: rule.state };
  }
  if (rule.scopeKind === 'all_launches') {
    return { scopeKind: 'all_launches' as const };
  }
  if (rule.scopeKind === 'preset') {
    return { scopeKind: 'preset' as const, presetId: rule.presetId };
  }
  if (rule.scopeKind === 'follow') {
    return {
      scopeKind: 'follow' as const,
      followRuleType: rule.followRuleType,
      followRuleValue: rule.followRuleValue
    };
  }

  return {
    scopeKind: 'all_launches' as const
  };
}

function PreferenceRow({ label, value }: { label: string; value: string }) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function AddRuleChip({
  label,
  active = false,
  disabled = false,
  onPress
}: {
  label: string;
  active?: boolean;
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

function flattenWatchlistRules(watchlists: Array<{ rules: WatchlistRuleV1[] }>) {
  const next = new Map<string, WatchlistRuleV1>();
  for (const watchlist of watchlists) {
    for (const rule of watchlist.rules) {
      const key = buildFollowKey(rule.ruleType, rule.ruleValue);
      if (!next.has(key)) {
        next.set(key, rule);
      }
    }
  }
  return Array.from(next.values());
}

function buildFollowKey(ruleType: string, ruleValue: string) {
  return `${normalizeToken(ruleType)}:${normalizeToken(ruleValue)}`;
}

function formatFollowCandidate(rule: WatchlistRuleV1) {
  if (rule.ruleType === 'provider') return rule.ruleValue;
  if (rule.ruleType === 'tier') return `Tier ${rule.ruleValue}`;
  if (rule.ruleType === 'pad') return rule.ruleValue.replace(/^code:/, '').replace(/^ll2:/, 'Pad ');
  return 'Launch';
}

function normalizeLocalTime(value: string) {
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeToken(value: string) {
  return String(value || '').trim().toLowerCase();
}

function formatPermissionLabel(permissionStatus: 'granted' | 'denied' | 'undetermined') {
  if (permissionStatus === 'granted') return 'Permission granted';
  if (permissionStatus === 'denied') return 'Permission denied';
  return 'Permission pending';
}

function formatOnOff(value: boolean) {
  return value ? 'On' : 'Off';
}

function buildMutationMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
