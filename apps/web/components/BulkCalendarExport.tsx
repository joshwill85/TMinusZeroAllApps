'use client';

import { useEffect, useMemo, useState } from 'react';
import { LaunchFilter } from '@/lib/types/launch';
import { PremiumGateButton } from '@/components/PremiumGateButton';

export function BulkCalendarExport({
  filters,
  isAuthed,
  isPremium
}: {
  filters: LaunchFilter;
  isAuthed: boolean;
  isPremium: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [alarmMinutesBefore, setAlarmMinutesBefore] = useState<number | null>(null);
  const [feedState, setFeedState] = useState<
    { status: 'idle' | 'creating' | 'ready' | 'error'; feed: { id: string; name: string; token: string } | null }
  >({ status: 'idle', feed: null });

  useEffect(() => {
    if (!open) return;
    setCopyState('idle');
    setAlarmMinutesBefore(null);
  }, [open]);

  const links = useMemo(() => buildLinks(filters, feedState.feed?.token ?? null), [filters, feedState.feed?.token]);

  async function copyLink() {
    try {
      if (!links.liveSubscriptionHttpsUrl) throw new Error('subscription_link_unavailable');
      await navigator.clipboard.writeText(links.liveSubscriptionHttpsUrl);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  }

  async function createLiveFeed() {
    if (feedState.status === 'creating') return;
    const suggested = `Live feed • ${links.summary}`;
    const name = window.prompt('Feed name', suggested)?.trim();
    if (!name) return;

    setFeedState({ status: 'creating', feed: null });
    try {
      const res = await fetch('/api/me/calendar-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters, alarm_minutes_before: alarmMinutesBefore }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedState({ status: 'error', feed: null });
        return;
      }
      const feed = json?.feed;
      if (!feed?.id || !feed?.token) {
        setFeedState({ status: 'error', feed: null });
        return;
      }
      setFeedState({ status: 'ready', feed: { id: String(feed.id), name: String(feed.name || ''), token: String(feed.token) } });
    } catch {
      setFeedState({ status: 'error', feed: null });
    }
  }

  async function rotateLiveFeed() {
    if (!feedState.feed?.id) return;
    setFeedState((prev) => ({ ...prev, status: 'creating' }));
    try {
      const res = await fetch(`/api/me/calendar-feeds/${encodeURIComponent(feedState.feed.id)}/rotate`, {
        method: 'POST',
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedState((prev) => ({ ...prev, status: 'error' }));
        return;
      }
      const feed = json?.feed;
      if (!feed?.token) {
        setFeedState((prev) => ({ ...prev, status: 'error' }));
        return;
      }
      setFeedState((prev) =>
        prev.feed ? { status: 'ready', feed: { ...prev.feed, token: String(feed.token) } } : { status: 'error', feed: null }
      );
    } catch {
      setFeedState((prev) => ({ ...prev, status: 'error' }));
    }
  }

  if (!isPremium) {
    return (
      <PremiumGateButton
        isAuthed={isAuthed}
        featureLabel="calendar exports"
        className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
        ariaLabel="Bulk export calendar (.ics) (Premium)"
      >
        Bulk export
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
        Bulk export
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(0,0,0,0.55)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">Bulk calendar export</div>
                <div className="text-base font-semibold text-text1">Filtered launches</div>
                <div className="mt-1 text-xs text-text3">{links.summary}</div>
              </div>
              <button className="text-sm text-text3 hover:text-text1" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <a
                href={links.icsUrl}
                className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                onClick={() => setOpen(false)}
              >
                Download .ics (bulk)
              </a>
            </div>

            <p className="mt-3 text-xs text-text3">
              Exports up to 1000 launches using your current filters.
            </p>

            <div className="mt-4 border-t border-stroke pt-4">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Live calendar feed</div>
              <div className="mt-1 text-sm font-semibold text-text1">Subscribe once, auto-updates</div>
              <p className="mt-1 text-xs text-text3">
                Uses the live Premium feed. Calendar apps may poll frequently; we cache responses and rate limit requests.
              </p>

              {!feedState.feed && (
                <div className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
                  <label className="block text-xs uppercase tracking-[0.1em] text-text3" htmlFor="calendarAlarm">
                    Reminders (optional)
                  </label>
                  <select
                    id="calendarAlarm"
                    className="mt-2 w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                    value={alarmMinutesBefore == null ? 'none' : String(alarmMinutesBefore)}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === 'none') {
                        setAlarmMinutesBefore(null);
                        return;
                      }
                      const n = Number(next);
                      if (!Number.isFinite(n)) return;
                      setAlarmMinutesBefore(Math.max(0, Math.min(10080, Math.trunc(n))));
                    }}
                  >
                    <option value="none">None</option>
                    <option value="10">10 minutes before</option>
                    <option value="30">30 minutes before</option>
                    <option value="60">1 hour before</option>
                    <option value="1440">1 day before</option>
                  </select>
                  <div className="mt-2 text-xs text-text3">Applies only to timed launches (not all-day events).</div>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {!feedState.feed ? (
                  <button
                    type="button"
                    className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                    onClick={createLiveFeed}
                    disabled={feedState.status === 'creating'}
                  >
                    {feedState.status === 'creating'
                      ? 'Creating live feed…'
                      : feedState.status === 'error'
                        ? 'Create live feed (retry)'
                        : 'Create live feed'}
                  </button>
                ) : (
                  <>
                    <a
                      href={links.liveSubscriptionWebcalUrl || undefined}
                      className={`block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                        links.liveSubscriptionWebcalUrl ? 'hover:border-primary' : 'pointer-events-none opacity-50'
                      }`}
                      aria-disabled={!links.liveSubscriptionWebcalUrl}
                      tabIndex={links.liveSubscriptionWebcalUrl ? undefined : -1}
                      onClick={() => setOpen(false)}
                    >
                      Subscribe (webcal)
                    </a>
                    <button
                      type="button"
                      className={`w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 ${
                        links.liveSubscriptionHttpsUrl ? 'hover:border-primary' : 'opacity-50'
                      }`}
                      onClick={copyLink}
                      disabled={!links.liveSubscriptionHttpsUrl}
                    >
                      {copyState === 'copied' ? 'Link copied' : copyState === 'error' ? 'Copy failed' : 'Copy live feed link'}
                    </button>
                    <button
                      type="button"
                      className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary"
                      onClick={rotateLiveFeed}
                      disabled={feedState.status === 'creating'}
                    >
                      {feedState.status === 'creating' ? 'Rotating live feed…' : 'Rotate live feed link'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function buildLinks(filters: LaunchFilter, feedToken: string | null) {
  const params = new URLSearchParams();
  const region = filters.region ?? 'us';
  params.set('region', region);
  if (filters.range) params.set('range', filters.range);
  if (filters.state) params.set('state', filters.state);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  params.set('limit', '1000');

  const qs = params.toString();
  const icsPath = `/api/launches/ics${qs ? `?${qs}` : ''}`;

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const httpsBase = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const livePath = feedToken ? `/api/calendar/${encodeURIComponent(feedToken)}.ics` : null;
  const liveSubscriptionHttpsUrl = livePath ? `${httpsBase}${livePath}` : null;
  const liveSubscriptionWebcalUrl = liveSubscriptionHttpsUrl ? liveSubscriptionHttpsUrl.replace(/^https?:\/\//, 'webcal://') : null;

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
    icsUrl: icsPath,
    liveSubscriptionHttpsUrl,
    liveSubscriptionWebcalUrl,
    summary: summaryParts.join(' • ')
  };
}
