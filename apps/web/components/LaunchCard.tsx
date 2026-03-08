'use client';

import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Launch } from '@/lib/types/launch';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { LIFTOFF_VISIBILITY_SECONDS, NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { computeCountdown, formatDateOnly, formatNetLabel, isCountdownEligible, isDateOnlyNet } from '@/lib/time';
import { getLaunchMilestoneEndMs, parseIsoDurationToMs } from '@/lib/utils/launchMilestones';
import { buildCatalogHref } from '@/lib/utils/catalog';
import { resolveProviderLogoUrl } from '@/lib/utils/providerLogo';
import { buildLaunchHref, buildLocationHref, buildProviderHref, buildRocketHref } from '@/lib/utils/launchLinks';
import { getLaunchStatusTone } from '@/lib/utils/launchStatusTone';
import { isArtemisLaunch } from '@/lib/utils/launchArtemis';
import { isStarshipLaunch } from '@/lib/utils/launchStarship';
import { SMS_NOTIFICATIONS_COMING_SOON } from '@/lib/notifications/smsAvailability';
import { CameraGuideButton } from '@/components/ar/CameraGuideButton';
import { TimeDisplay } from './TimeDisplay';
import { AddToCalendarButton } from './AddToCalendarButton';
import { ShareButton } from './ShareButton';
import { buildLaunchShare } from '@/lib/share';
import { CryoAtmosphere, type CryoStage } from './CryoAtmosphere';
import { WeatherIcon } from './WeatherIcon';
import { Badge, type BadgeTone } from './Badge';

type LaunchAlertPrefs = {
  mode: 't_minus' | 'local_time';
  timezone: string;
  t_minus_minutes: number[];
  local_times: string[];
  notify_status_change: boolean;
  notify_net_change: boolean;
};

const DEFAULT_LAUNCH_ALERTS: LaunchAlertPrefs = {
  mode: 't_minus',
  timezone: 'UTC',
  t_minus_minutes: [],
  local_times: [],
  notify_status_change: false,
  notify_net_change: false
};

export function LaunchCard({
  launch,
  isNext = false,
  showAlertsNudge = false,
  onAlertsNudgeClick,
  isAuthed = false,
  isPaid = false,
  isArEligible = false,
  onOpenUpsell,
  blockThirdPartyEmbeds = false,
  initialNowMs,
  isWatched = false,
  watchDisabled = false,
  onToggleWatch,
  isProviderFollowed = false,
  providerFollowDisabled = false,
  onToggleFollowProvider,
  padFollowValue,
  isPadFollowed = false,
  padFollowDisabled = false,
  onToggleFollowPad
}: {
  launch: Launch;
  isNext?: boolean;
  showAlertsNudge?: boolean;
  onAlertsNudgeClick?: () => void;
  isAuthed?: boolean;
  isPaid?: boolean;
  isArEligible?: boolean;
  onOpenUpsell?: (featureLabel?: string) => void;
  blockThirdPartyEmbeds?: boolean;
  initialNowMs?: number;
  isWatched?: boolean;
  watchDisabled?: boolean;
  onToggleWatch?: (launchId: string) => void;
  isProviderFollowed?: boolean;
  providerFollowDisabled?: boolean;
  onToggleFollowProvider?: (provider: string) => void;
  padFollowValue?: string | null;
  isPadFollowed?: boolean;
  padFollowDisabled?: boolean;
  onToggleFollowPad?: (padRuleValue: string) => void;
}) {
  const searchParams = useSearchParams();
  const debugToken = String(searchParams.get('debug') || '').trim().toLowerCase();
  const debugLaunchId = String(searchParams.get('debugLaunchId') || '').trim();
  const debugEnabled = debugToken === '1' || debugToken === 'true' || debugToken === 'card' || debugToken === 'launchcard';
  const debugThisCard = debugEnabled && (!debugLaunchId || debugLaunchId === launch.id);
  const debugSessionIdRef = useRef(Math.random().toString(36).slice(2));
  const debugName = useMemo(() => `LaunchCard:${launch.id}:${debugSessionIdRef.current}`, [launch.id]);

  const [userTz, setUserTz] = useState('UTC');
  const dateOnly = !isCountdownEligible(launch, userTz);
  const statusCombined = `${launch.status ?? ''} ${launch.statusText ?? ''}`.toLowerCase();
  const isHold = statusCombined.includes('hold');
  const isScrubbed = statusCombined.includes('scrub');
  const isGo = statusCombined.includes('go');
  const netMs = useMemo(() => new Date(launch.net).getTime(), [launch.net]);
  const initialNowMsValue =
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
  const nowMs = useSharedNow(1_000, initialNowMsValue);
  const countdown = useMemo(() => computeCountdown(launch.net, nowMs), [launch.net, nowMs]);
  const liftoffWindowMs = !isHold && !isScrubbed ? LIFTOFF_VISIBILITY_SECONDS * 1000 : 0;
  const milestoneEndMs = useMemo(
    () => getLaunchMilestoneEndMs(launch, liftoffWindowMs, { ignoreTimeline: isHold || isScrubbed }),
    [launch, liftoffWindowMs, isHold, isScrubbed]
  );
  const fallbackEndMs = Number.isFinite(netMs) ? netMs + liftoffWindowMs : Number.NaN;
  const effectiveEndMs = milestoneEndMs ?? fallbackEndMs;
  const isLaunchWindow = !dateOnly && liftoffWindowMs > 0 && nowMs >= netMs && nowMs < netMs + liftoffWindowMs;
  const isLaunchedTagWindow =
    !dateOnly &&
    !isHold &&
    !isScrubbed &&
    Number.isFinite(netMs) &&
    nowMs >= netMs &&
    nowMs < netMs + NEXT_LAUNCH_RETENTION_MS;
  const isPast = dateOnly
    ? netMs < nowMs
    : Number.isFinite(effectiveEndMs)
      ? nowMs >= effectiveEndMs
      : false;
  const isArtemis = !isPast && isArtemisLaunch(launch);
  const isStarship = !isPast && isStarshipLaunch(launch);

  const milestones = useMemo(() => buildLaunchMilestones(launch), [launch]);
  const firstPrelaunchMilestone = useMemo(() => pickFirstPrelaunchMilestone(milestones), [milestones]);
  const postLaunchMilestones = useMemo(
    () => milestones.filter((milestone) => milestone.offsetMs != null && milestone.offsetMs >= 0),
    [milestones]
  );
  const hasPostLaunchMilestones = postLaunchMilestones.length > 0;
  const isBeforeLaunch = Number.isFinite(netMs) && nowMs < netMs;
  const isMilestoneSequence =
    hasPostLaunchMilestones &&
    !dateOnly &&
    !isHold &&
    !isScrubbed &&
    Number.isFinite(effectiveEndMs) &&
    nowMs >= netMs &&
    nowMs < effectiveEndMs;
  const showPrelaunchGoal = Boolean(firstPrelaunchMilestone) && !dateOnly && isBeforeLaunch && !isScrubbed;
  const milestoneSequence = isMilestoneSequence ? postLaunchMilestones : [];
  const nextMilestone = isMilestoneSequence
    ? milestoneSequence.find((milestone) => milestone.absoluteMs != null && milestone.absoluteMs >= nowMs) ||
      milestoneSequence[milestoneSequence.length - 1] ||
      null
    : null;
  const milestoneBadge =
    isMilestoneSequence && nextMilestone
      ? { label: 'Next milestone', milestone: nextMilestone }
      : showPrelaunchGoal && firstPrelaunchMilestone
        ? { label: 'First goal', milestone: firstPrelaunchMilestone }
        : null;

  useEffect(() => {
    if (!debugThisCard) return;
    console.log(`[${debugName}] mounted`, {
      isNext,
      dateOnly,
      isPast,
      status: launch.status ?? null,
      statusText: launch.statusText ?? null,
      net: launch.net
    });
    return () => console.log(`[${debugName}] unmounted`);
  }, [dateOnly, debugName, debugThisCard, isNext, isPast, launch.net, launch.status, launch.statusText]);

  const timelineFillPct = useMemo(() => {
    if (isPast) return 100;
    if (dateOnly) return 85;
    if (Number.isFinite(effectiveEndMs) && nowMs >= netMs && effectiveEndMs > netMs) {
      const progress = clampNumber((nowMs - netMs) / (effectiveEndMs - netMs), 0, 1);
      return Math.max(4, Math.round(progress * 100));
    }
    const horizonSeconds = 24 * 60 * 60; // 24h horizon
    const pct = Math.min(100, Math.max(4, (countdown.diffSeconds / horizonSeconds) * 100));
    return pct;
  }, [countdown.diffSeconds, dateOnly, effectiveEndMs, isPast, netMs, nowMs]);

  const variant = useMemo(() => {
    if (isPast) return 'past';
    if (isGo) return 'go';
    if (isScrubbed) return 'alert';
    if (isHold) return 'hold';
    return 'idle';
  }, [isGo, isHold, isPast, isScrubbed]);
  const providerLogoUrl = resolveProviderLogoUrl(launch);
  const hasProviderLogo = Boolean(providerLogoUrl);
  const providerHref = buildProviderHref(launch.provider);
  const launchHref = buildLaunchHref(launch);
  const arHref = `${launchHref}/ar`;
  const providerCatalogHref = useMemo(() => {
    const provider = launch.provider?.trim();
    if (!provider) return null;
    if (provider.toLowerCase() === 'unknown') return null;
    return buildCatalogHref({ entity: 'agencies', q: provider });
  }, [launch.provider]);
  const providerLabel = launch.provider.toUpperCase();
  const providerFollowTarget = String(launch.provider || '').trim() || 'Provider';
  const providerFollowLabel = `Follow ${providerFollowTarget}`;

  const pastOutcome = useMemo(() => {
    if (!isPast) return null;
    if (isScrubbed) return 'scrubbed' as const;
    if (statusCombined.includes('success') || statusCombined.includes('successful')) return 'success' as const;
    if (statusCombined.includes('fail') || statusCombined.includes('anomaly') || statusCombined.includes('partial')) return 'failure' as const;
    return 'unknown' as const;
  }, [isPast, isScrubbed, statusCombined]);

  const statusLabel = useMemo(() => {
    if (isPast) {
      if (pastOutcome === 'success') return 'MISSION SUCCESS';
      if (pastOutcome === 'failure') return 'ANOMALY DETECTED';
      if (pastOutcome === 'scrubbed') return 'SCRUBBED';
      return 'MISSION COMPLETE';
    }
    if (isLaunchWindow) return 'LIFTOFF';
    if (isMilestoneSequence) return 'FLIGHT SEQUENCE';
    if (isHold) return 'HOLD HOLD HOLD';
    if (isScrubbed) return 'SCRUBBED';
    if (dateOnly) return 'AWAITING NET';
    return 'T-MINUS RUNNING';
  }, [dateOnly, isHold, isLaunchWindow, isMilestoneSequence, isPast, isScrubbed, pastOutcome]);

  const baseStatusTone = useMemo(
    () => getLaunchStatusTone(launch.status, launch.statusText),
    [launch.status, launch.statusText]
  );

  const statusTone = useMemo(() => {
    if (isPast) {
      if (pastOutcome === 'success') return 'success';
      if (pastOutcome === 'failure') return 'danger';
      if (pastOutcome === 'scrubbed') return 'neutral';
      return 'neutral';
    }
    return baseStatusTone;
  }, [baseStatusTone, isPast, pastOutcome]);

  const orbitLabel =
    launch.mission?.orbit ||
    launch.payloads?.find((p) => p?.orbit)?.orbit ||
    launch.mission?.type ||
    'TBD';

  const countdownGlow = useMemo(() => {
    if (!isNext || isPast || dateOnly) return null;
    if (nowMs >= netMs && !isLaunchWindow) return null;
    return computeCountdownGlow(countdown.diffSeconds);
  }, [dateOnly, isLaunchWindow, isNext, isPast, countdown.diffSeconds, netMs, nowMs]);

  const showVehicle = useMemo(() => {
    const vehicleKey = normalizeKey(launch.vehicle);
    const nameKey = normalizeKey(launch.name);
    if (!vehicleKey || !nameKey) return true;
    return !(nameKey.includes(vehicleKey) || vehicleKey.includes(nameKey));
  }, [launch.name, launch.vehicle]);

  void blockThirdPartyEmbeds;
  const canUpsell = typeof onOpenUpsell === 'function';

  const padDisplay = useMemo(() => {
    const name = launch.pad.name?.trim();
    const shortCode = launch.pad.shortCode?.trim();
    const nameOk = name && name !== 'Pad' ? name : null;
    const shortOk = shortCode && shortCode !== 'Pad' ? shortCode : null;
    return nameOk || shortOk || 'Pad';
  }, [launch.pad.name, launch.pad.shortCode]);

  const locationDisplay = useMemo(() => {
    const locationName = launch.pad.locationName?.trim();
    if (!locationName) return null;
    if (locationName.toLowerCase() === 'unknown') return null;
    return locationName;
  }, [launch.pad.locationName]);

  const firstStageBooster = useMemo(() => {
    const value = String(launch.firstStageBooster || '').trim();
    if (!value) return null;
    if (value.toLowerCase() === 'unknown') return null;
    return value;
  }, [launch.firstStageBooster]);
  const padFollowTarget = locationDisplay || padDisplay || 'Pad';
  const padFollowLabel = `Follow ${padFollowTarget}`;

  const rocketHref = useMemo(
    () => buildRocketHref(launch, launch.rocket?.fullName || launch.vehicle),
    [launch]
  );
  const locationHref = useMemo(() => buildLocationHref(launch), [launch]);
  const padCatalogHref = useMemo(() => {
    if (launch.ll2PadId == null) return locationHref;
    return `/catalog/pads/${encodeURIComponent(String(launch.ll2PadId))}`;
  }, [launch.ll2PadId, locationHref]);

  const activeEvent = launch.currentEvent ?? launch.nextEvent;
  const activeEventLabel = formatEventDate(activeEvent?.date, activeEvent?.datePrecision, userTz);
  const activeEventTag = launch.currentEvent ? 'Current event' : 'Next event';

  const share = useMemo(() => buildLaunchShare(launch), [launch]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsNotice, setAlertsNotice] = useState<string | null>(null);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsLoadedChannel, setAlertsLoadedChannel] = useState<'sms' | 'push' | null>(null);
  const [alertsChannel, setAlertsChannel] = useState<'sms' | 'push'>(() => (SMS_NOTIFICATIONS_COMING_SOON ? 'push' : 'sms'));
  const [alertsNudgeLatched, setAlertsNudgeLatched] = useState(showAlertsNudge);
  const [alertsSaved, setAlertsSaved] = useState<LaunchAlertPrefs>(DEFAULT_LAUNCH_ALERTS);
  const [alertsDraft, setAlertsDraft] = useState<LaunchAlertPrefs>(DEFAULT_LAUNCH_ALERTS);
  const [smsStatus, setSmsStatus] = useState<{ enabled: boolean; verified: boolean } | null>(null);
  const [smsSystemEnabled, setSmsSystemEnabled] = useState<boolean | null>(null);
  const [pushStatus, setPushStatus] = useState<{ enabled: boolean; subscribed: boolean } | null>(null);

  useEffect(() => {
    if (showAlertsNudge) setAlertsNudgeLatched(true);
  }, [showAlertsNudge]);
  const windowStartIso = launch.windowStart || launch.net;
  const windowEndIso = launch.windowEnd || windowStartIso;
  const windowStartMs = parseIsoMs(windowStartIso);
  const windowEndMs = parseIsoMs(windowEndIso);
  const hasWindowRange = Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && windowEndMs > windowStartMs;
  const windowProgress = hasWindowRange
    ? clampNumber((nowMs - windowStartMs) / (windowEndMs - windowStartMs), 0, 1)
    : isPast
      ? 1
      : 0;
  const windowStartLabel = useMemo(
    () => formatWindowLabel(windowStartIso, userTz, dateOnly),
    [windowStartIso, userTz, dateOnly]
  );
  const windowEndLabel = useMemo(
    () => (launch.windowEnd ? formatWindowLabel(launch.windowEnd, userTz, dateOnly) : 'TBD'),
    [launch.windowEnd, userTz, dateOnly]
  );
  const windowEndValueClass = launch.windowEnd ? 'text-text1' : 'text-text3';
  const windowStatusLabel = useMemo(() => {
    if (isPast) return 'WINDOW CLOSED';
    if (isScrubbed) return 'SCRUBBED';
    if (isHold) return 'ON HOLD';
    if (dateOnly) return 'NET TBD';
    if (isLaunchWindow) return 'WINDOW OPEN';
    return 'COUNTDOWN';
  }, [dateOnly, isHold, isLaunchWindow, isPast, isScrubbed]);
  const windowStatusClass =
    statusTone === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : statusTone === 'danger'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : statusTone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-white/10 bg-white/5 text-text3';
  const windowTrackStyle = useMemo(() => {
    const horizonSeconds = 24 * 60 * 60;
    const paletteT = clampNumber(1 - countdown.diffSeconds / horizonSeconds, 0, 1);
    let { a, b } = sampleCountdownPalette(paletteT);

    if (isScrubbed) {
      a = hexToRgb('#94A3B8');
      b = hexToRgb('#475569');
    } else if (isHold) {
      a = hexToRgb('#FDE68A');
      b = hexToRgb('#F59E0B');
    } else if (isGo) {
      a = hexToRgb('#6EE7B7');
      b = hexToRgb('#2DD4BF');
    }

    const rim = mixRgb(a, b, 0.5);
    const fillOpacity = isPast ? 0.3 : isScrubbed ? 0.22 : isHold ? 0.6 : 0.82;
    const sparkOpacity = isPast ? 0.2 : isScrubbed ? 0.25 : 0.7;

    return {
      ['--window-progress' as any]: windowProgress.toFixed(3),
      ['--window-accent-a' as any]: rgba(a, 0.4),
      ['--window-accent-b' as any]: rgba(b, 0.75),
      ['--window-accent-c' as any]: rgba(rim, 0.65),
      ['--window-fill-opacity' as any]: fillOpacity.toFixed(2),
      ['--window-spark-opacity' as any]: sparkOpacity.toFixed(2)
    } as CSSProperties;
  }, [countdown.diffSeconds, isGo, isHold, isPast, isScrubbed, windowProgress]);

  const isLaunchDay = isSameDayInTimeZone(netMs, nowMs, userTz);
  const secondsUntilLaunch = Math.floor((netMs - nowMs) / 1000);
  const showWeatherIcon =
    !isPast &&
    !dateOnly &&
    secondsUntilLaunch > 0 &&
    secondsUntilLaunch <= 7 * 24 * 60 * 60 &&
    Boolean(launch.weatherIconUrl);
  const ws45Pov =
    typeof launch.probability === 'number' && Number.isFinite(launch.probability)
      ? Math.round(clampNumber(launch.probability, 0, 100))
      : null;
  const ws45Concerns = Array.isArray(launch.weatherConcerns)
    ? launch.weatherConcerns.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  const ws45Tone: BadgeTone =
    ws45Pov == null ? 'neutral' : ws45Pov <= 10 ? 'success' : ws45Pov <= 25 ? 'warning' : 'danger';
  const ws45Label = ws45Pov == null ? 'W—' : `W${ws45Pov}`;
  const ws45Title = ws45Concerns.length > 0 ? `45WS PoV ${ws45Pov == null ? 'TBD' : `${ws45Pov}%`}: ${ws45Concerns.join(', ')}` : undefined;
  const showWs45Badge =
    !isPast &&
    !dateOnly &&
    secondsUntilLaunch > 0 &&
    secondsUntilLaunch <= 7 * 24 * 60 * 60 &&
    (ws45Pov != null || ws45Concerns.length > 0);
  const showCryo = isLaunchDay && !isPast && !isScrubbed;
  const cryoStage: CryoStage = showCryo && !dateOnly && isLaunchWindow ? 'ignition' : 'venting';
  const cryoIntensity = getCryoIntensity({
    showCryo,
    dateOnly,
    secondsUntilLaunch,
    isHold
  });
  const frostCreep = Math.round(35 + cryoIntensity * 45);
  const launchTextStyle = useMemo(
    () =>
      computeLaunchTextStyle({
        showCryo,
        isPast,
        isScrubbed,
        cryoIntensity
      }),
    [showCryo, isPast, isScrubbed, cryoIntensity]
  );

  const cryoRef = useRef<HTMLDivElement | null>(null);
  const [cryoSize, setCryoSize] = useState({ width: 0, height: 0 });
  const [flashActive, setFlashActive] = useState(false);
  const ignitionRef = useRef(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setUserTz(tz);
  }, []);

  useEffect(() => {
    if (!showCryo) return;
    const element = cryoRef.current;
    if (!element) return;

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      setCryoSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
    };

    const rect = element.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [showCryo]);

  useEffect(() => {
    let timeout: number | undefined;
    if (!showCryo) {
      ignitionRef.current = false;
      setFlashActive(false);
      return;
    }
    if (cryoStage === 'ignition' && !ignitionRef.current) {
      ignitionRef.current = true;
      setFlashActive(true);
      timeout = window.setTimeout(() => setFlashActive(false), 140);
    }
    if (cryoStage !== 'ignition') {
      ignitionRef.current = false;
    }
    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [cryoStage, showCryo]);

  const smsComingSoon = SMS_NOTIFICATIONS_COMING_SOON || smsSystemEnabled === false;
  const canManageSms = isAuthed && isPaid && smsStatus?.enabled && smsStatus?.verified && !smsComingSoon;
  const canManagePush = isAuthed && isPaid && pushStatus?.enabled && pushStatus?.subscribed;
  const canManageAlerts = alertsChannel === 'sms' ? canManageSms : canManagePush;
  const normalizedSavedAlerts = useMemo(() => normalizeLaunchAlertPrefs(alertsSaved, userTz), [alertsSaved, userTz]);
  const normalizedDraftAlerts = useMemo(() => normalizeLaunchAlertPrefs(alertsDraft, userTz), [alertsDraft, userTz]);
  const hasUnsavedChanges = !launchAlertPrefsEqual(normalizedDraftAlerts, normalizedSavedAlerts);
  const canSaveDraftAlerts = canManageAlerts && !alertsSaving && hasUnsavedChanges;
  const hasConfiguredAlerts =
    (normalizedSavedAlerts.mode === 't_minus'
      ? normalizedSavedAlerts.t_minus_minutes.length > 0
      : normalizedSavedAlerts.local_times.length > 0) ||
    normalizedSavedAlerts.notify_status_change ||
    normalizedSavedAlerts.notify_net_change;
  const hasActiveAlerts = (alertsChannel === 'sms' ? !smsComingSoon : true) && hasConfiguredAlerts;

  const openAlerts = () => {
    setAlertsOpen(true);
    setAlertsError(null);
    setAlertsNotice(null);
    if (isAuthed && !(alertsChannel === 'sms' && smsComingSoon) && (!alertsLoaded || alertsLoadedChannel !== alertsChannel)) {
      void loadAlerts(alertsChannel);
    }
  };

  const closeAlerts = () => {
    setAlertsOpen(false);
    setAlertsError(null);
    setAlertsNotice(null);
    setAlertsDraft(alertsSaved);
  };

  async function loadAlerts(channel: 'sms' | 'push') {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const res = await fetch(`/api/me/notifications/launches/${launch.id}?channel=${encodeURIComponent(channel)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load alerts');
      const nextPrefs = normalizeLaunchAlertPrefs(json.preferences || DEFAULT_LAUNCH_ALERTS, userTz);
      setAlertsSaved(nextPrefs);
      setAlertsDraft(nextPrefs);
      setAlertsLoaded(true);
      setAlertsLoadedChannel(channel);

      if (channel === 'sms') {
        setSmsStatus({ enabled: !!json.sms?.enabled, verified: !!json.sms?.verified });
        setSmsSystemEnabled(typeof json.smsSystemEnabled === 'boolean' ? json.smsSystemEnabled : null);
      } else {
        setPushStatus({ enabled: !!json.push?.enabled, subscribed: !!json.push?.subscribed });
      }
    } catch (err: any) {
      setAlertsError(err.message || 'Failed to load alerts');
    } finally {
      setAlertsLoading(false);
    }
  }

  async function saveAlerts() {
    if (alertsChannel === 'sms' && smsComingSoon) {
      setAlertsError('SMS alerts are coming soon.');
      return;
    }

    const normalized = normalizeLaunchAlertPrefs(alertsDraft, userTz);
    const validationError = validateLaunchAlertPrefs(normalized, launch.net, launch.netPrecision, userTz);
    if (validationError) {
      setAlertsError(validationError);
      return;
    }

    setAlertsSaving(true);
    setAlertsError(null);
    setAlertsNotice(null);
    try {
      const res = await fetch(`/api/me/notifications/launches/${launch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: alertsChannel,
          ...normalized
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'subscription_required') throw new Error('Upgrade to Premium to enable alerts.');
        if (alertsChannel === 'sms') {
          if (json.error === 'sms_system_disabled') throw new Error('SMS alerts are coming soon.');
          if (json.error === 'sms_not_verified') throw new Error('Verify your phone in Preferences before enabling alerts.');
          if (json.error === 'sms_not_enabled') throw new Error('Enable SMS opt-in in Preferences first.');
        }
        if (alertsChannel === 'push') {
          if (json.error === 'push_not_enabled') throw new Error('Enable browser notifications in Preferences first.');
          if (json.error === 'push_not_subscribed') throw new Error('Subscribe a device in Preferences first.');
        }
        if (json.error === 'launch_not_available') throw new Error('This launch is no longer available for alerts.');
        if (res.status === 401) throw new Error('Sign in to manage alerts.');
        throw new Error(json.error || 'Failed to save alerts');
      }
      const nextPrefs = normalizeLaunchAlertPrefs(json.preferences || normalized, userTz);
      setAlertsSaved(nextPrefs);
      setAlertsDraft(nextPrefs);
      setAlertsNotice('Alerts saved.');
    } catch (err: any) {
      setAlertsError(err.message || 'Failed to save alerts');
    } finally {
      setAlertsSaving(false);
    }
  }

  return (
    <article
      className={clsx(
        'launch-card group w-full',
        variant === 'go' && 'launch-card--go',
        variant === 'alert' && 'launch-card--alert',
        variant === 'hold' && 'launch-card--hold',
        variant === 'past' && 'launch-card--past',
        variant === 'past' && pastOutcome === 'success' && 'launch-card--pastSuccess',
        variant === 'past' && pastOutcome === 'failure' && 'launch-card--pastFailure',
        variant === 'past' && pastOutcome === 'scrubbed' && 'launch-card--pastScrubbed',
        isScrubbed && 'launch-card--scrubbed',
        isArtemis && 'launch-card--artemis',
        isStarship && 'launch-card--starship'
      )}
      style={launchTextStyle}
    >
      <div className="launch-card__spine" aria-hidden="true">
        <div className="launch-card__spineTrack" />
        {variant === 'past' ? (
          <div
            className="launch-card__spineSolid"
            data-tone={pastOutcome ?? 'unknown'}
          />
        ) : (
          <div
            className={clsx('launch-card__spineFill', launch.webcastLive && !dateOnly && 'launch-card__spineFill--live')}
            style={{ height: `${timelineFillPct}%` }}
          />
        )}
      </div>

      <div className="launch-card__bg" aria-hidden="true">
        <div className="launch-card__bgImage">
          <Image
            src={launch.image.thumbnail}
            alt=""
            fill
            className="object-cover"
            unoptimized
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          {isScrubbed && <div className="launch-card__bgCaution" />}
        </div>
      </div>

      {showCryo && (
        <div
          ref={cryoRef}
          className="cryo-layer"
          style={{ '--frost-creep': `${frostCreep}%` } as CSSProperties}
          aria-hidden="true"
        >
          <CryoAtmosphere stage={cryoStage} intensity={cryoIntensity} width={cryoSize.width} height={cryoSize.height} />
          <div className={clsx('cryo-frost', cryoStage === 'ignition' && 'cryo-frost--melt')} />
          <div className={clsx('cryo-flash', flashActive && 'cryo-flash--active')} />
        </div>
      )}

      <div className="launch-card__content relative flex flex-col gap-4 p-4 pl-5">
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {hasProviderLogo ? (
                  providerCatalogHref ? (
                    <Link
                      href={providerCatalogHref}
                      aria-label={`${launch.provider} profile`}
                      title={`${launch.provider} profile`}
                    >
                      <ProviderLogo
                        provider={launch.provider}
                        logoUrl={providerLogoUrl}
                        variant="wordmark"
                        className="h-14 w-[min(200px,55vw)]"
                      />
                    </Link>
                  ) : providerHref ? (
                    <Link href={providerHref} aria-label={`${launch.provider} news`} title={`${launch.provider} news`}>
                      <ProviderLogo
                        provider={launch.provider}
                        logoUrl={providerLogoUrl}
                        variant="wordmark"
                        className="h-14 w-[min(200px,55vw)]"
                      />
                    </Link>
                  ) : (
                    <ProviderLogo
                      provider={launch.provider}
                      logoUrl={providerLogoUrl}
                      variant="wordmark"
                      className="h-14 w-[min(200px,55vw)]"
                    />
                  )
                ) : (
                  providerCatalogHref ? (
                    <Link
                      href={providerCatalogHref}
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text2 transition hover:border-primary hover:text-text1"
                      aria-label={`${launch.provider} profile`}
                      title={`${launch.provider} profile`}
                    >
                      {providerLabel}
                    </Link>
                  ) : providerHref ? (
                    <Link
                      href={providerHref}
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text2 transition hover:border-primary hover:text-text1"
                      aria-label={`${launch.provider} news`}
                      title={`${launch.provider} news`}
                    >
                      {providerLabel}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text2">
                      {providerLabel}
                    </span>
                  )
                )}
                {!isPast &&
                  (onToggleFollowProvider ? (
                    <button
                      type="button"
                      className={clsx(
                        'btn-secondary flex h-10 items-center rounded-lg border border-white/10 bg-white/5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-text1',
                        isProviderFollowed ? 'w-10 justify-center px-0' : 'gap-2 px-3',
                        isProviderFollowed && 'border-primary text-primary',
                        providerFollowDisabled && 'pointer-events-none opacity-60'
                      )}
                      onClick={() => onToggleFollowProvider(launch.provider)}
                      aria-pressed={isProviderFollowed}
                      aria-label={isProviderFollowed ? `Unfollow ${providerFollowTarget}` : providerFollowLabel}
                      title={isProviderFollowed ? `Unfollow ${providerFollowTarget}` : providerFollowLabel}
                      disabled={providerFollowDisabled}
                    >
                      <StarIcon className="h-4 w-4" filled={isProviderFollowed} />
                      {!isProviderFollowed && <span>{providerFollowLabel}</span>}
                    </button>
                  ) : canUpsell ? (
                    <button
                      type="button"
                      className="btn-secondary relative flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-text1"
                      onClick={() => onOpenUpsell?.('My Launches')}
                      aria-label={`Upgrade to Premium to ${providerFollowLabel.toLowerCase()}`}
                      title={`${providerFollowLabel} (Premium)`}
                    >
                      <StarIcon className="h-4 w-4" />
                      <span>{providerFollowLabel}</span>
                      <CornerLockBadge />
                    </button>
                  ) : null)}
              </div>
              {launch.featured && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-text2">
                  FEATURED
                </span>
              )}
            </div>
            <h3 className="mt-2 min-w-0 font-mono text-lg uppercase tracking-wide text-text1 md:text-xl">
              <Link href={launchHref} className="hover:text-primary">
                {launch.name}
              </Link>
            </h3>
            <div className="mt-1 space-y-1">
              {showVehicle && launch.vehicle && (
                <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wider text-text3">
                  <Link href={rocketHref} className="transition hover:text-primary">
                    {launch.rocket?.fullName || launch.vehicle}
                  </Link>
                </div>
              )}
              {firstStageBooster && (
                <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wider text-text3">
                  <span className="text-text4">First-Stage Booster:</span>
                  <span className="text-text2">{firstStageBooster}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wider text-text3">
                <Link href={padCatalogHref} className="transition hover:text-primary">
                  {locationDisplay || padDisplay || 'Pad'}
                </Link>
                {padFollowValue &&
                  !isPast &&
                  (onToggleFollowPad ? (
                    <button
                      type="button"
                      className={clsx(
                        'btn-secondary inline-flex h-7 items-center rounded-md border border-white/10 bg-white/5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text3 transition hover:border-primary hover:text-text1',
                        isPadFollowed ? 'w-7 justify-center px-0' : 'gap-1.5 px-2.5',
                        isPadFollowed && 'border-primary text-primary',
                        padFollowDisabled && 'pointer-events-none opacity-60'
                      )}
                      onClick={() => onToggleFollowPad(padFollowValue)}
                      aria-pressed={isPadFollowed}
                      aria-label={isPadFollowed ? `Unfollow ${padFollowTarget}` : padFollowLabel}
                      title={isPadFollowed ? `Unfollow ${padFollowTarget}` : padFollowLabel}
                      disabled={padFollowDisabled}
                    >
                      <StarIcon className="h-4 w-4" filled={isPadFollowed} />
                      {!isPadFollowed && <span>{padFollowLabel}</span>}
                    </button>
                  ) : canUpsell ? (
                    <button
                      type="button"
                      className="btn-secondary relative inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text3 transition hover:border-primary hover:text-text1"
                      onClick={() => onOpenUpsell?.('My Launches')}
                      aria-label={`Upgrade to Premium to ${padFollowLabel.toLowerCase()}`}
                      title={`${padFollowLabel} (Premium)`}
                    >
                      <StarIcon className="h-4 w-4" />
                      <span>{padFollowLabel}</span>
                      <CornerLockBadge size="sm" />
                    </button>
                  ) : null)}
                {!locationDisplay && launch.pad.state && launch.pad.state !== 'NA' && (
                  <span className="text-text4">• {launch.pad.state}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-start justify-between gap-2 md:w-auto md:shrink-0 md:flex-col md:items-end md:gap-1">
            {variant === 'past' ? (
              <ResultStamp tone={statusTone} label={statusLabel} />
            ) : (
              <StatusBeacon tone={statusTone} label={statusLabel} ping={!dateOnly && statusTone !== 'neutral'} />
            )}
            {isLaunchedTagWindow && (
              <span className="mt-0.5">
                <Badge tone="danger" subtle>
                  Launched
                </Badge>
              </span>
            )}
            {milestoneBadge && (
              <div
                className="max-w-full break-words text-[9px] uppercase tracking-[0.12em] text-text3 md:max-w-[220px] md:truncate md:text-right"
                title={`${milestoneBadge.label}: ${milestoneBadge.milestone.relativeLabel ? `${milestoneBadge.milestone.relativeLabel} ` : ''}${milestoneBadge.milestone.label}`}
              >
                {milestoneBadge.label} • {milestoneBadge.milestone.relativeLabel ? `${milestoneBadge.milestone.relativeLabel} ` : ''}
                {milestoneBadge.milestone.label}
              </div>
            )}
            {showWeatherIcon && launch.weatherIconUrl && (
              <div
                className="mt-1 flex h-10 w-10 items-center justify-center rounded-full border border-stroke bg-[rgba(0,0,0,0.18)]"
              >
                <WeatherIcon
                  nwsIconUrl={launch.weatherIconUrl}
                  className="h-7 w-7"
                  ariaLabel="Weather forecast"
                />
              </div>
            )}
            {showWs45Badge && isPaid && (
              <span className="mt-1" title={ws45Title}>
                <Badge tone={ws45Tone} subtle>
                  {ws45Label}
                </Badge>
              </span>
            )}
          </div>
        </header>

        <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            {!isPast && (
              <TimeDisplay net={launch.net} netPrecision={launch.netPrecision} />
            )}
            {launch.changeSummary && (
              <div className="mt-2 text-xs text-text3">Update: {launch.changeSummary}</div>
            )}
            {activeEvent && !isPast && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text3">
                <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text3">
                  {activeEventTag}
                </span>
                <span className="text-text2">{activeEvent.name}</span>
                {activeEventLabel && <span>• {activeEventLabel}</span>}
              </div>
            )}
            {isPast && (
              <div className="space-y-1">
                <div className="font-mono text-3xl font-light uppercase tracking-wide text-text1 md:text-4xl">
                  {formatMissionLogDate(launch.net, userTz)}
                </div>
                <div className="text-sm text-text2">
                  {pastOutcome === 'success'
                    ? orbitLabel === 'TBD'
                      ? 'Payload deployed'
                      : `Orbit: ${orbitLabel}`
                    : pastOutcome === 'failure'
                      ? launch.statusText
                      : pastOutcome === 'scrubbed'
                        ? 'No launch attempt'
                        : launch.statusText}
                </div>
              </div>
            )}
          </div>

          {!isPast && (
            <div className="flex items-end justify-end">
              {dateOnly ? (
                <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-text2">Time TBD</span>
              ) : isLaunchWindow ? (
                <div
                  className={clsx(
                    'launch-card__countdownNow font-mono text-4xl font-semibold text-text1 md:text-5xl',
                    countdownGlow && 'launch-card__countdown--lit'
                  )}
                  style={countdownGlow?.style}
                >
                  <span className="launch-card__nowText">NOW</span>
                  <div className="launch-card__afterburner" aria-hidden="true">
                    <span className="launch-card__afterburnerJet" />
                    <span className="launch-card__afterburnerJet" />
                    <span className="launch-card__afterburnerJet" />
                  </div>
                </div>
              ) : isMilestoneSequence ? (
                <div className="launch-card__countdown font-mono text-4xl font-light tabular-nums text-text1 md:text-5xl">
                  {formatTimelineOffset('T+', nowMs - netMs)}
                </div>
              ) : (
                <div
                  className={clsx(
                    'launch-card__countdown font-mono text-4xl font-light tabular-nums text-text1 md:text-5xl',
                    countdownGlow && 'launch-card__countdown--lit',
                    countdownGlow?.ignite && 'launch-card__countdown--ignite'
                  )}
                  style={countdownGlow?.style}
                >
                  {formatTMinus(countdown.diffSeconds)}
                </div>
              )}
            </div>
          )}
        </section>

        {(showPrelaunchGoal || isMilestoneSequence) && (
          <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
            {showPrelaunchGoal && firstPrelaunchMilestone ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">First goal</div>
                  <div className="text-sm font-semibold text-text1">{firstPrelaunchMilestone.label}</div>
                  <div className="text-[11px] text-text3">
                    Planned goal{firstPrelaunchMilestone.relativeLabel ? ` at ${firstPrelaunchMilestone.relativeLabel}` : ''} in the countdown.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">
                    Planned
                  </span>
                  {firstPrelaunchMilestone.relativeLabel && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {firstPrelaunchMilestone.relativeLabel}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">Milestone sequence</div>
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                    Live
                  </span>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {milestoneSequence.map((milestone) => {
                    const isActive = nextMilestone?.id === milestone.id;
                    const isElapsed = milestone.absoluteMs != null && milestone.absoluteMs < nowMs;
                    return (
                      <div
                        key={milestone.id}
                        className={clsx(
                          'min-w-[140px] rounded-lg border px-2.5 py-2',
                          isActive
                            ? 'border-primary/60 bg-primary/10 shadow-glow'
                            : 'border-white/10 bg-white/[0.02]',
                          isElapsed && !isActive && 'opacity-70'
                        )}
                        title={`${milestone.relativeLabel ? `${milestone.relativeLabel} ` : ''}${milestone.label}`}
                      >
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text3">
                          <span className={clsx('font-mono', isActive ? 'text-primary' : 'text-text2')}>
                            {milestone.relativeLabel || 'T+'}
                          </span>
                          {isActive && <span className="text-primary">Target</span>}
                        </div>
                        <div className={clsx('mt-1 text-xs font-semibold', isElapsed && !isActive ? 'text-text3' : 'text-text1')}>
                          {milestone.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <a
              href={launch.videoUrl || undefined}
              target={launch.videoUrl ? '_blank' : undefined}
              rel={launch.videoUrl ? 'noreferrer' : undefined}
              className={clsx('btn h-10 rounded-lg px-4 py-2 text-sm', !launch.videoUrl && 'pointer-events-none opacity-50')}
              aria-disabled={!launch.videoUrl}
              tabIndex={launch.videoUrl ? undefined : -1}
            >
              {isPast ? 'Replay' : launch.webcastLive ? 'Watch Live' : 'Watch'}
            </a>
            <Link
              href={launchHref}
              className="btn-secondary flex h-10 items-center justify-center rounded-lg border border-stroke px-3 py-2 text-sm text-text2 hover:border-primary"
            >
              {isPast ? 'Report' : 'Details'}
            </Link>
            {isArEligible &&
              !isPast &&
              (isPaid ? (
                <CameraGuideButton
                  href={arHref}
                  launchId={launch.id}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary transition hover:border-primary"
                >
                  AR trajectory
                </CameraGuideButton>
              ) : canUpsell ? (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary transition hover:border-primary"
                  onClick={() => onOpenUpsell?.('AR trajectory')}
                  aria-label="Upgrade to Premium to unlock AR trajectory"
                  title="AR trajectory (Premium)"
                >
                  <span>AR trajectory</span>
                  <LockIcon className="h-3.5 w-3.5 opacity-80" />
                </button>
              ) : null)}
          </div>

          <div className="flex items-center gap-2">
            {!isPast &&
              (onToggleWatch ? (
                <button
                  type="button"
                  className={clsx(
                    'btn-secondary relative flex h-11 items-center gap-2 rounded-lg border border-stroke px-3 text-text2 hover:border-primary',
                    isWatched && 'border-primary text-primary',
                    watchDisabled && 'pointer-events-none opacity-60'
                  )}
                  onClick={() => onToggleWatch(launch.id)}
                  aria-pressed={isWatched}
                  aria-label={isWatched ? 'Remove from My Launches' : 'Add to My Launches'}
                >
                  <StarIcon className="h-4 w-4" filled={isWatched} />
                  <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] sm:inline">
                    {isWatched ? 'In My Launches' : 'My Launches'}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] sm:hidden">
                    {isWatched ? 'Saved' : 'Save'}
                  </span>
                </button>
              ) : canUpsell ? (
                <button
                  type="button"
                  className="btn-secondary relative flex h-11 items-center gap-2 rounded-lg border border-stroke px-3 text-text2 hover:border-primary"
                  onClick={() => onOpenUpsell?.('My Launches')}
                  aria-label="Upgrade to Premium to unlock My Launches"
                  title="My Launches (Premium)"
                >
                  <StarIcon className="h-4 w-4" />
                  <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] sm:inline">My Launches</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] sm:hidden">Save</span>
                  <CornerLockBadge />
                </button>
              ) : null)}
            <button
              type="button"
              className={clsx(
                'btn-secondary relative flex h-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary',
                alertsNudgeLatched ? 'gap-2 px-3' : 'w-11',
                hasActiveAlerts && 'border-primary text-primary'
              )}
              onClick={() => {
                if (!isPaid && canUpsell) {
                  if (showAlertsNudge) onAlertsNudgeClick?.();
                  onOpenUpsell?.('alerts (email + browser notifications)');
                  return;
                }
                if (alertsOpen) {
                  closeAlerts();
                  return;
                }
                if (showAlertsNudge) onAlertsNudgeClick?.();
                openAlerts();
              }}
              aria-expanded={alertsOpen}
              aria-label="Launch alerts"
              title={alertsNudgeLatched ? 'Get notified when things change' : undefined}
            >
              <BellIcon className="h-4 w-4" />
              {alertsNudgeLatched && <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Alerts</span>}
              {hasActiveAlerts && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary shadow-glow" />}
              {!isPaid && canUpsell && <CornerLockBadge />}
            </button>
            <ShareButton url={share.path} title={share.title} text={share.text} variant="icon" />
            {!isPast && <AddToCalendarButton launch={launch} variant="icon" requiresPremium isPremium={isPaid} isAuthed={isAuthed} />}
          </div>
        </div>

        {alertsOpen && (
          <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.03)] p-3 text-sm text-text2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.12em] text-text3">Launch alerts</div>
                <div className="text-sm text-text2">
                  {alertsChannel === 'push' ? 'Browser notifications (web push).' : smsComingSoon ? 'SMS alerts (coming soon).' : 'SMS alerts.'}
                </div>
              </div>
              <button type="button" className="text-xs text-text3 hover:text-text1" onClick={closeAlerts}>
                Exit
              </button>
            </div>

            {alertsError && <div className="mt-2 rounded-lg border border-danger bg-[rgba(251,113,133,0.08)] p-2 text-xs text-danger">{alertsError}</div>}
            {alertsNotice && <div className="mt-2 rounded-lg border border-stroke bg-[rgba(234,240,255,0.04)] p-2 text-xs text-text2">{alertsNotice}</div>}

            {alertsLoading && <div className="mt-3 text-xs text-text3">Loading alert settings…</div>}

            {!alertsLoading && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <AlertModeButton
                  label="Browser notifications"
                  helper="Web push (Premium)"
                  active={alertsChannel === 'push'}
                  onClick={() => {
                    if (alertsChannel === 'push') return;
                    setAlertsChannel('push');
                    setAlertsLoaded(false);
                    setAlertsLoadedChannel(null);
                    setAlertsSaved(DEFAULT_LAUNCH_ALERTS);
                    setAlertsDraft(DEFAULT_LAUNCH_ALERTS);
                    setAlertsError(null);
                    setAlertsNotice(null);
                    if (isAuthed) void loadAlerts('push');
                  }}
                />
                <AlertModeButton
                  label="SMS"
                  helper={smsComingSoon ? 'Coming soon' : 'Text messages (Premium)'}
                  active={alertsChannel === 'sms'}
                  disabled={smsComingSoon}
                  onClick={() => {
                    if (smsComingSoon) return;
                    if (alertsChannel === 'sms') return;
                    setAlertsChannel('sms');
                    setAlertsLoaded(false);
                    setAlertsLoadedChannel(null);
                    setAlertsSaved(DEFAULT_LAUNCH_ALERTS);
                    setAlertsDraft(DEFAULT_LAUNCH_ALERTS);
                    setAlertsError(null);
                    setAlertsNotice(null);
                    if (isAuthed) void loadAlerts('sms');
                  }}
                />
              </div>
            )}

            {!alertsLoading && !isAuthed && (
              <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
                Sign in to enable launch alerts.{' '}
                <Link className="text-primary" href="/auth/sign-in">
                  Sign in
                </Link>
              </div>
            )}

            {!alertsLoading && isAuthed && !isPaid && (
              <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
                Launch alerts are a Premium feature.{' '}
                <Link className="text-primary" href="/upgrade">
                  Upgrade
                </Link>{' '}
                to enable alerts.
              </div>
            )}

            {!alertsLoading && alertsChannel === 'sms' && smsComingSoon && (
              <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                SMS alerts are temporarily unavailable while we finish delivery setup.
              </div>
            )}

            {!alertsLoading && alertsChannel === 'sms' && !smsComingSoon && isAuthed && isPaid && smsStatus && (!smsStatus.verified || !smsStatus.enabled) && (
              <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
                {smsStatus.verified ? 'Enable SMS opt-in in Preferences to use alerts.' : 'Verify your phone in Preferences to enable alerts.'}{' '}
                <Link className="text-primary" href="/me/preferences">
                  Open Preferences
                </Link>
              </div>
            )}

            {!alertsLoading && alertsChannel === 'push' && isAuthed && isPaid && pushStatus && (!pushStatus.enabled || !pushStatus.subscribed) && (
              <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
                {pushStatus.enabled
                  ? 'Subscribe a device in Preferences to enable alerts.'
                  : 'Enable browser notifications in Preferences to enable alerts.'}{' '}
                <Link className="text-primary" href="/me/preferences">
                  Open Preferences
                </Link>
              </div>
            )}

            {!alertsLoading && canManageAlerts && (
              <>
                <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-text3">Launch time</div>
                  <div className="mt-1 text-sm font-semibold text-text1">{formatLaunchDateTime(launch.net, launch.netPrecision, userTz)}</div>
                  {launch.changeSummary && <div className="mt-1 text-xs text-text3">Update: {launch.changeSummary}</div>}
                </div>

                <div className="mt-3 space-y-3">
                  <div className="text-xs font-semibold text-text1">Schedule up to 2 alerts</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <AlertModeButton
                      label="T-minus"
                      helper="T-X before launch"
                      active={normalizedDraftAlerts.mode === 't_minus'}
                      onClick={() =>
                        setAlertsDraft((prev) => ({
                          ...prev,
                          mode: 't_minus'
                        }))
                      }
                    />
                    <AlertModeButton
                      label="Launch day (local time)"
                      helper={`Up to 2 times (${userTz})`}
                      active={normalizedDraftAlerts.mode === 'local_time'}
                      onClick={() =>
                        setAlertsDraft((prev) => ({
                          ...prev,
                          mode: 'local_time',
                          timezone: userTz || prev.timezone
                        }))
                      }
                    />
                  </div>

                  {normalizedDraftAlerts.mode === 't_minus' ? (
                    <TMinusPicker
                      netIso={launch.net}
                      netPrecision={launch.netPrecision}
                      userTz={userTz}
                      value={normalizedDraftAlerts.t_minus_minutes}
                      onChange={(next) =>
                        setAlertsDraft((prev) => ({
                          ...prev,
                          mode: 't_minus',
                          t_minus_minutes: next,
                          local_times: []
                        }))
                      }
                    />
                  ) : (
                    <LocalTimePicker
                      netIso={launch.net}
                      netPrecision={launch.netPrecision}
                      userTz={userTz}
                      value={normalizedDraftAlerts.local_times}
                      onChange={(next) =>
                        setAlertsDraft((prev) => ({
                          ...prev,
                          mode: 'local_time',
                          timezone: userTz || prev.timezone,
                          local_times: next,
                          t_minus_minutes: []
                        }))
                      }
                    />
                  )}

                  <div className="pt-2">
                    <div className="text-xs font-semibold text-text1">Also alert me on changes</div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <AlertToggle
                        label="Status change"
                        helper="Go/hold/scrub updates"
                        checked={normalizedDraftAlerts.notify_status_change}
                        onChange={(next) => setAlertsDraft((prev) => ({ ...prev, notify_status_change: next }))}
                      />
                      <AlertToggle
                        label="Timing change"
                        helper="NET or window shifts"
                        checked={normalizedDraftAlerts.notify_net_change}
                        onChange={(next) => setAlertsDraft((prev) => ({ ...prev, notify_net_change: next }))}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" className="btn-secondary w-full rounded-lg px-3 py-2 text-xs sm:w-auto" onClick={closeAlerts}>
                Exit
              </button>
              <button
                type="button"
                className="btn w-full rounded-lg px-3 py-2 text-xs sm:w-auto"
                onClick={saveAlerts}
                disabled={!canSaveDraftAlerts}
              >
                {alertsSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <footer className="mt-2 grid gap-3 border-t border-white/5 pt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center">
          <DataCell icon={<OrbitIcon className="h-4 w-4" />} label="Orbit" value={orbitLabel} tone="neutral" />
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text3">NET WINDOW</span>
              <span
                className={clsx(
                  'rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]',
                  windowStatusClass
                )}
              >
                {windowStatusLabel}
              </span>
            </div>
            <div className="launch-card__windowTrack" style={windowTrackStyle} aria-hidden="true" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">NET START</div>
                <div className="font-mono text-sm font-semibold text-text1">{windowStartLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">NET END</div>
                <div className={clsx('font-mono text-sm font-semibold', windowEndValueClass)}>{windowEndLabel}</div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </article>
  );
}

function formatTMinus(diffSeconds: number) {
  const seconds = Math.max(0, Math.floor(diffSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const core = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return days > 0 ? `T-${days}d ${core}` : `T-${core}`;
}

type LaunchMilestone = {
  id: string;
  label: string;
  relativeLabel?: string;
  offsetMs: number | null;
  absoluteMs: number | null;
};

function buildLaunchMilestones(launch: Launch): LaunchMilestone[] {
  const raw = Array.isArray(launch.timeline) ? launch.timeline : [];
  if (!raw.length) return [];

  const netMs = Date.parse(launch.net);
  const events = raw
    .map((event, index) => {
      const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
      const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
      const absoluteMs = Number.isFinite(netMs) && offsetMs != null ? netMs + offsetMs : null;
      const label = event?.type?.abbrev || event?.type?.description || 'Milestone';
      const relativeLabel = relative ? formatTimelineOffset(relative, offsetMs) : undefined;

      return {
        id: `${event?.type?.id ?? 'evt'}-${relative ?? index}`,
        label,
        relativeLabel,
        offsetMs,
        absoluteMs
      };
    })
    .filter((event) => event.label);

  events.sort((a, b) => {
    if (a.offsetMs == null && b.offsetMs == null) return 0;
    if (a.offsetMs == null) return 1;
    if (b.offsetMs == null) return -1;
    return a.offsetMs - b.offsetMs;
  });

  return events;
}

function pickFirstPrelaunchMilestone(milestones: LaunchMilestone[]): LaunchMilestone | null {
  let best: LaunchMilestone | null = null;
  let bestOffset = Number.POSITIVE_INFINITY;

  milestones.forEach((milestone) => {
    if (milestone.offsetMs == null || milestone.offsetMs >= 0) return;
    if (milestone.offsetMs < bestOffset) {
      bestOffset = milestone.offsetMs;
      best = milestone;
    }
  });

  return best;
}

function formatEventDate(value?: string | null, precision?: string | null, timeZone = 'UTC') {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const showTime = precision === 'minute' || precision === 'hour';
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(showTime ? { timeStyle: 'short' } : {}),
    timeZone
  }).format(date);
  return formatted;
}

function parseIsoMs(value?: string | null) {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function formatWindowLabel(value: string | null | undefined, tz: string, dateOnly: boolean) {
  if (!value) return 'TBD';
  const parsed = parseIsoMs(value);
  if (!Number.isFinite(parsed)) return 'TBD';
  return dateOnly ? formatDateOnly(value, tz) : formatNetLabel(value, tz);
}

function formatTimelineOffset(value: string, offsetMs: number | null): string {
  if (offsetMs == null) return value;
  const sign = offsetMs < 0 ? '-' : '+';
  const absMs = Math.abs(offsetMs);
  const totalSeconds = Math.round(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `T${sign}${clock}`;
}

function formatMissionLogDate(netIso: string, timeZone?: string) {
  try {
    const date = new Date(netIso);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit', year: 'numeric' };
    if (timeZone) options.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat('en-US', options)
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {});
    return `${(parts.month || '').toUpperCase()} ${parts.day || ''} • ${parts.year || ''}`;
  } catch {
    return netIso;
  }
}

function isSameDayInTimeZone(aMs: number, bMs: number, timeZone?: string) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const aKey = formatDateKey(aMs, timeZone);
  const bKey = formatDateKey(bMs, timeZone);
  return Boolean(aKey && bKey && aKey === bKey);
}

function formatDateKey(ms: number, timeZone?: string) {
  try {
    const date = new Date(ms);
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (timeZone) options.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat('en-US', options)
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
    if (!parts.year || !parts.month || !parts.day) return null;
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return null;
  }
}

function getCryoIntensity({
  showCryo,
  dateOnly,
  secondsUntilLaunch,
  isHold
}: {
  showCryo: boolean;
  dateOnly: boolean;
  secondsUntilLaunch: number;
  isHold: boolean;
}) {
  if (!showCryo) return 0;
  if (dateOnly) return 0.35;
  if (!Number.isFinite(secondsUntilLaunch)) return 0;
  const rampWindow = 6 * 60 * 60;
  const base = 0.18;
  const progress = clampNumber(1 - secondsUntilLaunch / rampWindow, 0, 1);
  const intensity = base + (1 - base) * progress;
  return clampNumber(intensity * (isHold ? 0.65 : 1), 0, 1);
}

function normalizeKey(value?: string | null) {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

type Rgb = { r: number; g: number; b: number };

function computeCountdownGlow(diffSeconds: number): { style: CSSProperties; ignite: boolean } | null {
  const t = Math.max(0, diffSeconds);
  const windowSeconds = 24 * 60 * 60;
  if (t > windowSeconds) return null;

  const progress = 1 - t / windowSeconds; // 0..1
  const intensity = Math.pow(progress, 1.35);
  const { a, b } = sampleCountdownPalette(progress);
  const rim = mixRgb(a, b, 0.52);

  const opacity = clampNumber(0.08 + intensity * 0.78, 0.08, 0.9);
  const opacityHi = clampNumber(opacity + 0.12, 0.12, 0.98);
  const blurPx = 14 + intensity * 26;
  const spreadPx = 14 + intensity * 24;

  const ignite = t <= 120;

  return {
    ignite,
    style: {
      ['--cd-glow-a' as any]: rgba(a, 0.55),
      ['--cd-glow-b' as any]: rgba(b, 0.44),
      ['--cd-glow-c' as any]: rgba(rim, 0.34),
      ['--cd-opacity' as any]: opacity.toFixed(3),
      ['--cd-opacity-hi' as any]: opacityHi.toFixed(3),
      ['--cd-blur' as any]: `${blurPx.toFixed(1)}px`,
      ['--cd-spread' as any]: `${spreadPx.toFixed(1)}px`
    }
  };
}

function computeLaunchTextStyle({
  showCryo,
  isPast,
  isScrubbed,
  cryoIntensity
}: {
  showCryo: boolean;
  isPast: boolean;
  isScrubbed: boolean;
  cryoIntensity: number;
}): CSSProperties {
  const style: CSSProperties & Record<string, string> = {
    '--launch-text-saturation': '1',
    '--launch-text-brightness': '1',
    '--launch-text-shadow': '0 0 0 rgba(0, 0, 0, 0)'
  };

  if (!showCryo || isPast || isScrubbed) return style;

  const boost = clampNumber(cryoIntensity, 0, 1);
  if (boost <= 0) return style;

  const eased = Math.pow(boost, 1.2);
  const { a, b } = sampleCountdownPalette(eased);
  const accent = mixRgb(a, b, 0.56);

  const saturation = 1 + eased * 0.9;
  const brightness = 1 + eased * 0.32;
  const innerGlow = rgba(accent, 0.18 + eased * 0.34);
  const outerGlow = rgba(accent, 0.06 + eased * 0.22);
  const innerSize = Math.round(6 + eased * 12);
  const outerSize = Math.round(16 + eased * 24);

  style['--launch-text-saturation'] = saturation.toFixed(3);
  style['--launch-text-brightness'] = brightness.toFixed(3);
  style['--launch-text-shadow'] = `0 0 ${innerSize}px ${innerGlow}, 0 0 ${outerSize}px ${outerGlow}`;
  return style;
}

function sampleCountdownPalette(t: number): { a: Rgb; b: Rgb } {
  const stops = [
    { t: 0.0, a: '#38BDF8', b: '#1D4ED8' }, // Cryo Blue
    { t: 0.12, a: '#2DD4BF', b: '#2563EB' },
    { t: 0.24, a: '#22D3EE', b: '#3B82F6' },
    { t: 0.36, a: '#60A5FA', b: '#6366F1' },
    { t: 0.48, a: '#7C5CFF', b: '#8B5CF6' }, // Ion Violet
    { t: 0.6, a: '#A855F7', b: '#D946EF' },
    { t: 0.7, a: '#E879F9', b: '#FF4DDB' },
    { t: 0.78, a: '#F472B6', b: '#FBBF24' },
    { t: 0.86, a: '#FBBF24', b: '#FB923C' }, // Ember Gold
    { t: 0.92, a: '#FB923C', b: '#F97316' },
    { t: 0.97, a: '#F97316', b: '#EF4444' },
    { t: 1.0, a: '#EF4444', b: '#DC2626' } // Plasma Red
  ] as const;

  const x = clampNumber(t, 0, 1);
  const hi = stops.findIndex((s) => x <= s.t);
  if (hi <= 0) return { a: hexToRgb(stops[0].a), b: hexToRgb(stops[0].b) };
  if (hi === -1) return { a: hexToRgb(stops[stops.length - 1].a), b: hexToRgb(stops[stops.length - 1].b) };

  const lo = hi - 1;
  const s0 = stops[lo];
  const s1 = stops[hi];
  const localT = (x - s0.t) / Math.max(1e-6, s1.t - s0.t);
  return {
    a: mixRgb(hexToRgb(s0.a), hexToRgb(s1.a), localT),
    b: mixRgb(hexToRgb(s0.b), hexToRgb(s1.b), localT)
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace('#', '').trim();
  const expanded =
    normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
  const int = Number.parseInt(expanded, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const x = clampNumber(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * x),
    g: Math.round(a.g + (b.g - a.g) * x),
    b: Math.round(a.b + (b.b - a.b) * x)
  };
}

function rgba(color: Rgb, alpha: number) {
  const a = clampNumber(alpha, 0, 1);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
}

function StatusBeacon({ tone, label, ping }: { tone: 'success' | 'danger' | 'neutral' | 'warning'; label: string; ping: boolean }) {
  const dotClass =
    tone === 'success' ? 'bg-success' : tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-text3';
  const textClass =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text3';

  return (
    <div className={clsx('flex shrink-0 items-center gap-2', textClass)}>
      <span className="relative flex h-2 w-2">
        {ping && (
          <span className={clsx('absolute inline-flex h-full w-full rounded-full opacity-60', dotClass, 'animate-ping')} />
        )}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', dotClass)} />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
  );
}

function ResultStamp({ tone, label }: { tone: 'success' | 'danger' | 'neutral' | 'warning'; label: string }) {
  const toneClasses =
    tone === 'success'
      ? 'border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.08)] text-success'
      : tone === 'danger'
        ? 'border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.08)] text-danger'
        : 'border-white/10 bg-white/5 text-text2';

  return (
    <div className={clsx('inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1', toneClasses)}>
      {tone === 'success' ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : tone === 'danger' ? (
        <AlertIcon className="h-3.5 w-3.5" />
      ) : (
        <SlashIcon className="h-3.5 w-3.5" />
      )}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
  );
}

const T_MINUS_OPTIONS: ReadonlyArray<number> = [5, 10, 15, 20, 30, 45, 60, 120];

function AlertModeButton({
  label,
  helper,
  active,
  disabled,
  onClick
}: {
  label: string;
  helper: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'rounded-lg border px-3 py-2 text-left transition',
        active ? 'border-primary/70 bg-[rgba(34,211,238,0.08)]' : 'border-stroke bg-surface-0 hover:border-primary/50',
        disabled && 'cursor-not-allowed opacity-60 hover:border-stroke'
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text1">{label}</div>
      <div className="mt-1 text-[11px] text-text3">{helper}</div>
    </button>
  );
}

function AlertToggle({
  label,
  helper,
  checked,
  disabled,
  onChange
}: {
  label: string;
  helper: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const labelId = useId();
  const helperId = useId();
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2',
        disabled && 'opacity-60'
      )}
    >
      <div>
        <div id={labelId} className="text-xs font-semibold uppercase tracking-[0.08em] text-text1">
          {label}
        </div>
        <div id={helperId} className="text-[11px] text-text3">
          {helper}
        </div>
      </div>
      <button
        type="button"
        className={clsx(
          'flex h-5 w-9 items-center rounded-full border px-0.5 transition',
          checked ? 'border-primary bg-[rgba(34,211,238,0.2)] justify-end' : 'border-stroke bg-surface-0 justify-start',
          disabled ? 'cursor-not-allowed' : ''
        )}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={helperId}
        aria-disabled={disabled}
      >
        <span className="h-4 w-4 rounded-full bg-white" />
      </button>
    </div>
  );
}

function TMinusPicker({
  netIso,
  netPrecision,
  userTz,
  value,
  onChange
}: {
  netIso: string;
  netPrecision: Launch['netPrecision'];
  userTz: string;
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const isDateOnly = isDateOnlyNet(netIso, netPrecision, userTz);
  const net = new Date(netIso);
  const netMs = net.getTime();

  const selected = Array.from(new Set(value)).filter((v) => T_MINUS_OPTIONS.includes(v)).sort((a, b) => a - b).slice(0, 2);
  const canAdd = selected.length < 2;

  const add = () => {
    const nextValue = T_MINUS_OPTIONS.find((opt) => !selected.includes(opt));
    if (!nextValue) return;
    onChange([...selected, nextValue].sort((a, b) => a - b));
  };

  return (
    <div className="space-y-2">
      {isDateOnly && (
        <div className="rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text3">
          Launch time is TBD; T-minus alerts will be scheduled once an exact time is published.
        </div>
      )}

      {selected.map((minutes, idx) => {
        const sendAt = Number.isFinite(netMs) ? new Date(netMs - minutes * 60 * 1000) : null;
        const sendAtLabel =
          sendAt && Number.isFinite(sendAt.getTime())
            ? new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: '2-digit',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: userTz,
                timeZoneName: 'short'
              }).format(sendAt)
            : null;

        return (
          <div key={`${minutes}-${idx}`} className="rounded-lg border border-stroke bg-surface-0 p-2">
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1 text-xs text-text1"
                value={minutes}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  const updated = selected.map((v, i) => (i === idx ? next : v));
                  onChange(Array.from(new Set(updated)).filter((v) => T_MINUS_OPTIONS.includes(v)).sort((a, b) => a - b).slice(0, 2));
                }}
                aria-label={`T-minus alert ${idx + 1}`}
              >
                {T_MINUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} disabled={selected.includes(opt) && opt !== minutes}>
                    {formatTMinusOption(opt)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary shrink-0 rounded-md px-2 py-1 text-[11px]"
                onClick={() => onChange(selected.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
            {sendAtLabel && !isDateOnly && <div className="mt-1 text-[11px] text-text3">Sends at {sendAtLabel}</div>}
          </div>
        );
      })}

      {selected.length === 0 && <div className="rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text3">Add up to 2 T-minus alerts.</div>}

      <div className="flex items-center justify-end">
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={add} disabled={!canAdd}>
          Add alert
        </button>
      </div>
    </div>
  );
}

function LocalTimePicker({
  netIso,
  netPrecision,
  userTz,
  value,
  onChange
}: {
  netIso: string;
  netPrecision: Launch['netPrecision'];
  userTz: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const net = new Date(netIso);
  const netMs = net.getTime();
  const isDateOnly = isDateOnlyNet(netIso, netPrecision, userTz);
  const localDay = Number.isFinite(netMs) ? { y: net.getFullYear(), m: net.getMonth(), d: net.getDate() } : null;

  const selected = Array.from(new Set(value.map((t) => normalizeLocalTime(t)).filter(Boolean) as string[])).sort().slice(0, 2);
  const rows = selected.length ? selected : [''];
  const canAdd = rows.filter(Boolean).length < 2;

  return (
    <div className="space-y-2">
      {rows.map((timeValue, idx) => {
        const normalized = normalizeLocalTime(timeValue);
        const sendAt =
          localDay && normalized
            ? new Date(localDay.y, localDay.m, localDay.d, Number(normalized.slice(0, 2)), Number(normalized.slice(3, 5)), 0, 0)
            : null;
        const sendAtLabel =
          sendAt && Number.isFinite(sendAt.getTime())
            ? new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: '2-digit',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: userTz,
                timeZoneName: 'short'
              }).format(sendAt)
            : null;

        const invalidAfterLaunch = !isDateOnly && sendAt && Number.isFinite(netMs) ? sendAt.getTime() >= netMs : false;

        return (
          <div key={`${idx}-${timeValue}`} className="rounded-lg border border-stroke bg-surface-0 p-2">
            <div className="flex items-center gap-2">
              <input
                type="time"
                className="w-full rounded-md border border-stroke bg-surface-0 px-2 py-1 text-xs text-text1"
                value={normalized ?? ''}
                onChange={(e) => {
                  const nextValue = normalizeLocalTime(e.target.value);
                  const without = selected.filter((_, i) => i !== idx);
                  const next = nextValue ? [...without, nextValue] : without;
                  onChange(Array.from(new Set(next)).sort().slice(0, 2));
                }}
                aria-label={`Launch day alert ${idx + 1}`}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary shrink-0 rounded-md px-2 py-1 text-[11px]"
                  onClick={() => onChange(selected.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              )}
            </div>
            {sendAtLabel && <div className="mt-1 text-[11px] text-text3">Sends at {sendAtLabel}</div>}
            {invalidAfterLaunch && (
              <div className="mt-1 text-[11px] text-danger">Pick a time before the scheduled launch time.</div>
            )}
          </div>
        );
      })}

      {selected.length === 0 && <div className="rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text3">Add up to 2 times on launch day.</div>}

      <div className="flex items-center justify-end">
        <button
          type="button"
          className="btn-secondary rounded-lg px-3 py-2 text-xs"
          onClick={() => {
            if (!localDay) return;
            const nextValue = selected.includes('09:00') ? '12:00' : '09:00';
            onChange(Array.from(new Set([...selected, nextValue])).sort().slice(0, 2));
          }}
          disabled={!canAdd || !localDay}
        >
          Add time
        </button>
      </div>
    </div>
  );
}

function formatTMinusOption(minutes: number) {
  if (minutes === 120) return 'T-2h';
  return `T-${minutes}`;
}

function normalizeLocalTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeLaunchAlertPrefs(prefs: LaunchAlertPrefs, userTz: string): LaunchAlertPrefs {
  const notify_status_change = Boolean(prefs?.notify_status_change);
  const notify_net_change = Boolean(prefs?.notify_net_change);
  const mode = prefs?.mode === 'local_time' ? 'local_time' : 't_minus';

  if (mode === 't_minus') {
    const t_minus_minutes = Array.from(new Set((prefs.t_minus_minutes || []).filter((v) => Number.isFinite(v)) as number[]))
      .filter((v) => T_MINUS_OPTIONS.includes(v))
      .sort((a, b) => a - b)
      .slice(0, 2);
    return {
      mode,
      timezone: 'UTC',
      t_minus_minutes,
      local_times: [],
      notify_status_change,
      notify_net_change
    };
  }

  const timezone = String(prefs?.timezone || userTz || 'UTC').trim() || 'UTC';
  const local_times = Array.from(new Set((prefs.local_times || []).map((t) => normalizeLocalTime(String(t))).filter(Boolean) as string[]))
    .sort()
    .slice(0, 2);

  return {
    mode,
    timezone,
    t_minus_minutes: [],
    local_times,
    notify_status_change,
    notify_net_change
  };
}

function launchAlertPrefsEqual(a: LaunchAlertPrefs, b: LaunchAlertPrefs) {
  if (a.notify_status_change !== b.notify_status_change) return false;
  if (a.notify_net_change !== b.notify_net_change) return false;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'local_time' && a.timezone !== b.timezone) return false;
  if (a.mode === 't_minus') return arrayEqual(a.t_minus_minutes, b.t_minus_minutes);
  return arrayEqual(a.local_times, b.local_times);
}

function validateLaunchAlertPrefs(
  prefs: LaunchAlertPrefs,
  netIso: string,
  netPrecision: Launch['netPrecision'],
  timeZone?: string
) {
  if (prefs.mode === 't_minus') {
    if (prefs.t_minus_minutes.length > 2) return 'Pick up to 2 T-minus alerts.';
    if (prefs.t_minus_minutes.some((m) => !T_MINUS_OPTIONS.includes(m))) return 'Pick a valid T-minus alert value.';
    return null;
  }

  if (prefs.local_times.length > 2) return 'Pick up to 2 launch-day times.';
  if (prefs.local_times.some((t) => !normalizeLocalTime(t))) return 'Enter valid times (HH:MM).';
  if (prefs.local_times.length === 0) return null;

  const net = new Date(netIso);
  const netMs = net.getTime();
  if (!Number.isFinite(netMs)) return null;

  const isDateOnly = isDateOnlyNet(netIso, netPrecision, timeZone);
  if (isDateOnly) return null;

  const day = { y: net.getFullYear(), m: net.getMonth(), d: net.getDate() };
  for (const t of prefs.local_times) {
    const normalized = normalizeLocalTime(t);
    if (!normalized) continue;
    const sendAt = new Date(day.y, day.m, day.d, Number(normalized.slice(0, 2)), Number(normalized.slice(3, 5)), 0, 0);
    if (Number.isFinite(sendAt.getTime()) && sendAt.getTime() >= netMs) {
      return 'Launch-day alert times must be before the scheduled launch time.';
    }
  }
  return null;
}

function formatLaunchDateTime(netIso: string, netPrecision: Launch['netPrecision'], tz: string) {
  const date = new Date(netIso);
  if (Number.isNaN(date.getTime())) return netIso;

  const isDateOnly = isDateOnlyNet(netIso, netPrecision, tz);
  if (isDateOnly) {
    const formatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: tz
    }).format(date);
    return `${formatted} (Time TBD)`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short'
  }).format(date);
}

function arrayEqual<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function DataCell({
  icon,
  label,
  value,
  tone,
  valueTrailing
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  valueTrailing?: ReactNode;
}) {
  const valueClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-text1';

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
      <div className="shrink-0 text-text3">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text3">{label}</div>
        <div className={clsx('flex min-w-0 items-center gap-1 text-xs font-semibold uppercase tracking-wider', valueClass)}>
          <span className="min-w-0 truncate">{value}</span>
          {valueTrailing ? <span className="shrink-0">{valueTrailing}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const key = (provider || '').toLowerCase();
  if (key.includes('spacex')) return <RocketIcon className={className} />;
  if (key.includes('nasa')) return <StarIcon className={className} />;
  if (key.includes('ula')) return <ShieldIcon className={className} />;
  return <RocketIcon className={className} />;
}

function ProviderLogo({
  provider,
  logoUrl,
  className,
  variant = 'icon'
}: {
  provider: string;
  logoUrl?: string;
  className?: string;
  variant?: 'icon' | 'wordmark';
}) {
  if (variant === 'wordmark') {
    const sizeClass = className || 'h-12 w-[min(180px,55vw)]';
    const initial = (provider || '?').trim().slice(0, 1).toUpperCase() || '?';

    return (
      <span className={clsx('relative inline-flex min-w-0 items-center justify-center', sizeClass)}>
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.55),rgba(124,92,255,0.24))] opacity-70 blur-[10px]"
        />
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-[rgba(7,9,19,0.72)] px-4 shadow-[0_0_18px_rgba(34,211,238,0.16)]">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="max-h-[84%] w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="text-sm font-semibold text-text2">{initial}</span>
          )}
        </span>
      </span>
    );
  }

  const sizeClass = className || 'h-5 w-5';
  return (
    <span className={clsx('relative inline-flex shrink-0 items-center justify-center', sizeClass)}>
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.6),rgba(124,92,255,0.3))] opacity-80 blur-[2px]"
      />
      <span className="relative flex h-full w-full items-center justify-center rounded-full border border-white/20 bg-[rgba(7,9,19,0.85)] shadow-[0_0_12px_rgba(34,211,238,0.35)]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-[86%] w-[86%] object-contain drop-shadow-[0_0_1px_rgba(255,255,255,0.55)]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <ProviderMark provider={provider} className="h-[84%] w-[84%] text-text1 drop-shadow-[0_0_2px_rgba(255,255,255,0.4)]" />
        )}
      </span>
    </span>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M14 4c2.5 2.5 4 6 4 10l-3 1-2 4-2-4-3-1c0-4 1.5-7.5 4-10 0.6-0.6 1.4-0.6 2 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9 14l-2 2m8-2 2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 8.5v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 3.5l2.2 5.1 5.5.5-4.2 3.7 1.3 5.4L12 15.8 7.2 18.2l1.3-5.4-4.2-3.7 5.5-.5L12 3.5Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CornerLockBadge({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const small = size === 'sm';
  return (
    <span
      className={clsx(
        'absolute -right-1 -top-1 flex items-center justify-center rounded-full border border-stroke bg-surface-2 text-text2 shadow-[0_0_6px_rgba(0,0,0,0.35)]',
        small ? 'h-3.5 w-3.5' : 'h-4 w-4'
      )}
    >
      <LockIcon className={small ? 'h-2 w-2' : 'h-2.5 w-2.5'} />
    </span>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5 19 6.5v6.2c0 4.1-2.6 7.8-7 9.8-4.4-2-7-5.7-7-9.8V6.5l7-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M20 7 10 17l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5 22 20.5H2L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 17.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 9.5a5.5 5.5 0 0 1 11 0v3.2l1.5 2.3H5l1.5-2.3V9.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 19.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SlashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 19 19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M6.5 6.5A8 8 0 0 1 17.5 17.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function OrbitIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 14.5c3.5-1.8 11.5-1.8 15 0M7 7.5c2.1 3 7.9 10 10 13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
