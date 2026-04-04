'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { FilterPresetV1, WatchlistRuleV1, WatchlistV1 } from '@tminuszero/api-client';
import { getTierLimits, type ViewerTier } from '@tminuszero/domain';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import {
  useAlertRulesQuery,
  useCreateAlertRuleMutation,
  useDeleteAlertRuleMutation,
  useDeleteFilterPresetMutation,
  useDeleteWatchlistMutation,
  useDeleteWatchlistRuleMutation,
  useFilterPresetsQuery,
  useUpdateFilterPresetMutation,
  useUpdateWatchlistMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery,
  useWatchlistsQuery
} from '@/lib/api/queries';
import type { LaunchFilter } from '@/lib/types/launch';

type CopyState = 'idle' | 'copied' | 'error';

const PREMIUM_SAVED_LIMITS = getTierLimits('premium');

export default function AccountSavedPage() {
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const deleteFilterPresetMutation = useDeleteFilterPresetMutation();
  const updateWatchlistMutation = useUpdateWatchlistMutation();
  const deleteWatchlistMutation = useDeleteWatchlistMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();
  const createAlertRuleMutation = useCreateAlertRuleMutation();
  const deleteAlertRuleMutation = useDeleteAlertRuleMutation();

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<Record<string, CopyState>>({});
  const [ruleQuery, setRuleQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const status: 'loading' | 'authed' | 'guest' = viewerSessionQuery.isPending
    ? 'loading'
    : viewerSessionQuery.data?.viewerId
      ? 'authed'
      : 'guest';
  const entitlementsLoading = status === 'authed' && entitlementsQuery.isPending && !entitlementsQuery.data;

  const viewerTier = resolveViewerTier(entitlementsQuery.data?.tier);
  const savedItemLimits = entitlementsQuery.data?.limits ?? getTierLimits(viewerTier);
  const canUseSavedItems = entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const canUseAdvancedAlertRules = entitlementsQuery.data?.capabilities.canUseAdvancedAlertRules ?? false;
  const filterPresetsQuery = useFilterPresetsQuery({ enabled: status === 'authed' && canUseSavedItems });
  const watchlistsQuery = useWatchlistsQuery({ enabled: status === 'authed' && canUseSavedItems });
  const alertRulesQuery = useAlertRulesQuery({ enabled: status === 'authed' && canUseSavedItems && canUseAdvancedAlertRules });
  const presets = canUseSavedItems ? filterPresetsQuery.data?.presets ?? [] : [];
  const watchlists = useMemo(
    () => (canUseSavedItems ? watchlistsQuery.data?.watchlists ?? [] : []),
    [canUseSavedItems, watchlistsQuery.data?.watchlists]
  );
  const alertRules = useMemo(() => alertRulesQuery.data?.rules ?? [], [alertRulesQuery.data?.rules]);
  const loadingSavedItems = status === 'authed' && canUseSavedItems && (filterPresetsQuery.isPending || watchlistsQuery.isPending);
  const normalizedRuleQuery = ruleQuery.trim().toLowerCase();
  const filteredWatchlists = useMemo(() => {
    if (!normalizedRuleQuery) return watchlists;
    return watchlists.map((watchlist) => ({
      ...watchlist,
      rules: watchlist.rules.filter((rule) => {
        const haystack = `${rule.ruleType || ''} ${rule.ruleValue || ''}`.toLowerCase();
        return haystack.includes(normalizedRuleQuery);
      })
    }));
  }, [normalizedRuleQuery, watchlists]);
  const presetAlertRuleIds = useMemo(
    () =>
      new Map(
        alertRules
          .filter((rule) => rule.kind === 'filter_preset')
          .map((rule) => [rule.presetId, rule.id])
      ),
    [alertRules]
  );
  const followAlertRuleIds = useMemo(
    () =>
      new Map(
        alertRules
          .filter((rule) => rule.kind === 'follow')
          .map((rule) => [buildFollowAlertRuleKey(rule.followRuleType, rule.followRuleValue), rule.id])
      ),
    [alertRules]
  );
  const queryError =
    status === 'authed'
      ? (canUseSavedItems ? filterPresetsQuery.error || watchlistsQuery.error : null) ||
        (canUseSavedItems && canUseAdvancedAlertRules ? alertRulesQuery.error : null) ||
        (entitlementsQuery.error ?? null)
      : entitlementsQuery.error;
  const activeError = error ?? (queryError ? getErrorMessage(queryError, 'Unable to load saved items.') : null);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState((prev) => ({ ...prev, [key]: 'copied' }));
      window.setTimeout(() => setCopyState((prev) => ({ ...prev, [key]: 'idle' })), 2000);
    } catch {
      setCopyState((prev) => ({ ...prev, [key]: 'error' }));
    }
  }

  async function renamePreset(preset: FilterPresetV1) {
    const next = window.prompt('Rename preset', preset.name)?.trim();
    if (!next || next === preset.name) return;

    const key = `preset:rename:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: preset.id,
        payload: { name: next }
      });
    } catch (mutationError: unknown) {
      console.error('rename preset error', mutationError);
      setError('Unable to rename preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function setDefaultPreset(preset: FilterPresetV1) {
    if (preset.isDefault) return;
    const key = `preset:default:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: preset.id,
        payload: { isDefault: true }
      });
    } catch (mutationError: unknown) {
      console.error('default preset error', mutationError);
      setError('Unable to set default preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deletePreset(preset: FilterPresetV1) {
    const ok = window.confirm(`Delete preset "${preset.name}"?`);
    if (!ok) return;

    const key = `preset:delete:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await deleteFilterPresetMutation.mutateAsync(preset.id);
    } catch (mutationError: unknown) {
      console.error('delete preset error', mutationError);
      setError('Unable to delete preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function renameWatchlist(watchlist: WatchlistV1) {
    const next = window.prompt('Rename watchlist', watchlist.name)?.trim();
    if (!next || next === watchlist.name) return;

    const key = `watchlist:rename:${watchlist.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await updateWatchlistMutation.mutateAsync({
        watchlistId: watchlist.id,
        payload: { name: next }
      });
    } catch (mutationError: unknown) {
      console.error('rename watchlist error', mutationError);
      setError('Unable to rename watchlist.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deleteWatchlist(watchlist: WatchlistV1) {
    const ok = window.confirm(`Delete watchlist "${watchlist.name}"? This removes all its rules.`);
    if (!ok) return;

    const key = `watchlist:delete:${watchlist.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await deleteWatchlistMutation.mutateAsync(watchlist.id);
    } catch (mutationError: unknown) {
      console.error('delete watchlist error', mutationError);
      setError('Unable to delete watchlist.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function removeRule(watchlist: WatchlistV1, rule: WatchlistRuleV1) {
    const ok = window.confirm('Remove this rule?');
    if (!ok) return;

    const key = `rule:delete:${rule.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await deleteWatchlistRuleMutation.mutateAsync({
        watchlistId: watchlist.id,
        ruleId: rule.id
      });
    } catch (mutationError: unknown) {
      console.error('remove rule error', mutationError);
      setError('Unable to remove rule.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function togglePresetAlertRule(preset: FilterPresetV1) {
    const key = `alert:preset:${preset.id}`;
    const existingRuleId = presetAlertRuleIds.get(preset.id) ?? null;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      if (existingRuleId) {
        await deleteAlertRuleMutation.mutateAsync(existingRuleId);
      } else {
        await createAlertRuleMutation.mutateAsync({
          kind: 'filter_preset',
          presetId: preset.id
        });
      }
    } catch (mutationError: unknown) {
      console.error('preset alert rule toggle error', mutationError);
      setError(existingRuleId ? 'Unable to remove preset alert rule.' : 'Unable to create preset alert rule.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function toggleFollowAlertRule(rule: WatchlistRuleV1) {
    const normalizedType = normalizeWatchlistAlertRuleType(rule.ruleType);
    if (!normalizedType) return;

    const alertKey = buildFollowAlertRuleKey(normalizedType, rule.ruleValue);
    const existingRuleId = followAlertRuleIds.get(alertKey) ?? null;
    const key = `alert:follow:${rule.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      if (existingRuleId) {
        await deleteAlertRuleMutation.mutateAsync(existingRuleId);
      } else {
        await createAlertRuleMutation.mutateAsync({
          kind: 'follow',
          followRuleType: normalizedType,
          followRuleValue: rule.ruleValue
        });
      }
    } catch (mutationError: unknown) {
      console.error('follow alert rule toggle error', mutationError);
      setError(existingRuleId ? 'Unable to remove follow alert rule.' : 'Unable to create follow alert rule.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Account</p>
          <h1 className="text-3xl font-semibold text-text1">Saved</h1>
          <p className="mt-1 text-sm text-text3">
            {canUseSavedItems
              ? 'Review saved filters, follows, and starred launches.'
              : 'Review saved filters, follows, and starred launches. Editing and new saves require paid access.'}
          </p>
        </div>
        <Link href={buildProfileHref()} className="text-sm text-primary hover:underline">
          Back to account
        </Link>
      </div>

      {activeError && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{activeError}</div>
      )}

      {(status === 'loading' || entitlementsLoading) && <p className="mt-4 text-text3">Loading…</p>}

      {status === 'guest' && (
        <p className="mt-4 text-text2">
          You are not signed in.{' '}
          <Link className="text-primary hover:underline" href={buildAuthHref('sign-in', { returnTo: '/account/saved' })}>
            Sign in
          </Link>{' '}
          to manage saved items after Premium is active.
        </p>
      )}

      {status === 'authed' && !entitlementsLoading && (
        <div className="mt-4 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">{viewerTier === 'premium' ? 'Enabled' : 'Public'}</div>
          <div className="mt-1 text-base font-semibold text-text1">
            {viewerTier === 'premium' ? 'Saved items are ready.' : 'Saved items are Premium-only.'}
          </div>
          <div className="mt-1 text-xs text-text3">
            {viewerTier === 'premium'
              ? `${savedItemLimits.presetLimit} presets, ${savedItemLimits.watchlistLimit} watchlists, and ${savedItemLimits.watchlistRuleLimit} rules per watchlist.`
              : `Premium unlocks saved/default filters, follows, and starred launches, plus up to ${PREMIUM_SAVED_LIMITS.presetLimit} presets and ${PREMIUM_SAVED_LIMITS.watchlistLimit} watchlists.`}
          </div>
          {viewerTier !== 'premium' && (
            <Link className="mt-3 inline-block text-sm text-primary hover:underline" href={buildProfileHref()}>
              View billing options
            </Link>
          )}
        </div>
      )}

      {status === 'authed' && !entitlementsLoading && !canUseSavedItems && (
        <div className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Saved items are unavailable on the public tier. Upgrade to Premium to manage saved/default filters, follows, and starred launches across your account.
        </div>
      )}

      {status === 'authed' && !entitlementsLoading && canUseSavedItems && (
        <>
          <Section
            title="Presets"
            description={`Saved filters for the home feed (${presets.length}/${savedItemLimits.presetLimit}). Use a preset as an alert source when needed.`}
            emptyLabel="No presets yet."
            loading={loadingSavedItems}
          >
            {presets.map((preset) => {
              const renameKey = `preset:rename:${preset.id}`;
              const defaultKey = `preset:default:${preset.id}`;
              const deleteKey = `preset:delete:${preset.id}`;
              const alertKey = `alert:preset:${preset.id}`;
              const presetAlertsEnabled = presetAlertRuleIds.has(preset.id);
              const summary = summarizeFilters(preset.filters as LaunchFilter);

              return (
                <div key={preset.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-text1">{preset.name}</div>
                        {preset.isDefault ? (
                          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-primary">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-text3">{summary}</div>
                    </div>
                    {canUseSavedItems ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-stroke bg-surface-0 px-2 py-1 text-xs text-text1 hover:border-primary"
                        onClick={() => copyText(`preset:${preset.id}`, preset.id)}
                      >
                        {copyState[`preset:${preset.id}`] === 'copied'
                          ? 'Copied ID'
                          : copyState[`preset:${preset.id}`] === 'error'
                            ? 'Copy failed'
                            : 'Copy ID'}
                      </button>
                    ) : null}
                  </div>

                  {canUseSavedItems ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canUseAdvancedAlertRules ? (
                        <button
                          type="button"
                          className={clsx(
                            'rounded-lg border px-3 py-2 text-xs',
                            presetAlertsEnabled
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-stroke bg-surface-0 text-text1 hover:border-primary'
                          )}
                          onClick={() => togglePresetAlertRule(preset)}
                          disabled={busy[alertKey]}
                        >
                          {busy[alertKey] ? 'Saving…' : presetAlertsEnabled ? 'Alerts on' : 'Use for alerts'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={clsx(
                          'rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary',
                          preset.isDefault && 'opacity-50'
                        )}
                        onClick={() => setDefaultPreset(preset)}
                        disabled={preset.isDefault || busy[defaultKey]}
                      >
                        {busy[defaultKey] ? 'Saving…' : 'Set default'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => renamePreset(preset)}
                        disabled={busy[renameKey]}
                      >
                        {busy[renameKey] ? 'Renaming…' : 'Rename'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => deletePreset(preset)}
                        disabled={busy[deleteKey]}
                      >
                        {busy[deleteKey] ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Section>

          <Section
            title="My Launches"
            description={`Watchlists and rules (${watchlists.length}/${savedItemLimits.watchlistLimit} watchlists, ${savedItemLimits.watchlistRuleLimit} rules max per watchlist). Use a follow as an alert source when needed.`}
            emptyLabel="No watchlists yet."
            loading={loadingSavedItems}
          >
            <div className="rounded-xl border border-stroke bg-surface-0 p-3">
              <label className="block text-xs uppercase tracking-[0.1em] text-text3" htmlFor="ruleFilter">
                Filter rules
              </label>
              <input
                id="ruleFilter"
                value={ruleQuery}
                onChange={(e) => setRuleQuery(e.target.value)}
                placeholder="Search (e.g., spacex, ll2:, code:, major)…"
                className="mt-2 w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1 placeholder:text-text3"
              />
            </div>

            {filteredWatchlists.map((watchlist) => {
              const rules = watchlist.rules
                .filter((rule) => rule?.id && rule?.ruleType && rule?.ruleValue)
                .slice()
                .sort((a, b) => Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || '')));

              const grouped = groupRules(rules);
              const total = rules.length;

              const renameKey = `watchlist:rename:${watchlist.id}`;
              const deleteKey = `watchlist:delete:${watchlist.id}`;

              return (
                <div key={watchlist.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text1">{watchlist.name}</div>
                      <div className="mt-1 text-xs text-text3">
                        {total} {total === 1 ? 'rule' : 'rules'}
                        {normalizedRuleQuery ? ' (filtered)' : ''}
                      </div>
                    </div>
                    {canUseSavedItems ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary"
                          onClick={() => renameWatchlist(watchlist)}
                          disabled={busy[renameKey]}
                        >
                          {busy[renameKey] ? 'Renaming…' : 'Rename'}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary"
                          onClick={() => deleteWatchlist(watchlist)}
                          disabled={busy[deleteKey]}
                        >
                          {busy[deleteKey] ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-3">
                    {Object.entries(grouped).map(([groupKey, items]) => (
                      <RuleGroup
                        key={groupKey}
                        title={items.title}
                        rules={items.rules}
                        onRemove={canUseSavedItems ? (rule) => removeRule(watchlist, rule) : null}
                        onToggleAlertRule={canUseAdvancedAlertRules ? toggleFollowAlertRule : null}
                        activeAlertRuleIds={followAlertRuleIds}
                        busy={busy}
                      />
                    ))}
                  </div>

                  {total === 0 && <div className="mt-3 text-sm text-text3">No rules in this watchlist.</div>}
                </div>
              );
            })}
          </Section>

          <div className="mt-6 text-xs text-text3">
            Tip: if you hit your plan limit, remove old follows or saved views here first. Tokenized feeds (calendar, RSS, embeds) stay in Integrations and still use caching and rate limits.
          </div>
        </>
      )}
    </div>
  );
}

function summarizeFilters(filters: LaunchFilter) {
  const region = filters.region ?? 'us';
  const locationSummary =
    region === 'all' ? 'Location: all' : region === 'non-us' ? 'Location: Non-US only' : 'Location: US only';

  const summaryParts = [
    locationSummary,
    filters.range ? `Range: ${filters.range}` : 'Range: 7d',
    filters.state ? `Region: ${filters.state}` : 'Region: all',
    filters.provider ? `Provider: ${filters.provider}` : 'Provider: all',
    filters.status && filters.status !== 'all' ? `Status: ${filters.status}` : 'Status: all',
    filters.sort ? `Sort: ${filters.sort}` : null
  ].filter(Boolean) as string[];

  return summaryParts.join(' • ');
}

function normalizeViewerTier(value: unknown): ViewerTier | undefined {
  return value === 'anon' || value === 'premium' ? value : undefined;
}

function resolveViewerTier(value: unknown): ViewerTier {
  return normalizeViewerTier(value) ?? 'anon';
}

function normalizeRuleValue(ruleType: string, ruleValue: string) {
  const type = String(ruleType || '').trim().toLowerCase();
  const value = String(ruleValue || '').trim();
  if (type === 'pad') {
    const lower = value.toLowerCase();
    if (lower.startsWith('ll2:')) return { label: 'Pad', value: `LL2 ${value.slice(4).trim()}` };
    if (lower.startsWith('code:')) return { label: 'Pad', value: value.slice(5).trim() };
    return { label: 'Pad', value };
  }

  if (type === 'provider') return { label: 'Provider', value };
  if (type === 'tier') return { label: 'Tier', value };
  if (type === 'launch') return { label: 'Launch', value };
  return { label: type || 'Rule', value };
}

function normalizeWatchlistAlertRuleType(ruleType: string): 'launch' | 'pad' | 'provider' | 'tier' | null {
  const normalized = String(ruleType || '').trim().toLowerCase();
  return normalized === 'launch' || normalized === 'pad' || normalized === 'provider' || normalized === 'tier' ? normalized : null;
}

function buildFollowAlertRuleKey(ruleType: string, ruleValue: string) {
  return `${String(ruleType || '').trim().toLowerCase()}:${String(ruleValue || '').trim().toLowerCase()}`;
}

function groupRules(rules: WatchlistRuleV1[]) {
  const result: Record<
    string,
    {
      title: string;
      rules: WatchlistRuleV1[];
    }
  > = {};

  const byType = (type: string) => rules.filter((rule) => String(rule.ruleType || '').toLowerCase() === type);

  const providers = byType('provider');
  const pads = byType('pad');
  const launches = byType('launch');
  const tiers = byType('tier');
  const other = rules.filter((rule) => !['provider', 'pad', 'launch', 'tier'].includes(String(rule.ruleType || '').toLowerCase()));

  if (providers.length) result.providers = { title: `Followed providers (${providers.length})`, rules: providers };
  if (pads.length) result.pads = { title: `Followed pads (${pads.length})`, rules: pads };
  if (tiers.length) result.tiers = { title: `Tier rules (${tiers.length})`, rules: tiers };
  if (launches.length) result.launches = { title: `Starred launches (${launches.length})`, rules: launches };
  if (other.length) result.other = { title: `Other rules (${other.length})`, rules: other };

  return result;
}

function RuleGroup({
  title,
  rules,
  onRemove,
  onToggleAlertRule,
  activeAlertRuleIds,
  busy
}: {
  title: string;
  rules: WatchlistRuleV1[];
  onRemove: ((rule: WatchlistRuleV1) => void) | null;
  onToggleAlertRule: ((rule: WatchlistRuleV1) => void) | null;
  activeAlertRuleIds: Map<string, string>;
  busy: Record<string, boolean>;
}) {
  if (!rules.length) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
      <div className="mt-2 space-y-2">
        {rules.map((rule) => {
          const normalized = normalizeRuleValue(rule.ruleType, rule.ruleValue);
          const removeKey = `rule:delete:${rule.id}`;
          const alertKey = `alert:follow:${rule.id}`;
          const normalizedAlertType = normalizeWatchlistAlertRuleType(rule.ruleType);
          const activeAlertRuleId = normalizedAlertType ? activeAlertRuleIds.get(buildFollowAlertRuleKey(normalizedAlertType, rule.ruleValue)) : null;
          const canToggleAlertRule = Boolean(onToggleAlertRule && normalizedAlertType);
          const canLinkToLaunch =
            String(rule.ruleType || '').toLowerCase() === 'launch' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rule.ruleValue);

          return (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke bg-surface-1 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">{normalized.label}</div>
                <div className="mt-0.5 truncate text-sm text-text1">
                  {canLinkToLaunch ? (
                    <Link className="text-primary hover:underline" href={`/launches/${encodeURIComponent(rule.ruleValue)}`}>
                      {normalized.value}
                    </Link>
                  ) : (
                    normalized.value
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canToggleAlertRule ? (
                  <button
                    type="button"
                    className={clsx(
                      'shrink-0 rounded-lg border px-3 py-2 text-xs disabled:opacity-50',
                      activeAlertRuleId
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-stroke bg-surface-0 text-text1 hover:border-primary'
                    )}
                    onClick={() => onToggleAlertRule?.(rule)}
                    disabled={busy[alertKey]}
                  >
                    {busy[alertKey] ? 'Saving…' : activeAlertRuleId ? 'Alerts on' : 'Use for alerts'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary disabled:opacity-50"
                  onClick={() => onRemove?.(rule)}
                  disabled={!onRemove || busy[removeKey]}
                >
                  {!onRemove ? 'Premium only' : busy[removeKey] ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  emptyLabel,
  loading,
  children
}: {
  title: string;
  description: string;
  emptyLabel: string;
  loading: boolean;
  children: ReactNode;
}) {
  const hasContent = Boolean(children) && !(Array.isArray(children) && children.length === 0);
  return (
    <section className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4">
      <div>
        <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
        <div className="mt-1 text-xs text-text3">{description}</div>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? <div className="text-sm text-text3">Loading…</div> : hasContent ? children : <div className="text-sm text-text3">{emptyLabel}</div>}
      </div>
    </section>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
