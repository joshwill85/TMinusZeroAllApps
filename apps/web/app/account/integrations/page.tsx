'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { LaunchFilter } from '@/lib/types/launch';

type SubscriptionSnapshot = {
  isAuthed: boolean;
  isPaid: boolean;
  isAdmin: boolean;
  tier?: string;
};

type NamedFeed = {
  id: string;
  name: string;
  token: string;
  filters?: LaunchFilter;
  alarm_minutes_before?: number | null;
  created_at?: string;
  updated_at?: string;
};

type EmbedWidget = {
  id: string;
  name: string;
  token: string;
  widget_type?: string;
  filters?: LaunchFilter;
  preset_id?: string | null;
  watchlist_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type CopyState = 'idle' | 'copied' | 'error';

export default function IntegrationsPage() {
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [calendarFeeds, setCalendarFeeds] = useState<NamedFeed[]>([]);
  const [rssFeeds, setRssFeeds] = useState<NamedFeed[]>([]);
  const [embedWidgets, setEmbedWidgets] = useState<EmbedWidget[]>([]);

  const [copyState, setCopyState] = useState<Record<string, CopyState>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const baseUrl = useMemo(() => resolveBaseUrl(), []);

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
          tier: typeof json?.tier === 'string' ? json.tier : undefined
        });
        setStatus(json?.isAuthed ? 'authed' : 'guest');
      })
      .catch((err) => {
        if (!active) return;
        console.error('subscription load error', err);
        setSubscription({ isAuthed: false, isPaid: false, isAdmin: false });
        setStatus('guest');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'authed') return;
    if (!subscription?.isPaid) {
      setCalendarFeeds([]);
      setRssFeeds([]);
      setEmbedWidgets([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch('/api/me/calendar-feeds', { cache: 'no-store' }),
      fetch('/api/me/rss-feeds', { cache: 'no-store' }),
      fetch('/api/me/embed-widgets', { cache: 'no-store' })
    ])
      .then(async ([calendarRes, rssRes, widgetsRes]) => {
        const [calendarJson, rssJson, widgetsJson] = await Promise.all([
          calendarRes.json().catch(() => ({})),
          rssRes.json().catch(() => ({})),
          widgetsRes.json().catch(() => ({}))
        ]);

        if (!active) return;

        if (!calendarRes.ok && calendarRes.status === 402) {
          setError('Premium required to manage integrations.');
          return;
        }

        if (!calendarRes.ok) throw new Error(calendarJson?.error || 'Failed to load calendar feeds.');
        if (!rssRes.ok) throw new Error(rssJson?.error || 'Failed to load RSS feeds.');
        if (!widgetsRes.ok) throw new Error(widgetsJson?.error || 'Failed to load embed widgets.');

        setCalendarFeeds(Array.isArray(calendarJson?.feeds) ? calendarJson.feeds : []);
        setRssFeeds(Array.isArray(rssJson?.feeds) ? rssJson.feeds : []);
        setEmbedWidgets(Array.isArray(widgetsJson?.widgets) ? widgetsJson.widgets : []);
      })
      .catch((err) => {
        if (!active) return;
        console.error('integrations load error', err);
        setError(err?.message || 'Unable to load integrations.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status, subscription?.isPaid]);

  async function copyText(key: string, value: string | null) {
    try {
      if (!value) throw new Error('missing_value');
      await navigator.clipboard.writeText(value);
      setCopyState((prev) => ({ ...prev, [key]: 'copied' }));
      window.setTimeout(() => setCopyState((prev) => ({ ...prev, [key]: 'idle' })), 2000);
    } catch {
      setCopyState((prev) => ({ ...prev, [key]: 'error' }));
    }
  }

  async function renameFeed(kind: 'calendar' | 'rss', feed: NamedFeed) {
    const next = window.prompt('Rename feed', feed.name)?.trim();
    if (!next || next === feed.name) return;

    const key = `${kind}:rename:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/${kind}-feeds/${encodeURIComponent(feed.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rename_http_${res.status}`);
      const updated = json?.feed;
      if (!updated?.id) throw new Error('rename_failed');

      if (kind === 'calendar') setCalendarFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, name: next } : f)));
      if (kind === 'rss') setRssFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, name: next } : f)));
    } catch (err) {
      console.error('rename feed error', err);
      setError('Unable to rename feed.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function rotateFeed(kind: 'calendar' | 'rss', feed: NamedFeed) {
    const ok = window.confirm('Rotate token? Existing subscriptions using the old token will stop working.');
    if (!ok) return;

    const key = `${kind}:rotate:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/${kind}-feeds/${encodeURIComponent(feed.id)}/rotate`, {
        method: 'POST',
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rotate_http_${res.status}`);
      const token = json?.feed?.token ? String(json.feed.token) : null;
      if (!token) throw new Error('token_missing');

      const update = (items: NamedFeed[]) => items.map((f) => (f.id === feed.id ? { ...f, token } : f));
      if (kind === 'calendar') setCalendarFeeds(update);
      if (kind === 'rss') setRssFeeds(update);
    } catch (err) {
      console.error('rotate feed error', err);
      setError('Unable to rotate token.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function updateCalendarReminder(feed: NamedFeed) {
    const current =
      typeof feed.alarm_minutes_before === 'number' && Number.isFinite(feed.alarm_minutes_before)
        ? String(Math.trunc(feed.alarm_minutes_before))
        : '';
    const nextRaw = window.prompt('Reminder minutes before launch (blank for none)', current);
    if (nextRaw == null) return;

    const trimmed = nextRaw.trim();
    let next: number | null = null;
    if (trimmed) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10080) {
        setError('Reminder must be an integer between 0 and 10080 (7 days).');
        return;
      }
      next = n;
    }

    const key = `calendar:reminder:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/me/calendar-feeds/${encodeURIComponent(feed.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alarm_minutes_before: next }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `reminder_http_${res.status}`);

      setCalendarFeeds((prev) => prev.map((f) => (f.id === feed.id ? { ...f, alarm_minutes_before: next } : f)));
    } catch (err) {
      console.error('update calendar reminder error', err);
      setError('Unable to update calendar reminders.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deleteFeed(kind: 'calendar' | 'rss', feed: NamedFeed) {
    const ok = window.confirm('Delete this feed? Existing subscriptions will stop working.');
    if (!ok) return;

    const key = `${kind}:delete:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/${kind}-feeds/${encodeURIComponent(feed.id)}`, { method: 'DELETE', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);

      if (kind === 'calendar') setCalendarFeeds((prev) => prev.filter((f) => f.id !== feed.id));
      if (kind === 'rss') setRssFeeds((prev) => prev.filter((f) => f.id !== feed.id));
    } catch (err) {
      console.error('delete feed error', err);
      setError('Unable to delete feed.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function renameWidget(widget: EmbedWidget) {
    const next = window.prompt('Rename widget', widget.name)?.trim();
    if (!next || next === widget.name) return;

    const key = `widget:rename:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/embed-widgets/${encodeURIComponent(widget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rename_http_${res.status}`);
      setEmbedWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, name: next } : w)));
    } catch (err) {
      console.error('rename widget error', err);
      setError('Unable to rename widget.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function rotateWidget(widget: EmbedWidget) {
    const ok = window.confirm('Rotate token? Existing embeds using the old token will stop working.');
    if (!ok) return;

    const key = `widget:rotate:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/embed-widgets/${encodeURIComponent(widget.id)}/rotate`, { method: 'POST', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rotate_http_${res.status}`);
      const token = json?.widget?.token ? String(json.widget.token) : null;
      if (!token) throw new Error('token_missing');
      setEmbedWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, token } : w)));
    } catch (err) {
      console.error('rotate widget error', err);
      setError('Unable to rotate widget token.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function revokeWidget(widget: EmbedWidget) {
    const ok = window.confirm('Revoke this widget? Existing embeds will stop working.');
    if (!ok) return;

    const key = `widget:revoke:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/me/embed-widgets/${encodeURIComponent(widget.id)}`, { method: 'DELETE', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);
      setEmbedWidgets((prev) => prev.filter((w) => w.id !== widget.id));
    } catch (err) {
      console.error('revoke widget error', err);
      setError('Unable to revoke widget.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Account</p>
          <h1 className="text-3xl font-semibold text-text1">Integrations</h1>
          <p className="mt-1 text-sm text-text3">Manage your calendar feeds, RSS feeds, and embeddable widgets.</p>
        </div>
        <Link href="/account" className="text-sm text-primary hover:underline">
          Back to profile
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {error}
        </div>
      )}

      {status === 'loading' && <p className="mt-4 text-text3">Loading…</p>}

      {status === 'guest' && (
        <p className="mt-4 text-text2">
          You are not signed in.{' '}
          <Link className="text-primary hover:underline" href="/auth/sign-in">
            Sign in
          </Link>{' '}
          to manage integrations.
        </p>
      )}

      {status === 'authed' && subscription?.isPaid !== true && (
        <div className="mt-4 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Premium</div>
          <div className="mt-1 text-base font-semibold text-text1">Integrations are Premium-only</div>
          <div className="mt-1 text-xs text-text3">
            Calendar feeds, RSS feeds, and embeds use live data and tokenized links. Upgrade to Premium to enable and manage them.
          </div>
          <Link className="mt-3 inline-block text-sm text-primary hover:underline" href="/account">
            View billing options
          </Link>
        </div>
      )}

      {status === 'authed' && subscription?.isPaid === true && (
        <>
          <Section
            title="Calendar feeds"
            description="Private, tokenized .ics subscriptions (live Premium schedule)."
            emptyLabel={loading ? 'Loading calendar feeds…' : 'No calendar feeds yet. Create one from Bulk export on the home page.'}
            items={calendarFeeds}
            renderItem={(feed) => {
              const urls = buildCalendarUrls(baseUrl, feed.token);
              const renameKey = `calendar:rename:${feed.id}`;
              const rotateKey = `calendar:rotate:${feed.id}`;
              const reminderKey = `calendar:reminder:${feed.id}`;
              const deleteKey = `calendar:delete:${feed.id}`;
              return (
                <div key={feed.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text1">{feed.name}</div>
                      <div className="mt-1 text-xs text-text3">
                        {formatUpdated(feed.updated_at || feed.created_at)} • {formatCalendarReminder(feed.alarm_minutes_before)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={clsx('btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary', !urls.httpsUrl && 'pointer-events-none opacity-50')}
                        href={urls.webcalUrl || undefined}
                        aria-disabled={!urls.webcalUrl}
                        tabIndex={urls.webcalUrl ? undefined : -1}
                      >
                        Subscribe
                      </a>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => copyText(`calendar:https:${feed.id}`, urls.httpsUrl)}
                      >
                        {copyState[`calendar:https:${feed.id}`] === 'copied'
                          ? 'Copied'
                          : copyState[`calendar:https:${feed.id}`] === 'error'
                            ? 'Copy failed'
                            : 'Copy link'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => renameFeed('calendar', feed)}
                      disabled={busy[renameKey]}
                    >
                      {busy[renameKey] ? 'Renaming…' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => updateCalendarReminder(feed)}
                      disabled={busy[reminderKey]}
                    >
                      {busy[reminderKey] ? 'Saving…' : 'Reminders'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => rotateFeed('calendar', feed)}
                      disabled={busy[rotateKey]}
                    >
                      {busy[rotateKey] ? 'Rotating…' : 'Rotate token'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => deleteFeed('calendar', feed)}
                      disabled={busy[deleteKey]}
                    >
                      {busy[deleteKey] ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            }}
          />

          <Section
            title="RSS feeds"
            description="Private RSS links (live Premium schedule)."
            emptyLabel={loading ? 'Loading RSS feeds…' : 'No RSS feeds yet. Create one from the RSS button on the home page.'}
            items={rssFeeds}
            renderItem={(feed) => {
              const urls = buildRssUrls(baseUrl, feed.token);
              const renameKey = `rss:rename:${feed.id}`;
              const rotateKey = `rss:rotate:${feed.id}`;
              const deleteKey = `rss:delete:${feed.id}`;
              return (
                <div key={feed.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text1">{feed.name}</div>
                      <div className="mt-1 text-xs text-text3">{formatUpdated(feed.updated_at || feed.created_at)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={clsx(
                          'btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary',
                          !urls.rssUrl && 'pointer-events-none opacity-50'
                        )}
                        href={urls.rssUrl || undefined}
                        aria-disabled={!urls.rssUrl}
                        tabIndex={urls.rssUrl ? undefined : -1}
                      >
                        RSS
                      </a>
                      <a
                        className={clsx(
                          'btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary',
                          !urls.atomUrl && 'pointer-events-none opacity-50'
                        )}
                        href={urls.atomUrl || undefined}
                        aria-disabled={!urls.atomUrl}
                        tabIndex={urls.atomUrl ? undefined : -1}
                      >
                        Atom
                      </a>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => copyText(`rss:https:${feed.id}`, urls.rssUrl)}
                      >
                        {copyState[`rss:https:${feed.id}`] === 'copied'
                          ? 'Copied'
                          : copyState[`rss:https:${feed.id}`] === 'error'
                            ? 'Copy failed'
                            : 'Copy RSS'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => copyText(`rss:atom:${feed.id}`, urls.atomUrl)}
                      >
                        {copyState[`rss:atom:${feed.id}`] === 'copied'
                          ? 'Copied'
                          : copyState[`rss:atom:${feed.id}`] === 'error'
                            ? 'Copy failed'
                            : 'Copy Atom'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => renameFeed('rss', feed)}
                      disabled={busy[renameKey]}
                    >
                      {busy[renameKey] ? 'Renaming…' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => rotateFeed('rss', feed)}
                      disabled={busy[rotateKey]}
                    >
                      {busy[rotateKey] ? 'Rotating…' : 'Rotate token'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => deleteFeed('rss', feed)}
                      disabled={busy[deleteKey]}
                    >
                      {busy[deleteKey] ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            }}
          />

          <Section
            title="Embeds"
            description="Per-widget tokens (revocable per embed)."
            emptyLabel={loading ? 'Loading embed widgets…' : 'No embed widgets yet. Create one from the Embed button on the home page.'}
            items={embedWidgets}
            renderItem={(widget) => {
              const urls = buildEmbedUrls(baseUrl, widget.token);
              const renameKey = `widget:rename:${widget.id}`;
              const rotateKey = `widget:rotate:${widget.id}`;
              const revokeKey = `widget:revoke:${widget.id}`;
              return (
                <div key={widget.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text1">{widget.name}</div>
                      <div className="mt-1 text-xs text-text3">{formatUpdated(widget.updated_at || widget.created_at)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={clsx('btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary', !urls.srcUrl && 'pointer-events-none opacity-50')}
                        href={urls.srcUrl || undefined}
                        aria-disabled={!urls.srcUrl}
                        tabIndex={urls.srcUrl ? undefined : -1}
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                        onClick={() => copyText(`widget:code:${widget.id}`, urls.iframeCode)}
                      >
                        {copyState[`widget:code:${widget.id}`] === 'copied'
                          ? 'Copied'
                          : copyState[`widget:code:${widget.id}`] === 'error'
                            ? 'Copy failed'
                            : 'Copy code'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => renameWidget(widget)}
                      disabled={busy[renameKey]}
                    >
                      {busy[renameKey] ? 'Renaming…' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => rotateWidget(widget)}
                      disabled={busy[rotateKey]}
                    >
                      {busy[rotateKey] ? 'Rotating…' : 'Rotate token'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => revokeWidget(widget)}
                      disabled={busy[revokeKey]}
                    >
                      {busy[revokeKey] ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              );
            }}
          />

          <div className="mt-6 text-xs text-text3">
            These links are secret tokens. We use caching headers and rate limits on token endpoints to reduce abuse and backend load.
          </div>
        </>
      )}
    </div>
  );
}

function resolveBaseUrl() {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (baseUrl) return baseUrl;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function buildCalendarUrls(baseUrl: string, token: string) {
  const httpsUrl = baseUrl ? `${baseUrl}/api/calendar/${encodeURIComponent(token)}.ics` : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:\/\//, 'webcal://') : null;
  return { httpsUrl, webcalUrl };
}

function buildRssUrls(baseUrl: string, token: string) {
  const rssUrl = baseUrl ? `${baseUrl}/rss/${encodeURIComponent(token)}.xml` : null;
  const atomUrl = baseUrl ? `${baseUrl}/rss/${encodeURIComponent(token)}.atom` : null;
  return { rssUrl, atomUrl };
}

function buildEmbedUrls(baseUrl: string, token: string) {
  const srcUrl = baseUrl ? `${baseUrl}/embed/next-launch?token=${encodeURIComponent(token)}` : null;
  const iframeCode = srcUrl
    ? `<iframe
  src="${srcUrl}"
  title="T-Minus Next Launch"
  loading="lazy"
  style="width: 100%; max-width: 520px; height: 720px; border: 0; border-radius: 16px; overflow: hidden;"
  allow="clipboard-write; web-share"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>`
    : null;
  return { srcUrl, iframeCode };
}

function formatUpdated(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `Updated ${d.toLocaleString()}`;
}

function formatCalendarReminder(value?: unknown) {
  if (value == null) return 'Reminders: none';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'Reminders: none';
  const minutes = Math.trunc(n);
  if (minutes <= 0) return 'Reminders: at launch';
  if (minutes === 60) return 'Reminders: 1 hour';
  if (minutes === 1440) return 'Reminders: 1 day';
  return `Reminders: ${minutes}m`;
}

function Section<T>({
  title,
  description,
  emptyLabel,
  items,
  renderItem
}: {
  title: string;
  description: string;
  emptyLabel: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">{title}</div>
          <div className="mt-1 text-xs text-text3">{description}</div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {items.length ? items.map((item) => renderItem(item)) : <div className="text-sm text-text3">{emptyLabel}</div>}
      </div>
    </section>
  );
}
