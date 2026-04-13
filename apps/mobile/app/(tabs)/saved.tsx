import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  ApiClientError,
  type FilterPresetV1,
  type WatchlistRuleV1,
  type WatchlistV1
} from '@tminuszero/api-client';
import { getMobileViewerTier } from '@tminuszero/domain';
import {
  useAlertRulesQuery,
  useCreateAlertRuleMutation,
  useCreateWatchlistMutation,
  useDeleteAlertRuleMutation,
  useDeleteFilterPresetMutation,
  useDeleteWatchlistMutation,
  useDeleteWatchlistRuleMutation,
  useFilterPresetsQuery,
  useUpdateFilterPresetMutation,
  useUpdateWatchlistMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  buildWatchlistCreateLimitMessage,
  isWatchlistCreateLimitError
} from '@/src/watchlists/errorMessages';

type NoticeTone = 'info' | 'success' | 'warning';
type Notice = { tone: NoticeTone; message: string } | null;

export default function SavedScreen() {
  const { theme } = useMobileBootstrap();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const canUseSavedItems =
    entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const canUseAdvancedAlertRules =
    entitlementsQuery.data?.capabilities.canUseAdvancedAlertRules ?? false;
  const watchlistsQuery = useWatchlistsQuery({ enabled: canUseSavedItems });
  const filterPresetsQuery = useFilterPresetsQuery({
    enabled: canUseSavedItems
  });
  const alertRulesQuery = useAlertRulesQuery({
    enabled: canUseSavedItems && canUseAdvancedAlertRules
  });
  const createWatchlistMutation = useCreateWatchlistMutation();
  const updateWatchlistMutation = useUpdateWatchlistMutation();
  const deleteWatchlistMutation = useDeleteWatchlistMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const deleteFilterPresetMutation = useDeleteFilterPresetMutation();
  const createAlertRuleMutation = useCreateAlertRuleMutation();
  const deleteAlertRuleMutation = useDeleteAlertRuleMutation();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | null>(
    null
  );
  const [editingWatchlistName, setEditingWatchlistName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const limits = entitlementsQuery.data?.limits;
  const watchlists = canUseSavedItems
    ? (watchlistsQuery.data?.watchlists ?? [])
    : [];
  const presets = canUseSavedItems
    ? (filterPresetsQuery.data?.presets ?? [])
    : [];
  const alertRules = useMemo(
    () =>
      canUseSavedItems && canUseAdvancedAlertRules
        ? (alertRulesQuery.data?.rules ?? [])
        : [],
    [alertRulesQuery.data?.rules, canUseAdvancedAlertRules, canUseSavedItems]
  );
  const readOnly = !canUseSavedItems;
  const alertsLoading =
    canUseSavedItems && canUseAdvancedAlertRules && alertRulesQuery.isPending;
  const presetAlertRuleIds = useMemo(() => {
    return new Map(
      alertRules
        .filter((rule) => rule.kind === 'filter_preset')
        .map((rule) => [rule.presetId, rule.id])
    );
  }, [alertRules]);
  const followAlertRuleIds = useMemo(() => {
    return new Map(
      alertRules
        .filter((rule) => rule.kind === 'follow')
        .map((rule) => [
          buildFollowAlertRuleKey(rule.followRuleType, rule.followRuleValue),
          rule.id
        ])
    );
  }, [alertRules]);
  const savedError =
    (canUseSavedItems && watchlistsQuery.error instanceof Error
      ? watchlistsQuery.error.message
      : null) ||
    (canUseSavedItems && filterPresetsQuery.error instanceof Error
      ? filterPresetsQuery.error.message
      : null) ||
    (canUseSavedItems &&
    canUseAdvancedAlertRules &&
    alertRulesQuery.error instanceof Error
      ? alertRulesQuery.error.message
      : null);
  const statusMessage = notice?.message ?? savedError;
  const statusTone: NoticeTone = notice?.tone ?? 'warning';

  async function createWatchlist() {
    if (!canUseSavedItems) return;
    const name = newWatchlistName.trim();
    if (!name) return;
    const busyKey = 'watchlist:create';
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await createWatchlistMutation.mutateAsync({ name });
      setNewWatchlistName('');
      setNotice({ tone: 'success', message: `Created watchlist "${name}".` });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to create watchlist.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  function beginWatchlistRename(watchlist: WatchlistV1) {
    if (readOnly) return;
    setEditingWatchlistId(watchlist.id);
    setEditingWatchlistName(watchlist.name);
    setNotice(null);
  }

  function cancelWatchlistRename() {
    setEditingWatchlistId(null);
    setEditingWatchlistName('');
  }

  async function saveWatchlistRename(watchlist: WatchlistV1) {
    if (readOnly) return;
    const nextName = editingWatchlistName.trim();
    if (!nextName || nextName === watchlist.name) {
      cancelWatchlistRename();
      return;
    }

    const busyKey = `watchlist:rename:${watchlist.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateWatchlistMutation.mutateAsync({
        watchlistId: watchlist.id,
        payload: { name: nextName }
      });
      cancelWatchlistRename();
      setNotice({
        tone: 'success',
        message: `Renamed watchlist to "${nextName}".`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to rename watchlist.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  function confirmDeleteWatchlist(watchlist: WatchlistV1) {
    if (readOnly) return;
    Alert.alert(
      'Delete watchlist?',
      `Delete "${watchlist.name}" and remove all of its follow rules?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteWatchlist(watchlist);
          }
        }
      ]
    );
  }

  async function deleteWatchlist(watchlist: WatchlistV1) {
    if (readOnly) return;
    const busyKey = `watchlist:delete:${watchlist.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteWatchlistMutation.mutateAsync(watchlist.id);
      if (editingWatchlistId === watchlist.id) {
        cancelWatchlistRename();
      }
      setNotice({
        tone: 'info',
        message: `Deleted watchlist "${watchlist.name}".`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to delete watchlist.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  function confirmRemoveRule(watchlist: WatchlistV1, rule: WatchlistRuleV1) {
    if (readOnly) return;
    Alert.alert(
      'Remove rule?',
      `Remove ${formatWatchlistRuleLabel(rule.ruleType)} "${formatWatchlistRuleValue(rule.ruleType, rule.ruleValue)}" from "${watchlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeRule(watchlist, rule);
          }
        }
      ]
    );
  }

  async function removeRule(watchlist: WatchlistV1, rule: WatchlistRuleV1) {
    if (readOnly) return;
    const busyKey = `rule:delete:${rule.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteWatchlistRuleMutation.mutateAsync({
        watchlistId: watchlist.id,
        ruleId: rule.id
      });
      setNotice({ tone: 'info', message: 'Removed follow rule.' });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to remove follow rule.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  function beginPresetRename(preset: FilterPresetV1) {
    if (readOnly) return;
    setEditingPresetId(preset.id);
    setEditingPresetName(preset.name);
    setNotice(null);
  }

  function cancelPresetRename() {
    setEditingPresetId(null);
    setEditingPresetName('');
  }

  async function savePresetRename(preset: FilterPresetV1) {
    if (readOnly) return;
    const nextName = editingPresetName.trim();
    if (!nextName || nextName === preset.name) {
      cancelPresetRename();
      return;
    }

    const busyKey = `preset:rename:${preset.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: preset.id,
        payload: { name: nextName }
      });
      cancelPresetRename();
      setNotice({
        tone: 'success',
        message: `Renamed preset to "${nextName}".`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to rename preset.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function setDefaultPreset(preset: FilterPresetV1) {
    if (readOnly || preset.isDefault) return;
    const busyKey = `preset:default:${preset.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: preset.id,
        payload: { isDefault: true }
      });
      setNotice({
        tone: 'success',
        message: `"${preset.name}" is now your default view.`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(
          error,
          'Unable to set the default preset.'
        )
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  function confirmDeletePreset(preset: FilterPresetV1) {
    if (readOnly) return;
    Alert.alert('Delete preset?', `Delete saved view "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deletePreset(preset);
        }
      }
    ]);
  }

  async function deletePreset(preset: FilterPresetV1) {
    if (readOnly) return;
    const busyKey = `preset:delete:${preset.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      await deleteFilterPresetMutation.mutateAsync(preset.id);
      if (editingPresetId === preset.id) {
        cancelPresetRename();
      }
      setNotice({ tone: 'info', message: `Deleted preset "${preset.name}".` });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(error, 'Unable to delete preset.')
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function toggleFollowAlertRule(rule: WatchlistRuleV1) {
    if (readOnly || !canUseAdvancedAlertRules) return;
    const followRuleType = normalizeWatchlistAlertRuleType(rule.ruleType);
    if (!followRuleType) return;

    const followKey = buildFollowAlertRuleKey(followRuleType, rule.ruleValue);
    const existingRuleId = followAlertRuleIds.get(followKey) ?? null;
    const busyKey = `alert:follow:${rule.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      if (existingRuleId) {
        await deleteAlertRuleMutation.mutateAsync(existingRuleId);
        setNotice({ tone: 'info', message: 'Follow alert removed.' });
      } else {
        await createAlertRuleMutation.mutateAsync({
          kind: 'follow',
          followRuleType,
          followRuleValue: rule.ruleValue
        });
        setNotice({ tone: 'success', message: 'Follow alert enabled.' });
      }
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(
          error,
          existingRuleId
            ? 'Unable to remove follow alert.'
            : 'Unable to enable follow alert.'
        )
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function togglePresetAlertRule(preset: FilterPresetV1) {
    if (readOnly || !canUseAdvancedAlertRules) return;
    const existingRuleId = presetAlertRuleIds.get(preset.id) ?? null;
    const busyKey = `alert:preset:${preset.id}`;
    if (busy[busyKey]) return;

    setBusy((current) => ({ ...current, [busyKey]: true }));
    setNotice(null);
    try {
      if (existingRuleId) {
        await deleteAlertRuleMutation.mutateAsync(existingRuleId);
        setNotice({
          tone: 'info',
          message: `Preset alerts disabled for "${preset.name}".`
        });
      } else {
        await createAlertRuleMutation.mutateAsync({
          kind: 'filter_preset',
          presetId: preset.id
        });
        setNotice({
          tone: 'success',
          message: `Preset alerts enabled for "${preset.name}".`
        });
      }
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildMutationMessage(
          error,
          existingRuleId
            ? 'Unable to disable preset alerts.'
            : 'Unable to enable preset alerts.'
        )
      });
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  return (
    <AppScreen testID="saved-screen" keyboardShouldPersistTaps="handled">
      <CustomerShellHero
        eyebrow="Account"
        title="Saved"
        description={
          canUseSavedItems
            ? 'Saved views, follows, and My Launches stay in sync on this account.'
            : isAuthed
              ? 'Saved views, follows, and My Launches require paid access. Without it, you can still use filters, the calendar, and basic reminders, but saved items do not sync.'
              : 'Saved views, follows, and My Launches require paid access. Public mobile browsing keeps filters, the calendar, and basic reminders without saved-item sync.'
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge
            label={formatTierLabel(tier, isAuthed)}
            tone={tier === 'premium' ? 'accent' : 'default'}
          />
          <CustomerShellBadge
            label={canUseSavedItems ? 'Saved enabled' : 'Public'}
            tone={canUseSavedItems ? 'success' : 'warning'}
          />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Saved access"
        description={
          tier === 'premium'
            ? 'Saved watchlists and reusable filter presets are available across this account.'
            : 'Public access does not include saved watchlists or reusable filter presets. Upgrade to Premium to create and manage them.'
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric
            label="Access"
            value={formatTierLabel(tier, isAuthed)}
            caption={
              tier === 'premium'
                ? limits
                  ? `${limits.watchlistLimit} watchlists · ${limits.presetLimit} presets`
                  : 'Saved watchlists and presets are available'
                : 'Premium unlocks saved watchlists and presets'
            }
          />
          <CustomerShellMetric
            label="Watchlists"
            value={canUseSavedItems ? String(watchlists.length) : '—'}
            caption={
              canUseSavedItems && limits
                ? `${limits.watchlistRuleLimit} rules per watchlist`
                : 'Premium only'
            }
          />
          <CustomerShellMetric
            label="Presets"
            value={canUseSavedItems ? String(presets.length) : '—'}
            caption={canUseSavedItems ? 'Saved launch filters' : 'Premium only'}
          />
        </View>
      </CustomerShellPanel>

      <ViewerTierCard
        tier={tier}
        isAuthed={isAuthed}
        featureKey="saved_items"
        testID="saved-tier-card"
      />

      {statusMessage ? (
        <View
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor:
              statusTone === 'warning'
                ? 'rgba(251, 191, 36, 0.25)'
                : theme.stroke,
            backgroundColor:
              statusTone === 'warning'
                ? 'rgba(251, 191, 36, 0.08)'
                : theme.surface,
            paddingHorizontal: 16,
            paddingVertical: 12
          }}
        >
          <Text
            style={{
              color:
                statusTone === 'warning'
                  ? '#ffd36e'
                  : statusTone === 'success'
                    ? theme.accent
                    : theme.foreground,
              fontSize: 14,
              lineHeight: 20
            }}
          >
            {statusMessage}
          </Text>
        </View>
      ) : null}

      {canUseSavedItems ? (
        <>
          <CustomerShellPanel
            testID="saved-watchlists-section"
            title="Watchlists"
            description="Create and maintain the lists that drive Following across launches, providers, and pads."
          >
            <View
              style={{
                gap: 10,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                padding: 14
              }}
            >
              <Text
                style={{
                  color: theme.foreground,
                  fontSize: 14,
                  fontWeight: '700'
                }}
              >
                Create watchlist
              </Text>
              <SavedTextInput
                value={newWatchlistName}
                onChangeText={setNewWatchlistName}
                placeholder="My Launches"
              />
              <InlineActionButton
                label={
                  busy['watchlist:create'] ? 'Creating…' : 'Create watchlist'
                }
                onPress={() => {
                  void createWatchlist();
                }}
                disabled={busy['watchlist:create'] || !newWatchlistName.trim()}
                tone="accent"
              />
            </View>

            {watchlistsQuery.isPending ? (
              <Text
                style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}
              >
                Loading watchlists…
              </Text>
            ) : watchlists.length === 0 ? (
              <Text
                testID="saved-watchlists-empty"
                style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}
              >
                No watchlists yet. Create one above to start organizing follows.
              </Text>
            ) : (
              <View style={{ gap: 12 }}>
                {watchlists.map((watchlist, index) => {
                  const groupedRules = groupWatchlistRules(watchlist.rules);
                  const isEditing = editingWatchlistId === watchlist.id;
                  const renameBusy = busy[`watchlist:rename:${watchlist.id}`];
                  const deleteBusy = busy[`watchlist:delete:${watchlist.id}`];

                  return (
                    <View
                      key={watchlist.id}
                      testID={
                        index === 0
                          ? 'saved-watchlist-first'
                          : `saved-watchlist-${watchlist.id}`
                      }
                      style={{
                        gap: 12,
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: 'rgba(234, 240, 255, 0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 14,
                        paddingVertical: 14
                      }}
                    >
                      <View style={{ gap: 10 }}>
                        {isEditing ? (
                          <View style={{ gap: 10 }}>
                            <SavedTextInput
                              value={editingWatchlistName}
                              onChangeText={setEditingWatchlistName}
                              placeholder="Watchlist name"
                              autoFocus
                            />
                            <View
                              style={{
                                flexDirection: 'row',
                                flexWrap: 'wrap',
                                gap: 8
                              }}
                            >
                              <InlineActionButton
                                label={renameBusy ? 'Saving…' : 'Save name'}
                                onPress={() => {
                                  void saveWatchlistRename(watchlist);
                                }}
                                disabled={
                                  renameBusy || !editingWatchlistName.trim()
                                }
                                tone="accent"
                              />
                              <InlineActionButton
                                label="Cancel"
                                onPress={cancelWatchlistRename}
                                disabled={renameBusy}
                              />
                            </View>
                          </View>
                        ) : (
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10
                            }}
                          >
                            <View style={{ flex: 1, gap: 4 }}>
                              <Text
                                style={{
                                  color: theme.foreground,
                                  fontSize: 16,
                                  fontWeight: '700'
                                }}
                              >
                                {watchlist.name}
                              </Text>
                              <Text
                                style={{
                                  color: theme.muted,
                                  fontSize: 13,
                                  lineHeight: 19
                                }}
                              >
                                {watchlist.ruleCount} rule
                                {watchlist.ruleCount === 1 ? '' : 's'}
                              </Text>
                            </View>
                            <CustomerShellBadge
                              label={`${watchlist.ruleCount} rule${watchlist.ruleCount === 1 ? '' : 's'}`}
                            />
                          </View>
                        )}

                        {!readOnly && !isEditing ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 8
                            }}
                          >
                            <InlineActionButton
                              label="Rename"
                              onPress={() => beginWatchlistRename(watchlist)}
                              disabled={renameBusy || deleteBusy}
                            />
                            <InlineActionButton
                              label={deleteBusy ? 'Deleting…' : 'Delete'}
                              onPress={() => confirmDeleteWatchlist(watchlist)}
                              disabled={deleteBusy}
                              tone="danger"
                            />
                          </View>
                        ) : null}
                      </View>

                      {Object.entries(groupedRules).length === 0 ? (
                        <Text
                          style={{
                            color: theme.muted,
                            fontSize: 13,
                            lineHeight: 19
                          }}
                        >
                          No rules in this watchlist yet.
                        </Text>
                      ) : (
                        <View style={{ gap: 12 }}>
                          {Object.entries(groupedRules).map(
                            ([groupKey, group]) => (
                              <View
                                key={`${watchlist.id}:${groupKey}`}
                                style={{ gap: 8 }}
                              >
                                <Text
                                  style={{
                                    color: theme.muted,
                                    fontSize: 11,
                                    fontWeight: '700',
                                    letterSpacing: 1,
                                    textTransform: 'uppercase'
                                  }}
                                >
                                  {group.title}
                                </Text>
                                <View style={{ gap: 8 }}>
                                  {group.rules.map((rule) => {
                                    const alertType =
                                      normalizeWatchlistAlertRuleType(
                                        rule.ruleType
                                      );
                                    const followAlertRuleId = alertType
                                      ? (followAlertRuleIds.get(
                                          buildFollowAlertRuleKey(
                                            alertType,
                                            rule.ruleValue
                                          )
                                        ) ?? null)
                                      : null;
                                    const alertBusy =
                                      busy[`alert:follow:${rule.id}`];
                                    const removeBusy =
                                      busy[`rule:delete:${rule.id}`];

                                    return (
                                      <View
                                        key={rule.id}
                                        style={{
                                          gap: 10,
                                          borderRadius: 16,
                                          borderWidth: 1,
                                          borderColor: theme.stroke,
                                          backgroundColor:
                                            'rgba(255, 255, 255, 0.02)',
                                          paddingHorizontal: 12,
                                          paddingVertical: 12
                                        }}
                                      >
                                        <View style={{ gap: 4 }}>
                                          <Text
                                            style={{
                                              color: theme.muted,
                                              fontSize: 11,
                                              fontWeight: '700',
                                              letterSpacing: 1,
                                              textTransform: 'uppercase'
                                            }}
                                          >
                                            {formatWatchlistRuleLabel(
                                              rule.ruleType
                                            )}
                                          </Text>
                                          <Text
                                            style={{
                                              color: theme.foreground,
                                              fontSize: 14,
                                              fontWeight: '700',
                                              lineHeight: 19
                                            }}
                                          >
                                            {formatWatchlistRuleValue(
                                              rule.ruleType,
                                              rule.ruleValue
                                            )}
                                          </Text>
                                        </View>
                                        <View
                                          style={{
                                            flexDirection: 'row',
                                            flexWrap: 'wrap',
                                            gap: 8
                                          }}
                                        >
                                          {!readOnly &&
                                          canUseAdvancedAlertRules &&
                                          alertType ? (
                                            <InlineActionButton
                                              label={
                                                alertBusy
                                                  ? 'Saving…'
                                                  : followAlertRuleId
                                                    ? 'Alerts on'
                                                    : alertsLoading
                                                      ? 'Loading alerts…'
                                                      : 'Use for alerts'
                                              }
                                              onPress={() => {
                                                void toggleFollowAlertRule(
                                                  rule
                                                );
                                              }}
                                              disabled={
                                                alertBusy || alertsLoading
                                              }
                                              tone={
                                                followAlertRuleId
                                                  ? 'accent'
                                                  : 'default'
                                              }
                                            />
                                          ) : followAlertRuleId ? (
                                            <InlineActionButton
                                              label="Alerts on"
                                              onPress={() => undefined}
                                              disabled
                                            />
                                          ) : null}
                                          {!readOnly ? (
                                            <InlineActionButton
                                              label={
                                                removeBusy
                                                  ? 'Removing…'
                                                  : 'Remove'
                                              }
                                              onPress={() =>
                                                confirmRemoveRule(
                                                  watchlist,
                                                  rule
                                                )
                                              }
                                              disabled={removeBusy}
                                              tone="danger"
                                            />
                                          ) : null}
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            )
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </CustomerShellPanel>

          <CustomerShellPanel
            title="Filter presets"
            description="Rename, delete, and promote the saved views that reshape your feed."
          >
            {filterPresetsQuery.isPending ? (
              <Text
                style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}
              >
                Loading saved filters…
              </Text>
            ) : presets.length === 0 ? (
              <Text
                style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}
              >
                No saved filters yet. Presets saved from Feed will appear here.
              </Text>
            ) : (
              <View style={{ gap: 12 }}>
                {presets.map((preset) => {
                  const isEditing = editingPresetId === preset.id;
                  const renameBusy = busy[`preset:rename:${preset.id}`];
                  const defaultBusy = busy[`preset:default:${preset.id}`];
                  const deleteBusy = busy[`preset:delete:${preset.id}`];
                  const presetAlertRuleId =
                    presetAlertRuleIds.get(preset.id) ?? null;
                  const presetAlertBusy = busy[`alert:preset:${preset.id}`];

                  return (
                    <View
                      key={preset.id}
                      style={{
                        gap: 12,
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: 'rgba(234, 240, 255, 0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 14,
                        paddingVertical: 14
                      }}
                    >
                      {isEditing ? (
                        <View style={{ gap: 10 }}>
                          <SavedTextInput
                            value={editingPresetName}
                            onChangeText={setEditingPresetName}
                            placeholder="Saved view name"
                            autoFocus
                          />
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 8
                            }}
                          >
                            <InlineActionButton
                              label={renameBusy ? 'Saving…' : 'Save name'}
                              onPress={() => {
                                void savePresetRename(preset);
                              }}
                              disabled={renameBusy || !editingPresetName.trim()}
                              tone="accent"
                            />
                            <InlineActionButton
                              label="Cancel"
                              onPress={cancelPresetRename}
                              disabled={renameBusy}
                            />
                          </View>
                        </View>
                      ) : (
                        <View style={{ gap: 8 }}>
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: 8
                            }}
                          >
                            <Text
                              style={{
                                color: theme.foreground,
                                fontSize: 16,
                                fontWeight: '700',
                                flex: 1
                              }}
                            >
                              {preset.name}
                            </Text>
                            {preset.isDefault ? (
                              <CustomerShellBadge
                                label="Default"
                                tone="accent"
                              />
                            ) : null}
                            <CustomerShellBadge
                              label={`${countPresetFilters(preset.filters)} filter${countPresetFilters(preset.filters) === 1 ? '' : 's'}`}
                            />
                          </View>
                          <Text
                            style={{
                              color: theme.muted,
                              fontSize: 13,
                              lineHeight: 19
                            }}
                          >
                            {summarizePresetFilters(preset.filters)}
                          </Text>
                        </View>
                      )}

                      {!readOnly && !isEditing ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8
                          }}
                        >
                          {canUseAdvancedAlertRules ? (
                            <InlineActionButton
                              label={
                                presetAlertBusy
                                  ? 'Saving…'
                                  : presetAlertRuleId
                                    ? 'Alerts on'
                                    : alertsLoading
                                      ? 'Loading alerts…'
                                      : 'Use for alerts'
                              }
                              onPress={() => {
                                void togglePresetAlertRule(preset);
                              }}
                              disabled={presetAlertBusy || alertsLoading}
                              tone={presetAlertRuleId ? 'accent' : 'default'}
                            />
                          ) : null}
                          <InlineActionButton
                            label={
                              defaultBusy
                                ? 'Saving…'
                                : preset.isDefault
                                  ? 'Default view'
                                  : 'Set default'
                            }
                            onPress={() => {
                              void setDefaultPreset(preset);
                            }}
                            disabled={defaultBusy || preset.isDefault}
                            tone={preset.isDefault ? 'accent' : 'default'}
                          />
                          <InlineActionButton
                            label="Rename"
                            onPress={() => beginPresetRename(preset)}
                            disabled={renameBusy || deleteBusy}
                          />
                          <InlineActionButton
                            label={deleteBusy ? 'Deleting…' : 'Delete'}
                            onPress={() => confirmDeletePreset(preset)}
                            disabled={deleteBusy}
                            tone="danger"
                          />
                        </View>
                      ) : !isEditing && presetAlertRuleId ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8
                          }}
                        >
                          <InlineActionButton
                            label="Alerts on"
                            onPress={() => undefined}
                            disabled
                            tone="accent"
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </CustomerShellPanel>
        </>
      ) : null}
    </AppScreen>
  );
}

function SavedTextInput({
  value,
  onChangeText,
  placeholder,
  autoFocus = false
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(154, 179, 197, 0.7)"
      autoFocus={autoFocus}
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: theme.background,
        color: theme.foreground,
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    />
  );
}

function InlineActionButton({
  label,
  onPress,
  disabled = false,
  tone = 'default'
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
}) {
  const { theme } = useMobileBootstrap();
  const colors =
    tone === 'accent'
      ? {
          borderColor: 'rgba(34, 211, 238, 0.2)',
          backgroundColor: 'rgba(34, 211, 238, 0.1)',
          textColor: theme.accent
        }
      : tone === 'danger'
        ? {
            borderColor: 'rgba(251, 113, 133, 0.25)',
            backgroundColor: 'rgba(251, 113, 133, 0.08)',
            textColor: '#ff9aab'
          }
        : {
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            textColor: theme.foreground
          };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.borderColor,
        backgroundColor: colors.backgroundColor,
        paddingHorizontal: 12,
        paddingVertical: 9,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text
        style={{ color: colors.textColor, fontSize: 12, fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatTierLabel(tier: 'anon' | 'premium', isAuthed = false) {
  void isAuthed;
  if (tier === 'premium') {
    return 'Full access';
  }
  return 'Public';
}

function groupWatchlistRules(rules: WatchlistRuleV1[]) {
  const groups: Array<[string, string]> = [
    ['provider', 'Providers'],
    ['pad', 'Pads'],
    ['launch', 'Launches'],
    ['tier', 'Tiers']
  ];

  const result: Record<string, { title: string; rules: WatchlistRuleV1[] }> =
    {};

  for (const [type, title] of groups) {
    const matches = rules.filter(
      (rule) =>
        String(rule.ruleType || '')
          .trim()
          .toLowerCase() === type
    );
    if (matches.length > 0) {
      result[type] = { title, rules: matches };
    }
  }

  const knownTypes = new Set(groups.map(([type]) => type));
  const otherRules = rules.filter(
    (rule) =>
      !knownTypes.has(
        String(rule.ruleType || '')
          .trim()
          .toLowerCase()
      )
  );
  if (otherRules.length > 0) {
    result.other = { title: 'Other', rules: otherRules };
  }

  return result;
}

function formatWatchlistRuleLabel(ruleType: string) {
  const normalized = String(ruleType || '')
    .trim()
    .toLowerCase();
  if (normalized === 'provider') return 'Provider';
  if (normalized === 'pad') return 'Pad';
  if (normalized === 'launch') return 'Launch';
  if (normalized === 'tier') return 'Tier';
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Rule';
}

function formatWatchlistRuleValue(ruleType: string, ruleValue: string) {
  const normalizedType = String(ruleType || '')
    .trim()
    .toLowerCase();
  const normalizedValue = String(ruleValue || '').trim();

  if (normalizedType === 'pad') {
    const lowerValue = normalizedValue.toLowerCase();
    if (lowerValue.startsWith('ll2:')) {
      return `LL2 Pad ${normalizedValue.slice(4).trim()}`;
    }
    if (lowerValue.startsWith('code:')) {
      return `Pad ${normalizedValue.slice(5).trim()}`;
    }
  }

  return normalizedValue || 'Unknown';
}

function normalizeWatchlistAlertRuleType(
  ruleType: string
): 'launch' | 'pad' | 'provider' | 'tier' | null {
  const normalized = String(ruleType || '')
    .trim()
    .toLowerCase();
  return normalized === 'launch' ||
    normalized === 'pad' ||
    normalized === 'provider' ||
    normalized === 'tier'
    ? normalized
    : null;
}

function buildFollowAlertRuleKey(ruleType: string, ruleValue: string) {
  return `${String(ruleType || '')
    .trim()
    .toLowerCase()}:${String(ruleValue || '')
    .trim()
    .toLowerCase()}`;
}

function summarizePresetFilters(filters: FilterPresetV1['filters']) {
  const record = filters as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record.range === 'string' && record.range.trim()) {
    parts.push(`Range ${record.range.trim()}`);
  }
  if (typeof record.region === 'string' && record.region.trim()) {
    parts.push(
      record.region === 'non-us'
        ? 'Non-US'
        : record.region === 'all'
          ? 'All locations'
          : 'US only'
    );
  }
  if (typeof record.provider === 'string' && record.provider.trim()) {
    parts.push(`Provider ${record.provider.trim()}`);
  }
  if (typeof record.state === 'string' && record.state.trim()) {
    parts.push(`State ${record.state.trim()}`);
  }
  if (typeof record.location === 'string' && record.location.trim()) {
    parts.push(`Site ${record.location.trim()}`);
  }
  if (typeof record.pad === 'string' && record.pad.trim()) {
    parts.push(`Pad ${record.pad.trim()}`);
  }
  if (
    typeof record.status === 'string' &&
    record.status.trim() &&
    record.status !== 'all'
  ) {
    parts.push(`Status ${record.status.trim()}`);
  }
  if (typeof record.sort === 'string' && record.sort.trim()) {
    parts.push(`Sort ${record.sort.trim()}`);
  }

  return parts.length > 0
    ? parts.join(' • ')
    : 'Saved launch feed filter bundle.';
}

function countPresetFilters(filters: FilterPresetV1['filters']) {
  return Object.entries(filters as Record<string, unknown>).filter(
    ([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string')
        return value.trim().length > 0 && value !== 'all';
      return true;
    }
  ).length;
}

function buildMutationMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    if (isWatchlistCreateLimitError(error)) {
      return buildWatchlistCreateLimitMessage();
    }
    if (error.code === 'limit_reached') {
      return 'Plan limit reached. Remove an older saved item before adding more.';
    }
    if (error.message) {
      return error.message;
    }
    if (error.code) {
      return `${fallback} (${error.code})`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
