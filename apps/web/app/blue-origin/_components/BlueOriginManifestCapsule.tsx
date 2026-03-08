'use client';

import { useEffect, useState } from 'react';
import {
  getLaunchStatusTone,
  type LaunchStatusTone
} from '@/lib/utils/launchStatusTone';

const BLUE_ORIGIN_MANIFEST_TONE_STYLES: Record<
  LaunchStatusTone,
  { badge: string; text: string }
> = {
  success: { badge: 'border-success/40 bg-success/10 text-success', text: 'text-success' },
  warning: { badge: 'border-warning/40 bg-warning/10 text-warning', text: 'text-warning' },
  danger: { badge: 'border-danger/40 bg-danger/10 text-danger', text: 'text-danger' },
  neutral: {
    badge: 'border-stroke bg-surface-2/45 text-text2',
    text: 'text-text1'
  }
};

type Seat = {
  id: number;
  label: string;
  traveler?: {
    name: string;
    role: string;
    avatarUrl?: string | null;
  };
  payload?: {
    name: string;
    description?: string;
  };
};

export function BlueOriginManifestCapsule({
  launchName,
  seats,
  isUnmannedFlight,
  hasExplicitSeatAssignments,
  isFutureLaunch,
  missionSummary,
  launchStatus,
  launchStatusTone,
  failureReason,
  missionVehicle,
  missionProvider,
  missionPad,
  missionPadState,
  manifestCapacity,
  manifestTravelerCount,
  manifestPayloadCount,
  manifestSourceTags
}: {
  launchName: string;
  seats: Seat[];
  isUnmannedFlight?: boolean;
  hasExplicitSeatAssignments?: boolean;
  isFutureLaunch?: boolean;
  missionSummary?: string | null;
  launchStatus?: string | null;
  launchStatusTone?: LaunchStatusTone;
  failureReason?: string | null;
  missionVehicle?: string | null;
  missionProvider?: string | null;
  missionPad?: string | null;
  missionPadState?: string | null;
  manifestCapacity?: number;
  manifestTravelerCount?: number;
  manifestPayloadCount?: number;
  manifestSourceTags?: string[];
}) {
  const hasSeatData = seats.length > 0;
  const manifestTravelerCountSafe = Math.max(0, Math.floor(manifestTravelerCount || 0));
  const manifestPayloadCountSafe = Math.max(0, Math.floor(manifestPayloadCount || 0));
  const manifestCapacitySafe = Math.max(1, Math.floor(manifestCapacity || 6));
  const manifestAssignedCount = manifestTravelerCountSafe + manifestPayloadCountSafe;
  const manifestOpenSlotCount = Math.max(0, manifestCapacitySafe - manifestAssignedCount);
  const hasManifestData = manifestAssignedCount > 0;

  const normalizedLaunchStatus = normalizeMissionText(launchStatus) || 'Unknown';
  const statusTone = launchStatusTone || getLaunchStatusTone(launchStatus, launchStatus);
  const statusStyles = BLUE_ORIGIN_MANIFEST_TONE_STYLES[statusTone];
  const showFutureTag = Boolean(isFutureLaunch);

  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(seats[0]?.id || null);

  useEffect(() => {
    setSelectedSeatId(seats[0]?.id || null);
  }, [seats]);

  const normalizedMissionSummary = normalizeMissionText(missionSummary);
  const normalizedFailureReason = normalizeMissionText(failureReason);
  const showFailureReason =
    statusTone === 'danger' && Boolean(normalizedFailureReason);
  const hasUnmannedTag = Boolean(isUnmannedFlight);
  const manifestSourceTagList = [
    ...new Set((manifestSourceTags || []).map((tag) => tag.trim()).filter(Boolean))
  ];
  const manifestCompositionRows = [
    `${manifestTravelerCountSafe} ${pluralize(manifestTravelerCountSafe, 'Traveler')}`,
    `${manifestPayloadCountSafe} ${pluralize(manifestPayloadCountSafe, 'Payload')}`
  ];
  const manifestContextRows = [missionVehicle, missionProvider, missionPad, missionPadState].filter(Boolean) as string[];

  return (
    <div className="flex flex-col items-center gap-8 md:flex-row md:items-start md:gap-12">
      {/* 2D Top-Down Capsule Visualization */}
      <div className="relative w-full max-w-[300px] flex-shrink-0">
        <div className="relative flex h-[300px] w-[300px] items-center justify-center rounded-full border-2 border-stroke bg-surface-1/40 shadow-inner">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-[200px] w-[200px] rounded-full border border-stroke/40 border-dashed" />
          </div>

          {/* Seat Positions (Circular Arrangement) */}
          {hasSeatData
            ? seats.map((seat, index) => {
                const angles = [0, 60, 120, 180, 240, 300];
                const angle = angles[index % angles.length];
                const radius = 100;
                const x = radius * Math.cos((angle - 90) * (Math.PI / 180));
                const y = radius * Math.sin((angle - 90) * (Math.PI / 180));
                const isSelected = selectedSeatId === seat.id;
                return (
                  <div
                    key={seat.id}
                    className="absolute flex items-center justify-center"
                    style={{
                      transform: `translate(${x}px, ${y}px)`
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSeatId(seat.id)}
                      onFocus={() => setSelectedSeatId(seat.id)}
                      aria-label={buildSeatAriaLabel(seat)}
                      aria-pressed={isSelected}
                      className={`relative flex h-14 w-14 items-center justify-center rounded-full border bg-surface-0 shadow-sm transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                        isSelected
                          ? 'border-primary/70 ring-2 ring-primary/40'
                          : 'border-stroke'
                      }`}
                    >
                      {seat?.traveler ? (
                        <div className="h-full w-full overflow-hidden rounded-full border-2 border-primary/20">
                          {seat.traveler.avatarUrl ? (
                            <img
                              src={seat.traveler.avatarUrl}
                              alt={seat.traveler.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-[10px] font-bold text-primary">
                              {seat.traveler.name.charAt(0)}
                            </div>
                          )}
                        </div>
                      ) : seat?.payload ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-stroke/40 bg-surface-2 text-text3">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div className="h-6 w-6 rounded-full border border-stroke/20 bg-surface-1" />
                      )}
                    </button>
                  </div>
                );
              })
            : null}

          <div className="z-10 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text3">
              Capsule
            </p>
            <p className="text-xs font-medium text-text1">{launchName}</p>
            {hasUnmannedTag ? (
              <p className="mt-2 inline-flex items-center justify-center rounded-full border border-warning/50 bg-warning/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-warning">
                Unmanned
              </p>
            ) : null}
          </div>
        </div>

      </div>

      {/* Roster + Mission Summary */}
        <div className="w-full flex-grow">
        <div className="grid gap-5">
          <aside className="rounded-lg border border-stroke bg-surface-1/40 p-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
              Launch status
            </p>
            <p
              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${statusStyles.badge}`}
            >
              {normalizedLaunchStatus}
            </p>
            {showFutureTag ? (
              <p className="mt-2 inline-flex rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-warning">
                Future launch
              </p>
            ) : null}

            <div className="mt-3 border-t border-stroke pt-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
                Launch details
              </p>
              <ul className="mt-2 space-y-1 text-xs text-text2">
                <li>
                  <span className="text-text3">Manifest composition:</span>{' '}
                  <span className="font-semibold text-text1">
                    {manifestCompositionRows[0]}, {manifestCompositionRows[1]}
                  </span>
                </li>
                <li>
                  <span className="text-text3">Known manifest slots:</span>{' '}
                  <span className="font-semibold text-text1">
                    {Math.min(manifestAssignedCount, manifestCapacitySafe)} /{' '}
                    {manifestCapacitySafe}
                  </span>
                </li>
                {manifestContextRows.length > 0 ? (
                  <li>
                    <span className="text-text3">Context:</span>{' '}
                    <span className="font-semibold text-text1">{manifestContextRows.join(' • ')}</span>
                  </li>
                ) : null}
                {manifestOpenSlotCount > 0 ? (
                  <li className={statusStyles.text}>
                    {manifestOpenSlotCount} open {pluralize(manifestOpenSlotCount, 'slot')}{' '}
                    not yet assigned.
                  </li>
                ) : null}
              </ul>
            </div>

            {manifestSourceTagList.length > 0 ? (
              <div className="mt-3 border-t border-stroke pt-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
                  Manifest sources
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {manifestSourceTagList.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-stroke bg-surface-2/40 px-2 py-0.5 text-[10px] font-medium text-text2"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-3 border-t border-stroke pt-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
                Mission context
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missionProvider ? (
                  <span className="rounded-md border border-stroke bg-surface-2/40 px-2 py-1 text-[11px] text-text2">
                    {missionProvider}
                  </span>
                ) : null}
                {missionVehicle ? (
                  <span className="rounded-md border border-stroke bg-surface-2/40 px-2 py-1 text-[11px] text-text2">
                    {missionVehicle}
                  </span>
                ) : null}
                {missionPad ? (
                  <span className="rounded-md border border-stroke bg-surface-2/40 px-2 py-1 text-[11px] text-text2">
                    {missionPad}
                    {missionPadState ? ` • ${missionPadState}` : ''}
                  </span>
                ) : null}
              </div>
            </div>

            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
              Mission summary
            </p>
            <p className="mt-2 text-xs leading-relaxed text-text2">
              {normalizedMissionSummary ||
                'Mission summary is not currently available in launch details.'}
            </p>

            {showFailureReason ? (
              <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-danger">
                  Failure reason
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text2">
                  {normalizedFailureReason}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function buildSeatAriaLabel(seat: Seat | undefined) {
  if (!seat) return 'Unassigned position';
  if (seat.traveler)
    return `Seat ${seat.id}: ${seat.traveler.name}, ${seat.traveler.role}`;
  if (seat.payload) return `Seat ${seat.id}: payload ${seat.payload.name}`;
  return `Seat ${seat.id}: open slot`;
}

function normalizeMissionText(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
