import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, type WatchlistRuleV1, type WatchlistV1 } from '@tminuszero/api-client';
import {
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useDeleteWatchlistRuleMutation,
  useWatchlistsQuery
} from '@/src/api/queries';

type WatchlistActionNotice = {
  tone: 'info' | 'success';
  message: string;
};

type UsePrimaryWatchlistOptions = {
  enabled: boolean;
  autoCreate?: boolean;
  ruleLimit?: number | null;
};

type ToggleRuleKind = 'launch' | 'provider' | 'pad' | 'rocket' | 'launch_site' | 'state';

type ToggleRuleResult = {
  notice: WatchlistActionNotice;
  action: 'added' | 'removed';
  watchlistId: string;
  ruleId: string | null;
  ruleType: ToggleRuleKind;
  ruleValue: string;
  label: string;
};

type PrimaryWatchlistState = {
  watchlists: WatchlistV1[];
  primaryWatchlist: WatchlistV1 | null;
  primaryWatchlistId: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  busyKeys: Record<string, boolean>;
  launchRuleIdsByLaunchId: Record<string, string>;
  providerRuleIdsByValue: Record<string, string>;
  padRuleIdsByValue: Record<string, string>;
  rocketRuleIdsByValue: Record<string, string>;
  launchSiteRuleIdsByValue: Record<string, string>;
  stateRuleIdsByValue: Record<string, string>;
  isLaunchTracked: (launchId: string | null | undefined) => boolean;
  isProviderTracked: (provider: string | null | undefined) => boolean;
  isPadTracked: (ruleValue: string | null | undefined) => boolean;
  isRocketTracked: (ruleValue: string | null | undefined) => boolean;
  isLaunchSiteTracked: (ruleValue: string | null | undefined) => boolean;
  isStateTracked: (ruleValue: string | null | undefined) => boolean;
  isTracked: (kind: ToggleRuleKind, ruleValue: string | null | undefined) => boolean;
  ensurePrimaryWatchlist: () => Promise<string | null>;
  toggleLaunch: (launchId: string) => Promise<ToggleRuleResult | null>;
  toggleProvider: (provider: string) => Promise<ToggleRuleResult | null>;
  togglePad: (ruleValue: string) => Promise<ToggleRuleResult | null>;
  toggleRocket: (ruleValue: string, label?: string) => Promise<ToggleRuleResult | null>;
  toggleLaunchSite: (ruleValue: string, label?: string) => Promise<ToggleRuleResult | null>;
  toggleState: (ruleValue: string, label?: string) => Promise<ToggleRuleResult | null>;
  toggleRule: (args: { kind: ToggleRuleKind; ruleValue: string; label: string }) => Promise<ToggleRuleResult | null>;
};

export function buildPadRuleValue({
  ll2PadId,
  padShortCode
}: {
  ll2PadId?: number | null;
  padShortCode?: string | null;
}) {
  if (typeof ll2PadId === 'number' && Number.isFinite(ll2PadId) && ll2PadId > 0) {
    return `ll2:${String(Math.trunc(ll2PadId))}`;
  }

  const normalizedShortCode = String(padShortCode || '').trim();
  if (!normalizedShortCode || normalizedShortCode === 'Pad') {
    return null;
  }

  return `code:${normalizedShortCode}`;
}

export function buildRocketRuleValue({
  ll2RocketConfigId,
  rocketName,
  vehicle
}: {
  ll2RocketConfigId?: number | null;
  rocketName?: string | null;
  vehicle?: string | null;
}) {
  if (typeof ll2RocketConfigId === 'number' && Number.isFinite(ll2RocketConfigId) && ll2RocketConfigId > 0) {
    return `ll2:${String(Math.trunc(ll2RocketConfigId))}`;
  }

  const label = String(rocketName || vehicle || '').trim();
  return label || null;
}

export function buildLaunchSiteRuleValue(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized && normalized.toLowerCase() !== 'unknown' ? normalized : null;
}

export function buildStateRuleValue(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || normalized === 'NA' || normalized === 'N/A' || normalized === 'UNKNOWN') {
    return null;
  }
  return normalized;
}

export function formatPadRuleLabel(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'Pad';
  }
  if (normalized.toLowerCase().startsWith('code:')) {
    const code = normalized.slice(5).trim();
    return code ? `Pad ${code}` : 'Pad';
  }
  if (normalized.toLowerCase().startsWith('ll2:')) {
    return 'Launch pad';
  }
  return normalized;
}

export function formatRocketRuleLabel(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'Rocket';
  }
  return normalized.startsWith('ll2:') ? `Rocket ${normalized.slice(4)}` : normalized;
}

export function formatLaunchSiteRuleLabel(value: string) {
  return String(value || '').trim() || 'Launch site';
}

export function formatStateRuleLabel(value: string) {
  return String(value || '').trim().toUpperCase() || 'State';
}

export function formatWatchlistRuleLabel(rule: Pick<WatchlistRuleV1, 'ruleType' | 'ruleValue'>) {
  if (rule.ruleType === 'provider') {
    return String(rule.ruleValue || 'Provider').trim() || 'Provider';
  }
  if (rule.ruleType === 'pad') {
    return formatPadRuleLabel(rule.ruleValue);
  }
  if (rule.ruleType === 'rocket') {
    return formatRocketRuleLabel(rule.ruleValue);
  }
  if (rule.ruleType === 'launch_site') {
    return formatLaunchSiteRuleLabel(rule.ruleValue);
  }
  if (rule.ruleType === 'state') {
    return formatStateRuleLabel(rule.ruleValue);
  }
  if (rule.ruleType === 'tier') {
    const normalizedTier = String(rule.ruleValue || '').trim();
    return normalizedTier ? `${normalizedTier.toUpperCase()} tier` : 'Tier follow';
  }

  const normalizedLaunchId = String(rule.ruleValue || '').trim();
  return normalizedLaunchId ? `Launch ${normalizedLaunchId.slice(0, 8)}` : 'Saved launch';
}

export function formatWatchlistRuleCaption(rule: Pick<WatchlistRuleV1, 'ruleType' | 'ruleValue'>) {
  if (rule.ruleType === 'provider') {
    return 'Provider follow';
  }
  if (rule.ruleType === 'pad') {
    return 'Pad follow';
  }
  if (rule.ruleType === 'rocket') {
    return 'Rocket follow';
  }
  if (rule.ruleType === 'launch_site') {
    return 'Launch site follow';
  }
  if (rule.ruleType === 'state') {
    return 'State launches';
  }
  if (rule.ruleType === 'tier') {
    return 'Tier follow';
  }
  return 'Saved launch';
}

export function buildFollowAlertRuleKey(ruleType: string, ruleValue: string) {
  return `${String(ruleType || '').trim().toLowerCase()}:${String(ruleValue || '').trim().toLowerCase()}`;
}

export function resolvePrimaryWatchlist(watchlists: WatchlistV1[]) {
  return (
    watchlists.find((watchlist) => String(watchlist.name || '').trim().toLowerCase() === 'my launches') ?? watchlists[0] ?? null
  );
}

export function findWatchlistRuleId(
  rules: WatchlistRuleV1[],
  ruleType: WatchlistRuleV1['ruleType'],
  ruleValue: string | null | undefined
) {
  const normalizedRuleValue = String(ruleValue || '').trim();
  if (!normalizedRuleValue) {
    return null;
  }

  const match = rules.find(
    (rule) => rule.ruleType === ruleType && String(rule.ruleValue || '').trim().toLowerCase() === normalizedRuleValue.toLowerCase()
  );
  return match?.id ?? null;
}

function buildWatchlistRuleMaps(watchlist: WatchlistV1 | null) {
  const launchRuleIdsByLaunchId: Record<string, string> = {};
  const providerRuleIdsByValue: Record<string, string> = {};
  const padRuleIdsByValue: Record<string, string> = {};
  const rocketRuleIdsByValue: Record<string, string> = {};
  const launchSiteRuleIdsByValue: Record<string, string> = {};
  const stateRuleIdsByValue: Record<string, string> = {};

  for (const rule of watchlist?.rules ?? []) {
    const normalizedValue = String(rule.ruleValue || '').trim();
    if (!normalizedValue || !rule.id) {
      continue;
    }

    if (rule.ruleType === 'launch') {
      launchRuleIdsByLaunchId[normalizedValue] = rule.id;
      continue;
    }
    if (rule.ruleType === 'provider') {
      providerRuleIdsByValue[normalizedValue.toLowerCase()] = rule.id;
      continue;
    }
    if (rule.ruleType === 'pad') {
      padRuleIdsByValue[normalizedValue.toLowerCase()] = rule.id;
      continue;
    }
    if (rule.ruleType === 'rocket') {
      rocketRuleIdsByValue[normalizedValue.toLowerCase()] = rule.id;
      continue;
    }
    if (rule.ruleType === 'launch_site') {
      launchSiteRuleIdsByValue[normalizedValue.toLowerCase()] = rule.id;
      continue;
    }
    if (rule.ruleType === 'state') {
      stateRuleIdsByValue[normalizedValue.toLowerCase()] = rule.id;
    }
  }

  return {
    launchRuleIdsByLaunchId,
    providerRuleIdsByValue,
    padRuleIdsByValue,
    rocketRuleIdsByValue,
    launchSiteRuleIdsByValue,
    stateRuleIdsByValue
  };
}

function buildRuleLimitMessage(ruleLimit: number | null | undefined) {
  return ruleLimit ? `My Launches limit reached (${ruleLimit} rules).` : 'My Launches limit reached.';
}

export function buildWatchlistRuleErrorMessage(error: unknown, label: string, ruleLimit?: number | null) {
  if (error instanceof ApiClientError) {
    if (error.code === 'limit_reached') {
      return buildRuleLimitMessage(ruleLimit);
    }
    if (error.code) {
      return `${label} error: ${error.code}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Unable to update ${label.toLowerCase()}.`;
}

export function usePrimaryWatchlist({
  enabled,
  autoCreate = true,
  ruleLimit = null
}: UsePrimaryWatchlistOptions): PrimaryWatchlistState {
  const watchlistsQuery = useWatchlistsQuery();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const [didAttemptAutoCreate, setDidAttemptAutoCreate] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const watchlists = useMemo(() => watchlistsQuery.data?.watchlists ?? [], [watchlistsQuery.data?.watchlists]);
  const primaryWatchlist = useMemo(() => resolvePrimaryWatchlist(watchlists), [watchlists]);
  const primaryWatchlistId = primaryWatchlist?.id ?? null;
  const ruleMaps = useMemo(() => buildWatchlistRuleMaps(primaryWatchlist), [primaryWatchlist]);

  useEffect(() => {
    if (!enabled) {
      setDidAttemptAutoCreate(false);
      return;
    }
    if (watchlists.length > 0) {
      setDidAttemptAutoCreate(false);
    }
  }, [enabled, watchlists.length]);

  useEffect(() => {
    if (!enabled || !autoCreate) {
      return;
    }
    if (!watchlistsQuery.isSuccess || watchlists.length > 0 || didAttemptAutoCreate || createWatchlistMutation.isPending) {
      return;
    }

    setDidAttemptAutoCreate(true);
    setLastError(null);
    void createWatchlistMutation.mutateAsync({}).catch((error) => {
      setLastError(buildWatchlistRuleErrorMessage(error, 'My Launches', ruleLimit));
    });
  }, [
    autoCreate,
    createWatchlistMutation,
    didAttemptAutoCreate,
    enabled,
    ruleLimit,
    watchlists.length,
    watchlistsQuery.isSuccess
  ]);

  const ensurePrimaryWatchlist = useCallback(async () => {
    if (!enabled) {
      return null;
    }
    if (primaryWatchlistId) {
      return primaryWatchlistId;
    }

    setLastError(null);
    const payload = await createWatchlistMutation.mutateAsync({});
    return payload.watchlist.id ?? null;
  }, [createWatchlistMutation, enabled, primaryWatchlistId]);

  const toggleRule = useCallback(
    async ({
      kind,
      ruleValue,
      label
    }: {
      kind: ToggleRuleKind;
      ruleValue: string;
      label: string;
    }): Promise<ToggleRuleResult | null> => {
      const normalizedRuleValue = String(ruleValue || '').trim();
      if (!normalizedRuleValue) {
        return null;
      }

      const watchlistId = await ensurePrimaryWatchlist();
      if (!watchlistId) {
        return null;
      }

      const busyKey = `${kind}:${normalizedRuleValue.toLowerCase()}`;
      if (busyKeys[busyKey]) {
        return null;
      }

      const existingRuleId =
        kind === 'launch'
          ? ruleMaps.launchRuleIdsByLaunchId[normalizedRuleValue] ?? null
          : kind === 'provider'
            ? ruleMaps.providerRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
            : kind === 'pad'
              ? ruleMaps.padRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
              : kind === 'rocket'
                ? ruleMaps.rocketRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
                : kind === 'launch_site'
                  ? ruleMaps.launchSiteRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
                  : ruleMaps.stateRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null;

      setBusyKeys((current) => ({ ...current, [busyKey]: true }));
      setLastError(null);
      try {
        if (existingRuleId) {
          await deleteWatchlistRuleMutation.mutateAsync({
            watchlistId,
            ruleId: existingRuleId
          });
          return {
            action: 'removed',
            watchlistId,
            ruleId: existingRuleId,
            ruleType: kind,
            ruleValue: normalizedRuleValue,
            label,
            notice: {
              tone: 'info',
              message: kind === 'launch' ? 'Removed from My Launches.' : `Unfollowed ${label}.`
            }
          };
        }

        const payload = await createWatchlistRuleMutation.mutateAsync({
          watchlistId,
          payload: {
            ruleType: kind,
            ruleValue: normalizedRuleValue
          }
        });
        return {
          action: 'added',
          watchlistId,
          ruleId: payload.rule.id ?? null,
          ruleType: kind,
          ruleValue: normalizedRuleValue,
          label,
          notice: {
            tone: 'success',
            message: kind === 'launch' ? 'Added to My Launches.' : `Following ${label}.`
          }
        };
      } catch (error) {
        const message = buildWatchlistRuleErrorMessage(error, label, ruleLimit);
        setLastError(message);
        throw error;
      } finally {
        setBusyKeys((current) => ({ ...current, [busyKey]: false }));
      }
    },
    [busyKeys, createWatchlistRuleMutation, deleteWatchlistRuleMutation, ensurePrimaryWatchlist, ruleLimit, ruleMaps]
  );

  const errorMessage =
    lastError ??
    (watchlistsQuery.error instanceof Error ? watchlistsQuery.error.message : watchlistsQuery.error ? 'Unable to load saved items.' : null);

  return {
    watchlists,
    primaryWatchlist,
    primaryWatchlistId,
    isLoading: watchlistsQuery.isPending || createWatchlistMutation.isPending,
    errorMessage,
    busyKeys,
    launchRuleIdsByLaunchId: ruleMaps.launchRuleIdsByLaunchId,
    providerRuleIdsByValue: ruleMaps.providerRuleIdsByValue,
    padRuleIdsByValue: ruleMaps.padRuleIdsByValue,
    rocketRuleIdsByValue: ruleMaps.rocketRuleIdsByValue,
    launchSiteRuleIdsByValue: ruleMaps.launchSiteRuleIdsByValue,
    stateRuleIdsByValue: ruleMaps.stateRuleIdsByValue,
    isLaunchTracked: (launchId) => {
      const normalizedLaunchId = String(launchId || '').trim();
      return Boolean(normalizedLaunchId && ruleMaps.launchRuleIdsByLaunchId[normalizedLaunchId]);
    },
    isProviderTracked: (provider) => {
      const normalizedProvider = String(provider || '').trim().toLowerCase();
      return Boolean(normalizedProvider && ruleMaps.providerRuleIdsByValue[normalizedProvider]);
    },
    isPadTracked: (ruleValue) => {
      const normalizedRuleValue = String(ruleValue || '').trim().toLowerCase();
      return Boolean(normalizedRuleValue && ruleMaps.padRuleIdsByValue[normalizedRuleValue]);
    },
    isRocketTracked: (ruleValue) => {
      const normalizedRuleValue = String(ruleValue || '').trim().toLowerCase();
      return Boolean(normalizedRuleValue && ruleMaps.rocketRuleIdsByValue[normalizedRuleValue]);
    },
    isLaunchSiteTracked: (ruleValue) => {
      const normalizedRuleValue = String(ruleValue || '').trim().toLowerCase();
      return Boolean(normalizedRuleValue && ruleMaps.launchSiteRuleIdsByValue[normalizedRuleValue]);
    },
    isStateTracked: (ruleValue) => {
      const normalizedRuleValue = String(ruleValue || '').trim().toLowerCase();
      return Boolean(normalizedRuleValue && ruleMaps.stateRuleIdsByValue[normalizedRuleValue]);
    },
    isTracked: (kind, ruleValue) => {
      if (kind === 'launch') {
        const normalizedLaunchId = String(ruleValue || '').trim();
        return Boolean(normalizedLaunchId && ruleMaps.launchRuleIdsByLaunchId[normalizedLaunchId]);
      }
      const normalizedRuleValue = String(ruleValue || '').trim().toLowerCase();
      if (!normalizedRuleValue) return false;
      if (kind === 'provider') return Boolean(ruleMaps.providerRuleIdsByValue[normalizedRuleValue]);
      if (kind === 'pad') return Boolean(ruleMaps.padRuleIdsByValue[normalizedRuleValue]);
      if (kind === 'rocket') return Boolean(ruleMaps.rocketRuleIdsByValue[normalizedRuleValue]);
      if (kind === 'launch_site') return Boolean(ruleMaps.launchSiteRuleIdsByValue[normalizedRuleValue]);
      return Boolean(ruleMaps.stateRuleIdsByValue[normalizedRuleValue]);
    },
    ensurePrimaryWatchlist,
    toggleRule,
    toggleLaunch: (launchId) =>
      toggleRule({
        kind: 'launch',
        ruleValue: launchId,
        label: 'My Launches'
      }),
    toggleProvider: (provider) =>
      toggleRule({
        kind: 'provider',
        ruleValue: provider,
        label: String(provider || 'Provider').trim() || 'Provider'
      }),
    togglePad: (ruleValue) =>
      toggleRule({
        kind: 'pad',
        ruleValue,
        label: formatPadRuleLabel(ruleValue)
      }),
    toggleRocket: (ruleValue, label) =>
      toggleRule({
        kind: 'rocket',
        ruleValue,
        label: String(label || ruleValue || 'Rocket').trim() || 'Rocket'
      }),
    toggleLaunchSite: (ruleValue, label) =>
      toggleRule({
        kind: 'launch_site',
        ruleValue,
        label: String(label || ruleValue || 'Launch site').trim() || 'Launch site'
      }),
    toggleState: (ruleValue, label) =>
      toggleRule({
        kind: 'state',
        ruleValue,
        label: String(label || ruleValue || 'State').trim().toUpperCase() || 'State'
      })
  };
}
