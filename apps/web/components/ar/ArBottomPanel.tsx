'use client';

import type { TrajectoryTimeMode } from '@/components/ar/useTrajectoryTime';
import { deriveArBottomGuidance } from '@/lib/ar/bottomGuidance';

type Props = {
  mode: TrajectoryTimeMode;
  primaryTimeLabel: string;
  secondaryTimeLabel?: string | null;
  onSelectLive: () => void;
  reducedEffects?: boolean;
  evidenceLabel?: string | null;
  confidenceBadgeLabel?: string | null;
  confidenceTier?: string | null;
  onOpenConfidenceInfo?: () => void;
  headingHint?: string | null;
  pitchHint?: string | null;
  rollHint?: string | null;
};

export function ArBottomPanel({
  mode,
  primaryTimeLabel,
  secondaryTimeLabel,
  onSelectLive,
  reducedEffects,
  evidenceLabel,
  confidenceBadgeLabel,
  confidenceTier,
  onOpenConfidenceInfo,
  headingHint,
  pitchHint,
  rollHint
}: Props) {
  const { primaryGuidance, secondaryGuidance } = deriveArBottomGuidance({
    headingHint,
    pitchHint,
    rollHint,
    reducedEffects
  });

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border border-white/15 bg-black/70 px-3 py-2 text-white/90 ${
        reducedEffects ? '' : 'backdrop-blur'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-white">{primaryTimeLabel}</div>
            {mode === 'SCRUB' && (
              <button
                type="button"
                onClick={onSelectLive}
                className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-medium"
              >
                Live
              </button>
            )}
          </div>
          {secondaryTimeLabel && <div className="mt-0.5 text-[11px] text-white/70">{secondaryTimeLabel}</div>}
          {(evidenceLabel || confidenceBadgeLabel || confidenceTier) && (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/65">
              <div className="min-w-0">
                {evidenceLabel || 'Trajectory estimate'}
                {confidenceTier ? ` • Tier ${confidenceTier}` : ''}
                {confidenceBadgeLabel ? ` • ${confidenceBadgeLabel}` : ''}
              </div>
              {onOpenConfidenceInfo && (
                <button
                  type="button"
                  onClick={onOpenConfidenceInfo}
                  className="pointer-events-auto rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85"
                  aria-label="Trajectory confidence info"
                >
                  i
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1 text-[11px] text-white/70">
          <div className="rounded-full border border-white/15 bg-black/40 px-3 py-1 text-white/90">{primaryGuidance}</div>
          {secondaryGuidance.map((label) => (
            <div key={label} className="rounded-full border border-white/10 bg-black/30 px-3 py-1">
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
