'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useToast } from './ToastProvider';

type RuleRow = {
  id: string;
  rule_type: string;
  rule_value: string;
};

type WatchlistRow = {
  id: string;
  name: string;
  watchlist_rules?: RuleRow[] | null;
};

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

  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [providerRuleId, setProviderRuleId] = useState<string | null>(null);
  const [padRuleId, setPadRuleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthed || !canUseSavedItems) return;
    if (!providerKey && !padRuleValue) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (debugEnabled) {
          console.log('[WatchlistFollows] load_start', {
            providerKey,
            padRuleValue,
            isAuthed,
            canUseSavedItems
          });
        }
        const startedAt = Date.now();
        const res = await fetch('/api/me/watchlists', { cache: 'no-store' });
        if (debugEnabled) console.log('[WatchlistFollows] load_response', { status: res.status, ok: res.ok, ms: Date.now() - startedAt });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error || `watchlists_http_${res.status}`);

        const watchlists = Array.isArray(json?.watchlists) ? (json.watchlists as WatchlistRow[]) : [];
        const selected =
          watchlists.find((w) => String(w?.name || '').trim().toLowerCase() === 'my launches') ?? watchlists[0] ?? null;

        if (!selected) {
          if (debugEnabled) console.log('[WatchlistFollows] load_no_watchlist_creating');
          const createRes = await fetch('/api/me/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            cache: 'no-store'
          });
          if (debugEnabled) console.log('[WatchlistFollows] create_response', { status: createRes.status, ok: createRes.ok });
          const createJson = await createRes.json().catch(() => ({}));
          if (cancelled) return;
          if (!createRes.ok) throw new Error(createJson?.error || `watchlists_create_http_${createRes.status}`);

          const created = createJson?.watchlist ?? null;
          const createdId = created?.id ? String(created.id) : null;
          setWatchlistId(createdId);
          setProviderRuleId(null);
          setPadRuleId(null);
          return;
        }

        const selectedId = selected?.id ? String(selected.id) : null;
        setWatchlistId(selectedId);
        if (debugEnabled) console.log('[WatchlistFollows] load_selected', { watchlistId: selectedId ? `${selectedId.slice(0, 8)}…` : null });

        const rules = Array.isArray(selected.watchlist_rules) ? selected.watchlist_rules : [];
        const nextProviderRuleId = findRuleId(rules, 'provider', providerKey);
        const nextPadRuleId = padRuleValue ? findRuleId(rules, 'pad', padRuleValue) : null;
        setProviderRuleId(nextProviderRuleId);
        setPadRuleId(nextPadRuleId);
        if (debugEnabled) {
          console.log('[WatchlistFollows] load_rules', {
            providerFollowing: Boolean(nextProviderRuleId),
            padFollowing: Boolean(nextPadRuleId),
            providerRuleId: nextProviderRuleId ? `${nextProviderRuleId.slice(0, 8)}…` : null,
            padRuleId: nextPadRuleId ? `${nextPadRuleId.slice(0, 8)}…` : null
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('watchlist follows load error', err);
        setError(err?.message || 'Unable to load follows.');
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [canUseSavedItems, debugEnabled, isAuthed, padRuleValue, providerKey]);

  if (!isAuthed || !canUseSavedItems) return null;
  if (!providerKey && !padRuleValue) return null;

  const providerFollowing = Boolean(providerRuleId);
  const padFollowing = Boolean(padRuleId);

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
        const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(providerRuleId)}`, {
          method: 'DELETE',
          cache: 'no-store'
        });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_delete_response', { status: res.status, ok: res.ok });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `unfollow_http_${res.status}`);
        setProviderRuleId(null);
        if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_deleted');
        if (!options?.skipToast) {
          pushToast({
            message: `Unfollowed ${providerKey}.`,
            tone: 'info',
            onUndo: async () => {
              try {
                const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rule_type: 'provider', rule_value: providerKey }),
                  cache: 'no-store'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const limit = typeof json?.limit === 'number' ? json.limit : null;
                  if (json?.error === 'limit_reached' && limit) throw new Error(`My Launches limit reached (${limit} rules).`);
                  throw new Error(json?.error || `follow_http_${res.status}`);
                }
                const nextId = json?.rule?.id ? String(json.rule.id) : null;
                if (!nextId) throw new Error('follow_failed');
                setProviderRuleId(nextId);
              } catch (err: any) {
                console.error('provider follow undo error', err);
                setError(err?.message || 'Unable to undo provider follow.');
                // Ensure UI reflects the last successful action (unfollow) if undo failed.
                setProviderRuleId(null);
              }
            }
          });
        }
        return;
      }

      const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_type: 'provider', rule_value: providerKey }),
        cache: 'no-store'
      });
      if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_post_response', { status: res.status, ok: res.ok });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const limit = typeof json?.limit === 'number' ? json.limit : null;
        if (json?.error === 'limit_reached' && limit) throw new Error(`My Launches limit reached (${limit} rules).`);
        throw new Error(json?.error || `follow_http_${res.status}`);
      }
      const nextId = json?.rule?.id ? String(json.rule.id) : null;
      if (!nextId) throw new Error('follow_failed');
      setProviderRuleId(nextId);
      if (debugEnabled) console.log('[WatchlistFollows] toggle_provider_added', { providerRuleId: `${nextId.slice(0, 8)}…` });
      if (!options?.skipToast) {
        pushToast({
          message: `Following ${providerKey}.`,
          tone: 'success',
          onUndo: async () => {
            try {
              const res = await fetch(
                `/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(nextId)}`,
                { method: 'DELETE', cache: 'no-store' }
              );
              const json = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(json?.error || `unfollow_http_${res.status}`);
              setProviderRuleId(null);
            } catch (err: any) {
              console.error('provider unfollow undo error', err);
              setError(err?.message || 'Unable to undo provider unfollow.');
              // Ensure UI reflects the last successful action (follow) if undo failed.
              setProviderRuleId(nextId);
            }
          }
        });
      }
    } catch (err: any) {
      console.error('provider follow toggle error', err);
      setError(err?.message || 'Unable to update provider follow.');
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
        const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(padRuleId)}`, {
          method: 'DELETE',
          cache: 'no-store'
        });
        if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_delete_response', { status: res.status, ok: res.ok });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `unfollow_http_${res.status}`);
        setPadRuleId(null);
        if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_deleted');
        if (!options?.skipToast) {
          pushToast({
            message: `Unfollowed ${padFollowTarget}.`,
            tone: 'info',
            onUndo: async () => {
              try {
                const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rule_type: 'pad', rule_value: padRuleValue }),
                  cache: 'no-store'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const limit = typeof json?.limit === 'number' ? json.limit : null;
                  if (json?.error === 'limit_reached' && limit) throw new Error(`My Launches limit reached (${limit} rules).`);
                  throw new Error(json?.error || `follow_http_${res.status}`);
                }
                const nextId = json?.rule?.id ? String(json.rule.id) : null;
                if (!nextId) throw new Error('follow_failed');
                setPadRuleId(nextId);
              } catch (err: any) {
                console.error('pad follow undo error', err);
                setError(err?.message || 'Unable to undo pad follow.');
                setPadRuleId(null);
              }
            }
          });
        }
        return;
      }

      const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_type: 'pad', rule_value: padRuleValue }),
        cache: 'no-store'
      });
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_post_response', { status: res.status, ok: res.ok });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const limit = typeof json?.limit === 'number' ? json.limit : null;
        if (json?.error === 'limit_reached' && limit) throw new Error(`My Launches limit reached (${limit} rules).`);
        throw new Error(json?.error || `follow_http_${res.status}`);
      }
      const nextId = json?.rule?.id ? String(json.rule.id) : null;
      if (!nextId) throw new Error('follow_failed');
      setPadRuleId(nextId);
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_added', { padRuleId: `${nextId.slice(0, 8)}…` });
      if (!options?.skipToast) {
        pushToast({
          message: `Following ${padFollowTarget}.`,
          tone: 'success',
          onUndo: async () => {
            try {
              const res = await fetch(
                `/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(nextId)}`,
                { method: 'DELETE', cache: 'no-store' }
              );
              const json = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(json?.error || `unfollow_http_${res.status}`);
              setPadRuleId(null);
            } catch (err: any) {
              console.error('pad unfollow undo error', err);
              setError(err?.message || 'Unable to undo pad unfollow.');
              setPadRuleId(nextId);
            }
          }
        });
      }
    } catch (err: any) {
      console.error('pad follow toggle error', err);
      setError(err?.message || 'Unable to update pad follow.');
      if (debugEnabled) console.log('[WatchlistFollows] toggle_pad_error', { error: String(err?.message || err) });
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">{error}</span>}
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

function findRuleId(rules: RuleRow[], type: string, value: string) {
  const t = type.trim().toLowerCase();
  const v = String(value || '').trim();
  if (!t || !v) return null;
  const found = rules.find((rule) => String(rule.rule_type || '').trim().toLowerCase() === t && String(rule.rule_value || '').trim() === v);
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
