'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { LaunchFilter } from '@/lib/types/launch';
import { PremiumGateButton } from '@/components/PremiumGateButton';

type Scope = 'filters' | 'preset' | 'watchlist';

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

export function EmbedNextLaunchCard({
  isAuthed,
  isPremium,
  filters,
  activePresetId,
  activePresetName,
  myLaunchesEnabled,
  myWatchlistId
}: {
  isAuthed: boolean;
  isPremium: boolean;
  filters: LaunchFilter;
  activePresetId: string | null;
  activePresetName: string | null;
  myLaunchesEnabled: boolean;
  myWatchlistId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [scope, setScope] = useState<Scope>('filters');
  const [busy, setBusy] = useState(false);
  const [widgetsState, setWidgetsState] = useState<
    { status: 'idle' | 'loading' | 'ready' | 'error'; widgets: EmbedWidget[] }
  >({ status: 'idle', widgets: [] });
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setCopyState('idle');
    setBusy(false);
    setWidgetsState({ status: 'idle', widgets: [] });
    setSelectedWidgetId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const defaultScope = resolveDefaultScope({ activePresetId, myLaunchesEnabled, myWatchlistId });
    setScope(defaultScope);
  }, [activePresetId, myLaunchesEnabled, myWatchlistId, open]);

  useEffect(() => {
    if (!open || widgetsState.status !== 'idle') return;
    setWidgetsState({ status: 'loading', widgets: [] });
    fetch('/api/me/embed-widgets', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`widgets_http_${res.status}`);
        return (await res.json()) as { widgets?: EmbedWidget[] };
      })
      .then((data) => {
        const widgets = Array.isArray(data.widgets) ? data.widgets : [];
        setWidgetsState({ status: 'ready', widgets });
        setSelectedWidgetId((prev) => prev || widgets[0]?.id || null);
      })
      .catch(() => {
        setWidgetsState({ status: 'error', widgets: [] });
      });
  }, [open, widgetsState.status]);

  const selectedWidget = useMemo(
    () => widgetsState.widgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [selectedWidgetId, widgetsState.widgets]
  );

  useEffect(() => {
    if (!open) return;
    if (selectedWidgetId && widgetsState.widgets.some((w) => w.id === selectedWidgetId)) return;
    setSelectedWidgetId(widgetsState.widgets[0]?.id || null);
  }, [open, selectedWidgetId, widgetsState.widgets]);

  const embed = useMemo(() => buildEmbed(selectedWidget?.token ?? null), [selectedWidget?.token]);

  async function copyEmbedCode() {
    try {
      if (!embed.iframeCode) throw new Error('embed_code_unavailable');
      await navigator.clipboard.writeText(embed.iframeCode);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  }

  async function createWidget() {
    if (busy) return;
    const suggested = buildSuggestedName({ scope, activePresetName, filters });
    const name = window.prompt('Widget name', suggested)?.trim();
    if (!name) return;

    const payload: Record<string, unknown> = { name };
    if (scope === 'preset') {
      if (!activePresetId) return;
      payload.preset_id = activePresetId;
    } else if (scope === 'watchlist') {
      if (!myWatchlistId) return;
      payload.watchlist_id = myWatchlistId;
      payload.filters = filters;
    } else {
      payload.filters = filters;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/me/embed-widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `create_http_${res.status}`);
      const widget = json?.widget as EmbedWidget | undefined;
      if (!widget?.id || !widget?.token) throw new Error('widget_missing');
      setWidgetsState((prev) => ({
        status: 'ready',
        widgets: [widget, ...prev.widgets.filter((w) => w.id !== widget.id)]
      }));
      setSelectedWidgetId(widget.id);
    } catch (err) {
      console.error('embed widget create error', err);
      setWidgetsState((prev) => ({ ...prev, status: prev.widgets.length ? 'ready' : 'error' }));
    } finally {
      setBusy(false);
    }
  }

  async function rotateWidget() {
    if (!selectedWidget?.id || busy) return;
    const ok = window.confirm('Rotate token? Existing embeds using the old token will stop working.');
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/me/embed-widgets/${encodeURIComponent(selectedWidget.id)}/rotate`, {
        method: 'POST',
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `rotate_http_${res.status}`);
      const token = json?.widget?.token ? String(json.widget.token) : null;
      if (!token) throw new Error('token_missing');
      setWidgetsState((prev) => ({
        status: 'ready',
        widgets: prev.widgets.map((w) => (w.id === selectedWidget.id ? { ...w, token } : w))
      }));
    } catch (err) {
      console.error('embed widget rotate error', err);
      setWidgetsState((prev) => ({ ...prev, status: prev.widgets.length ? 'ready' : 'error' }));
    } finally {
      setBusy(false);
    }
  }

  async function revokeWidget() {
    if (!selectedWidget?.id || busy) return;
    const ok = window.confirm('Revoke this widget? The embed will stop working.');
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/me/embed-widgets/${encodeURIComponent(selectedWidget.id)}`, {
        method: 'DELETE',
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `delete_http_${res.status}`);
      setWidgetsState((prev) => {
        const nextWidgets = prev.widgets.filter((w) => w.id !== selectedWidget.id);
        return { status: 'ready', widgets: nextWidgets };
      });
    } catch (err) {
      console.error('embed widget revoke error', err);
      setWidgetsState((prev) => ({ ...prev, status: prev.widgets.length ? 'ready' : 'error' }));
    } finally {
      setBusy(false);
    }
  }

  if (!isPremium) {
    return (
      <PremiumGateButton
        isAuthed={isAuthed}
        featureLabel="embeddable launch card"
        className="btn-secondary flex h-10 w-10 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary"
        ariaLabel="Embed next launch card (Premium)"
      >
        <EmbedIcon className="h-4 w-4" />
      </PremiumGateButton>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary flex h-10 w-10 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary"
        onClick={() => setOpen(true)}
        aria-label="Embed next launch card"
        title="Embed next launch card"
      >
        <EmbedIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(0,0,0,0.55)] p-4 backdrop-blur-sm md:items-center">
          <div className="w-full max-w-xl rounded-2xl border border-stroke bg-surface-1 p-4 shadow-glow md:max-h-[90vh] md:overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-text3">Embed</div>
                  <div className="text-base font-semibold text-text1">Next launch card</div>
                  <div className="mt-1 text-xs text-text3">
                    Uses the live Premium schedule (cached ~15 seconds). Keep the token private.
                  </div>
                </div>
                <button className="text-sm text-text3 hover:text-text1" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>

            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="block">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text3">Widget</div>
                  <select
                    className="mt-1 w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={selectedWidgetId ?? ''}
                    onChange={(e) => setSelectedWidgetId(e.target.value || null)}
                    disabled={widgetsState.status === 'loading' || busy}
                  >
                    <option value="">
                      {widgetsState.status === 'loading'
                        ? 'Loading…'
                        : widgetsState.status === 'error'
                          ? 'Unable to load widgets'
                          : widgetsState.widgets.length
                            ? 'Select a widget…'
                            : 'No widgets yet'}
                    </option>
                    {widgetsState.widgets.map((widget) => (
                      <option key={widget.id} value={widget.id}>
                        {widget.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text3">New widget scope</div>
                  <select
                    className="mt-1 w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                    value={scope}
                    onChange={(e) => setScope(e.target.value as Scope)}
                    disabled={busy}
                  >
                    <option value="filters">Current filters</option>
                    {activePresetId ? <option value="preset">Active preset</option> : null}
                    {myWatchlistId ? <option value="watchlist">My Launches</option> : null}
                  </select>
                </label>
              </div>

              <button
                type="button"
                className="block w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-left text-sm text-text1 hover:border-primary disabled:opacity-60"
                onClick={createWidget}
                disabled={busy || widgetsState.status === 'loading'}
              >
                {busy ? 'Working…' : 'Create new widget'}
              </button>

              <label className="block text-[10px] uppercase tracking-[0.16em] text-text3">Embed code</label>
              <textarea
                className="h-28 w-full resize-none rounded-xl border border-stroke bg-surface-0 p-3 font-mono text-[11px] text-text2"
                readOnly
                value={
                  widgetsState.status === 'loading'
                    ? 'Loading…'
                    : embed.iframeCode ||
                      (widgetsState.status === 'error'
                        ? 'Embed widgets unavailable'
                        : 'Select or create a widget to generate embed code.')
                }
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={clsx(
                    'btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary',
                    !embed.iframeCode && 'opacity-50'
                  )}
                  onClick={copyEmbedCode}
                  disabled={!embed.iframeCode}
                >
                  {copyState === 'copied' ? 'Code copied' : copyState === 'error' ? 'Copy failed' : 'Copy code'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  onClick={rotateWidget}
                  disabled={!selectedWidget?.id || busy}
                >
                  Rotate token
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  onClick={revokeWidget}
                  disabled={!selectedWidget?.id || busy}
                >
                  Revoke widget
                </button>
              </div>
            </div>

            {embed.srcUrl && (
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-text3">Preview</div>
                <iframe
                  title="Next launch card preview"
                  src={embed.srcUrl}
                  className="mt-2 h-[720px] w-full rounded-2xl border border-stroke bg-black/20"
                  loading="lazy"
                  allow="clipboard-write; web-share"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function buildEmbed(token: string | null) {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const httpsBase = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const srcUrl = token && httpsBase ? `${httpsBase}/embed/next-launch?token=${encodeURIComponent(token)}` : null;

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

function resolveDefaultScope({
  activePresetId,
  myLaunchesEnabled,
  myWatchlistId
}: {
  activePresetId: string | null;
  myLaunchesEnabled: boolean;
  myWatchlistId: string | null;
}): Scope {
  if (myLaunchesEnabled && myWatchlistId) return 'watchlist';
  if (activePresetId) return 'preset';
  return 'filters';
}

function buildSuggestedName({
  scope,
  activePresetName,
  filters
}: {
  scope: Scope;
  activePresetName: string | null;
  filters: LaunchFilter;
}) {
  if (scope === 'watchlist') return 'Next launch • My Launches';
  if (scope === 'preset') return `Next launch • ${activePresetName || 'Preset'}`;

  const region = filters.region ?? 'us';
  const locationSummary =
    region === 'all' ? 'All' : region === 'non-us' ? 'Non-US' : 'US';

  const summaryParts = [
    locationSummary,
    filters.state ? filters.state : null,
    filters.provider ? filters.provider : null,
    filters.status && filters.status !== 'all' ? filters.status : null
  ].filter(Boolean);

  return summaryParts.length ? `Next launch • ${summaryParts.join(' • ')}` : 'Next launch';
}

function EmbedIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 8l-4 4 4 4" />
      <path d="M16 8l4 4-4 4" />
      <path d="M14 6l-4 12" />
    </svg>
  );
}
