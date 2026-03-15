'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { EmbedWidgetV1 } from '@tminuszero/api-client';
import {
  useCreateEmbedWidgetMutation,
  useDeleteEmbedWidgetMutation,
  useEmbedWidgetsQuery,
  useRotateEmbedWidgetMutation
} from '@/lib/api/queries';
import { PremiumGateButton } from '@/components/PremiumGateButton';
import { LaunchFilter } from '@/lib/types/launch';

type Scope = 'filters' | 'preset' | 'watchlist';

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
  const embedWidgetsQuery = useEmbedWidgetsQuery({ enabled: open });
  const createEmbedWidgetMutation = useCreateEmbedWidgetMutation();
  const rotateEmbedWidgetMutation = useRotateEmbedWidgetMutation();
  const deleteEmbedWidgetMutation = useDeleteEmbedWidgetMutation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [scope, setScope] = useState<Scope>('filters');
  const [busy, setBusy] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const widgets = useMemo(() => embedWidgetsQuery.data?.widgets ?? [], [embedWidgetsQuery.data?.widgets]);
  const widgetsStatus = open
    ? embedWidgetsQuery.isPending
      ? 'loading'
      : embedWidgetsQuery.isError
        ? 'error'
        : 'ready'
    : 'idle';

  useEffect(() => {
    if (open) return;
    setCopyState('idle');
    setBusy(false);
    setSelectedWidgetId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const defaultScope = resolveDefaultScope({ activePresetId, myLaunchesEnabled, myWatchlistId });
    setScope(defaultScope);
  }, [activePresetId, myLaunchesEnabled, myWatchlistId, open]);

  const selectedWidget = useMemo(
    () => widgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [selectedWidgetId, widgets]
  );

  useEffect(() => {
    if (!open) return;
    if (selectedWidgetId && widgets.some((widget) => widget.id === selectedWidgetId)) return;
    setSelectedWidgetId(widgets[0]?.id || null);
  }, [open, selectedWidgetId, widgets]);

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
      const created = await createEmbedWidgetMutation.mutateAsync({
        name,
        filters: payload.filters as LaunchFilter | undefined,
        presetId: typeof payload.preset_id === 'string' ? payload.preset_id : undefined,
        watchlistId: typeof payload.watchlist_id === 'string' ? payload.watchlist_id : undefined
      });
      const widget = created.widget as EmbedWidgetV1 | undefined;
      if (!widget?.id || !widget?.token) throw new Error('widget_missing');
      setSelectedWidgetId(widget.id);
    } catch (err) {
      console.error('embed widget create error', err);
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
      const payload = await rotateEmbedWidgetMutation.mutateAsync(selectedWidget.id);
      const token = payload.widget?.token ? String(payload.widget.token) : null;
      if (!token) throw new Error('token_missing');
    } catch (err) {
      console.error('embed widget rotate error', err);
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
      await deleteEmbedWidgetMutation.mutateAsync(selectedWidget.id);
      const remainingWidgets = widgets.filter((widget) => widget.id !== selectedWidget.id);
      setSelectedWidgetId(remainingWidgets[0]?.id || null);
    } catch (err) {
      console.error('embed widget revoke error', err);
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
                    disabled={widgetsStatus === 'loading' || busy}
                  >
                    <option value="">
                      {widgetsStatus === 'loading'
                        ? 'Loading…'
                        : widgetsStatus === 'error'
                          ? 'Unable to load widgets'
                          : widgets.length
                            ? 'Select a widget…'
                            : 'No widgets yet'}
                    </option>
                    {widgets.map((widget) => (
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
                disabled={busy || widgetsStatus === 'loading' || createEmbedWidgetMutation.isPending}
              >
                {busy ? 'Working…' : 'Create new widget'}
              </button>

              <label className="block text-[10px] uppercase tracking-[0.16em] text-text3">Embed code</label>
              <textarea
                className="h-28 w-full resize-none rounded-xl border border-stroke bg-surface-0 p-3 font-mono text-[11px] text-text2"
                readOnly
                value={
                  widgetsStatus === 'loading'
                    ? 'Loading…'
                    : embed.iframeCode ||
                      (widgetsStatus === 'error'
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
