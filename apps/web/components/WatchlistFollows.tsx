'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import type { WatchlistRuleV1 } from '@tminuszero/api-client';
import {
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useDeleteWatchlistRuleMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/lib/api/queries';
import { useToast } from './ToastProvider';

export function WatchlistFollows({
  isAuthed,
  canUseSavedItems,
  provider,
  ll2PadId,
  padShortCode,
  padLabel
}: {
  isAuthed: boolean;
  canUseSavedItems: boolean;
  provider: string;
  ll2PadId?: number | null;
  padShortCode?: string | null;
  padLabel?: string | null;
}) {
  const { pushToast } = useToast();
  const searchParams = useSearchParams();
  const debugToken = String(searchParams.get('debug') || '').trim().toLowerCase();
  const debugEnabled =
    debugToken === '1' || debugToken === 'true' || debugToken === 'launch' || debugToken === 'detail' || debugToken === 'launchdetail';
  const providerKey = String(provider || '').trim();
  const padRuleValue = useMemo(() => buildPadRuleValue({ ll2PadId, padShortCode }), [ll2PadId, padShortCode]);
  const providerFollowTarget = providerKey || 'Provider';
  const providerFollowLabel = `Follow ${providerFollowTarget}`;
  const padFollowTarget = useMemo(() => resolvePadFollowTarget({ padLabel, padShortCode }), [padLabel, padShortCode]);
  const padFollowLabel = `Follow ${padFollowTarget}`;
  const entitlementsQuery = useViewerEntitlementsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();

  const [didAttemptEnsureWatchlist, setDidAttemptEnsureWatchlist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const watchlists = useMemo(() => watchlistsQuery.data?.watchlists ?? [], [watchlistsQuery.data?.watchlists]);
  const selectedWatchlist = useMemo(
    () => watchlists.find((watchlist) => String(watchlist.name || '').trim().toLowerCase() === 'my launches') ?? watchlists[0] ?? null,
    [watchlists]
  );
  const watchlistId = selectedWatchlist?.id ?? null;
  const providerRuleId = useMemo(
    () => findRuleId(selectedWatchlist?.rules ?? [], 'provider', providerKey),
    [providerKey, selectedWatchlist?.rules]
  );
  const padRuleId = useMemo(
    () => (padRuleValue ? findRuleId(selectedWatchlist?.rules ?? [], 'pad', padRuleValue) : null),
    [padRuleValue, selectedWatchlist?.rules]
  );
  const loading = watchlistsQuery.isPending || createWatchlistMutation.isPending;
  const ruleLimit = entitlementsQuery.data?.limits.watchlistRuleLimit ?? null;
  const queryErrorMessage = watchlistsQuery.error ? getErrorMessage(watchlistsQuery.error, 'Unable to load follows.') : null;

  useEffect(() => {
    if (!isAuthed || !canUseSavedItems || (!providerKey && !padRuleValue)) {
      setDidAttemptEnsureWatchlist(false);
      return;
    }
    if (!watchlists.length) return;
    setDidAttemptEnsureWatchlist(false);
  }, [canUseSavedItems, isAuthed, padRuleValue, providerKey, watchlists.length]);

  useEffect(() => {
    if (!isAuthed || !canUseSavedItems || (!providerKey && !padRuleValue)) return;
    if (!watchlistsQuery.isSuccess || watchlists.length > 0 || didAttemptEnsureWatchlist || createWatchlistMutation.isPending) return;

    setDidAttemptEnsureWatchlist(true);
    setError(null);
    if (debugEnabled) console.log('[WatchlistFollows] load_no_watchlist_creating');
    void createWatchlistMutation
      .mutateAsync({})
      .then((payload) => {
        if (debugEnabled) {
          console.log('[WatchlistFollows] create_response', {
            ok: true,
            watchlistId: payload.watchlist.id ? `${payload.watchlist.id.slice(0, 8)}…` : null
          });
        }
      })
      .catch((createError: unknown) => {
        console.error('watchlist follows create error', createError);
        setError(getErrorMessage(createError, 'Unable to load follows.'));
      });
  }, [
    canUseSavedItems,
    createWatchlistMutation,
    debugEnabled,
    didAttemptEnsureWatchlist,
    isAuthed,
    padRuleValue,
    providerKey,
    watchlists.length,
    watchlistsQuery.isSuccess
  ]);

  if (!isAuthed || !canUseSavedItems) return null;
  if (!providerKey && !padRuleValue) return null;

  const providerFollowing = Boolean(providerRuleId);
  const padFollowing = Boolean(padRuleId);
  const activeError = error ?? queryErrorMessage;

  function resolveRuleLimitMessage() {
    return ruleLimit ? `My Launches limit reached (${ruleLimit} rules).` : 'My Launches limit reached.';
  }

  async function toggleProvider(options?: { skipToast?: boolean }) {
    if (!watchlistId || !providerKey) return;
    const key = `provider:${providerKey}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);
    try {
      if (debugEnabled) {
        console.log('[WatchlistFollows] toggle_provider_start', {
          providerKey,
          watchlistId: watchlistId ? `${watchlistId.slice(0, 8)}…` : null,
          providerRuleId: providerRuleId ? `${providerRuleId.slice(0, 8)}…` : null
        });
      }
      if (providerRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({ watchlistId, ruleId: providerRuleId });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_delete_response', { ok: true });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_deleted');
        if (!options?.skipToast) {
          pushToast({
            message: `Unfollowed ${providerKey}.`,
            tone: 'info',
            onUndo: async () => {
              try {
                await createWatchlistRuleMutation.mutateAsync({
                  watchlistId,
                  payload: { ruleType: 'provider', ruleValue: providerKey }
                });
              } catch (err: any) {
                console.error('provider follow undo error', err);
                const nextError = getErrorCode(err) === 'limit_reached' ? resolveRuleLimitMessage() : getErrorMessage(err, 'Unable to undo provider follow.');
                setError(nextError);
              }
            }
          });
        }
        return;
      }

      const created = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: { ruleType: 'provider', ruleValue: providerKey }
      });
      const nextId = created.rule.id;
      if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_post_response', { ok: true });
      if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_added', { providerRuleId: `${nextId.slice(0, 8)}…` });
      if (!options?.skipToast) {
        pushToast({
          message: `Following ${providerKey}.`,
          tone: 'success',
          onUndo: async () => {
            try {
              await deleteWatchlistRuleMutation.mutateAsync({ watchlistId, ruleId: nextId });
            } catch (err: any) {
              console.error('provider unfollow undo error', err);
              setError(getErrorMessage(err, 'Unable to undo provider unfollow.'));
            }
          }
        });
      }
    } catch (err: any) {
      console.error('provider follow toggle error', err);
      const nextError = getErrorCode(err) === 'limit_reached' ? resolveRuleLimitMessage() : getErrorMessage(err, 'Unable to update provider follow.');
      setError(nextError);
      if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_error', { error: String(err?.message || err) });
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function togglePad(options?: { skipToast?: boolean }) {
    if (!watchlistId || !padRuleValue) return;
    const key = `pad:${padRuleValue}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);
    try {
      if (debugEnabled) {
        console.log('[WatchlistFollows] toggle_pad_start', {
          padRuleValue,
          watchlistId: watchlistId ? `${watchlistId.slice(0, 8)}…` : null,
          padRuleId: padRuleId ? `${padRuleId.slice(0, 8)}…` : null
        });
      }
      if (padRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({ watchlistId, ruleId: padRuleId });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_delete_response', { ok: true });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_deleted');
        if (!options?.skipToast) {
          pushToast({
            message: `Unfollowed ${padFollowTarget}.`,
            tone: 'info',
            onUndo: async () => {
              try {
                await createWatchlistRuleMutation.mutateAsync({
                  watchlistId,
                  payload: { ruleType: 'pad', ruleValue: padRuleValue }
                });
              } catch (err: any) {
                console.error('pad follow undo error', err);
                const nextError = getErrorCode(err) === 'limit_reached' ? resolveRuleLimitMessage() : getErrorMessage(err, 'Unable to undo pad follow.');
                setError(nextError);
              }
            }
          });
        }
        return;
      }

      const created = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: { ruleType: 'pad', ruleValue: padRuleValue }
      });
      const nextId = created.rule.id;
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_post_response', { ok: true });
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_added', { padRuleId: `${nextId.slice(0, 8)}…` });
      if (!options?.skipToast) {
        pushToast({
          message: `Following ${padFollowTarget}.`,
          tone: 'success',
          onUndo: async () => {
            try {
              await deleteWatchlistRuleMutation.mutateAsync({ watchlistId, ruleId: nextId });
            } catch (err: any) {
              console.error('pad unfollow undo error', err);
              setError(getErrorMessage(err, 'Unable to undo pad unfollow.'));
            }
          }
        });
      }
    } catch (err: any) {
      console.error('pad follow toggle error', err);
      const nextError = getErrorCode(err) === 'limit_reached' ? resolveRuleLimitMessage() : getErrorMessage(err, 'Unable to update pad follow.');
      setError(nextError);
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_error', { error: String(err?.message || err) });
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeError && <span className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">{activeError}</span>}
      {providerKey && (
        <button
          type="button"
          className={clsx(
            'btn-secondary relative flex h-11 items-center rounded-lg border border-stroke text-text2 transition hover:border-primary hover:text-text1',
            providerFollowing ? 'w-11 justify-center px-0' : 'gap-2 px-3 text-xs font-semibold uppercase tracking-[0.08em]',
            providerFollowing && 'border-primary text-primary',
            (loading || busy[`provider:${providerKey}`]) && 'pointer-events-none opacity-60'
          )}
          onClick={() => void toggleProvider()}
          aria-pressed={providerFollowing}
          aria-label={providerFollowing ? `Unfollow ${providerFollowTarget}` : providerFollowLabel}
          title={providerFollowing ? `Unfollow ${providerFollowTarget}` : providerFollowLabel}
          disabled={loading || Boolean(busy[`provider:${providerKey}`])}
        >
          <StarIcon className="h-4 w-4" filled={providerFollowing} />
          {!providerFollowing && <span>{providerFollowLabel}</span>}
        </button>
      )}
      {padRuleValue && (
        <button
          type="button"
          className={clsx(
            'btn-secondary relative flex h-11 items-center rounded-lg border border-stroke text-text2 transition hover:border-primary hover:text-text1',
            padFollowing ? 'w-11 justify-center px-0' : 'gap-2 px-3 text-xs font-semibold uppercase tracking-[0.08em]',
            padFollowing && 'border-primary text-primary',
            (loading || busy[`pad:${padRuleValue}`]) && 'pointer-events-none opacity-60'
          )}
          onClick={() => void togglePad()}
          aria-pressed={padFollowing}
          aria-label={padFollowing ? `Unfollow ${padFollowTarget}` : padFollowLabel}
          title={padFollowing ? `Unfollow ${padFollowTarget}` : padFollowLabel}
          disabled={loading || Boolean(busy[`pad:${padRuleValue}`])}
        >
          <StarIcon className="h-4 w-4" filled={padFollowing} />
          {!padFollowing && <span>{padFollowLabel}</span>}
        </button>
      )}
    </div>
  );
}

function findRuleId(rules: WatchlistRuleV1[], type: string, value: string) {
  const t = type.trim().toLowerCase();
  const v = String(value || '').trim();
  if (!t || !v) return null;
  const found = rules.find((rule) => String(rule.ruleType || '').trim().toLowerCase() === t && String(rule.ruleValue || '').trim() === v);
  return found?.id ? String(found.id) : null;
}

function buildPadRuleValue({ ll2PadId, padShortCode }: { ll2PadId?: number | null; padShortCode?: string | null }) {
  if (typeof ll2PadId === 'number' && Number.isFinite(ll2PadId) && ll2PadId > 0) {
    return `ll2:${String(Math.trunc(ll2PadId))}`;
  }
  const code = String(padShortCode || '').trim();
  if (!code || code === 'Pad') return null;
  return `code:${code}`;
}

function resolvePadFollowTarget({ padLabel, padShortCode }: { padLabel?: string | null; padShortCode?: string | null }) {
  const label = String(padLabel || '').trim();
  const labelKey = label.toLowerCase();
  if (label && labelKey !== 'unknown' && labelKey !== 'pad') return label;
  const shortCode = String(padShortCode || '').trim();
  if (shortCode && shortCode.toLowerCase() !== 'pad') return shortCode;
  return 'Pad';
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
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
