'use client';

import { useEffect, useMemo, useState } from 'react';
import { LaunchFilter } from '@/lib/types/launch';
import { useCreateRssFeedMutation, useRotateRssFeedMutation } from '@/lib/api/queries';
import { PremiumGateButton } from '@/components/PremiumGateButton';

export function RssFeeds({
  filters,
  isAuthed,
  isPremium
}: {
  filters: LaunchFilter;
  isAuthed: boolean;
  isPremium: boolean;
}) {
  const createRssFeedMutation = useCreateRssFeedMutation();
  const rotateRssFeedMutation = useRotateRssFeedMutation();
  const [open, setOpen] = useState(false);
  const [copyStateRss, setCopyStateRss] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyStateAtom, setCopyStateAtom] = useState<'idle' | 'copied' | 'error'>('idle');
  const [feedState, setFeedState] = useState<
    { status: 'idle' | 'creating' | 'ready' | 'error'; feed: { id: string; name: string; token: string } | null }
  >({ status: 'idle', feed: null });

  useEffect(() => {
    if (!open) return;
    setCopyStateRss('idle');
    setCopyStateAtom('idle');
  }, [open]);

  const links = useMemo(() => buildLinks(filters, feedState.feed?.token ?? null), [filters, feedState.feed?.token]);

  async function copyLink(kind: 'rss' | 'atom') {
    try {
      const url = kind === 'atom' ? links.atomSubscriptionUrl : links.rssSubscriptionUrl;
      if (!url) throw new Error('subscription_link_unavailable');
      await navigator.clipboard.writeText(url);
      if (kind === 'atom') setCopyStateAtom('copied');
      else setCopyStateRss('copied');
      setTimeout(() => {
        if (kind === 'atom') setCopyStateAtom('idle');
        else setCopyStateRss('idle');
      }, 2000);
    } catch {
      if (kind === 'atom') setCopyStateAtom('error');
      else setCopyStateRss('error');
    }
  }

  async function createFeed() {
    if (feedState.status === 'creating') return;
    const suggested = `RSS • ${links.summary}`;
    const name = window.prompt('Feed name', suggested)?.trim();
    if (!name) return;

    setFeedState({ status: 'creating', feed: null });
    try {
      const payload = await createRssFeedMutation.mutateAsync({
        name,
        filters
      });
      const feed = payload.feed;
      if (!feed?.id || !feed?.token) {
        setFeedState({ status: 'error', feed: null });
        return;
      }
      setFeedState({ status: 'ready', feed: { id: String(feed.id), name: String(feed.name || ''), token: String(feed.token) } });
    } catch {
      setFeedState({ status: 'error', feed: null });
    }
  }

  async function rotateFeed() {
    if (!feedState.feed?.id) return;
    setFeedState((prev) => ({ ...prev, status: 'creating' }));
    try {
      const payload = await rotateRssFeedMutation.mutateAsync(feedState.feed.id);
      const token = payload.feed?.token ? String(payload.feed.token) : null;
      if (!token) {
        setFeedState((prev) => ({ ...prev, status: 'error' }));
        return;
      }
      setFeedState((prev) =>
        prev.feed ? { status: 'ready', feed: { ...prev.feed, token } } : { status: 'error', feed: null }
      );
    } catch {
      setFeedState((prev) => ({ ...prev, status: 'error' }));
    }
  }

  if (!isPremium) {
    return (
      <PremiumGateButton
        isAuthed={isAuthed}
        featureLabel="RSS feeds"
        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
        ariaLabel="RSS feeds (Premium)"
      >
        RSS
      </PremiumGateButton>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
        onClick={() => setOpen(true)}
      >
        RSS
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(0,0,0,0.55)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">RSS feeds</div>
                <div className="text-base font-semibold text-text1">Private launch feed</div>
                <div className="mt-1 text-xs text-text3">{links.summary}</div>
              </div>
              <button className="text-sm text-text3 hover:text-text1" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {!feedState.feed ? (
                <button
                  type="button"
                  className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                  onClick={createFeed}
                  disabled={feedState.status === 'creating' || createRssFeedMutation.isPending}
                >
                  {feedState.status === 'creating'
                    ? 'Creating RSS feed…'
                    : feedState.status === 'error'
                      ? 'Create RSS feed (retry)'
                      : 'Create RSS feed'}
                </button>
              ) : (
                <>
                  <a
                    href={links.rssSubscriptionUrl || undefined}
                    className={`block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                      links.rssSubscriptionUrl ? 'hover:border-primary' : 'pointer-events-none opacity-50'
                    }`}
                    aria-disabled={!links.rssSubscriptionUrl}
                    tabIndex={links.rssSubscriptionUrl ? undefined : -1}
                    onClick={() => setOpen(false)}
                  >
                    Open RSS link
                  </a>
                  <a
                    href={links.atomSubscriptionUrl || undefined}
                    className={`block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                      links.atomSubscriptionUrl ? 'hover:border-primary' : 'pointer-events-none opacity-50'
                    }`}
                    aria-disabled={!links.atomSubscriptionUrl}
                    tabIndex={links.atomSubscriptionUrl ? undefined : -1}
                    onClick={() => setOpen(false)}
                  >
                    Open Atom link
                  </a>
                  <button
                    type="button"
                    className={`w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                      links.rssSubscriptionUrl ? 'hover:border-primary' : 'opacity-50'
                    }`}
                    onClick={() => copyLink('rss')}
                    disabled={!links.rssSubscriptionUrl}
                  >
                    {copyStateRss === 'copied' ? 'Link copied' : copyStateRss === 'error' ? 'Copy failed' : 'Copy RSS link'}
                  </button>
                  <button
                    type="button"
                    className={`w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                      links.atomSubscriptionUrl ? 'hover:border-primary' : 'opacity-50'
                    }`}
                    onClick={() => copyLink('atom')}
                    disabled={!links.atomSubscriptionUrl}
                  >
                    {copyStateAtom === 'copied' ? 'Link copied' : copyStateAtom === 'error' ? 'Copy failed' : 'Copy Atom link'}
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                    onClick={rotateFeed}
                    disabled={feedState.status === 'creating' || rotateRssFeedMutation.isPending}
                  >
                    {feedState.status === 'creating' ? 'Rotating RSS feed…' : 'Rotate RSS link'}
                  </button>
                </>
              )}
            </div>

            <p className="mt-3 text-xs text-text3">
              RSS readers may poll frequently; we cache responses and rate limit requests.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function buildLinks(filters: LaunchFilter, feedToken: string | null) {
  const region = filters.region ?? 'us';

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const httpsBase = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  const rssPath = feedToken ? `/rss/${encodeURIComponent(feedToken)}.xml` : null;
  const atomPath = feedToken ? `/rss/${encodeURIComponent(feedToken)}.atom` : null;
  const rssSubscriptionUrl = rssPath ? `${httpsBase}${rssPath}` : null;
  const atomSubscriptionUrl = atomPath ? `${httpsBase}${atomPath}` : null;

  const locationSummary =
    region === 'all' ? 'Location: all' : region === 'non-us' ? 'Location: Non-US only' : 'Location: US only';

  const summaryParts = [
    locationSummary,
    filters.range ? `Range: ${filters.range}` : 'Range: 7d',
    filters.state ? `Region: ${filters.state}` : 'Region: all',
    filters.provider ? `Provider: ${filters.provider}` : 'Provider: all',
    filters.status && filters.status !== 'all' ? `Status: ${filters.status}` : 'Status: all'
  ];

  return {
    rssSubscriptionUrl,
    atomSubscriptionUrl,
    summary: summaryParts.join(' • ')
  };
}
