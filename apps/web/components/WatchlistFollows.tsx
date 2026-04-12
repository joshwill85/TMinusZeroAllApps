'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiClientError, type WatchlistRuleV1 } from '@tminuszero/api-client';
import { buildPreferencesHref, buildUpgradeHref } from '@tminuszero/navigation';
import {
  useBasicFollowsQuery,
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useDeleteWatchlistRuleMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/lib/api/queries';
import { FollowMenuButton, type FollowMenuOption } from './FollowMenuButton';
import { useToast } from './ToastProvider';

type WatchlistFollowsProps = {
  isAuthed: boolean;
  canUseSavedItems: boolean;
  launchId: string;
  launchName?: string | null;
  provider?: string | null;
  ll2PadId?: number | null;
  padShortCode?: string | null;
  padLabel?: string | null;
  ll2RocketConfigId?: number | null;
  rocketLabel?: string | null;
  launchSiteLabel?: string | null;
  state?: string | null;
};

type FollowRuleType = 'launch' | 'provider' | 'pad' | 'rocket' | 'launch_site' | 'state';

export function WatchlistFollows({
  isAuthed,
  canUseSavedItems,
  launchId,
  launchName,
  provider,
  ll2PadId,
  padShortCode,
  padLabel,
  ll2RocketConfigId,
  rocketLabel,
  launchSiteLabel,
  state
}: WatchlistFollowsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const basicFollowsQuery = useBasicFollowsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const { refetch: refetchWatchlists } = watchlistsQuery;
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const watchlists = useMemo(() => watchlistsQuery.data?.watchlists ?? [], [watchlistsQuery.data?.watchlists]);
  const selectedWatchlist = useMemo(
    () => watchlists.find((watchlist) => String(watchlist.name || '').trim().toLowerCase() === 'my launches') ?? watchlists[0] ?? null,
    [watchlists]
  );
  const watchlistId = selectedWatchlist?.id ?? null;
  const loading = canUseSavedItems && (watchlistsQuery.isPending || createWatchlistMutation.isPending);
  const ruleLimit = entitlementsQuery.data?.limits.watchlistRuleLimit ?? null;
  const singleLaunchFollowLimit = Math.max(1, entitlementsQuery.data?.limits.singleLaunchFollowLimit ?? 1);
  const activeBasicLaunchFollow = basicFollowsQuery.data?.activeLaunchFollow ?? null;
  const normalizedLaunchId = String(launchId || '').trim().toLowerCase();
  const currentBasicLaunchActive = activeBasicLaunchFollow?.launchId === normalizedLaunchId;
  const isAnonViewer = !isAuthed;
  const basicFollowCapacityLabel = canUseSavedItems || isAnonViewer ? undefined : `${activeBasicLaunchFollow ? 1 : 0}/${singleLaunchFollowLimit}`;
  const queryErrorMessage =
    canUseSavedItems
      ? watchlistsQuery.error
        ? getErrorMessage(watchlistsQuery.error, 'Unable to load follows.')
        : null
      : basicFollowsQuery.error
        ? getErrorMessage(basicFollowsQuery.error, 'Unable to load your launch slot.')
        : null;

  const providerKey = normalizeText(provider);
  const padRuleValue = useMemo(() => buildPadRuleValue({ ll2PadId, padShortCode }), [ll2PadId, padShortCode]);
  const rocketRuleValue = useMemo(() => buildRocketRuleValue({ ll2RocketConfigId, rocketLabel }), [ll2RocketConfigId, rocketLabel]);
  const launchSiteRuleValue = useMemo(() => buildLaunchSiteRuleValue(launchSiteLabel ?? padLabel), [launchSiteLabel, padLabel]);
  const stateRuleValue = useMemo(() => buildStateRuleValue(state), [state]);
  const rocketDisplayLabel = normalizeText(rocketLabel) ?? (rocketRuleValue ? formatRocketRuleLabel(rocketRuleValue) : 'this rocket');
  const launchSiteDisplayLabel = normalizeText(launchSiteLabel ?? padLabel) ?? 'this site';
  const openFollowUpgrade = useCallback(() => {
    router.push(buildUpgradeHref({ returnTo: pathname || null }));
  }, [pathname, router]);

  const launchRuleId = useMemo(
    () => (launchId ? findRuleId(selectedWatchlist?.rules ?? [], 'launch', launchId) : null),
    [launchId, selectedWatchlist?.rules]
  );
  const providerRuleId = useMemo(
    () => (providerKey ? findRuleId(selectedWatchlist?.rules ?? [], 'provider', providerKey) : null),
    [providerKey, selectedWatchlist?.rules]
  );
  const padRuleId = useMemo(
    () => (padRuleValue ? findRuleId(selectedWatchlist?.rules ?? [], 'pad', padRuleValue) : null),
    [padRuleValue, selectedWatchlist?.rules]
  );
  const rocketRuleId = useMemo(
    () => (rocketRuleValue ? findRuleId(selectedWatchlist?.rules ?? [], 'rocket', rocketRuleValue) : null),
    [rocketRuleValue, selectedWatchlist?.rules]
  );
  const launchSiteRuleId = useMemo(
    () => (launchSiteRuleValue ? findRuleId(selectedWatchlist?.rules ?? [], 'launch_site', launchSiteRuleValue) : null),
    [launchSiteRuleValue, selectedWatchlist?.rules]
  );
  const stateRuleId = useMemo(
    () => (stateRuleValue ? findRuleId(selectedWatchlist?.rules ?? [], 'state', stateRuleValue) : null),
    [stateRuleValue, selectedWatchlist?.rules]
  );

  const activeError = error ?? queryErrorMessage;
  const locked = !canUseSavedItems;
  const baseDisabled = loading || Boolean(activeError);
  const premiumFollowOptions: FollowMenuOption[] = [
    {
      key: 'launch',
      label: 'This launch',
      description: launchName ? `Keep ${launchName} in Following.` : 'Keep this exact launch in Following.',
      active: Boolean(launchRuleId),
      disabled: baseDisabled || !launchId || Boolean(busy[`launch:${launchId}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        void toggleRule('launch', launchId, launchName || 'this launch');
      }
    },
    {
      key: 'provider',
      label: 'This provider',
      description: providerKey ? `All launches from ${providerKey}.` : 'Provider follow unavailable.',
      active: Boolean(providerRuleId),
      disabled: baseDisabled || !providerKey || Boolean(busy[`provider:${providerKey}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        if (!providerKey) return;
        void toggleRule('provider', providerKey, providerKey);
      }
    },
    {
      key: 'rocket',
      label: 'This rocket',
      description: rocketRuleValue ? `All launches for ${rocketDisplayLabel}.` : 'Rocket follow unavailable.',
      active: Boolean(rocketRuleId),
      disabled: baseDisabled || !rocketRuleValue || Boolean(busy[`rocket:${rocketRuleValue}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        if (!rocketRuleValue) return;
        void toggleRule('rocket', rocketRuleValue, rocketDisplayLabel);
      }
    },
    {
      key: 'pad',
      label: 'This pad',
      description: padRuleValue ? `Launches from ${resolvePadFollowTarget({ padLabel, padShortCode })}.` : 'Pad follow unavailable.',
      active: Boolean(padRuleId),
      disabled: baseDisabled || !padRuleValue || Boolean(busy[`pad:${padRuleValue}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        if (!padRuleValue) return;
        void toggleRule('pad', padRuleValue, resolvePadFollowTarget({ padLabel, padShortCode }));
      }
    },
    {
      key: 'launch_site',
      label: 'This launch site',
      description: launchSiteRuleValue ? `Launches from ${launchSiteDisplayLabel}.` : 'Launch-site follow unavailable.',
      active: Boolean(launchSiteRuleId),
      disabled: baseDisabled || !launchSiteRuleValue || Boolean(busy[`launch_site:${launchSiteRuleValue}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        if (!launchSiteRuleValue) return;
        void toggleRule('launch_site', launchSiteRuleValue, launchSiteDisplayLabel);
      }
    },
    {
      key: 'state',
      label: 'This state',
      description: stateRuleValue ? `Launches in ${stateRuleValue.toUpperCase()}.` : 'State follow unavailable.',
      active: Boolean(stateRuleId),
      disabled: baseDisabled || !stateRuleValue || Boolean(busy[`state:${stateRuleValue}`]),
      locked,
      onPress: () => {
        if (locked) {
          openFollowUpgrade();
          return;
        }
        if (!stateRuleValue) return;
        void toggleRule('state', stateRuleValue, stateRuleValue.toUpperCase());
      }
    }
  ];
  const basicFollowOptions: FollowMenuOption[] = [
    {
      key: 'launch',
      label: 'This launch',
      description: currentBasicLaunchActive
        ? 'This launch is already tracked on your account. Manage it in the native iOS or Android app.'
        : 'Manage launch push reminders for this launch in the native iOS or Android app.',
      active: currentBasicLaunchActive,
      disabled: false,
      locked: false,
      onPress: () => {
        void toggleBasicLaunchFollow();
      }
    },
    {
      key: 'provider',
      label: 'This provider',
      description: providerKey ? `All launches from ${providerKey}. Premium unlocks recurring provider follows.` : 'Provider follow unavailable for this card.',
      active: false,
      disabled: !providerKey,
      locked: Boolean(providerKey),
      onPress: () => {
        openFollowUpgrade();
      }
    },
    {
      key: 'rocket',
      label: 'This rocket',
      description: rocketRuleValue ? `All launches for ${rocketDisplayLabel}. Premium unlocks recurring rocket follows.` : 'Rocket follow unavailable for this card.',
      active: false,
      disabled: !rocketRuleValue,
      locked: Boolean(rocketRuleValue),
      onPress: () => {
        openFollowUpgrade();
      }
    },
    {
      key: 'pad',
      label: 'This pad',
      description: padRuleValue ? `Launches from ${resolvePadFollowTarget({ padLabel, padShortCode })}. Premium unlocks recurring pad follows.` : 'Pad follow unavailable for this card.',
      active: false,
      disabled: !padRuleValue,
      locked: Boolean(padRuleValue),
      onPress: () => {
        openFollowUpgrade();
      }
    },
    {
      key: 'launch_site',
      label: 'This launch site',
      description: launchSiteRuleValue ? `Launches from ${launchSiteDisplayLabel}. Premium unlocks recurring launch-site follows.` : 'Launch-site follow unavailable for this card.',
      active: false,
      disabled: !launchSiteRuleValue,
      locked: Boolean(launchSiteRuleValue),
      onPress: () => {
        openFollowUpgrade();
      }
    },
    {
      key: 'state',
      label: 'This state',
      description: stateRuleValue ? `Launches in ${stateRuleValue.toUpperCase()}. Premium unlocks state-wide follows.` : 'State follow unavailable for this card.',
      active: false,
      disabled: !stateRuleValue,
      locked: Boolean(stateRuleValue),
      onPress: () => {
        openFollowUpgrade();
      }
    }
  ];
  const followOptions = canUseSavedItems ? premiumFollowOptions : basicFollowOptions;

  const availableOptionCount = followOptions.filter((option) => !option.disabled || option.locked || option.active).length;
  const activeFollowCount = followOptions.filter((option) => option.active).length;
  const notificationsContent = (
    <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.03)] p-3 text-sm text-text2">
      <div className="text-xs uppercase tracking-[0.12em] text-text3">Launch alerts</div>
      <div className="mt-1 text-sm text-text2">Follow sources stay visible on your account here. Push alert delivery is managed in the native mobile app.</div>
      <div className="mt-3 rounded-lg border border-stroke bg-surface-1 p-2 text-xs text-text2">
        Open the native app to manage reminder timing, push delivery, and device registration on each phone.
      </div>
      <div className="mt-3 flex items-center justify-end">
        <Link className="btn rounded-lg px-3 py-2 text-xs" href={buildPreferencesHref()}>
          Open alert settings
        </Link>
      </div>
    </div>
  );

  if (!availableOptionCount) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {activeError && (
          <span className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">{activeError}</span>
        )}
        <FollowMenuButton
          label={activeFollowCount > 0 ? 'Following' : 'Follow'}
          active={activeFollowCount > 0}
          activeCount={canUseSavedItems ? activeFollowCount : 0}
          capacityLabel={basicFollowCapacityLabel}
          notificationsContent={notificationsContent}
          options={followOptions}
        />
      </div>
    </>
  );

  function resolveRuleLimitMessage() {
    return ruleLimit ? `My Launches limit reached (${ruleLimit} rules).` : 'My Launches limit reached.';
  }

  async function toggleRule(ruleType: FollowRuleType, ruleValue: string, label: string) {
    const normalizedValue = String(ruleValue || '').trim();
    if (!normalizedValue) return;

    const busyKey = `${ruleType}:${normalizedValue}`;
    if (busy[busyKey]) return;

    const existingRuleId = findRuleId(selectedWatchlist?.rules ?? [], ruleType, normalizedValue);
    setBusy((prev) => ({ ...prev, [busyKey]: true }));
    setError(null);

    try {
      const ensuredWatchlistId = await ensureWatchlistId();
      if (!ensuredWatchlistId) {
        setError('Unable to load follows.');
        return;
      }

      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId: ensuredWatchlistId,
          ruleId: existingRuleId
        });
        pushToast({
          message: `Unfollowed ${label}.`,
          tone: 'info',
          onUndo: async () => {
            try {
              await createWatchlistRuleMutation.mutateAsync({
                watchlistId: ensuredWatchlistId,
                payload: { ruleType, ruleValue: normalizedValue }
              });
            } catch (undoError: unknown) {
              setError(getErrorMessage(undoError, `Unable to undo ${label} follow.`));
            }
          }
        });
        return;
      }

      const created = await createWatchlistRuleMutation.mutateAsync({
        watchlistId: ensuredWatchlistId,
        payload: {
          ruleType,
          ruleValue: normalizedValue
        }
      });
      const nextRuleId = created.rule.id;
      pushToast({
        message: `Following ${label}.`,
        tone: 'success',
        onUndo: async () => {
          if (!nextRuleId) return;
          try {
            await deleteWatchlistRuleMutation.mutateAsync({
              watchlistId,
              ruleId: nextRuleId
            });
          } catch (undoError: unknown) {
            setError(getErrorMessage(undoError, `Unable to undo ${label} follow.`));
          }
        }
      });
    } catch (toggleError: unknown) {
      const nextError =
        getErrorCode(toggleError) === 'limit_reached'
          ? resolveRuleLimitMessage()
          : getErrorMessage(toggleError, `Unable to update ${label} follow.`);
      setError(nextError);
    } finally {
      setBusy((prev) => ({ ...prev, [busyKey]: false }));
    }
  }

  async function ensureWatchlistId() {
    if (watchlistId) return watchlistId;

    try {
      const created = await createWatchlistMutation.mutateAsync({});
      return created.watchlist.id;
    } catch (createError: unknown) {
      if (createError instanceof ApiClientError && createError.status === 409) {
        const refreshed = await refetchWatchlists();
        const refreshedWatchlists = refreshed.data?.watchlists ?? [];
        const refreshedSelection =
          refreshedWatchlists.find((watchlist) => String(watchlist.name || '').trim().toLowerCase() === 'my launches') ??
          refreshedWatchlists[0] ??
          null;
        return refreshedSelection?.id ?? null;
      }
      throw createError;
    }
  }

  async function toggleBasicLaunchFollow() {
    if (!launchId) return;

    setError('Launch alerts are managed in the native iOS or Android app. Open Notifications for the current setup.');
    router.push('/me/preferences');
  }
}

function hasAnyFollowableValue(values: {
  launchId?: string | null;
  providerKey?: string | null;
  padRuleValue?: string | null;
  rocketRuleValue?: string | null;
  launchSiteRuleValue?: string | null;
  stateRuleValue?: string | null;
}) {
  return Boolean(
    normalizeText(values.launchId) ||
      normalizeText(values.providerKey) ||
      normalizeText(values.padRuleValue) ||
      normalizeText(values.rocketRuleValue) ||
      normalizeText(values.launchSiteRuleValue) ||
      normalizeText(values.stateRuleValue)
  );
}

function findRuleId(rules: WatchlistRuleV1[], type: FollowRuleType, value: string) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();
  if (!normalizedType || !normalizedValue) return null;
  const found = rules.find(
    (rule) =>
      String(rule.ruleType || '').trim().toLowerCase() === normalizedType && String(rule.ruleValue || '').trim() === normalizedValue
  );
  return found?.id ? String(found.id) : null;
}

function buildPadRuleValue({ ll2PadId, padShortCode }: { ll2PadId?: number | null; padShortCode?: string | null }) {
  if (typeof ll2PadId === 'number' && Number.isFinite(ll2PadId) && ll2PadId > 0) {
    return `ll2:${String(Math.trunc(ll2PadId))}`;
  }
  const code = normalizeText(padShortCode);
  if (!code || code.toLowerCase() === 'pad') return null;
  return `code:${code}`;
}

function buildRocketRuleValue({
  ll2RocketConfigId,
  rocketLabel
}: {
  ll2RocketConfigId?: number | null;
  rocketLabel?: string | null;
}) {
  if (typeof ll2RocketConfigId === 'number' && Number.isFinite(ll2RocketConfigId) && ll2RocketConfigId > 0) {
    return `ll2:${String(Math.trunc(ll2RocketConfigId))}`;
  }
  const label = normalizeText(rocketLabel);
  return label ? label.toLowerCase() : null;
}

function formatRocketRuleLabel(value: string) {
  const raw = normalizeText(value);
  if (!raw) return 'Rocket';
  return raw.toLowerCase().startsWith('ll2:') ? `Rocket ${raw.slice(4)}` : raw;
}

function buildLaunchSiteRuleValue(value?: string | null) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function buildStateRuleValue(value?: string | null) {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized || normalized === 'na' || normalized === 'n/a' || normalized === 'unknown') {
    return null;
  }
  return normalized;
}

function resolvePadFollowTarget({ padLabel, padShortCode }: { padLabel?: string | null; padShortCode?: string | null }) {
  const label = normalizeText(padLabel);
  if (label && label.toLowerCase() !== 'unknown' && label.toLowerCase() !== 'pad') return label;
  const shortCode = normalizeText(padShortCode);
  if (shortCode && shortCode.toLowerCase() !== 'pad') return shortCode;
  return 'Pad';
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
