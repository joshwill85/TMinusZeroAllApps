'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { getTierLimits, type ViewerCapabilities, type ViewerLimits, type ViewerTier } from '@/lib/tiers';
import type { LaunchFilter } from '@/lib/types/launch';

type SubscriptionSnapshot = {
  isAuthed: boolean;
  isPaid: boolean;
  isAdmin: boolean;
  tier?: ViewerTier;
  capabilities?: ViewerCapabilities;
  limits?: ViewerLimits;
};

type Preset = {
  id: string;
  name: string;
  filters: LaunchFilter;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
};

type WatchlistRule = {
  id: string;
  rule_type: 'launch' | 'pad' | 'provider' | 'tier' | string;
  rule_value: string;
  created_at?: string;
};

type Watchlist = {
  id: string;
  name: string;
  created_at?: string;
  watchlist_rules?: WatchlistRule[];
};

type CopyState = 'idle' | 'copied' | 'error';

const PREMIUM_SAVED_LIMITS = getTierLimits('premium');

export default function AccountSavedPage() {
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<Record<string, CopyState>>({});
  const [ruleQuery, setRuleQuery] = useState('');
  const viewerTier = resolveViewerTier(subscription);
  const savedItemLimits = subscription?.limits ?? getTierLimits(viewerTier);
  const canUseSavedItems = subscription?.capabilities?.canUseSavedItems ?? viewerTier !== 'anon';
  const totalRuleCount = useMemo(
    () => watchlists.reduce((sum, watchlist) => sum + countWatchlistRules(watchlist.watchlist_rules), 0),
    [watchlists]
  );
  const overLimitItems = [
    viewerTier === 'free' && presets.length > savedItemLimits.presetLimit ? `presets (${presets.length}/${savedItemLimits.presetLimit})` : null,
    viewerTier === 'free' && watchlists.length > savedItemLimits.watchlistLimit
      ? `watchlists (${watchlists.length}/${savedItemLimits.watchlistLimit})`
      : null,
    viewerTier === 'free' && totalRuleCount > savedItemLimits.watchlistRuleLimit
      ? `total rules (${totalRuleCount}/${savedItemLimits.watchlistRuleLimit})`
      : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    let active = true;
    fetch('/api/me/subscription', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        setSubscription({
          isAuthed: Boolean(json?.isAuthed),
          isPaid: Boolean(json?.isPaid),
          isAdmin: Boolean(json?.isAdmin),
          tier: normalizeViewerTier(json?.tier),
          capabilities:
            json?.capabilities && typeof json.capabilities === 'object' ? (json.capabilities as ViewerCapabilities) : undefined,
          limits: json?.limits && typeof json.limits === 'object' ? (json.limits as ViewerLimits) : undefined
        });
        setStatus(json?.isAuthed ? 'authed' : 'guest');
      })
      .catch((err) => {
        if (!active) return;
        console.error('subscription load error', err);
        setSubscription({ isAuthed: false, isPaid: false, isAdmin: false, tier: 'anon' });
        setStatus('guest');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'authed') return;
    if (!canUseSavedItems) {
      setPresets([]);
      setWatchlists([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([fetch('/api/me/filter-presets', { cache: 'no-store' }), fetch('/api/me/watchlists', { cache: 'no-store' })])
      .then(async ([presetsRes, watchlistsRes]) => {
        const [presetsJson, watchlistsJson] = await Promise.all([
          presetsRes.json().catch(() => ({})),
          watchlistsRes.json().catch(() => ({}))
        ]);

        if (!active) return;

        if ((!presetsRes.ok && presetsRes.status === 402) || (!watchlistsRes.ok && watchlistsRes.status === 402)) {
          setError('Saved items are not available on this account.');
          return;
        }

        if (!presetsRes.ok) throw new Error(presetsJson?.error || 'Failed to load presets.');
        if (!watchlistsRes.ok) throw new Error(watchlistsJson?.error || 'Failed to load watchlists.');

        setPresets(Array.isArray(presetsJson?.presets) ? presetsJson.presets : []);
        setWatchlists(Array.isArray(watchlistsJson?.watchlists) ? watchlistsJson.watchlists : []);
      })
      .catch((err) => {
        if (!active) return;
        console.error('account saved load error', err);
        setError(err?.message || 'Unable to load saved items.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canUseSavedItems, status]);

  const normalizedRuleQuery = ruleQuery.trim().toLowerCase();
  const filteredWatchlists = useMemo(() => {
    if (!normalizedRuleQuery) return watchlists;
    return watchlists.map((watchlist) => ({
      ...watchlist,
      watchlist_rules: (Array.isArray(watchlist.watchlist_rules) ? watchlist.watchlist_rules : []).filter((rule) => {
        const haystack = `${rule.rule_type || ''} ${rule.rule_value || ''}`.toLowerCase();
        return haystack.includes(normalizedRuleQuery);
      })
    }));
  }, [normalizedRuleQuery, watchlists]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState((prev) => ({ ...prev, [key]: 'copied' }));
      window.setTimeout(() => setCopyState((prev) => ({ ...prev, [key]: 'idle' })), 2000);
    } catch {
      setCopyState((prev) => ({ ...prev, [key]: 'error' }));
    }
  }

  async function renamePreset(preset: Preset) {
    const next = window.prompt('Rename preset', preset.name)?.trim();
    if (!next || next === preset.name) return;

    const key = `preset:rename:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/filter-presets/${encodeURIComponent(preset.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rename_http_${res.status}`);
      setPresets((prev) => prev.map((p) => (p.id === preset.id ? { ...p, name: next } : p)));
    } catch (err) {
      console.error('rename preset error', err);
      setError('Unable to rename preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function setDefaultPreset(preset: Preset) {
    if (preset.is_default) return;
    const key = `preset:default:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/filter-presets/${encodeURIComponent(preset.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `default_http_${res.status}`);
      setPresets((prev) => prev.map((p) => ({ ...p, is_default: p.id === preset.id })));
    } catch (err) {
      console.error('default preset error', err);
      setError('Unable to set default preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deletePreset(preset: Preset) {
    const ok = window.confirm(`Delete preset "${preset.name}"?`);
    if (!ok) return;

    const key = `preset:delete:${preset.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/filter-presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    } catch (err) {
      console.error('delete preset error', err);
      setError('Unable to delete preset.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function renameWatchlist(watchlist: Watchlist) {
    const next = window.prompt('Rename watchlist', watchlist.name)?.trim();
    if (!next || next === watchlist.name) return;

    const key = `watchlist:rename:${watchlist.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlist.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rename_http_${res.status}`);
      setWatchlists((prev) => prev.map((w) => (w.id === watchlist.id ? { ...w, name: next } : w)));
    } catch (err) {
      console.error('rename watchlist error', err);
      setError('Unable to rename watchlist.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deleteWatchlist(watchlist: Watchlist) {
    const ok = window.confirm(`Delete watchlist "${watchlist.name}"? This removes all its rules.`);
    if (!ok) return;

    const key = `watchlist:delete:${watchlist.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlist.id)}`, { method: 'DELETE', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);
      setWatchlists((prev) => prev.filter((w) => w.id !== watchlist.id));
    } catch (err) {
      console.error('delete watchlist error', err);
      setError('Unable to delete watchlist.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function removeRule(watchlist: Watchlist, rule: WatchlistRule) {
    const ok = window.confirm('Remove this rule?');
    if (!ok) return;

    const key = `rule:delete:${rule.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlist.id)}/rules/${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);
      setWatchlists((prev) =>
        prev.map((w) =>
          w.id === watchlist.id ? { ...w, watchlist_rules: (w.watchlist_rules || []).filter((r) => r.id !== rule.id) } : w
        )
      );
    } catch (err) {
      console.error('remove rule error', err);
      setError('Unable to remove rule.');
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
          <p className="mt-1 text-sm text-text3">Manage saved views and My Launches rules, including follows and starred launches.</p>
        </div>
        <Link href="/account" className="text-sm text-primary hover:underline">
          Back to profile
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{error}</div>
      )}

      {status === 'loading' && <p className="mt-4 text-text3">Loading…</p>}

      {status === 'guest' && (
        <p className="mt-4 text-text2">
          You are not signed in.{' '}
          <Link className="text-primary hover:underline" href="/auth/sign-in">
            Sign in
          </Link>{' '}
          or{' '}
          <Link className="text-primary hover:underline" href="/auth/sign-up">
            create a free account
          </Link>{' '}
          to manage saved items.
        </p>
      )}

      {status === 'authed' && (
        <div className="mt-4 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">{viewerTier === 'premium' ? 'Premium' : 'Free account'}</div>
          <div className="mt-1 text-base font-semibold text-text1">
            {viewerTier === 'premium' ? 'Saved items are fully enabled.' : 'Free saved items are enabled.'}
          </div>
          <div className="mt-1 text-xs text-text3">
            {viewerTier === 'premium'
              ? `${savedItemLimits.presetLimit} presets, ${savedItemLimits.watchlistLimit} watchlists, and ${savedItemLimits.watchlistRuleLimit} rules per watchlist.`
              : `${savedItemLimits.presetLimit} preset, ${savedItemLimits.watchlistLimit} watchlist, and ${savedItemLimits.watchlistRuleLimit} total follow rules. Premium expands that to ${PREMIUM_SAVED_LIMITS.presetLimit} presets, ${PREMIUM_SAVED_LIMITS.watchlistLimit} watchlists, and ${PREMIUM_SAVED_LIMITS.watchlistRuleLimit} rules per watchlist.`}
          </div>
          {viewerTier === 'free' && (
            <Link className="mt-3 inline-block text-sm text-primary hover:underline" href="/account">
              View billing options
            </Link>
          )}
          {overLimitItems.length > 0 && (
            <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Over the current free limit for {overLimitItems.join(', ')}. You can keep reviewing and deleting items here, but new saves stay
              blocked until you trim back under the cap.
            </div>
          )}
        </div>
      )}

      {status === 'authed' && canUseSavedItems && (
        <>
          <Section
            title="Presets"
            description={`Saved filters for the home feed (${presets.length}/${savedItemLimits.presetLimit}).`}
            emptyLabel="No presets yet."
            loading={loading}
          >
            {presets.map((preset) => {
              const renameKey = `preset:rename:${preset.id}`;
              const defaultKey = `preset:default:${preset.id}`;
              const deleteKey = `preset:delete:${preset.id}`;
              const summary = summarizeFilters(preset.filters);

              return (
                <div key={preset.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-text1">{preset.name}</div>
                        {preset.is_default ? (
                          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-primary">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-text3">{summary}</div>
                    </div>
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
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={clsx(
                        'rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary',
                        preset.is_default && 'opacity-50'
                      )}
                      onClick={() => setDefaultPreset(preset)}
                      disabled={preset.is_default || busy[defaultKey]}
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
                </div>
              );
            })}
          </Section>

          <Section
            title="My Launches"
            description={
              viewerTier === 'premium'
                ? `Watchlists and rules (${watchlists.length}/${savedItemLimits.watchlistLimit} watchlists, ${savedItemLimits.watchlistRuleLimit} rules max per watchlist).`
                : `Watchlists and rules (${watchlists.length}/${savedItemLimits.watchlistLimit} watchlists, ${totalRuleCount}/${savedItemLimits.watchlistRuleLimit} total rules).`
            }
            emptyLabel="No watchlists yet."
            loading={loading}
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
              const rules = (Array.isArray(watchlist.watchlist_rules) ? watchlist.watchlist_rules : [])
                .filter((rule) => rule?.id && rule?.rule_type && rule?.rule_value)
                .slice()
                .sort((a, b) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || '')));

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
                  </div>

                  <div className="mt-3 space-y-3">
                    {Object.entries(grouped).map(([groupKey, items]) => (
                      <RuleGroup
                        key={groupKey}
                        title={items.title}
                        rules={items.rules}
                        onRemove={(rule) => removeRule(watchlist, rule)}
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
            Tip: if you hit your plan limit, remove old follows or saved views here first. Tokenized feeds (calendar, RSS, embeds) still sit on
            the Premium side and stay cached and rate-limited.
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
  return value === 'anon' || value === 'free' || value === 'premium' ? value : undefined;
}

function resolveViewerTier(subscription: SubscriptionSnapshot | null): ViewerTier {
  if (subscription?.tier) return subscription.tier;
  if (subscription?.isPaid) return 'premium';
  if (subscription?.isAuthed) return 'free';
  return 'anon';
}

function countWatchlistRules(rules: Watchlist['watchlist_rules']) {
  if (!Array.isArray(rules)) return 0;
  return rules.filter((rule) => rule?.id && rule?.rule_type && rule?.rule_value).length;
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

function groupRules(rules: WatchlistRule[]) {
  const result: Record<
    string,
    {
      title: string;
      rules: WatchlistRule[];
    }
  > = {};

  const byType = (type: string) => rules.filter((r) => String(r.rule_type || '').toLowerCase() === type);

  const providers = byType('provider');
  const pads = byType('pad');
  const launches = byType('launch');
  const tiers = byType('tier');
  const other = rules.filter((r) => !['provider', 'pad', 'launch', 'tier'].includes(String(r.rule_type || '').toLowerCase()));

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
  busy
}: {
  title: string;
  rules: WatchlistRule[];
  onRemove: (rule: WatchlistRule) => void;
  busy: Record<string, boolean>;
}) {
  if (!rules.length) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
      <div className="mt-2 space-y-2">
        {rules.map((rule) => {
          const normalized = normalizeRuleValue(rule.rule_type, rule.rule_value);
          const removeKey = `rule:delete:${rule.id}`;
          const canLinkToLaunch =
            String(rule.rule_type || '').toLowerCase() === 'launch' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rule.rule_value);

          return (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke bg-surface-1 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.1em] text-text3">{normalized.label}</div>
                <div className="mt-0.5 truncate text-sm text-text1">
                  {canLinkToLaunch ? (
                    <Link className="text-primary hover:underline" href={`/launches/${encodeURIComponent(rule.rule_value)}`}>
                      {normalized.value}
                    </Link>
                  ) : (
                    normalized.value
                  )}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text1 hover:border-primary disabled:opacity-50"
                onClick={() => onRemove(rule)}
                disabled={busy[removeKey]}
              >
                {busy[removeKey] ? 'Removing…' : 'Remove'}
              </button>
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
