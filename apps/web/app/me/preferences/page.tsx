'use client';

import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  useAlertRulesQuery,
  useCompleteSmsVerificationMutation,
  useCreateAlertRuleMutation,
  useDeleteAlertRuleMutation,
  useFeedFilterOptionsQuery,
  useNotificationPreferencesQuery,
  useSendWebPushTestMutation,
  useStartSmsVerificationMutation,
  useSubscribeWebPushDeviceMutation,
  useUnsubscribeWebPushDeviceMutation,
  useUpdateNotificationPreferencesMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery,
  useWebPushDeviceStatusQuery
} from '@/lib/api/queries';
import { getBrowserClient } from '@/lib/api/supabase';
import { parseUsPhone, formatUsPhoneForDisplay } from '@/lib/notifications/phone';
import { BRAND_NAME } from '@/lib/brand';
import { SMS_NOTIFICATIONS_COMING_SOON } from '@/lib/notifications/smsAvailability';

const WEB_PUSH_PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || '';

type PrefForm = {
  push_enabled: boolean;
  sms_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start_local: string;
  quiet_end_local: string;
  sms_phone_us: string;
  sms_verified: boolean;
};

const DEFAULT_PREFS: PrefForm = {
  push_enabled: false,
  sms_enabled: false,
  quiet_hours_enabled: false,
  quiet_start_local: '22:00',
  quiet_end_local: '07:00',
  sms_phone_us: '',
  sms_verified: false
};

export default function PreferencesPage() {
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const notificationPreferencesQuery = useNotificationPreferencesQuery();
  const updateNotificationPreferencesMutation = useUpdateNotificationPreferencesMutation();
  const startSmsVerificationMutation = useStartSmsVerificationMutation();
  const completeSmsVerificationMutation = useCompleteSmsVerificationMutation();
  const subscribeWebPushDeviceMutation = useSubscribeWebPushDeviceMutation();
  const unsubscribeWebPushDeviceMutation = useUnsubscribeWebPushDeviceMutation();
  const sendWebPushTestMutation = useSendWebPushTestMutation();
  const alertRulesQuery = useAlertRulesQuery();
  const createAlertRuleMutation = useCreateAlertRuleMutation();
  const deleteAlertRuleMutation = useDeleteAlertRuleMutation();

  const [form, setForm] = useState<PrefForm>(DEFAULT_PREFS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smsConsent, setSmsConsent] = useState(false);
  const [smsCodeSent, setSmsCodeSent] = useState(false);
  const [smsCode, setSmsCode] = useState('');
  const [selectedStateToAdd, setSelectedStateToAdd] = useState('');
  const supabaseAvailable = Boolean(getBrowserClient());
  const status: 'loading' | 'guest' | 'ready' | 'missing-supabase' = !supabaseAvailable
    ? 'missing-supabase'
    : viewerSessionQuery.isPending
      ? 'loading'
      : viewerSessionQuery.data?.viewerId
        ? 'ready'
        : 'guest';
  const webPushDeviceStatusQuery = useWebPushDeviceStatusQuery({ enabled: status === 'ready' });

  useEffect(() => {
    if (!notificationPreferencesQuery.data) return;
    setForm({
      push_enabled: notificationPreferencesQuery.data.pushEnabled,
      sms_enabled: notificationPreferencesQuery.data.smsEnabled,
      quiet_hours_enabled: notificationPreferencesQuery.data.quietHoursEnabled,
      quiet_start_local: notificationPreferencesQuery.data.quietStartLocal || '22:00',
      quiet_end_local: notificationPreferencesQuery.data.quietEndLocal || '07:00',
      sms_phone_us: notificationPreferencesQuery.data.smsPhone ? formatUsPhoneForDisplay(notificationPreferencesQuery.data.smsPhone) : '',
      sms_verified: notificationPreferencesQuery.data.smsVerified
    });
  }, [notificationPreferencesQuery.data]);

  useEffect(() => {
    if (!form.sms_verified) {
      setSmsCode('');
      setSmsCodeSent(false);
    }
  }, [form.sms_phone_us, form.sms_verified]);

  const quietHoursLabel = useMemo(() => {
    if (!form.quiet_hours_enabled) return 'Off';
    return `${form.quiet_start_local} → ${form.quiet_end_local}`;
  }, [form.quiet_end_local, form.quiet_hours_enabled, form.quiet_start_local]);

  const parsedPhone = useMemo(() => parseUsPhone(form.sms_phone_us.trim()), [form.sms_phone_us]);
  const isValidPhone = parsedPhone !== null;
  const smsSystemEnabled = notificationPreferencesQuery.data?.smsSystemEnabled ?? null;
  const smsComingSoon = SMS_NOTIFICATIONS_COMING_SOON || smsSystemEnabled === false;
  const isPaid = entitlementsQuery.data?.isPaid ?? false;
  const canUseBasicAlerts = entitlementsQuery.data?.capabilities.canUseBasicAlertRules ?? false;
  const canUseAdvancedAlertRules = entitlementsQuery.data?.capabilities.canUseAdvancedAlertRules ?? false;
  const canUseBrowserLaunchAlerts = entitlementsQuery.data?.capabilities.canUseBrowserLaunchAlerts ?? false;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const feedFilterOptionsQuery = useFeedFilterOptionsQuery(
    {
      mode: feedScope,
      range: 'all',
      region: 'all'
    },
    { enabled: status === 'ready' && canUseBasicAlerts }
  );
  const pushSupported = webPushDeviceStatusQuery.data?.supported ?? false;
  const pushPermission = webPushDeviceStatusQuery.data?.permission ?? 'unsupported';
  const pushDeviceSubscribed = webPushDeviceStatusQuery.data?.subscribed ?? false;
  const canUseSms = isPaid === true && !smsComingSoon;
  const canToggleSms = canUseSms && form.sms_verified;
  const smsToggleDisabled = form.sms_enabled ? false : !canToggleSms;
  const canUsePush = canUseBasicAlerts;
  const canManageBrowserPush = canUseBrowserLaunchAlerts && pushSupported;
  const pushToggleDisabled = form.push_enabled ? false : !canUsePush;
  const alertRules = alertRulesQuery.data?.rules ?? [];
  const regionUsRule = alertRules.find((rule) => rule.kind === 'region_us') ?? null;
  const stateRules = alertRules.filter((rule) => rule.kind === 'state');
  const advancedAlertRules = alertRules.filter((rule) => rule.kind === 'filter_preset' || rule.kind === 'follow');
  const selectedStateKeys = useMemo(
    () => new Set(stateRules.map((rule) => normalizeAlertRuleToken(rule.kind === 'state' ? rule.state : rule.label))),
    [stateRules]
  );
  const availableStates = useMemo(
    () =>
      (feedFilterOptionsQuery.data?.states ?? []).filter(
        (state) => !selectedStateKeys.has(normalizeAlertRuleToken(state))
      ),
    [feedFilterOptionsQuery.data?.states, selectedStateKeys]
  );

  useEffect(() => {
    if (!availableStates.length) {
      if (selectedStateToAdd) setSelectedStateToAdd('');
      return;
    }
    if (!selectedStateToAdd || !availableStates.includes(selectedStateToAdd)) {
      setSelectedStateToAdd(availableStates[0] ?? '');
    }
  }, [availableStates, selectedStateToAdd]);

  async function savePreferences() {
    setMessage(null);
    setError(null);
    try {
      const prefs = await updateNotificationPreferencesMutation.mutateAsync({
        pushEnabled: form.push_enabled,
        smsEnabled: form.sms_enabled,
        smsConsent,
        quietHoursEnabled: form.quiet_hours_enabled,
        quietStartLocal: form.quiet_start_local,
        quietEndLocal: form.quiet_end_local
      });
      setForm((current) => ({
        ...current,
        push_enabled: prefs.pushEnabled,
        sms_enabled: prefs.smsEnabled,
        quiet_hours_enabled: prefs.quietHoursEnabled,
        quiet_start_local: prefs.quietStartLocal || '22:00',
        quiet_end_local: prefs.quietEndLocal || '07:00',
        sms_phone_us: prefs.smsPhone ? formatUsPhoneForDisplay(prefs.smsPhone) : current.sms_phone_us,
        sms_verified: prefs.smsVerified
      }));
      setMessage('Preferences saved');
    } catch (saveError: unknown) {
      const code = getErrorCode(saveError);
      if (code === 'subscription_required') {
        setError('Upgrade to Premium for that notification option.');
        return;
      }
      if (code === 'sms_system_disabled') {
        setError('SMS alerts are coming soon.');
        return;
      }
      if (code === 'sms_not_verified') {
        setError('Verify your phone before enabling SMS alerts.');
        return;
      }
      if (code === 'phone_required') {
        setError('Enter and verify a phone number to enable SMS alerts.');
        return;
      }
      if (code === 'sms_consent_required') {
        setError('Please agree to the SMS terms below to enable SMS alerts.');
        return;
      }
      if (code === 'sms_reply_start_required') {
        setError('This number is opted out (STOP). Reply START from your phone to resubscribe, then try again.');
        return;
      }
      setError(getErrorMessage(saveError, 'Save failed'));
    }
  }

  async function sendSmsCode() {
    if (smsComingSoon) {
      setError('SMS alerts are coming soon.');
      return;
    }
    if (!isValidPhone) {
      setError('Enter a valid US phone number (10 digits, or 11 digits starting with 1).');
      return;
    }
    if (!smsConsent) {
      setError('Please agree to the SMS terms below to request a verification code.');
      return;
    }

    setMessage(null);
    setError(null);
    try {
      await startSmsVerificationMutation.mutateAsync({
        phone: form.sms_phone_us.trim(),
        smsConsent
      });
      setSmsCodeSent(true);
      setMessage('Verification code sent.');
    } catch (smsError: unknown) {
      const code = getErrorCode(smsError);
      if (code === 'sms_system_disabled') {
        setError('SMS alerts are coming soon.');
        return;
      }
      if (code === 'sms_consent_required') {
        setError('Please agree to the SMS terms below to request a verification code.');
        return;
      }
      if (code === 'subscription_required') {
        setError('Upgrade to enable SMS alerts.');
        return;
      }
      setError(getErrorMessage(smsError, 'Failed to send code'));
    }
  }

  async function verifySmsCode() {
    if (smsComingSoon) {
      setError('SMS alerts are coming soon.');
      return;
    }
    if (!smsCode.trim()) {
      setError('Enter the verification code.');
      return;
    }

    setMessage(null);
    setError(null);
    try {
      await completeSmsVerificationMutation.mutateAsync({
        phone: form.sms_phone_us.trim(),
        code: smsCode.trim()
      });
      setForm((current) => ({ ...current, sms_verified: true, sms_enabled: false }));
      setSmsCodeSent(false);
      setSmsCode('');
      setMessage('Phone verified. Turn on SMS alerts and save to opt in.');
    } catch (smsError: unknown) {
      const code = getErrorCode(smsError);
      if (code === 'sms_system_disabled') {
        setError('SMS alerts are coming soon.');
        return;
      }
      if (code === 'invalid_code') {
        setError('Verification failed');
        return;
      }
      setError(getErrorMessage(smsError, 'Verification failed'));
    }
  }

  async function ensurePushEnabled() {
    if (form.push_enabled) return;
    const prefs = await updateNotificationPreferencesMutation.mutateAsync({ pushEnabled: true });
    setForm((current) => ({ ...current, push_enabled: prefs.pushEnabled }));
  }

  async function subscribePushDevice() {
    if (!pushSupported) {
      setError('Browser notifications are not supported in this browser.');
      return;
    }
    if (!canUseBrowserLaunchAlerts) {
      setError('Upgrade to Premium to enable browser notifications.');
      return;
    }
    if (!WEB_PUSH_PUBLIC_KEY) {
      setError('Missing web push public key configuration.');
      return;
    }
    if (Notification.permission === 'denied') {
      setError('Browser notification permission is blocked. Enable notifications in your browser settings, then try again.');
      return;
    }

    setMessage(null);
    setError(null);
    try {
      await ensurePushEnabled();

      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        await webPushDeviceStatusQuery.refetch();
        throw new Error('Notification permission was not granted.');
      }

      const existingRegistration = await navigator.serviceWorker.getRegistration();
      const registration = existingRegistration ?? (await navigator.serviceWorker.register('/sw.js'));
      const readyRegistration = (await navigator.serviceWorker.ready) ?? registration;

      const existingSubscription = await readyRegistration.pushManager.getSubscription();
      const subscription =
        existingSubscription ??
        (await readyRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY)
        }));

      const p256dhKey = subscription.getKey('p256dh');
      const authKey = subscription.getKey('auth');
      if (!p256dhKey || !authKey) throw new Error('Missing subscription keys.');

      await subscribeWebPushDeviceMutation.mutateAsync({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(p256dhKey),
        auth: arrayBufferToBase64(authKey),
        user_agent: navigator.userAgent
      });

      await webPushDeviceStatusQuery.refetch();
      setMessage('Browser notifications enabled on this device.');
    } catch (pushError: unknown) {
      await webPushDeviceStatusQuery.refetch().catch(() => undefined);
      const code = getErrorCode(pushError);
      if (code === 'subscription_required') {
        setError('Upgrade to Premium to enable browser notifications.');
        return;
      }
      setError(getErrorMessage(pushError, 'Failed to enable browser notifications.'));
    }
  }

  async function unsubscribePushDevice() {
    if (!pushSupported) {
      setError('Browser notifications are not supported in this browser.');
      return;
    }

    setMessage(null);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      const endpoint = subscription?.endpoint || null;
      if (subscription) {
        await subscription.unsubscribe();
      }
      if (endpoint) {
        await unsubscribeWebPushDeviceMutation.mutateAsync({ endpoint });
      }

      await webPushDeviceStatusQuery.refetch();
      setMessage('Browser notifications disabled on this device.');
    } catch (pushError: unknown) {
      await webPushDeviceStatusQuery.refetch().catch(() => undefined);
      setError(getErrorMessage(pushError, 'Failed to disable browser notifications.'));
    }
  }

  async function sendPushTest() {
    if (!canUseBrowserLaunchAlerts) {
      setError('Upgrade to Premium to use browser notifications on web.');
      return;
    }
    if (!form.push_enabled) {
      setError('Enable browser notifications first.');
      return;
    }
    if (!pushDeviceSubscribed) {
      setError('Subscribe this device first.');
      return;
    }

    setMessage(null);
    setError(null);
    try {
      await sendWebPushTestMutation.mutateAsync();
      setMessage('Test notification queued. It should arrive within about a minute.');
    } catch (pushError: unknown) {
      const code = getErrorCode(pushError);
      if (code === 'push_not_enabled') {
        setError('Enable browser notifications first.');
        return;
      }
      if (code === 'push_not_subscribed') {
        setError('Subscribe this device first.');
        return;
      }
      if (code === 'rate_limited') {
        setError('Please wait a moment before sending another test.');
        return;
      }
      if (code === 'subscription_required') {
        setError('Upgrade to Premium to enable browser notifications.');
        return;
      }
      setError(getErrorMessage(pushError, 'Failed to send test notification.'));
    }
  }

  async function createAlertRule(
    payload: { kind: 'region_us' } | { kind: 'state'; state: string },
    successMessage: string
  ) {
    setMessage(null);
    setError(null);
    try {
      await createAlertRuleMutation.mutateAsync(payload);
      setMessage(successMessage);
    } catch (ruleError: unknown) {
      setError(getErrorMessage(ruleError, 'Unable to save alert rule.'));
    }
  }

  async function removeAlertRule(ruleId: string, successMessage: string) {
    setMessage(null);
    setError(null);
    try {
      await deleteAlertRuleMutation.mutateAsync(ruleId);
      setMessage(successMessage);
    } catch (ruleError: unknown) {
      setError(getErrorMessage(ruleError, 'Unable to remove alert rule.'));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Profile</p>
      <h1 className="text-3xl font-semibold text-text1">Notifications</h1>
      <p className="text-sm text-text2">
        {smsComingSoon
          ? 'Signed-in accounts can use shared push alerts on mobile devices. Premium adds browser delivery on web. SMS launch alerts are coming soon.'
          : 'Signed-in accounts can use shared push alerts on mobile devices. Premium adds browser delivery on web plus SMS alerts.'}
      </p>

      {status === 'loading' && (
        <div className="mt-4 rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text2">Loading…</div>
      )}
      {status === 'missing-supabase' && (
        <div className="mt-4 rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text2">Supabase env vars not configured; preferences are read-only stubs.</div>
      )}
      {status === 'guest' && (
        <div className="mt-4 rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text2">
          You are not signed in. <Link className="text-primary" href="/auth/sign-in">Sign in</Link> to manage notifications.
        </div>
      )}
      {status === 'ready' && smsComingSoon && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          SMS alerts are temporarily unavailable while we finish delivery setup. Push alerts are still available.
        </div>
      )}
      {status === 'ready' && !canUseBrowserLaunchAlerts && (
        <div className="mt-4 rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text2">
          Free accounts can manage push alerts for signed-in iOS and Android devices. <Link className="text-primary" href="/upgrade">Upgrade</Link> to add browser notifications on web{smsComingSoon ? '.' : ' and SMS alerts.'}
        </div>
      )}
      {message && <div className="mt-3 rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">{message}</div>}
      {error && <div className="mt-3 rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">{error}</div>}

      {status === 'ready' && (
        <>
          <section className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Account alert rules</div>
            <p className="mt-1 text-sm text-text2">
              {canUseAdvancedAlertRules
                ? 'Basic rules deliver to signed-in mobile devices. Premium also supports preset-based and follow-based rules, with browser delivery available on web.'
                : 'Choose which launches this signed-in account should watch. Free rules deliver to registered iOS and Android devices.'}
            </p>

            {!canUseBasicAlerts ? (
              <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
                Sign in to manage shared alert rules.
              </div>
            ) : alertRulesQuery.isPending ? (
              <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">Loading alert rules…</div>
            ) : alertRulesQuery.isError ? (
              <div className="mt-4 rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
                {getErrorMessage(alertRulesQuery.error, 'Unable to load alert rules.')}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="text-sm font-semibold text-text1">Basic launch scopes</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded-full border px-3 py-2 text-xs font-semibold ${
                        regionUsRule
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-stroke bg-surface-0 text-text1 hover:border-primary'
                      }`}
                      onClick={() =>
                        void (regionUsRule
                          ? removeAlertRule(regionUsRule.id, 'Removed the U.S. launch alert rule.')
                          : createAlertRule({ kind: 'region_us' }, 'Added the U.S. launch alert rule.'))
                      }
                      disabled={createAlertRuleMutation.isPending || deleteAlertRuleMutation.isPending}
                    >
                      All U.S. launches
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text1">Tracked states</div>
                      <div className="text-xs text-text3">Add state-based account rules for mobile push delivery.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border border-stroke bg-surface-0 px-2 py-2 text-xs text-text1"
                        value={selectedStateToAdd}
                        onChange={(event) => setSelectedStateToAdd(event.target.value)}
                        disabled={!availableStates.length || createAlertRuleMutation.isPending}
                      >
                        {availableStates.length ? (
                          availableStates.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))
                        ) : (
                          <option value="">No states left to add</option>
                        )}
                      </select>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-3 py-2 text-xs"
                        onClick={() => {
                          if (!selectedStateToAdd) return;
                          void createAlertRule({ kind: 'state', state: selectedStateToAdd }, `Added ${selectedStateToAdd} alerts.`);
                        }}
                        disabled={!selectedStateToAdd || createAlertRuleMutation.isPending}
                      >
                        {createAlertRuleMutation.isPending ? 'Saving…' : 'Add state'}
                      </button>
                    </div>
                  </div>
                  {feedFilterOptionsQuery.isError && (
                    <div className="mt-3 text-xs text-warning">{getErrorMessage(feedFilterOptionsQuery.error, 'Unable to load state options.')}</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stateRules.length ? (
                      stateRules.map((rule) => (
                        <button
                          key={rule.id}
                          type="button"
                          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
                          onClick={() => void removeAlertRule(rule.id, `Removed ${rule.label}.`)}
                          disabled={deleteAlertRuleMutation.isPending}
                        >
                          {rule.label} • Remove
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-text3">No state rules are active yet.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text1">Current rules</div>
                      <div className="text-xs text-text3">Remove any shared account-level alert rule from here.</div>
                    </div>
                    {canUseAdvancedAlertRules ? (
                      <Link className="text-xs text-primary hover:underline" href="/account/saved">
                        Manage Premium sources
                      </Link>
                    ) : (
                      <Link className="text-xs text-primary hover:underline" href="/upgrade">
                        Upgrade for preset/follow rules
                      </Link>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    {alertRules.length ? (
                      alertRules.map((rule) => (
                        <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-text1">{rule.label}</div>
                            <div className="text-xs text-text3">
                              {rule.kind === 'filter_preset' || rule.kind === 'follow' ? 'Premium rule' : 'Basic mobile rule'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary disabled:opacity-50"
                            onClick={() => void removeAlertRule(rule.id, `Removed ${rule.label}.`)}
                            disabled={deleteAlertRuleMutation.isPending}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-text3">No alert rules are active yet.</div>
                    )}
                  </div>
                  {canUseAdvancedAlertRules && advancedAlertRules.length === 0 && (
                    <div className="mt-3 text-xs text-text3">
                      Premium preset-based and follow-based rules can be added from{' '}
                      <Link className="text-primary hover:underline" href="/account/saved">
                        Saved
                      </Link>
                      .
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <form className="mt-6 space-y-4 rounded-2xl border border-stroke bg-surface-1 p-4">
            <Toggle
              label={canUseBrowserLaunchAlerts ? 'Push alerts' : 'Push alerts (browser delivery is Premium)'}
              checked={form.push_enabled}
              onChange={(value) => {
                if (value && !canUseBasicAlerts) {
                  setError('Sign in to enable push alerts.');
                  return;
                }
                setForm((current) => ({ ...current, push_enabled: value }));
              }}
              helper="Shared push preference across your signed-in devices. Premium adds browser delivery on web."
              disabled={pushToggleDisabled}
            >
              <div className="mt-2 rounded-lg border border-stroke bg-surface-0 p-3 text-xs text-text3">
                {canUseBrowserLaunchAlerts ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Device: <span className="text-text2">{pushDeviceSubscribed ? 'Subscribed' : 'Not subscribed'}</span>
                      </span>
                      <span>
                        Permission: <span className="text-text2">{pushPermission === 'unsupported' ? 'Unsupported' : pushPermission}</span>
                      </span>
                    </div>
                    {!pushSupported && <div className="mt-2">This browser does not support web push notifications.</div>}
                    {pushSupported && pushPermission === 'denied' && (
                      <div className="mt-2">Permission is blocked. Enable notifications in your browser settings, then try again.</div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn rounded-lg px-3 py-2 text-[11px]"
                        onClick={() => void subscribePushDevice()}
                        disabled={!canManageBrowserPush || subscribeWebPushDeviceMutation.isPending || pushPermission === 'denied'}
                      >
                        {subscribeWebPushDeviceMutation.isPending ? 'Working…' : pushDeviceSubscribed ? 'Re-sync device' : 'Subscribe device'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-3 py-2 text-[11px]"
                        onClick={() => void unsubscribePushDevice()}
                        disabled={!pushSupported || unsubscribeWebPushDeviceMutation.isPending || !pushDeviceSubscribed}
                      >
                        Unsubscribe device
                      </button>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-3 py-2 text-[11px]"
                        onClick={() => void sendPushTest()}
                        disabled={!canManageBrowserPush || sendWebPushTestMutation.isPending || !form.push_enabled || !pushDeviceSubscribed}
                      >
                        {sendWebPushTestMutation.isPending ? 'Sending…' : 'Send test'}
                      </button>
                    </div>
                    {!WEB_PUSH_PUBLIC_KEY && pushSupported && (
                      <div className="mt-2 text-warning">Missing configuration: set NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY to enable web push.</div>
                    )}
                  </>
                ) : (
                  <div>
                    Free push alerts deliver to your signed-in iOS and Android devices. Upgrade if you want this browser to receive alerts directly.
                  </div>
                )}
              </div>
            </Toggle>
            <Toggle
              label={smsComingSoon ? 'SMS alerts (coming soon)' : 'SMS alerts (Premium only)'}
              checked={form.sms_enabled}
              onChange={(value) => {
                if (value && smsComingSoon) {
                  setError('SMS alerts are coming soon.');
                  return;
                }
                if (value && !canUseSms) {
                  setError('Upgrade to enable SMS alerts.');
                  return;
                }
                if (value && !form.sms_verified) {
                  setError('Verify your phone number before enabling SMS alerts.');
                  return;
                }
                if (value && !smsConsent) {
                  setError('Please agree to the SMS terms below to enable SMS alerts.');
                  return;
                }
                setForm((current) => ({ ...current, sms_enabled: value }));
              }}
              helper="Rocket launch alerts via SMS. Msg freq varies. Message and data rates may apply. Reply STOP to cancel, HELP for help."
              disabled={smsToggleDisabled}
            >
              {smsComingSoon ? (
                <div className="mt-2 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-xs text-text3">
                  SMS alerts are coming soon. We&#39;re temporarily disabling SMS notifications while delivery issues are resolved.
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-2 text-sm text-text2">
                  <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span>Phone (US)</span>
                    <input
                      type="tel"
                      className="flex-1 rounded-lg border border-stroke bg-surface-0 px-2 py-1"
                      value={form.sms_phone_us}
                      onChange={(event) => {
                        const nextPhone = event.target.value;
                        setSmsConsent(false);
                        setForm((current) => {
                          const changed = current.sms_phone_us !== nextPhone;
                          return {
                            ...current,
                            sms_phone_us: nextPhone,
                            sms_verified: changed ? false : current.sms_verified,
                            sms_enabled: changed ? false : current.sms_enabled
                          };
                        });
                      }}
                      placeholder="(555) 555-5555"
                      disabled={!canUseSms || startSmsVerificationMutation.isPending || completeSmsVerificationMutation.isPending}
                    />
                  </label>
                  {!form.sms_enabled && (
                    <div className="rounded-lg border border-stroke bg-surface-0 p-3 text-xs text-text3">
                      <p>
                        By enabling SMS alerts, you agree to receive recurring automated text messages from {BRAND_NAME} about rocket launch alerts you select.
                        Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See{' '}
                        <Link className="text-primary hover:underline" href="/legal/terms#sms-alerts">
                          Terms
                        </Link>{' '}
                        (SMS Alerts section) and{' '}
                        <Link className="text-primary hover:underline" href="/legal/privacy">
                          Privacy
                        </Link>
                        .
                      </p>
                      <label className="mt-2 flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={smsConsent}
                          onChange={(event) => setSmsConsent(event.target.checked)}
                          disabled={!canUseSms || startSmsVerificationMutation.isPending || completeSmsVerificationMutation.isPending}
                        />
                        <span>I agree.</span>
                      </label>
                    </div>
                  )}
                  {form.sms_verified ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 uppercase tracking-[0.08em] text-emerald-200">
                        Verified
                      </span>
                      <span>
                        {form.sms_enabled ? 'SMS opt-in is active.' : 'Phone verified. Enable SMS alerts and save to opt in.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary rounded-lg px-3 py-2 text-xs"
                          onClick={() => void sendSmsCode()}
                          disabled={!canUseSms || !isValidPhone || startSmsVerificationMutation.isPending || !smsConsent}
                        >
                          {startSmsVerificationMutation.isPending ? 'Sending…' : smsCodeSent ? 'Resend code' : 'Send code'}
                        </button>
                        {!canUseSms && <span className="text-xs text-text3">Upgrade to verify.</span>}
                        {canUseSms && !isValidPhone && <span className="text-xs text-text3">Enter a valid US phone number.</span>}
                        {canUseSms && isValidPhone && !smsConsent && <span className="text-xs text-text3">Agree to the SMS terms above.</span>}
                      </div>
                      {smsCodeSent && (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            className="rounded-lg border border-stroke bg-surface-0 px-2 py-1 text-sm"
                            value={smsCode}
                            onChange={(event) => setSmsCode(event.target.value)}
                            placeholder="Verification code"
                            aria-label="Verification code"
                          />
                          <button
                            type="button"
                            className="btn rounded-lg px-3 py-2 text-xs"
                            onClick={() => void verifySmsCode()}
                            disabled={!canUseSms || completeSmsVerificationMutation.isPending || !smsCode.trim()}
                          >
                            {completeSmsVerificationMutation.isPending ? 'Verifying…' : 'Verify phone'}
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-text3">We send a one-time code to confirm your number before enabling alerts.</p>
                    </div>
                  )}
                </div>
              )}
            </Toggle>
            <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-xs text-text3">
              Per-launch alert controls live on the bell icon. Free push alerts deliver to mobile devices; Premium adds browser delivery here on web.
            </div>
            <Toggle
              label={`Quiet hours (${quietHoursLabel})`}
              checked={form.quiet_hours_enabled}
              onChange={(value) => setForm((current) => ({ ...current, quiet_hours_enabled: value }))}
              helper="Silence notifications during your window; batching resumes after."
            >
              <div className="mt-2 flex flex-col gap-2 text-sm text-text2 sm:flex-row">
                <label className="flex items-center gap-2">
                  <span>Start</span>
                  <input
                    type="time"
                    className="rounded-lg border border-stroke bg-surface-0 px-2 py-1"
                    value={form.quiet_start_local}
                    onChange={(event) => setForm((current) => ({ ...current, quiet_start_local: event.target.value }))}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>End</span>
                  <input
                    type="time"
                    className="rounded-lg border border-stroke bg-surface-0 px-2 py-1"
                    value={form.quiet_end_local}
                    onChange={(event) => setForm((current) => ({ ...current, quiet_end_local: event.target.value }))}
                  />
                </label>
              </div>
            </Toggle>

            <button
              type="button"
              className="btn rounded-lg px-4 py-2 text-sm"
              onClick={() => void savePreferences()}
              disabled={updateNotificationPreferencesMutation.isPending}
            >
              {updateNotificationPreferencesMutation.isPending ? 'Saving…' : 'Save preferences'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Toggle({
  label,
  helper,
  checked,
  onChange,
  disabled,
  children
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const labelId = useId();
  const helperId = useId();
  return (
    <div className={`rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div id={labelId} className="text-sm font-semibold text-text1">
            {label}
          </div>
          {helper && (
            <div id={helperId} className="text-xs text-text3">
              {helper}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`flex h-6 w-11 items-center rounded-full border px-1 transition ${
            checked ? 'border-primary bg-[rgba(34,211,238,0.2)] justify-end' : 'border-stroke bg-surface-0 justify-start'
          } ${disabled ? 'cursor-not-allowed' : ''}`}
          onClick={() => {
            if (!disabled) onChange(!checked);
          }}
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={helper ? helperId : undefined}
          aria-disabled={disabled}
        >
          <span className="h-4 w-4 rounded-full bg-white" />
        </button>
      </div>
      {children}
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
}

function normalizeAlertRuleToken(value: string) {
  return value.trim().toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
