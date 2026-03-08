'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
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
  const [status, setStatus] = useState<'loading' | 'guest' | 'ready' | 'missing-supabase' | 'error'>('loading');
  const [form, setForm] = useState<PrefForm>(DEFAULT_PREFS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [smsSystemEnabled, setSmsSystemEnabled] = useState<boolean | null>(null);
  const [smsConsent, setSmsConsent] = useState(false);
  const [smsCodeSent, setSmsCodeSent] = useState(false);
  const [smsCode, setSmsCode] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsVerifying, setSmsVerifying] = useState(false);
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [pushSupported, setPushSupported] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [pushDeviceSubscribed, setPushDeviceSubscribed] = useState<boolean>(false);
  const [pushWorking, setPushWorking] = useState(false);
  const [pushTestSending, setPushTestSending] = useState(false);

  const loadPreferences = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/me/notifications/preferences', { cache: 'no-store' });
      if (res.status === 401) {
        setStatus('guest');
        return;
      }
      const json = await res.json();
      const prefs = json.preferences || DEFAULT_PREFS;
      setSmsSystemEnabled(typeof json.smsSystemEnabled === 'boolean' ? json.smsSystemEnabled : null);
      setForm({
        push_enabled: !!prefs.push_enabled,
        sms_enabled: !!prefs.sms_enabled,
        quiet_hours_enabled: !!prefs.quiet_hours_enabled,
        quiet_start_local: prefs.quiet_start_local || '22:00',
        quiet_end_local: prefs.quiet_end_local || '07:00',
        sms_phone_us: prefs.sms_phone_e164 ? formatUsPhoneForDisplay(prefs.sms_phone_e164) : '',
        sms_verified: !!prefs.sms_verified
      });
      setStatus('ready');
    } catch (err: any) {
      setError(err.message || 'Failed to load preferences');
      setStatus('error');
    }
  }, []);

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/me/subscription', { cache: 'no-store' });
      if (!res.ok) {
        setIsPaid(false);
        return;
      }
      const json = await res.json();
      setIsPaid(!!json.isPaid);
    } catch (err) {
      console.error('subscription load error', err);
      setIsPaid(false);
    }
  }, []);

  const refreshPushDeviceStatus = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    if (!supported) {
      setPushPermission('unsupported');
      setPushDeviceSubscribed(false);
      return;
    }

    setPushPermission(Notification.permission);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setPushDeviceSubscribed(false);
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      setPushDeviceSubscribed(!!sub);
    } catch (err) {
      console.warn('push status check warning', err);
      setPushDeviceSubscribed(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setStatus('missing-supabase');
      return;
    }
    let active = true;
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        setStatus('guest');
        return;
      }
      loadPreferences();
      loadSubscription();
      refreshPushDeviceStatus();
    };
    run();
    return () => {
      active = false;
    };
  }, [loadPreferences, loadSubscription, refreshPushDeviceStatus]);

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
  const smsComingSoon = SMS_NOTIFICATIONS_COMING_SOON || smsSystemEnabled === false;
  const canUseSms = isPaid === true && !smsComingSoon;
  const canToggleSms = canUseSms && form.sms_verified;
  const smsToggleDisabled = form.sms_enabled ? false : !canToggleSms;
  const canUsePush = isPaid === true && pushSupported;
  const pushToggleDisabled = form.push_enabled ? false : !canUsePush;

  async function savePreferences() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/me/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          push_enabled: form.push_enabled,
          sms_enabled: form.sms_enabled,
          sms_consent: smsConsent,
          quiet_hours_enabled: form.quiet_hours_enabled,
          quiet_start_local: form.quiet_start_local,
          quiet_end_local: form.quiet_end_local
        })
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === 'subscription_required') {
          throw new Error('Upgrade to Premium to enable notifications.');
        }
        if (json.error === 'sms_system_disabled') {
          throw new Error('SMS alerts are coming soon.');
        }
        if (json.error === 'sms_not_verified') {
          throw new Error('Verify your phone before enabling SMS alerts.');
        }
        if (json.error === 'phone_required') {
          throw new Error('Enter and verify a phone number to enable SMS alerts.');
        }
        if (json.error === 'sms_consent_required') {
          throw new Error('Please agree to the SMS terms below to enable SMS alerts.');
        }
        if (json.error === 'sms_reply_start_required') {
          throw new Error(json.message || 'This number is opted out (STOP). Reply START from your phone to resubscribe, then try again.');
        }
        throw new Error(json.error || 'Failed to save preferences');
      }
      const prefs = json.preferences || {};
      setForm((prev) => ({
        ...prev,
        push_enabled: !!prefs.push_enabled,
        sms_enabled: !!prefs.sms_enabled,
        sms_verified: !!prefs.sms_verified
      }));
      setMessage('Preferences saved');
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
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
    setSmsSending(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/notifications/sms/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.sms_phone_us.trim(), sms_consent: smsConsent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && json.error === 'sms_system_disabled') {
        throw new Error('SMS alerts are coming soon.');
      }
      if (!res.ok && json.error === 'sms_consent_required') {
        throw new Error('Please agree to the SMS terms below to request a verification code.');
      }
      if (!res.ok) throw new Error(json.error || 'Failed to send code');
      setSmsCodeSent(true);
      setMessage('Verification code sent.');
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
    } finally {
      setSmsSending(false);
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
    setSmsVerifying(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/notifications/sms/verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.sms_phone_us.trim(), code: smsCode.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && json.error === 'sms_system_disabled') {
        throw new Error('SMS alerts are coming soon.');
      }
      if (!res.ok) throw new Error(json.error || 'Verification failed');
      setForm((prev) => ({ ...prev, sms_verified: true, sms_enabled: false }));
      setSmsCodeSent(false);
      setSmsCode('');
      setMessage('Phone verified. Turn on SMS alerts and save to opt in.');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setSmsVerifying(false);
    }
  }

  async function ensurePushEnabled() {
    if (form.push_enabled) return;
    const res = await fetch('/api/me/notifications/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ push_enabled: true })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === 'subscription_required') throw new Error('Upgrade to Premium to enable browser notifications.');
      throw new Error(json.error || 'Failed to enable browser notifications.');
    }
    setForm((prev) => ({ ...prev, push_enabled: !!json.preferences?.push_enabled }));
  }

  async function subscribePushDevice() {
    if (!pushSupported) {
      setError('Browser notifications are not supported in this browser.');
      return;
    }
    if (isPaid !== true) {
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

    setPushWorking(true);
    setMessage(null);
    setError(null);
    try {
      await ensurePushEnabled();

      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }

      const existingReg = await navigator.serviceWorker.getRegistration();
      const reg = existingReg ?? (await navigator.serviceWorker.register('/sw.js'));
      const readyReg = (await navigator.serviceWorker.ready) ?? reg;

      const existingSub = await readyReg.pushManager.getSubscription();
      const sub =
        existingSub ??
        (await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY)
        }));

      const p256dhKey = sub.getKey('p256dh');
      const authKey = sub.getKey('auth');
      if (!p256dhKey || !authKey) throw new Error('Missing subscription keys.');

      const saveRes = await fetch('/api/me/notifications/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: arrayBufferToBase64(p256dhKey),
          auth: arrayBufferToBase64(authKey),
          user_agent: navigator.userAgent
        })
      });
      const saveJson = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        if (saveJson.error === 'subscription_required') throw new Error('Upgrade to Premium to enable browser notifications.');
        throw new Error(saveJson.error || 'Failed to save device subscription.');
      }

      await refreshPushDeviceStatus();
      setMessage('Browser notifications enabled on this device.');
    } catch (err: any) {
      setError(err.message || 'Failed to enable browser notifications.');
    } finally {
      setPushWorking(false);
    }
  }

  async function unsubscribePushDevice() {
    if (!pushSupported) {
      setError('Browser notifications are not supported in this browser.');
      return;
    }

    setPushWorking(true);
    setMessage(null);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const endpoint = sub?.endpoint || null;
      if (sub) {
        await sub.unsubscribe();
      }
      if (endpoint) {
        await fetch('/api/me/notifications/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint })
        });
      }

      await refreshPushDeviceStatus();
      setMessage('Browser notifications disabled on this device.');
    } catch (err: any) {
      setError(err.message || 'Failed to disable browser notifications.');
    } finally {
      setPushWorking(false);
    }
  }

  async function sendPushTest() {
    if (isPaid !== true) {
      setError('Upgrade to Premium to use notifications.');
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

    setPushTestSending(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/me/notifications/push/test', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'push_not_enabled') throw new Error('Enable browser notifications first.');
        if (json.error === 'push_not_subscribed') throw new Error('Subscribe this device first.');
        if (json.error === 'rate_limited') throw new Error('Please wait a moment before sending another test.');
        if (json.error === 'subscription_required') throw new Error('Upgrade to Premium to enable notifications.');
        throw new Error(json.error || 'Failed to queue test notification.');
      }
      setMessage('Test notification queued. It should arrive within about a minute.');
    } catch (err: any) {
      setError(err.message || 'Failed to send test notification.');
    } finally {
      setPushTestSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Profile</p>
      <h1 className="text-3xl font-semibold text-text1">Notifications</h1>
      <p className="text-sm text-text2">
        {smsComingSoon
          ? 'Browser notifications are available for Premium users. SMS launch alerts are coming soon.'
          : 'Browser notifications and SMS alerts are available for Premium users. Opt in once, then choose alert types per launch.'}
      </p>

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
          SMS alerts are temporarily unavailable while we finish delivery setup. Browser notifications are still available.
        </div>
      )}
      {status === 'ready' && isPaid === false && (
        <div className="mt-4 rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text2">
          Notifications are a Premium feature. <Link className="text-primary" href="/upgrade">Upgrade</Link> to enable browser notifications (and SMS once it launches).
        </div>
      )}
      {message && <div className="mt-3 rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">{message}</div>}
      {error && <div className="mt-3 rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">{error}</div>}

      {status === 'ready' && (
        <>
          <form className="mt-6 space-y-4 rounded-2xl border border-stroke bg-surface-1 p-4">
            <Toggle
              label="Browser notifications (Premium only)"
              checked={form.push_enabled}
              onChange={(v) => {
                if (v && !pushSupported) {
                  setError('Browser notifications are not supported in this browser.');
                  return;
                }
                if (v && isPaid !== true) {
                  setError('Upgrade to Premium to enable browser notifications.');
                  return;
                }
                setForm((f) => ({ ...f, push_enabled: v }));
              }}
              helper="Launch alerts delivered as browser notifications (web push)."
              disabled={pushToggleDisabled}
            >
              <div className="mt-2 rounded-lg border border-stroke bg-surface-0 p-3 text-xs text-text3">
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
                    onClick={subscribePushDevice}
                    disabled={!canUsePush || pushWorking || pushPermission === 'denied'}
                  >
                    {pushWorking ? 'Working…' : pushDeviceSubscribed ? 'Re-sync device' : 'Subscribe device'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary rounded-lg px-3 py-2 text-[11px]"
                    onClick={unsubscribePushDevice}
                    disabled={!pushSupported || pushWorking || !pushDeviceSubscribed}
                  >
                    Unsubscribe device
                  </button>
                  <button
                    type="button"
                    className="btn-secondary rounded-lg px-3 py-2 text-[11px]"
                    onClick={sendPushTest}
                    disabled={!canUsePush || pushWorking || pushTestSending || !form.push_enabled || !pushDeviceSubscribed}
                  >
                    {pushTestSending ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                {!WEB_PUSH_PUBLIC_KEY && pushSupported && (
                  <div className="mt-2 text-warning">Missing configuration: set NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY to enable web push.</div>
                )}
              </div>
            </Toggle>
            <Toggle
              label={smsComingSoon ? 'SMS alerts (coming soon)' : 'SMS alerts (Premium only)'}
              checked={form.sms_enabled}
              onChange={(v) => {
                if (v && smsComingSoon) {
                  setError('SMS alerts are coming soon.');
                  return;
                }
                if (v && !canUseSms) {
                  setError('Upgrade to enable SMS alerts.');
                  return;
                }
                if (v && !form.sms_verified) {
                  setError('Verify your phone number before enabling SMS alerts.');
                  return;
                }
                if (v && !smsConsent) {
                  setError('Please agree to the SMS terms below to enable SMS alerts.');
                  return;
                }
                setForm((f) => ({ ...f, sms_enabled: v }));
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
                    onChange={(e) => {
                      const nextPhone = e.target.value;
                      setSmsConsent(false);
                      setForm((f) => {
                        const changed = f.sms_phone_us !== nextPhone;
                        return {
                          ...f,
                          sms_phone_us: nextPhone,
                          sms_verified: changed ? false : f.sms_verified,
                          sms_enabled: changed ? false : f.sms_enabled
                        };
                      });
                    }}
                    placeholder="(555) 555-5555"
                    disabled={!canUseSms || smsSending || smsVerifying}
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
                        onChange={(e) => setSmsConsent(e.target.checked)}
                        disabled={!canUseSms || smsSending || smsVerifying}
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
                      {form.sms_enabled
                        ? 'SMS opt-in is active.'
                        : 'Phone verified. Enable SMS alerts and save to opt in.'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-3 py-2 text-xs"
                        onClick={sendSmsCode}
                        disabled={!canUseSms || !isValidPhone || smsSending || !smsConsent}
                      >
                        {smsSending ? 'Sending…' : smsCodeSent ? 'Resend code' : 'Send code'}
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
                          onChange={(e) => setSmsCode(e.target.value)}
                          placeholder="Verification code"
                          aria-label="Verification code"
                        />
                        <button
                          type="button"
                          className="btn rounded-lg px-3 py-2 text-xs"
                          onClick={verifySmsCode}
                          disabled={!canUseSms || smsVerifying || !smsCode.trim()}
                        >
                          {smsVerifying ? 'Verifying…' : 'Verify phone'}
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
              Per-launch alert controls are available on the bell icon for browser notifications. SMS controls will appear once SMS alerts launch.
            </div>
            <Toggle
              label={`Quiet hours (${quietHoursLabel})`}
              checked={form.quiet_hours_enabled}
              onChange={(v) => setForm((f) => ({ ...f, quiet_hours_enabled: v }))}
              helper="Silence notifications during your window; batching resumes after."
            >
              <div className="mt-2 flex flex-col gap-2 text-sm text-text2 sm:flex-row">
                <label className="flex items-center gap-2">
                  <span>Start</span>
                  <input
                    type="time"
                    className="rounded-lg border border-stroke bg-surface-0 px-2 py-1"
                    value={form.quiet_start_local}
                    onChange={(e) => setForm((f) => ({ ...f, quiet_start_local: e.target.value }))}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>End</span>
                  <input
                    type="time"
                    className="rounded-lg border border-stroke bg-surface-0 px-2 py-1"
                    value={form.quiet_end_local}
                    onChange={(e) => setForm((f) => ({ ...f, quiet_end_local: e.target.value }))}
                  />
                </label>
              </div>
            </Toggle>

            <button type="button" className="btn rounded-lg px-4 py-2 text-sm" onClick={savePreferences} disabled={saving}>
              {saving ? 'Saving…' : 'Save preferences'}
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
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
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
          className={`flex h-6 w-11 items-center rounded-full border px-1 transition ${checked ? 'border-primary bg-[rgba(34,211,238,0.2)] justify-end' : 'border-stroke bg-surface-0 justify-start'} ${disabled ? 'cursor-not-allowed' : ''}`}
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
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
