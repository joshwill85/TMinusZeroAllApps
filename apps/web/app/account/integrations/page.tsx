'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { CalendarFeedV1, EmbedWidgetV1, RssFeedV1 } from '@tminuszero/api-client';
import { buildAuthHref, buildProfileHref } from '@tminuszero/navigation';
import {
  useCalendarFeedsQuery,
  useDeleteCalendarFeedMutation,
  useDeleteEmbedWidgetMutation,
  useDeleteRssFeedMutation,
  useEmbedWidgetsQuery,
  useRotateCalendarFeedMutation,
  useRotateEmbedWidgetMutation,
  useRotateRssFeedMutation,
  useRssFeedsQuery,
  useUpdateCalendarFeedMutation,
  useUpdateEmbedWidgetMutation,
  useUpdateRssFeedMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';

type CopyState = 'idle' | 'copied' | 'error';

export default function IntegrationsPage() {
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const status: 'loading' | 'authed' | 'guest' = viewerSessionQuery.isPending
    ? 'loading'
    : viewerSessionQuery.data?.viewerId
      ? 'authed'
      : 'guest';
  const isPaid = entitlementsQuery.data?.isPaid ?? false;
  const entitlementsLoading = status === 'authed' && entitlementsQuery.isPending && !entitlementsQuery.data;
  const calendarFeedsQuery = useCalendarFeedsQuery({ enabled: status === 'authed' });
  const rssFeedsQuery = useRssFeedsQuery({ enabled: status === 'authed' });
  const embedWidgetsQuery = useEmbedWidgetsQuery({ enabled: status === 'authed' });
  const updateCalendarFeedMutation = useUpdateCalendarFeedMutation();
  const deleteCalendarFeedMutation = useDeleteCalendarFeedMutation();
  const rotateCalendarFeedMutation = useRotateCalendarFeedMutation();
  const updateRssFeedMutation = useUpdateRssFeedMutation();
  const deleteRssFeedMutation = useDeleteRssFeedMutation();
  const rotateRssFeedMutation = useRotateRssFeedMutation();
  const updateEmbedWidgetMutation = useUpdateEmbedWidgetMutation();
  const deleteEmbedWidgetMutation = useDeleteEmbedWidgetMutation();
  const rotateEmbedWidgetMutation = useRotateEmbedWidgetMutation();

  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<Record<string, CopyState>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const baseUrl = useMemo(() => resolveBaseUrl(), []);
  const calendarFeeds = calendarFeedsQuery.data?.feeds ?? [];
  const rssFeeds = rssFeedsQuery.data?.feeds ?? [];
  const embedWidgets = embedWidgetsQuery.data?.widgets ?? [];
  const hasIntegrationInventory = calendarFeeds.length > 0 || rssFeeds.length > 0 || embedWidgets.length > 0;
  const loadingIntegrations = status === 'authed' && (calendarFeedsQuery.isPending || rssFeedsQuery.isPending || embedWidgetsQuery.isPending);
  const queryError =
    status === 'authed' ? calendarFeedsQuery.error || rssFeedsQuery.error || embedWidgetsQuery.error || (entitlementsQuery.error ?? null) : entitlementsQuery.error;
  const activeError = error ?? (queryError ? getErrorMessage(queryError, 'Unable to load integrations.') : null);

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

  async function renameFeed(kind: 'calendar' | 'rss', feed: CalendarFeedV1 | RssFeedV1) {
    const next = window.prompt('Rename feed', feed.name)?.trim();
    if (!next || next === feed.name) return;

    const key = `${kind}:rename:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      if (kind === 'calendar') {
        await updateCalendarFeedMutation.mutateAsync({ feedId: feed.id, payload: { name: next } });
      } else {
        await updateRssFeedMutation.mutateAsync({ feedId: feed.id, payload: { name: next } });
      }
    } catch (mutationError: unknown) {
      console.error('rename feed error', mutationError);
      setError('Unable to rename feed.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function rotateFeed(kind: 'calendar' | 'rss', feed: CalendarFeedV1 | RssFeedV1) {
    const ok = window.confirm('Rotate token? Existing subscriptions using the old token will stop working.');
    if (!ok) return;

    const key = `${kind}:rotate:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      if (kind === 'calendar') {
        await rotateCalendarFeedMutation.mutateAsync(feed.id);
      } else {
        await rotateRssFeedMutation.mutateAsync(feed.id);
      }
    } catch (mutationError: unknown) {
      console.error('rotate feed error', mutationError);
      setError('Unable to rotate token.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function updateCalendarReminder(feed: CalendarFeedV1) {
    const current =
      typeof feed.alarmMinutesBefore === 'number' && Number.isFinite(feed.alarmMinutesBefore)
        ? String(Math.trunc(feed.alarmMinutesBefore))
        : '';
    const nextRaw = window.prompt('Reminder minutes before launch (blank for none)', current);
    if (nextRaw == null) return;

    const trimmed = nextRaw.trim();
    let next: number | null = null;
    if (trimmed) {
      const value = Number(trimmed);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 10080) {
        setError('Reminder must be an integer between 0 and 10080 (7 days).');
        return;
      }
      next = value;
    }

    const key = `calendar:reminder:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await updateCalendarFeedMutation.mutateAsync({
        feedId: feed.id,
        payload: { alarmMinutesBefore: next }
      });
    } catch (mutationError: unknown) {
      console.error('update calendar reminder error', mutationError);
      setError('Unable to update calendar reminders.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function deleteFeed(kind: 'calendar' | 'rss', feed: CalendarFeedV1 | RssFeedV1) {
    const ok = window.confirm('Delete this feed? Existing subscriptions will stop working.');
    if (!ok) return;

    const key = `${kind}:delete:${feed.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      if (kind === 'calendar') {
        await deleteCalendarFeedMutation.mutateAsync(feed.id);
      } else {
        await deleteRssFeedMutation.mutateAsync(feed.id);
      }
    } catch (mutationError: unknown) {
      console.error('delete feed error', mutationError);
      setError('Unable to delete feed.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function renameWidget(widget: EmbedWidgetV1) {
    const next = window.prompt('Rename widget', widget.name)?.trim();
    if (!next || next === widget.name) return;

    const key = `widget:rename:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await updateEmbedWidgetMutation.mutateAsync({
        widgetId: widget.id,
        payload: { name: next }
      });
    } catch (mutationError: unknown) {
      console.error('rename widget error', mutationError);
      setError('Unable to rename widget.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function rotateWidget(widget: EmbedWidgetV1) {
    const ok = window.confirm('Rotate token? Existing embeds using the old token will stop working.');
    if (!ok) return;

    const key = `widget:rotate:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await rotateEmbedWidgetMutation.mutateAsync(widget.id);
    } catch (mutationError: unknown) {
      console.error('rotate widget error', mutationError);
      setError('Unable to rotate widget token.');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function revokeWidget(widget: EmbedWidgetV1) {
    const ok = window.confirm('Revoke this widget? Existing embeds will stop working.');
    if (!ok) return;

    const key = `widget:revoke:${widget.id}`;
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      await deleteEmbedWidgetMutation.mutateAsync(widget.id);
    } catch (mutationError: unknown) {
      console.error('revoke widget error', mutationError);
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
        <Link href={buildProfileHref()} className="text-sm text-primary hover:underline">
          Back to profile
        </Link>
      </div>

      {activeError && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{activeError}</div>
      )}

      {(status === 'loading' || entitlementsLoading) && <p className="mt-4 text-text3">Loading…</p>}

      {status === 'guest' && (
        <p className="mt-4 text-text2">
          You are not signed in.{' '}
          <Link className="text-primary hover:underline" href={buildAuthHref('sign-in', { returnTo: '/account/integrations' })}>
            Sign in
          </Link>{' '}
          to manage integrations.
        </p>
      )}

      {status === 'authed' && !entitlementsLoading && isPaid !== true && (
        <div className="mt-4 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Signed in</div>
          <div className="mt-1 text-base font-semibold text-text1">
            {hasIntegrationInventory ? 'Stored integrations are read-only without Premium.' : 'Integrations are Premium-only.'}
          </div>
          <div className="mt-1 text-xs text-text3">
            {hasIntegrationInventory
              ? 'Calendar feeds, RSS feeds, and embeds already stored on this account remain visible. Upgrade to Premium to rotate, edit, delete, or create new integrations.'
              : 'Calendar feeds, RSS feeds, and embeds use live data and tokenized links. Upgrade to Premium to enable and manage them.'}
          </div>
          <Link className="mt-3 inline-block text-sm text-primary hover:underline" href={buildProfileHref()}>
            View billing options
          </Link>
        </div>
      )}

      {status === 'authed' && !entitlementsLoading && isPaid !== true && hasIntegrationInventory && (
        <>
          <Section
            title="Calendar feeds"
            description="Stored Premium calendar feeds (read-only)."
            emptyLabel="No stored calendar feeds."
            items={calendarFeeds}
            renderItem={(feed) => {
              const urls = buildCalendarUrls(baseUrl, feed.token);
              return (
                <div key={feed.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="truncate text-sm font-semibold text-text1">{feed.name}</div>
                  <div className="mt-1 text-xs text-text3">
                    {formatUpdated(feed.updatedAt || feed.createdAt)} • {formatCalendarReminder(feed.alarmMinutesBefore)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      className={clsx(
                        'btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary',
                        !urls.webcalUrl && 'pointer-events-none opacity-50'
                      )}
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
              );
            }}
          />

          <Section
            title="RSS feeds"
            description="Stored Premium RSS and Atom feeds (read-only)."
            emptyLabel="No stored RSS feeds."
            items={rssFeeds}
            renderItem={(feed) => {
              const urls = buildRssUrls(baseUrl, feed.token);
              return (
                <div key={feed.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="truncate text-sm font-semibold text-text1">{feed.name}</div>
                  <div className="mt-1 text-xs text-text3">{formatUpdated(feed.updatedAt || feed.createdAt)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
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
                  </div>
                </div>
              );
            }}
          />

          <Section
            title="Embed widgets"
            description="Stored Premium widgets (read-only)."
            emptyLabel="No stored widgets."
            items={embedWidgets}
            renderItem={(widget) => {
              const urls = buildEmbedUrls(baseUrl, widget.token);
              return (
                <div key={widget.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="truncate text-sm font-semibold text-text1">{widget.name}</div>
                  <div className="mt-1 text-xs text-text3">
                    {widget.widgetType.replace(/_/g, ' ')} • {formatUpdated(widget.updatedAt || widget.createdAt)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => copyText(`widget:src:${widget.id}`, urls.srcUrl)}
                    >
                      {copyState[`widget:src:${widget.id}`] === 'copied'
                        ? 'Copied'
                        : copyState[`widget:src:${widget.id}`] === 'error'
                          ? 'Copy failed'
                          : 'Copy src'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary"
                      onClick={() => copyText(`widget:iframe:${widget.id}`, urls.iframeCode)}
                    >
                      {copyState[`widget:iframe:${widget.id}`] === 'copied'
                        ? 'Copied'
                        : copyState[`widget:iframe:${widget.id}`] === 'error'
                          ? 'Copy failed'
                          : 'Copy iframe'}
                    </button>
                  </div>
                </div>
              );
            }}
          />
        </>
      )}

      {status === 'authed' && !entitlementsLoading && isPaid === true && (
        <>
          <Section
            title="Calendar feeds"
            description="Private, tokenized .ics subscriptions (live Premium schedule)."
            emptyLabel={loadingIntegrations ? 'Loading calendar feeds…' : 'No calendar feeds yet. Create one from Bulk export on the home page.'}
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
                        {formatUpdated(feed.updatedAt || feed.createdAt)} • {formatCalendarReminder(feed.alarmMinutesBefore)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={clsx(
                          'btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary',
                          !urls.httpsUrl && 'pointer-events-none opacity-50'
                        )}
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
            emptyLabel={loadingIntegrations ? 'Loading RSS feeds…' : 'No RSS feeds yet. Create one from the RSS button on the home page.'}
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
                      <div className="mt-1 text-xs text-text3">{formatUpdated(feed.updatedAt || feed.createdAt)}</div>
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
            emptyLabel={loadingIntegrations ? 'Loading embed widgets…' : 'No embed widgets yet. Create one from the Embed button on the home page.'}
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
                      <div className="mt-1 text-xs text-text3">{formatUpdated(widget.updatedAt || widget.createdAt)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className={clsx(
                          'btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1 hover:border-primary',
                          !urls.srcUrl && 'pointer-events-none opacity-50'
                        )}
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `Updated ${date.toLocaleString()}`;
}

function formatCalendarReminder(value?: unknown) {
  if (value == null) return 'Reminders: none';
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes)) return 'Reminders: none';
  const normalized = Math.trunc(minutes);
  if (normalized <= 0) return 'Reminders: at launch';
  if (normalized === 60) return 'Reminders: 1 hour';
  if (normalized === 1440) return 'Reminders: 1 day';
  return `Reminders: ${normalized}m`;
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
