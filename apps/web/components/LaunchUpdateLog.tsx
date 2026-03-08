'use client';

import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';

type LaunchUpdateTag = { label: string; tone: BadgeTone };

export type LaunchUpdateView = {
  id: string;
  detectedAt: string | null;
  detectedLabel: string;
  summary: string;
  tags: LaunchUpdateTag[];
  details: string[];
};

type Props = {
  updates: LaunchUpdateView[];
  initialCount?: number;
};

export function LaunchUpdateLog({ updates, initialCount = 5 }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visibleUpdates = showAll ? updates : updates.slice(0, initialCount);
  const remaining = Math.max(0, updates.length - visibleUpdates.length);
  const latestUpdateLabel = updates[0]?.detectedLabel || null;
  const latestUpdateDateTime = toIsoDateTime(updates[0]?.detectedAt || undefined);

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Change log</div>
          <h2 className="text-xl font-semibold text-text1">Launch update history</h2>
          <p className="text-sm text-text3">Launch detail changes captured over time.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">{updates.length} updates</span>
          {latestUpdateLabel && (
            <span className="rounded-full border border-stroke px-3 py-1">
              Latest{' '}
              <time dateTime={latestUpdateDateTime}>{latestUpdateLabel}</time>
            </span>
          )}
        </div>
      </div>

      {updates.length > 0 ? (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {visibleUpdates.map((update) => (
              <div key={update.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                  <span className="uppercase tracking-[0.08em]">Detected</span>
                  <time dateTime={toIsoDateTime(update.detectedAt || undefined)}>{update.detectedLabel}</time>
                </div>
                <div className="mt-2 text-sm font-semibold text-text1">{update.summary}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {update.tags.map((tag) => (
                    <Badge key={`${update.id}-${tag.label}`} tone={tag.tone} subtle>
                      {tag.label}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 space-y-2 text-xs text-text2">
                  {update.details.map((detail, idx) => (
                    <div
                      key={`${update.id}-detail-${idx}`}
                      className="rounded-md border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1 break-words"
                    >
                      {detail}
                    </div>
                  ))}
                  {update.details.length === 0 && <div className="text-text3">No detail lines recorded.</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 hidden overflow-hidden rounded-xl border border-stroke bg-surface-0 md:block">
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-left text-sm text-text2">
                <thead className="bg-[rgba(255,255,255,0.02)] text-xs uppercase tracking-[0.08em] text-text3">
                  <tr>
                    <th className="px-4 py-3">Detected</th>
                    <th className="px-4 py-3">Summary</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stroke">
                  {visibleUpdates.map((update) => (
                    <tr key={update.id} className="hover:bg-[rgba(255,255,255,0.02)]">
                      <td className="px-4 py-3 align-top">
                        <time
                          dateTime={toIsoDateTime(update.detectedAt || undefined)}
                          className="text-sm font-semibold text-text1"
                        >
                          {update.detectedLabel}
                        </time>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-sm font-semibold text-text1">{update.summary}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {update.tags.map((tag) => (
                            <Badge key={`${update.id}-${tag.label}`} tone={tag.tone} subtle>
                              {tag.label}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-2 break-words">
                          {update.details.map((detail, idx) => (
                            <div
                              key={`${update.id}-detail-${idx}`}
                              className="rounded-md border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1 text-xs text-text2"
                            >
                              {detail}
                            </div>
                          ))}
                          {update.details.length === 0 && (
                            <div className="text-xs text-text3">No detail lines recorded.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {remaining > 0 && !showAll && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="btn-secondary rounded-lg px-4 py-2 text-sm"
                onClick={() => setShowAll(true)}
              >
                Load full history ({remaining} more)
              </button>
              <div className="text-xs text-text3">Showing latest {visibleUpdates.length} updates.</div>
            </div>
          )}

          {(showAll || remaining === 0) && (
            <div className="mt-3 text-xs text-text3">
              Showing {showAll ? 'all' : 'latest'} {visibleUpdates.length} update{visibleUpdates.length === 1 ? '' : 's'}.
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
          No updates recorded for this launch yet.
        </div>
      )}
    </div>
  );
}

function toIsoDateTime(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
