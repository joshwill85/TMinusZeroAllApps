import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@tminuszero/api-client';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_LAUNCH_FILTERS,
  areLaunchFilterValuesEqual,
  countActiveLaunchFilters,
  formatLaunchFilterLocationOptionLabel,
  formatLaunchFilterStatusLabel,
  normalizeLaunchFilterValue,
  type LaunchFilterOptions,
  type LaunchFilterValue
} from '@tminuszero/domain';
import { buildLaunchHref, buildSearchHref } from '@tminuszero/navigation';
import {
  prefetchLaunchDetail,
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useCreateFilterPresetMutation,
  useDeleteWatchlistRuleMutation,
  useFilterPresetsQuery,
  useLaunchFeedQuery,
  useLaunchFilterOptionsQuery,
  useUpdateFilterPresetMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery,
  useWatchlistsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard } from '@/src/components/SectionCard';
import { useApiClient } from '@/src/api/client';
import { LaunchFilterSheet } from '@/src/components/LaunchFilterSheet';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { WebParityLaunchCard } from '@/src/components/WebParityLaunchCard';
import { getProgramHubEntryHref } from '@/src/features/programHubs/rollout';
import { buildPadRuleValue, formatPadRuleLabel, resolvePrimaryWatchlist } from '@/src/watchlists/usePrimaryWatchlist';
import artemisProgramLogo from '../../assets/program-logos/artemis-nasa-official.png';
import spacexProgramLogo from '../../assets/program-logos/spacex-official.png';
import blueOriginProgramLogo from '../../assets/program-logos/blueorigin-official.png';

export default function FeedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { accessToken, theme } = useMobileBootstrap();
  const { baseUrl, client } = useApiClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const filterPresetsQuery = useFilterPresetsQuery();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();
  const createFilterPresetMutation = useCreateFilterPresetMutation();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<LaunchFilterValue>({ ...DEFAULT_LAUNCH_FILTERS });
  const [activePresetId, setActivePresetId] = useState('');
  const [feedMode, setFeedMode] = useState<'for-you' | 'following'>('for-you');
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({});
  const [didAttemptEnsureWatchlist, setDidAttemptEnsureWatchlist] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; message: string } | null>(null);
  const didApplyInitialDefaultPresetRef = useRef(false);
  const canUseLaunchFilters = entitlementsQuery.data?.capabilities.canUseLaunchFilters ?? false;
  const canManageFilterPresets = entitlementsQuery.data?.capabilities.canManageFilterPresets ?? false;
  const canUseSavedItems = entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const watchlistRuleLimit = entitlementsQuery.data?.limits.watchlistRuleLimit ?? null;
  const refreshIntervalMs = (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200) * 1000;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const watchlists = useMemo(() => watchlistsQuery.data?.watchlists ?? [], [watchlistsQuery.data?.watchlists]);
  const primaryWatchlist = useMemo(() => resolvePrimaryWatchlist(watchlists), [watchlists]);
  const primaryWatchlistId = primaryWatchlist?.id ?? null;
  const isFollowingFeed = feedMode === 'following' && Boolean(primaryWatchlistId) && canUseSavedItems;
  const watchlistsLoading = canUseSavedItems && (watchlistsQuery.isPending || createWatchlistMutation.isPending);
  const watchlistsError =
    canUseSavedItems && watchlistsQuery.isError
      ? watchlistsQuery.error instanceof Error
        ? watchlistsQuery.error.message
        : 'Unable to load My Launches.'
      : null;
  const watchlistRuleIdsByLaunchId = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'launch' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const providerRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'provider' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const padRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'pad' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const filterOptionsQuery = useLaunchFilterOptionsQuery(
    {
      mode: feedScope,
      range: filters.range ?? DEFAULT_LAUNCH_FILTERS.range,
      region: filters.region ?? DEFAULT_LAUNCH_FILTERS.region,
      location: filters.location ?? null,
      state: filters.state ?? null,
      pad: filters.pad ?? null,
      provider: filters.provider ?? null,
      status: filters.status && filters.status !== 'all' ? filters.status : null
    },
    { enabled: canUseLaunchFilters }
  );
  const filterOptions = useMemo<LaunchFilterOptions>(
    () =>
      filterOptionsQuery.data ?? {
        providers: [],
        locations: [],
        states: [],
        pads: [],
        statuses: []
      },
    [filterOptionsQuery.data]
  );
  const presetList = useMemo(
    () =>
      (!canManageFilterPresets ? [] : filterPresetsQuery.data?.presets ?? [])
        .map((preset) => {
          const id = String(preset.id || '').trim();
          if (!id) return null;
          return {
            id,
            name: String(preset.name || '').trim() || 'Saved view',
            filters: normalizeLaunchFilterValue(preset.filters),
            isDefault: preset.isDefault === true
          };
        })
        .filter((preset): preset is { id: string; name: string; filters: LaunchFilterValue; isDefault: boolean } => preset != null),
    [canManageFilterPresets, filterPresetsQuery.data]
  );
  const activeFilterCount = countActiveLaunchFilters(filters);
  const launchFeedQuery = useLaunchFeedQuery(
    {
      scope: isFollowingFeed ? 'watchlist' : feedScope,
      watchlistId: isFollowingFeed ? primaryWatchlistId : null,
      range: filters.range ?? DEFAULT_LAUNCH_FILTERS.range,
      region: filters.region ?? DEFAULT_LAUNCH_FILTERS.region,
      location: filters.location ?? null,
      state: filters.state ?? null,
      pad: filters.pad ?? null,
      provider: filters.provider ?? null,
      sort: filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort,
      status: filters.status && filters.status !== 'all' ? filters.status : null
    },
    {
      staleTimeMs: refreshIntervalMs
    }
  );
  const launches = launchFeedQuery.data?.pages.flatMap((page) => page.launches) ?? [];
  const nextLaunch = launches[0] ?? null;
  const activePreset = presetList.find((preset) => preset.id === activePresetId) ?? null;
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if ((filters.range ?? DEFAULT_LAUNCH_FILTERS.range) !== DEFAULT_LAUNCH_FILTERS.range) {
      labels.push(filters.range === '7d' ? 'Next 7 days' : filters.range === 'month' ? 'Next 30 days' : filters.range === 'today' ? 'Today' : filters.range === 'past' ? 'Past launches' : filters.range === 'all' ? 'All time' : 'Next 12 months');
    }
    if ((filters.region ?? DEFAULT_LAUNCH_FILTERS.region) !== DEFAULT_LAUNCH_FILTERS.region) {
      labels.push(filters.region === 'all' ? 'All locations' : filters.region === 'non-us' ? 'Non-US' : 'US only');
    }
    if ((filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort) !== DEFAULT_LAUNCH_FILTERS.sort) {
      labels.push(filters.sort === 'latest' ? 'Newest first' : 'Recently updated');
    }
    if (filters.location) labels.push(formatLaunchFilterLocationOptionLabel(filters.location));
    if (filters.state) labels.push(filters.state);
    if (filters.provider) labels.push(filters.provider);
    if (filters.pad) labels.push(filters.pad);
    if (filters.status && filters.status !== 'all') labels.push(formatLaunchFilterStatusLabel(filters.status));
    return labels;
  }, [filters]);

  useEffect(() => {
    if (canUseLaunchFilters) return;
    didApplyInitialDefaultPresetRef.current = false;
    setActivePresetId('');
    setFilters((current) => (areLaunchFilterValuesEqual(current, DEFAULT_LAUNCH_FILTERS) ? current : { ...DEFAULT_LAUNCH_FILTERS }));
  }, [canUseLaunchFilters]);

  useEffect(() => {
    if (canManageFilterPresets) return;
    didApplyInitialDefaultPresetRef.current = false;
    setActivePresetId('');
  }, [canManageFilterPresets]);

  useEffect(() => {
    if (!canManageFilterPresets) return;
    const defaultPreset = presetList.find((preset) => preset.isDefault) ?? null;
    if (defaultPreset?.id) {
      setActivePresetId(defaultPreset.id);
    }
    if (!didApplyInitialDefaultPresetRef.current && defaultPreset) {
      setFilters((current) => (areLaunchFilterValuesEqual(current, defaultPreset.filters) ? current : defaultPreset.filters));
      didApplyInitialDefaultPresetRef.current = true;
    }
  }, [canManageFilterPresets, presetList]);

  useEffect(() => {
    if (!activePresetId) return;
    const preset = presetList.find((candidate) => candidate.id === activePresetId);
    if (!preset) {
      setActivePresetId('');
      return;
    }
    if (!areLaunchFilterValuesEqual(filters, preset.filters)) {
      setActivePresetId('');
    }
  }, [activePresetId, filters, presetList]);

  useEffect(() => {
    if (accessToken && canUseSavedItems) {
      return;
    }
    setFeedMode('for-you');
  }, [accessToken, canUseSavedItems]);

  useEffect(() => {
    if (!accessToken || !canUseSavedItems) {
      setDidAttemptEnsureWatchlist(false);
      return;
    }
    if (watchlists.length > 0) {
      setDidAttemptEnsureWatchlist(false);
    }
  }, [accessToken, canUseSavedItems, watchlists.length]);

  useEffect(() => {
    if (!accessToken || !canUseSavedItems) {
      return;
    }
    if (!watchlistsQuery.isSuccess || watchlists.length > 0 || didAttemptEnsureWatchlist || createWatchlistMutation.isPending) {
      return;
    }

    setDidAttemptEnsureWatchlist(true);
    void createWatchlistMutation.mutateAsync({}).catch((error) => {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'My Launches', watchlistRuleLimit)
      });
    });
  }, [
    accessToken,
    canUseSavedItems,
    createWatchlistMutation,
    didAttemptEnsureWatchlist,
    watchlistRuleLimit,
    watchlists.length,
    watchlistsQuery.isSuccess
  ]);

  useEffect(() => {
    if (!canUseLaunchFilters || !filterOptionsQuery.data) return;
    setFilters((current) => {
      const next: LaunchFilterValue = { ...current };
      let changed = false;

      if (current.location && !filterOptions.locations.includes(current.location)) {
        next.location = undefined;
        changed = true;
      }
      if (current.state && !filterOptions.states.includes(current.state)) {
        next.state = undefined;
        changed = true;
      }
      if (current.pad && !filterOptions.pads.includes(current.pad)) {
        next.pad = undefined;
        changed = true;
      }
      if (current.provider && !filterOptions.providers.includes(current.provider)) {
        next.provider = undefined;
        changed = true;
      }
      if (current.status && current.status !== 'all' && !filterOptions.statuses.includes(current.status)) {
        next.status = 'all';
        changed = true;
      }

      return changed ? next : current;
    });
  }, [canUseLaunchFilters, filterOptions, filterOptionsQuery.data]);

  async function handleSavePreset(name: string) {
    if (!canManageFilterPresets) return;

    try {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }

      const payload = activePresetId
        ? await updateFilterPresetMutation.mutateAsync({
            presetId: activePresetId,
            payload: {
              name: normalizedName,
              filters
            }
          })
        : await createFilterPresetMutation.mutateAsync({
            name: normalizedName,
            filters,
            isDefault: false
          });
      if (payload.preset?.id) {
        setActivePresetId(String(payload.preset.id));
      }
      setNotice({ tone: 'info', message: activePresetId ? 'Saved view updated.' : 'Saved view created.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save this view.';
      setNotice({ tone: 'warning', message });
    }
  }

  async function handleSetDefaultPreset() {
    if (!canManageFilterPresets || !activePresetId) return;

    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: activePresetId,
        payload: {
          isDefault: true
        }
      });
      setNotice({ tone: 'info', message: 'Default view updated.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to set the default view.';
      setNotice({ tone: 'warning', message });
    }
  }

  function clearFiltersToDefault() {
    setActivePresetId('');
    setFilters({ ...DEFAULT_LAUNCH_FILTERS });
  }

  async function ensurePrimaryWatchlistId() {
    if (!canUseSavedItems || !accessToken) {
      return null;
    }
    if (primaryWatchlistId) {
      return primaryWatchlistId;
    }

    const payload = await createWatchlistMutation.mutateAsync({});
    return payload.watchlist.id ?? null;
  }

  async function toggleLaunchWatch(launchId: string) {
    const busyKey = `launch:${launchId.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = watchlistRuleIdsByLaunchId[launchId] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: 'Removed from My Launches.' });
        return;
      }

      await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'launch',
          ruleValue: launchId
        }
      });
      setNotice({ tone: 'info', message: 'Added to My Launches.' });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'My Launches', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function toggleProviderFollow(provider: string) {
    const normalizedProvider = String(provider || '').trim();
    if (!normalizedProvider) {
      return;
    }

    const busyKey = `provider:${normalizedProvider.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = providerRuleIdsByValue[normalizedProvider.toLowerCase()] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: `Unfollowed ${normalizedProvider}.` });
        return;
      }

      await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'provider',
          ruleValue: normalizedProvider
        }
      });
      setNotice({ tone: 'info', message: `Following ${normalizedProvider}.` });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function togglePadFollow(ruleValue: string) {
    const normalizedRuleValue = String(ruleValue || '').trim();
    if (!normalizedRuleValue) {
      return;
    }

    const busyKey = `pad:${normalizedRuleValue.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = padRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: `Unfollowed ${formatPadRuleLabel(normalizedRuleValue)}.` });
        return;
      }

      await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'pad',
          ruleValue: normalizedRuleValue
        }
      });
      setNotice({ tone: 'info', message: `Following ${formatPadRuleLabel(normalizedRuleValue)}.` });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  return (
    <AppScreen testID="feed-screen">
      <View
        style={{
          marginTop: Math.max(insets.top - 10, 8),
          overflow: 'hidden',
          borderRadius: 999,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(7, 9, 19, 0.72)',
          paddingHorizontal: 16,
          paddingVertical: 11
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: theme.accent }} />
            <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>
              T-Minus Zero
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text
              numberOfLines={1}
              style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' }}
            >
              Comm Link
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                testID="feed-filters-button"
                onPress={() => {
                  setFiltersOpen(true);
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                  Filters{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  router.push('/search');
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Search</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 1.2,
            textTransform: 'uppercase'
          }}
        >
          Launch schedule
        </Text>
        <Text style={{ color: theme.foreground, fontSize: 32, fontWeight: '800', lineHeight: 36 }}>
          US Rocket Launch Schedule & Countdown
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 23 }}>
          Track upcoming US rocket launches with NET windows, countdowns, and coverage links.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {PROGRAM_ITEMS.map((item) => (
          <Pressable
            key={item.label}
            testID={item.testID}
            onPress={() => {
              const nativeHref = getProgramHubEntryHref(viewerSessionQuery.data, item.hub);
              router.push((nativeHref || buildSearchHref(item.query)) as Href);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 10,
              opacity: pressed ? 0.85 : 1
            })}
            accessibilityLabel={item.accessibilityLabel}
          >
            <Image source={item.logo} resizeMode="contain" style={item.logoStyle} />
          </Pressable>
        ))}
      </View>

      {notice ? (
        <View
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.surface,
            paddingHorizontal: 16,
            paddingVertical: 12
          }}
        >
          <Text style={{ color: notice.tone === 'warning' ? theme.foreground : theme.accent, fontSize: 14, lineHeight: 20 }}>
            {notice.message}
          </Text>
        </View>
      ) : null}

      {accessToken ? (
        <View
          style={{
            gap: 10,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.surface,
            padding: 16
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ModeButton
              label="For You"
              active={feedMode === 'for-you'}
              onPress={() => setFeedMode('for-you')}
            />
            <ModeButton
              label="Following"
              active={feedMode === 'following'}
              disabled={watchlistsLoading}
              onPress={() => {
                if (!canUseSavedItems) {
                  router.push('/profile');
                  return;
                }
                setFeedMode('following');
              }}
            />
          </View>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
            {canUseSavedItems
              ? feedMode === 'following'
                ? primaryWatchlist?.rules.length
                  ? 'Showing launches from My Launches follows and saved launch rules.'
                  : 'Following is empty. Save a launch or follow a provider or pad to populate this feed.'
                : 'For You shows launches matching your current filters.'
              : 'Following stays on Premium. Free accounts keep the public and live feed plus filters.'}
          </Text>
          {watchlistsError ? <Text style={{ color: '#ff9087', fontSize: 12, lineHeight: 18 }}>{watchlistsError}</Text> : null}
        </View>
      ) : null}

      {canUseLaunchFilters && activeFilterCount > 0 ? (
        <View
          style={{
            gap: 10,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.surface,
            padding: 16
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>Active filters</Text>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                {activePreset ? `${activePreset.name} · ` : ''}
                {activeFilterCount} active
              </Text>
            </View>
            <Pressable
              onPress={clearFiltersToDefault}
              hitSlop={8}
            >
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Reset</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {activeFilterLabels.map((label, index) => (
              <View
                key={`${label}:${index}`}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: theme.background,
                  paddingHorizontal: 10,
                  paddingVertical: 7
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {launchFeedQuery.isPending ? (
        <LoadingStateCard title="Loading launches" body="Fetching the latest upcoming missions." />
      ) : launchFeedQuery.isError ? (
        <ErrorStateCard title="Feed unavailable" body={launchFeedQuery.error.message} />
      ) : launches.length === 0 ? (
        <EmptyStateCard title="No upcoming launches right now" body={`We could not find any scheduled launches. Data source: ${baseUrl}.`} />
      ) : (
        <View testID="feed-launches-section" style={{ gap: 14 }}>
          {launches.map((launch, index) => {
            const providerKey = String(launch.provider || '').trim().toLowerCase();
            const padRuleValue = buildPadRuleValue({
              ll2PadId: launch.ll2PadId,
              padShortCode: launch.pad.shortCode
            });
            const normalizedPadRuleValue = String(padRuleValue || '').trim().toLowerCase();

            return (
              <WebParityLaunchCard
                key={launch.id}
                launch={launch}
                isNext={index === 0 || launch.id === nextLaunch?.id}
                testID={index === 0 ? 'feed-launch-first' : index === 1 ? 'feed-launch-second' : `feed-launch-${launch.id}`}
                onOpenDetails={() => {
                  void prefetchLaunchDetail(queryClient, client, launch.id);
                  router.push(buildLaunchHref(launch.id) as Href);
                }}
                onOpenProvider={
                  launch.provider
                    ? () => {
                        router.push(buildSearchHref(launch.provider) as Href);
                      }
                    : undefined
                }
                onOpenPad={() => {
                  const padQuery = launch.pad.locationName || launch.pad.name || launch.pad.shortCode;
                  if (!padQuery) return;
                  router.push(buildSearchHref(padQuery) as Href);
                }}
                isWatched={Boolean(watchlistRuleIdsByLaunchId[launch.id])}
                watchDisabled={
                  !canUseSavedItems ||
                  watchlistsLoading ||
                  Boolean(watchlistsError) ||
                  Boolean(followBusy[`launch:${launch.id.toLowerCase()}`])
                }
                onToggleWatch={
                  canUseSavedItems
                    ? () => {
                        void toggleLaunchWatch(launch.id);
                      }
                    : undefined
                }
                isProviderFollowed={Boolean(providerRuleIdsByValue[providerKey])}
                providerFollowDisabled={
                  !canUseSavedItems ||
                  !providerKey ||
                  watchlistsLoading ||
                  Boolean(watchlistsError) ||
                  Boolean(followBusy[`provider:${providerKey}`])
                }
                onToggleFollowProvider={
                  canUseSavedItems && providerKey
                    ? () => {
                        void toggleProviderFollow(launch.provider);
                      }
                    : undefined
                }
                isPadFollowed={Boolean(normalizedPadRuleValue && padRuleIdsByValue[normalizedPadRuleValue])}
                padFollowDisabled={
                  !canUseSavedItems ||
                  !padRuleValue ||
                  watchlistsLoading ||
                  Boolean(watchlistsError) ||
                  Boolean(followBusy[`pad:${normalizedPadRuleValue}`])
                }
                onToggleFollowPad={
                  canUseSavedItems && padRuleValue
                    ? () => {
                        void togglePadFollow(padRuleValue);
                      }
                    : undefined
                }
              />
            );
          })}
          {launchFeedQuery.hasNextPage ? (
            <Pressable
              testID="feed-load-more"
              onPress={() => {
                void launchFeedQuery.fetchNextPage();
              }}
              disabled={launchFeedQuery.isFetchingNextPage}
              style={({ pressed }) => ({
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 18,
                paddingVertical: 14,
                opacity: launchFeedQuery.isFetchingNextPage ? 0.7 : 1
              })}
            >
              <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>
                {launchFeedQuery.isFetchingNextPage ? 'Loading…' : 'Load more launches'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <LaunchFilterSheet
        visible={filtersOpen}
        isAuthed={Boolean(accessToken)}
        canUseLaunchFilters={canUseLaunchFilters}
        canManageFilterPresets={canManageFilterPresets}
        filters={filters}
        filterOptions={filterOptions}
        filterOptionsLoading={filterOptionsQuery.isPending}
        filterOptionsError={filterOptionsQuery.isError ? filterOptionsQuery.error.message : null}
        presets={presetList}
        activePresetId={activePresetId}
        presetSaving={createFilterPresetMutation.isPending || updateFilterPresetMutation.isPending}
        presetDefaulting={updateFilterPresetMutation.isPending}
        onClose={() => setFiltersOpen(false)}
        onChange={(next) => {
          setNotice(null);
          setFilters(next);
        }}
        onReset={() => {
          setNotice(null);
          clearFiltersToDefault();
        }}
        onApplyPreset={(presetId) => {
          const preset = presetList.find((candidate) => candidate.id === presetId);
          if (!preset) return;
          setNotice(null);
          setActivePresetId(presetId);
          setFilters(preset.filters);
        }}
        onSavePreset={handleSavePreset}
        onSetDefaultPreset={handleSetDefaultPreset}
        onOpenUpgrade={() => {
          setFiltersOpen(false);
          router.push('/profile');
        }}
        onOpenSignIn={() => {
          setFiltersOpen(false);
          router.push('/sign-in');
        }}
      />
    </AppScreen>
  );
}

function ModeButton({
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
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? theme.accent : theme.background,
        paddingHorizontal: 14,
        paddingVertical: 9,
        opacity: disabled ? 0.5 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: active ? theme.background : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function buildWatchlistRuleErrorMessage(error: unknown, label: string, ruleLimit: number | null) {
  if (error instanceof ApiClientError) {
    if (error.code === 'limit_reached') {
      return ruleLimit ? `My Launches limit reached (${ruleLimit} rules).` : 'My Launches limit reached.';
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

const PROGRAM_ITEMS = [
  {
    hub: 'artemis',
    label: 'Artemis',
    accessibilityLabel: 'Artemis Program',
    query: 'artemis',
    testID: 'feed-program-artemis',
    logo: artemisProgramLogo,
    logoStyle: { width: 74, height: 38 }
  },
  {
    hub: 'spacex',
    label: 'SpaceX',
    accessibilityLabel: 'SpaceX Program',
    query: 'spacex',
    testID: 'feed-program-spacex',
    logo: spacexProgramLogo,
    logoStyle: { width: 106, height: 24 }
  },
  {
    hub: 'blueOrigin',
    label: 'Blue Origin',
    accessibilityLabel: 'Blue Origin Program',
    query: 'blue origin',
    testID: 'feed-program-blue-origin',
    logo: blueOriginProgramLogo,
    logoStyle: { width: 42, height: 42 }
  }
] as const;
