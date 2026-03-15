import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ApiClientError, type NotificationPreferencesUpdateV1, type NotificationPreferencesV1 } from '@tminuszero/api-client';
import {
  useAlertRulesQuery,
  useCompleteSmsVerificationMutation,
  useCreateAlertRuleMutation,
  useDeleteAlertRuleMutation,
  useLaunchFilterOptionsQuery,
  useNotificationPreferencesQuery,
  useStartSmsVerificationMutation,
  useUpdateNotificationPreferencesMutation,
  useViewerEntitlementsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';

type PreferencesDraft = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  launchDayEmailEnabled: boolean;
  launchDayEmailProviders: string[];
  launchDayEmailStates: string[];
  quietHoursEnabled: boolean;
  quietStartLocal: string;
  quietEndLocal: string;
};

export default function PreferencesScreen() {
  const { theme } = useMobileBootstrap();
  const notificationPreferencesQuery = useNotificationPreferencesQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const {
    installationId,
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
  const tier = entitlementsQuery.data?.tier ?? 'anon';
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const canUseBasicAlertRules = entitlementsQuery.data?.capabilities.canUseBasicAlertRules ?? false;
  const canUseAdvancedAlertRules = entitlementsQuery.data?.capabilities.canUseAdvancedAlertRules ?? false;
  const canUseBrowserLaunchAlerts = entitlementsQuery.data?.capabilities.canUseBrowserLaunchAlerts ?? false;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const [alertRuleError, setAlertRuleError] = useState<string | null>(null);
  const [channelStatus, setChannelStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [smsStatus, setSmsStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const prefs = notificationPreferencesQuery.data ?? null;
  const updateNotificationPreferencesMutation = useUpdateNotificationPreferencesMutation();
  const startSmsVerificationMutation = useStartSmsVerificationMutation();
  const completeSmsVerificationMutation = useCompleteSmsVerificationMutation();
  const alertRulesQuery = useAlertRulesQuery();
  const createAlertRuleMutation = useCreateAlertRuleMutation();
  const deleteAlertRuleMutation = useDeleteAlertRuleMutation();
  const filterOptionsQuery = useLaunchFilterOptionsQuery(
    {
      mode: feedScope,
      range: 'all',
      region: 'all'
    },
    { enabled: isAuthed && canUseBasicAlertRules }
  );
  const alertRules = alertRulesQuery.data?.rules ?? [];
  const regionUsRule = alertRules.find((rule) => rule.kind === 'region_us') ?? null;
  const stateRules = alertRules.filter((rule) => rule.kind === 'state');
  const selectedStateKeys = new Set(stateRules.map((rule) => normalizeAlertRuleToken(rule.kind === 'state' ? rule.state : rule.label)));
  const availableStateOptions = (filterOptionsQuery.data?.states ?? []).filter(
    (state) => !selectedStateKeys.has(normalizeAlertRuleToken(state))
  );
  const [draft, setDraft] = useState<PreferencesDraft | null>(null);
  const [smsPhoneDraft, setSmsPhoneDraft] = useState('');
  const [smsCodeDraft, setSmsCodeDraft] = useState('');

  useEffect(() => {
    if (!prefs) {
      return;
    }

    const nextDraft = buildPreferencesDraft(prefs);
    setDraft((current) => {
      if (!current || !hasPreferencesDraftChanges(current, prefs)) {
        return nextDraft;
      }
      return current;
    });
    setSmsPhoneDraft((current) => (current.trim() ? current : prefs.smsPhone ?? ''));
  }, [prefs]);

  const launchDayProviderOptions = useMemo(
    () => (filterOptionsQuery.data?.providers ?? []).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    [filterOptionsQuery.data?.providers]
  );
  const launchDayStateOptions = useMemo(
    () => (filterOptionsQuery.data?.states ?? []).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    [filterOptionsQuery.data?.states]
  );
  const channelValidationError = draft
    ? validatePreferencesDraft(draft, {
        canUseAdvancedAlertRules,
        isSmsVerified: prefs?.smsVerified === true,
        isSmsSystemEnabled: prefs?.smsSystemEnabled !== false
      })
    : null;
  const hasDraftChanges = draft && prefs ? hasPreferencesDraftChanges(draft, prefs) : false;

  async function upsertAlertRule(ruleKey: string, action: () => Promise<void>) {
    setAlertRuleError(null);
    try {
      await action();
    } catch (error) {
      console.error(`mobile alert rule ${ruleKey} failed`, error);
      setAlertRuleError(error instanceof Error && error.message ? error.message : 'Unable to update alert rule.');
    }
  }

  function updateDraft(patch: Partial<PreferencesDraft>) {
    setDraft((current) => {
      const base = current ?? buildPreferencesDraft(prefs);
      return {
        ...base,
        ...patch
      };
    });
  }

  async function saveNotificationPreferences() {
    if (!prefs || !draft) {
      return;
    }

    const validationError = validatePreferencesDraft(draft, {
      canUseAdvancedAlertRules,
      isSmsVerified: prefs.smsVerified,
      isSmsSystemEnabled: prefs.smsSystemEnabled !== false
    });
    if (validationError) {
      setChannelStatus({ tone: 'error', text: validationError });
      return;
    }

    const payload = buildNotificationPreferencesPayload(draft, prefs);
    if (!payload) {
      setChannelStatus({ tone: null, text: '' });
      return;
    }

    setChannelStatus({ tone: null, text: '' });
    try {
      const nextPrefs = await updateNotificationPreferencesMutation.mutateAsync(payload);
      setDraft(buildPreferencesDraft(nextPrefs));
      setChannelStatus({ tone: 'success', text: 'Notification settings updated.' });
    } catch (error) {
      setChannelStatus({
        tone: 'error',
        text: describePreferencesError(error)
      });
    }
  }

  async function handleStartSmsVerification() {
    const phone = smsPhoneDraft.trim();
    if (!phone) {
      setSmsStatus({ tone: 'error', text: 'Enter a phone number before requesting a code.' });
      return;
    }

    setSmsStatus({ tone: null, text: '' });
    try {
      await startSmsVerificationMutation.mutateAsync({
        phone,
        smsConsent: true
      });
      setSmsPhoneDraft(phone);
      setSmsCodeDraft('');
      setSmsStatus({ tone: 'success', text: 'Verification code sent. Enter it below to confirm this number.' });
      void notificationPreferencesQuery.refetch();
    } catch (error) {
      setSmsStatus({
        tone: 'error',
        text: describePreferencesError(error)
      });
    }
  }

  async function handleCompleteSmsVerification() {
    const phone = smsPhoneDraft.trim();
    const code = smsCodeDraft.trim();
    if (!phone || !code) {
      setSmsStatus({ tone: 'error', text: 'Enter both the phone number and verification code.' });
      return;
    }

    setSmsStatus({ tone: null, text: '' });
    try {
      await completeSmsVerificationMutation.mutateAsync({
        phone,
        code
      });
      setSmsPhoneDraft(phone);
      setSmsStatus({ tone: 'success', text: 'Phone number verified. You can now enable SMS alerts.' });
      setSmsCodeDraft('');
      void notificationPreferencesQuery.refetch();
    } catch (error) {
      setSmsStatus({
        tone: 'error',
        text: describePreferencesError(error)
      });
    }
  }

  return (
    <AppScreen testID="preferences-screen">
      <CustomerShellHero
        eyebrow="Alerts and settings"
        title="Settings"
        description="Manage shared alert rules, quiet hours, and this device’s push registration."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={formatTierLabel(tier)} tone={tier === 'premium' ? 'accent' : 'default'} />
          <CustomerShellBadge label={formatPermissionLabel(permissionStatus)} tone={permissionStatus === 'granted' ? 'success' : 'warning'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Notification overview"
        description="Shared account preferences control which alert channels and launch scopes are active. The native device panel below controls whether this phone can receive those push alerts."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric
            label="Plan"
            value={formatTierLabel(tier)}
            caption={
              canUseAdvancedAlertRules
                ? 'Advanced alerts enabled'
                : canUseBasicAlertRules
                  ? 'Basic mobile alerts enabled'
                  : 'Sign in to enable alerts'
            }
          />
          <CustomerShellMetric
            label="Push"
            value={isPushEnabled ? 'On' : 'Off'}
            caption={isRegistered ? 'This device is registered' : 'Device registration pending'}
          />
          <CustomerShellMetric
            label="Quiet hours"
            value={prefs ? formatQuietHours(prefs.quietHoursEnabled, prefs.quietStartLocal, prefs.quietEndLocal) : '—'}
            caption="Shared with your account"
          />
        </View>
      </CustomerShellPanel>

      <ViewerTierCard tier={tier} featureKey="preferences" testID="preferences-tier-card" />

      {!isAuthed ? null : notificationPreferencesQuery.isError ? (
        <CustomerShellPanel title="Notification settings unavailable" description={notificationPreferencesQuery.error.message} />
      ) : (
        <>
          <CustomerShellPanel
            title="Account alert rules"
            description={
              canUseAdvancedAlertRules
                ? 'Basic rules deliver to signed-in mobile devices. Premium also lets this account keep preset-based and follow-based rules, with browser delivery available on web.'
                : 'Choose which launches this signed-in account should watch. Free rules deliver to registered iOS and Android devices.'
            }
          >
            {!canUseBasicAlertRules ? (
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Sign in to manage shared alert rules.</Text>
            ) : alertRulesQuery.isPending ? (
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading alert rules…</Text>
            ) : alertRulesQuery.isError ? (
              <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{alertRulesQuery.error.message}</Text>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 8 }}>
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Basic launch scopes</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <AlertRuleChip
                      label="All U.S. launches"
                      active={Boolean(regionUsRule)}
                      disabled={createAlertRuleMutation.isPending || deleteAlertRuleMutation.isPending}
                      onPress={() => {
                        void upsertAlertRule('region_us', async () => {
                          if (regionUsRule) {
                            await deleteAlertRuleMutation.mutateAsync(regionUsRule.id);
                            return;
                          }
                          await createAlertRuleMutation.mutateAsync({ kind: 'region_us' });
                        });
                      }}
                    />
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Tracked states</Text>
                  {stateRules.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {stateRules.map((rule) => (
                        <AlertRuleChip
                          key={rule.id}
                          label={rule.label}
                          active
                          disabled={deleteAlertRuleMutation.isPending}
                          onPress={() => {
                            void upsertAlertRule(rule.id, async () => {
                              await deleteAlertRuleMutation.mutateAsync(rule.id);
                            });
                          }}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No state rules yet.</Text>
                  )}
                  {filterOptionsQuery.isPending ? (
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Loading state options…</Text>
                  ) : availableStateOptions.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {availableStateOptions.map((state) => (
                        <AlertRuleChip
                          key={state}
                          label={state}
                          active={false}
                          disabled={createAlertRuleMutation.isPending}
                          onPress={() => {
                            void upsertAlertRule(state, async () => {
                              await createAlertRuleMutation.mutateAsync({ kind: 'state', state });
                            });
                          }}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>All available states are already tracked.</Text>
                  )}
                </View>

                <View
                  style={{
                    gap: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: 'rgba(234, 240, 255, 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    paddingHorizontal: 14,
                    paddingVertical: 14
                  }}
                >
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Current account rules</Text>
                  {alertRules.length ? (
                    <View style={{ gap: 8 }}>
                      {alertRules.map((rule) => (
                        <View
                          key={rule.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: 'rgba(234, 240, 255, 0.08)',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            paddingHorizontal: 12,
                            paddingVertical: 10
                          }}
                        >
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '600' }}>{rule.label}</Text>
                            <Text style={{ color: theme.muted, fontSize: 12 }}>
                              {rule.kind === 'filter_preset' || rule.kind === 'follow'
                                ? 'Premium rule'
                                : 'Basic mobile rule'}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => {
                              void upsertAlertRule(rule.id, async () => {
                                await deleteAlertRuleMutation.mutateAsync(rule.id);
                              });
                            }}
                            disabled={deleteAlertRuleMutation.isPending}
                            style={({ pressed }) => ({
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: theme.stroke,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              opacity: deleteAlertRuleMutation.isPending ? 0.5 : pressed ? 0.86 : 1
                            })}
                          >
                            <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Remove</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>No alert rules are active yet.</Text>
                  )}
                  {canUseAdvancedAlertRules ? (
                    <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                      Premium preset-based and follow-based rules can be reviewed here and created from the web saved-items surface.
                    </Text>
                  ) : null}
                  {alertRuleError ? (
                    <Text style={{ color: '#ff9087', fontSize: 12, lineHeight: 18 }}>{alertRuleError}</Text>
                  ) : null}
                </View>
              </View>
            )}
          </CustomerShellPanel>

          <CustomerShellPanel
            title="Launch alert channels"
            description="Shared account-level delivery settings. Push enrollment still runs through the device registration panel below because it also has to manage this phone as a destination."
          >
            {notificationPreferencesQuery.isPending || !prefs || !draft ? (
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading notification preferences…</Text>
            ) : (
              <View style={{ gap: 12 }}>
                <PreferenceRow label="Push alerts" value={formatOnOff(prefs.pushEnabled)} caption="Managed by the device push section below." />
                <TogglePreferenceRow
                  label="Email alerts"
                  caption="General shared account email delivery."
                  value={draft.emailEnabled}
                  onChange={(value) => {
                    updateDraft({ emailEnabled: value });
                    setChannelStatus({ tone: null, text: '' });
                  }}
                />
                <TogglePreferenceRow
                  label="SMS alerts"
                  caption={
                    !canUseAdvancedAlertRules
                      ? 'Premium required.'
                      : prefs.smsSystemEnabled === false
                        ? 'SMS delivery is not configured right now.'
                        : prefs.smsVerified
                          ? `Verified for ${prefs.smsPhone ?? 'this number'}.`
                          : 'Verify a phone number before enabling SMS delivery.'
                  }
                  value={draft.smsEnabled}
                  disabled={!canUseAdvancedAlertRules || prefs.smsSystemEnabled === false}
                  onChange={(value) => {
                    updateDraft({ smsEnabled: value });
                    setChannelStatus({ tone: null, text: '' });
                  }}
                />
                <TogglePreferenceRow
                  label="Launch-day email"
                  caption={
                    canUseAdvancedAlertRules
                      ? 'Premium launch-day email summaries with optional provider and state targeting.'
                      : 'Premium required.'
                  }
                  value={draft.launchDayEmailEnabled}
                  disabled={!canUseAdvancedAlertRules}
                  onChange={(value) => {
                    updateDraft({ launchDayEmailEnabled: value });
                    setChannelStatus({ tone: null, text: '' });
                  }}
                />
                {draft.launchDayEmailEnabled ? (
                  <View style={{ gap: 10 }}>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Launch-day providers</Text>
                      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                        Leave all providers unselected to use every provider.
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {launchDayProviderOptions.map((provider) => {
                          const active = draft.launchDayEmailProviders.includes(provider);
                          return (
                            <AlertRuleChip
                              key={provider}
                              label={provider}
                              active={active}
                              onPress={() => {
                                updateDraft({
                                  launchDayEmailProviders: toggleListValue(draft.launchDayEmailProviders, provider)
                                });
                                setChannelStatus({ tone: null, text: '' });
                              }}
                            />
                          );
                        })}
                      </View>
                    </View>

                    <View style={{ gap: 6 }}>
                      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Launch-day states</Text>
                      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                        Leave all states unselected to use every state.
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {launchDayStateOptions.map((state) => {
                          const active = draft.launchDayEmailStates.includes(state);
                          return (
                            <AlertRuleChip
                              key={state}
                              label={state}
                              active={active}
                              onPress={() => {
                                updateDraft({
                                  launchDayEmailStates: toggleListValue(draft.launchDayEmailStates, state)
                                });
                                setChannelStatus({ tone: null, text: '' });
                              }}
                            />
                          );
                        })}
                      </View>
                    </View>
                  </View>
                ) : null}
                <TogglePreferenceRow
                  label="Quiet hours"
                  caption="Suppress shared delivery during the local window below."
                  value={draft.quietHoursEnabled}
                  onChange={(value) => {
                    updateDraft({ quietHoursEnabled: value });
                    setChannelStatus({ tone: null, text: '' });
                  }}
                />
                {draft.quietHoursEnabled ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TimeInput
                      label="Start"
                      value={draft.quietStartLocal}
                      onChangeText={(value) => {
                        updateDraft({ quietStartLocal: value });
                        setChannelStatus({ tone: null, text: '' });
                      }}
                    />
                    <TimeInput
                      label="End"
                      value={draft.quietEndLocal}
                      onChangeText={(value) => {
                        updateDraft({ quietEndLocal: value });
                        setChannelStatus({ tone: null, text: '' });
                      }}
                    />
                  </View>
                ) : null}
                {channelStatus.text ? (
                  <Text style={{ color: channelStatus.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>
                    {channelStatus.text}
                  </Text>
                ) : channelValidationError ? (
                  <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{channelValidationError}</Text>
                ) : null}
                <CustomerShellActionButton
                  testID="preferences-save-account-settings"
                  label={updateNotificationPreferencesMutation.isPending ? 'Saving…' : 'Save account notification settings'}
                  onPress={() => {
                    void saveNotificationPreferences();
                  }}
                  disabled={!hasDraftChanges || updateNotificationPreferencesMutation.isPending || Boolean(channelValidationError)}
                />
              </View>
            )}
          </CustomerShellPanel>

          <CustomerShellPanel
            title="SMS verification"
            description={
              canUseAdvancedAlertRules
                ? 'Premium SMS delivery requires a verified phone number before the shared account can enable SMS alerts.'
                : 'SMS verification is reserved for Premium notification access.'
            }
          >
            {!canUseAdvancedAlertRules ? (
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Upgrade to Premium to verify a phone number for SMS delivery.</Text>
            ) : prefs?.smsSystemEnabled === false ? (
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>SMS delivery is not configured on the backend right now.</Text>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Phone number</Text>
                  <TextInput
                    testID="preferences-sms-phone-input"
                    value={smsPhoneDraft}
                    onChangeText={setSmsPhoneDraft}
                    placeholder="(555) 555-1212"
                    placeholderTextColor={theme.muted}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    style={buildTextInputStyle(theme)}
                  />
                  {prefs?.smsVerified && prefs.smsPhone ? (
                    <Text style={{ color: theme.accent, fontSize: 12, lineHeight: 18 }}>Verified number: {prefs.smsPhone}</Text>
                  ) : null}
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Verification code</Text>
                  <TextInput
                    testID="preferences-sms-code-input"
                    value={smsCodeDraft}
                    onChangeText={setSmsCodeDraft}
                    placeholder="123456"
                    placeholderTextColor={theme.muted}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    style={buildTextInputStyle(theme)}
                  />
                </View>

                <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                  Requesting or enabling SMS implies consent to receive launch notifications at this number.
                </Text>

                {smsStatus.text ? (
                  <Text style={{ color: smsStatus.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>
                    {smsStatus.text}
                  </Text>
                ) : null}

                <CustomerShellActionButton
                  testID="preferences-sms-send-code"
                  label={startSmsVerificationMutation.isPending ? 'Sending code…' : 'Send verification code'}
                  onPress={() => {
                    void handleStartSmsVerification();
                  }}
                  disabled={startSmsVerificationMutation.isPending || completeSmsVerificationMutation.isPending}
                />

                <CustomerShellActionButton
                  testID="preferences-sms-verify-code"
                  label={completeSmsVerificationMutation.isPending ? 'Verifying…' : 'Verify code'}
                  variant="secondary"
                  onPress={() => {
                    void handleCompleteSmsVerification();
                  }}
                  disabled={startSmsVerificationMutation.isPending || completeSmsVerificationMutation.isPending}
                />
              </View>
            )}
          </CustomerShellPanel>

          <CustomerShellPanel
            testID="preferences-push-section"
            title="Device push"
            description={
              canUseBrowserLaunchAlerts
                ? 'This phone can receive mobile push. Browser delivery is also available on web for Premium.'
                : 'This phone is the delivery target for free and Premium mobile push alerts. Browser delivery remains Premium-only on web.'
            }
          >
            <View style={{ gap: 10 }}>
              <PreferenceRow testID="preferences-permission-state" valueTestID="preferences-permission-state-value" label="Permission" value={permissionStatus} />
              <PreferenceRow
                testID="preferences-push-enabled-row"
                valueTestID="preferences-push-enabled-state"
                label="Push enabled"
                value={formatOnOff(isPushEnabled)}
              />
              <PreferenceRow
                testID="preferences-device-registered-row"
                valueTestID="preferences-device-registered-state"
                label="Device registered"
                value={formatOnOff(isRegistered)}
              />
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
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                Installation id: {installationId ?? 'Loading...'}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                Basic mobile alert capability: {formatOnOff(canUseBasicAlertRules)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                Advanced/browser alert capability: {formatOnOff(canUseAdvancedAlertRules || canUseBrowserLaunchAlerts)}
              </Text>
              {lastTestQueuedAt ? (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>Last test queued: {lastTestQueuedAt}</Text>
              ) : null}
              {lastError ? (
                <Text testID="preferences-last-error" style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>
                  {lastError}
                </Text>
              ) : null}
            </View>

            <CustomerShellActionButton
              testID="preferences-enable-push"
              label={isPushEnabled ? 'Push enabled' : 'Enable push alerts'}
              onPress={() => {
                void enablePush().catch(() => {});
              }}
              disabled={isSyncing || isPushEnabled}
            />

            <CustomerShellActionButton
              testID="preferences-send-push-test"
              label="Send push test"
              variant="secondary"
              onPress={() => {
                void sendTestPush().catch(() => {});
              }}
              disabled={isSyncing || !isPushEnabled || !isRegistered}
            />

            <Pressable
              testID="preferences-disable-push"
              onPress={() => {
                void disablePushAlerts().catch(() => {});
              }}
              disabled={isSyncing || (!isPushEnabled && !isRegistered)}
              style={({ pressed }) => ({
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'transparent',
                paddingHorizontal: 18,
                paddingVertical: 14,
                opacity: isSyncing || (!isPushEnabled && !isRegistered) ? 0.5 : pressed ? 0.86 : 1
              })}
            >
              <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Disable push on this device</Text>
            </Pressable>
          </CustomerShellPanel>
        </>
      )}
    </AppScreen>
  );
}

function PreferenceRow({
  label,
  value,
  caption,
  testID,
  valueTestID
}: {
  label: string;
  value: string;
  caption?: string;
  testID?: string;
  valueTestID?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        {caption ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{caption}</Text> : null}
      </View>
      <Text testID={valueTestID} style={{ color: theme.muted, fontSize: 14, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function TogglePreferenceRow({
  label,
  caption,
  value,
  disabled,
  onChange
}: {
  label: string;
  caption: string;
  value: boolean;
  disabled?: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        gap: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{caption}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ToggleChip label="On" active={value} disabled={disabled} onPress={() => onChange(true)} />
        <ToggleChip label="Off" active={!value} disabled={disabled} onPress={() => onChange(false)} />
      </View>
    </View>
  );
}

function ToggleChip({
  label,
  active,
  disabled,
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
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.34)' : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 9,
        opacity: disabled ? 0.45 : pressed ? 0.84 : 1
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
      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="22:00"
        placeholderTextColor={theme.muted}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        style={buildTextInputStyle(theme)}
      />
    </View>
  );
}

function formatOnOff(value: boolean) {
  return value ? 'On' : 'Off';
}

function formatQuietHours(enabled: boolean, start: string | null | undefined, end: string | null | undefined) {
  if (!enabled) {
    return 'Off';
  }

  return `${start || '22:00'} to ${end || '07:00'}`;
}

function formatTierLabel(tier: 'anon' | 'free' | 'premium') {
  if (tier === 'premium') {
    return 'Premium';
  }
  if (tier === 'free') {
    return 'Free account';
  }
  return 'Guest access';
}

function formatPermissionLabel(permissionStatus: string) {
  if (permissionStatus === 'granted') {
    return 'Push permission granted';
  }
  if (permissionStatus === 'denied') {
    return 'Push permission denied';
  }
  return 'Push permission pending';
}

function AlertRuleChip({
  label,
  active,
  disabled,
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
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.34)' : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 9,
        opacity: disabled ? 0.5 : pressed ? 0.84 : 1
      })}
    >
      <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function normalizeAlertRuleToken(value: string) {
  return value.trim().toLowerCase();
}

function buildPreferencesDraft(prefs: NotificationPreferencesV1 | null): PreferencesDraft {
  return {
    emailEnabled: prefs?.emailEnabled === true,
    smsEnabled: prefs?.smsEnabled === true,
    launchDayEmailEnabled: prefs?.launchDayEmailEnabled === true,
    launchDayEmailProviders: normalizeStringList(prefs?.launchDayEmailProviders),
    launchDayEmailStates: normalizeStringList(prefs?.launchDayEmailStates),
    quietHoursEnabled: prefs?.quietHoursEnabled === true,
    quietStartLocal: prefs?.quietStartLocal ?? '22:00',
    quietEndLocal: prefs?.quietEndLocal ?? '07:00'
  };
}

function buildNotificationPreferencesPayload(
  draft: PreferencesDraft,
  prefs: NotificationPreferencesV1
): NotificationPreferencesUpdateV1 | null {
  const payload: Partial<NotificationPreferencesUpdateV1> = {};
  if (draft.emailEnabled !== prefs.emailEnabled) {
    payload.emailEnabled = draft.emailEnabled;
  }
  if (draft.smsEnabled !== prefs.smsEnabled) {
    payload.smsEnabled = draft.smsEnabled;
    if (draft.smsEnabled) {
      payload.smsConsent = true;
    }
  }
  if (draft.launchDayEmailEnabled !== prefs.launchDayEmailEnabled) {
    payload.launchDayEmailEnabled = draft.launchDayEmailEnabled;
  }

  const normalizedProviders = normalizeStringList(draft.launchDayEmailProviders);
  const normalizedProviderPrefs = normalizeStringList(prefs.launchDayEmailProviders);
  if (!areListsEqual(normalizedProviders, normalizedProviderPrefs)) {
    payload.launchDayEmailProviders = normalizedProviders;
  }

  const normalizedStates = normalizeStringList(draft.launchDayEmailStates);
  const normalizedStatePrefs = normalizeStringList(prefs.launchDayEmailStates);
  if (!areListsEqual(normalizedStates, normalizedStatePrefs)) {
    payload.launchDayEmailStates = normalizedStates;
  }

  if (draft.quietHoursEnabled !== prefs.quietHoursEnabled) {
    payload.quietHoursEnabled = draft.quietHoursEnabled;
  }
  if (draft.quietStartLocal !== (prefs.quietStartLocal ?? '22:00')) {
    payload.quietStartLocal = draft.quietStartLocal;
  }
  if (draft.quietEndLocal !== (prefs.quietEndLocal ?? '07:00')) {
    payload.quietEndLocal = draft.quietEndLocal;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function hasPreferencesDraftChanges(
  draft: PreferencesDraft,
  prefs: NotificationPreferencesV1
) {
  return buildNotificationPreferencesPayload(draft, prefs) !== null;
}

function validatePreferencesDraft(
  draft: PreferencesDraft,
  options: {
    canUseAdvancedAlertRules: boolean;
    isSmsVerified: boolean;
    isSmsSystemEnabled: boolean;
  }
) {
  if (draft.smsEnabled) {
    if (!options.canUseAdvancedAlertRules) {
      return 'SMS alerts require Premium notification access.';
    }
    if (!options.isSmsSystemEnabled) {
      return 'SMS delivery is not configured right now.';
    }
    if (!options.isSmsVerified) {
      return 'Verify a phone number before enabling SMS alerts.';
    }
  }

  if (draft.launchDayEmailEnabled && !options.canUseAdvancedAlertRules) {
    return 'Launch-day email requires Premium notification access.';
  }

  if (draft.quietHoursEnabled) {
    if (!isValidLocalTime(draft.quietStartLocal) || !isValidLocalTime(draft.quietEndLocal)) {
      return 'Quiet hours must use HH:MM 24-hour time.';
    }
  }

  return null;
}

function toggleListValue(values: string[], target: string) {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    return values;
  }

  return values.includes(normalizedTarget)
    ? values.filter((value) => value !== normalizedTarget)
    : [...values, normalizedTarget].sort((left, right) => left.localeCompare(right));
}

function normalizeStringList(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function areListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isValidLocalTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value.trim());
}

function buildTextInputStyle(theme: ReturnType<typeof useMobileBootstrap>['theme']) {
  return {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.stroke,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    color: theme.foreground,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  } as const;
}

function describePreferencesError(error: unknown) {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'payment_required':
        return 'This setting requires a higher plan.';
      case 'phone_required':
        return 'Add a phone number before enabling SMS alerts.';
      case 'sms_not_verified':
        return 'Verify this phone number before enabling SMS alerts.';
      case 'sms_consent_required':
        return 'SMS consent is required before enabling delivery.';
      case 'sms_reply_start_required':
        return 'This number previously opted out. Reply START to the confirmation message, then try again.';
      case 'sms_system_disabled':
        return 'SMS delivery is not configured right now.';
      case 'twilio_verify_not_configured':
      case 'billing_not_configured':
        return 'SMS verification is not configured on the backend yet.';
      case 'invalid_phone':
        return 'Enter a valid U.S. phone number.';
      case 'invalid_code':
        return 'That verification code was not accepted.';
      case 'sms_verification_failed':
        return 'Unable to verify this number right now.';
      default:
        break;
    }
  }

  return error instanceof Error && error.message ? error.message : 'Unable to update notification settings.';
}
