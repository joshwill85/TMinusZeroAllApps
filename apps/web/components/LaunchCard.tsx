'use client';

import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { buildPreferencesHref } from '@tminuszero/navigation';
import { useRouter, useSearchParams } from 'next/navigation';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { CameraGuideButton } from '@/components/ar/CameraGuideButton';
import { TimeDisplay } from './TimeDisplay';
import { ShareButton } from './ShareButton';
import { buildLaunchShare } from '@/lib/share';
import { CryoAtmosphere, type CryoStage } from './CryoAtmosphere';
import { WeatherIcon } from './WeatherIcon';
import { Badge, type BadgeTone } from './Badge';
import { FollowMenuButton, type FollowMenuOption } from './FollowMenuButton';

export function LaunchCard({
  launch,
  isNext = false,
  showAlertsNudge = false,
  onAlertsNudgeClick,
  isAuthed = false,
  isPaid = false,
  canUseBasicAlertRules = false,
  isArEligible = false,
  onOpenUpsell,
  blockThirdPartyEmbeds = false,
  initialNowMs,
  followMenuLabel,
  followMenuCapacityLabel,
  followMenuOptions
}: {
  launch: Launch;
  isNext?: boolean;
  showAlertsNudge?: boolean;
  onAlertsNudgeClick?: () => void;
  isAuthed?: boolean;
  isPaid?: boolean;
  canUseBasicAlertRules?: boolean;
  isArEligible?: boolean;
  onOpenUpsell?: (featureLabel?: string) => void;
  blockThirdPartyEmbeds?: boolean;
  initialNowMs?: number;
  followMenuLabel?: string;
  followMenuCapacityLabel?: string;
  followMenuOptions?: FollowMenuOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debugToken = String(searchParams.get('debug') || '').trim().toLowerCase();
  const debugLaunchId = String(searchParams.get('debugLaunchId') || '').trim();
  const debugEnabled = debugToken === '1' || debugToken === 'true' || debugToken === 'card' || debugToken === 'launchcard';
  const debugThisCard = debugEnabled && (!debugLaunchId || debugLaunchId === launch.id);
  const debugSessionIdRef = useRef(Math.random().toString(36).slice(2));
  const debugName = useMemo(() => `LaunchCard:${launch.id}:${debugSessionIdRef.current}`, [launch.id]);
  void onAlertsNudgeClick;
  void isAuthed;
  void canUseBasicAlertRules;

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
  const [, setFollowMenuState] = useState<{ open: boolean; view: 'following' | 'notifications' }>({
    open: false,
    view: 'following'
  });
  const alertsNudgeLatched = showAlertsNudge;
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

  const activeFollowCount = followMenuOptions?.filter((option) => option.active).length ?? 0;
  const followButtonLabel = followMenuLabel || (activeFollowCount > 0 ? 'Following' : 'Follow');
  const followButtonActive = activeFollowCount > 0;
  const detailsCueLabel = isPast ? 'Open report' : 'Open details';
  const notificationsContent = (
    <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.03)] p-3 text-sm text-text2">
      <div className="text-xs uppercase tracking-[0.12em] text-text3">Launch alerts</div>
      <div className="mt-1 text-sm text-text2">Follow sources stay visible on your account here. Push alert delivery is managed in the native mobile app.</div>
      <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
        Open the native app to manage reminder timing, alert scopes, and device registration on each phone.
      </div>
      <div className="mt-3 flex items-center justify-end">
        <Link className="btn rounded-lg px-3 py-2 text-xs" href={buildPreferencesHref()}>
          Open alert settings
        </Link>
      </div>
    </div>
  );

  const handleCardNavigation = () => {
    router.push(launchHref);
  };

  const handleCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (shouldIgnoreCardNavigation(event.target)) return;
    handleCardNavigation();
  };

  return (
    <article
      className={clsx(
        'launch-card group w-full cursor-pointer',
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
      onClick={handleCardClick}
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
            <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text3 transition group-hover:text-text1">
              <span>{detailsCueLabel}</span>
              <ChevronRightIcon className="h-3 w-3" />
            </div>
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

        <section className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
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
            <div className="flex items-end justify-end pl-2">
              <div className="flex flex-col items-end gap-2">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {launch.videoUrl ? (
              <a
                href={launch.videoUrl}
                target="_blank"
                rel="noreferrer"
                className={clsx(
                  'btn-secondary relative flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary',
                  launch.webcastLive && 'border-primary text-primary'
                )}
                aria-label={isPast ? 'Watch replay coverage' : launch.webcastLive ? 'Watch live coverage' : 'Watch coverage'}
                title={isPast ? 'Watch replay' : launch.webcastLive ? 'Watch live coverage' : 'Watch coverage'}
              >
                <PlayIcon className="h-4 w-4" />
                {launch.webcastLive && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary shadow-glow" />}
              </a>
            ) : null}
            <ShareButton url={share.path} title={share.title} text={share.text} variant="icon" />
            {isArEligible &&
              !isPast &&
              (isPaid ? (
                <CameraGuideButton
                  href={arHref}
                  launchId={launch.id}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 text-primary transition hover:border-primary hover:bg-primary/14"
                >
                  <TrajectoryIcon className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">AR trajectory</span>
                </CameraGuideButton>
              ) : canUpsell ? (
                <button
                  type="button"
                  className="relative inline-flex h-11 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 text-primary transition hover:border-primary hover:bg-primary/14"
                  onClick={() => onOpenUpsell?.('AR trajectory')}
                  aria-label="Upgrade to Premium to unlock AR trajectory"
                  title="AR trajectory (Premium)"
                >
                  <TrajectoryIcon className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">AR trajectory</span>
                  <CornerLockBadge size="sm" />
                </button>
              ) : null)}
          </div>

          {!isPast &&
            (followMenuOptions && followMenuOptions.length > 0 ? (
              <FollowMenuButton
                label={followButtonLabel}
                active={followButtonActive}
                activeCount={activeFollowCount}
                capacityLabel={followMenuCapacityLabel}
                notificationsActive={false}
                options={followMenuOptions}
                notificationsContent={notificationsContent}
                defaultView={alertsNudgeLatched ? 'notifications' : 'following'}
                onMenuStateChange={setFollowMenuState}
              />
            ) : canUpsell ? (
              <button
                type="button"
                className="btn-secondary relative flex h-11 items-center gap-2 rounded-full border border-stroke px-3 text-text2 hover:border-primary"
                onClick={() => onOpenUpsell?.('My Launches')}
                aria-label="Upgrade to Premium to unlock follow tools"
                title="Follow tools (Premium)"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/12 bg-white/5">
                  <PlusIcon className="h-3 w-3" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">Follow</span>
                <CornerLockBadge />
              </button>
            ) : null)}
        </div>

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

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function TrajectoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 8V5.5A1.5 1.5 0 0 1 6.5 4H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 8V5.5A1.5 1.5 0 0 0 17.5 4H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 16v2.5A1.5 1.5 0 0 1 17.5 20H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M7.5 15.75c1.25-3.25 4.15-6 8.25-7.35"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m14.75 7 2.85.2-1.5 2.45" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="15.75" r="1.35" fill="currentColor" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function shouldIgnoreCardNavigation(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('a, button, input, select, textarea, summary, [role="button"], [data-no-card-nav="true"]'));
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
