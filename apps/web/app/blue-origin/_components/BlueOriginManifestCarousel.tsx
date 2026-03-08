'use client';

import { useEffect, useMemo, useState } from 'react';
import { BlueOriginLocalTime } from '@/app/blue-origin/_components/BlueOriginLocalTime';
import { BlueOriginManifestCapsule } from '@/app/blue-origin/_components/BlueOriginManifestCapsule';
import { BlueOriginRouteTraceLink } from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';
import { getCircularIndex } from '@/lib/utils/blueOriginDossier';
import type { LaunchStatusTone } from '@/lib/utils/launchStatusTone';

type ManifestSeat = {
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

type ManifestCarouselItem = {
  launchId: string;
  launchName: string;
  launchNet: string | null | undefined;
  launchStatus: string;
  launchStatusTone: LaunchStatusTone;
  isFutureLaunch: boolean;
  manifestSourceTags: string[];
  missionSummary: string | null;
  failureReason: string | null;
  launchHref: string;
  seats: ManifestSeat[];
  hasExplicitSeatAssignments?: boolean;
  missionVehicle: string | null;
  missionProvider: string | null;
  missionPad: string | null;
  missionPadState: string | null;
  manifestCapacity: number;
  manifestTravelerCount: number;
  manifestPayloadCount: number;
  isUnmannedFlight: boolean;
};

export function BlueOriginManifestCarousel({
  items
}: {
  items: ManifestCarouselItem[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const canNavigate = items.length > 1;

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  const activeItem = items[activeIndex];

  const previousItemName = useMemo(() => {
    const previousIndex = getCircularIndex(activeIndex, -1, items.length);
    return items[previousIndex]?.launchName;
  }, [activeIndex, items]);

  const nextItemName = useMemo(() => {
    const nextIndex = getCircularIndex(activeIndex, 1, items.length);
    return items[nextIndex]?.launchName;
  }, [activeIndex, items]);

  const goToPrevious = () => {
    setActiveIndex((current) => getCircularIndex(current, -1, items.length));
  };

  const goToNext = () => {
    setActiveIndex((current) => getCircularIndex(current, 1, items.length));
  };

  const navButtonClass =
    'inline-flex touch-manipulation items-center justify-center text-text1 transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70';

  const navButtonSizeClass =
    'h-12 w-11 lg:h-64 lg:w-14';

  const navSvgClass = 'flex h-full w-full items-center justify-center';
  const navArrowClass = 'h-8 w-6 lg:h-64 lg:w-10';

  if (!activeItem) {
    return (
      <div className="rounded-xl border border-stroke bg-surface-1/40 p-6">
        <p className="text-sm text-text3">
          No Blue Origin manifests are currently available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-stroke bg-surface-1/40 p-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text3">
            Manifest {activeIndex + 1} / {items.length}
          </p>
          <h3 className="truncate text-lg font-bold text-text1">
            {activeItem.launchName}
          </h3>
          <BlueOriginLocalTime
            value={activeItem.launchNet}
            variant="date"
            className="font-mono text-xs text-text3"
          />
          <p className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text2">
            Status: {activeItem.launchStatus || 'Unknown'}
          </p>
        </div>

        <div className="mt-3">
          <BlueOriginRouteTraceLink
            href={activeItem.launchHref}
            traceLabel={`${activeItem.launchName} launch record`}
            className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
          >
            View Full Mission Record →
          </BlueOriginRouteTraceLink>
        </div>
      </header>

      <div className="relative">
        <div className="mb-3 flex w-full items-center justify-between gap-3 lg:hidden">
          {canNavigate ? (
            <>
              <button
                type="button"
                onClick={goToPrevious}
                className={`${navButtonClass} ${navButtonSizeClass} shrink-0`}
                aria-label={`Previous manifest (${previousItemName || 'previous'})`}
              >
                <span className="sr-only">Previous</span>
                <span aria-hidden="true" className={navSvgClass}>
                  <svg viewBox="0 0 24 72" fill="none" className="h-6 w-4">
                    <path
                      d="M18 6L6 36L18 66"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>

              <button
                type="button"
                onClick={goToNext}
                className={`${navButtonClass} ${navButtonSizeClass} shrink-0`}
                aria-label={`Next manifest (${nextItemName || 'next'})`}
              >
                <span className="sr-only">Next</span>
                <span aria-hidden="true" className={navSvgClass}>
                  <svg
                    viewBox="0 0 24 72"
                    fill="none"
                    className="h-6 w-4"
                  >
                    <path
                      d="M6 6L18 36L6 66"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-1 lg:items-center">
          <div className="lg:px-16">
            <BlueOriginManifestCapsule
              launchName={activeItem.launchName}
              seats={activeItem.seats}
              isUnmannedFlight={activeItem.isUnmannedFlight}
              hasExplicitSeatAssignments={activeItem.hasExplicitSeatAssignments}
              launchStatus={activeItem.launchStatus}
              launchStatusTone={activeItem.launchStatusTone}
              isFutureLaunch={activeItem.isFutureLaunch}
              manifestSourceTags={activeItem.manifestSourceTags}
              missionSummary={activeItem.missionSummary}
              failureReason={activeItem.failureReason}
              missionVehicle={activeItem.missionVehicle}
              missionProvider={activeItem.missionProvider}
              missionPad={activeItem.missionPad}
              missionPadState={activeItem.missionPadState}
              manifestCapacity={activeItem.manifestCapacity}
              manifestTravelerCount={activeItem.manifestTravelerCount}
              manifestPayloadCount={activeItem.manifestPayloadCount}
            />
          </div>
        </div>

        {canNavigate ? (
          <div className="pointer-events-none hidden lg:block">
            <button
              type="button"
              onClick={goToPrevious}
              className={`${navButtonClass} ${navButtonSizeClass} pointer-events-auto absolute top-1/2 left-0 z-30 -translate-y-1/2`}
              aria-label={`Previous manifest (${previousItemName || 'previous'})`}
              title={previousItemName || 'Previous manifest'}
            >
              <span className="sr-only">Previous</span>
              <span aria-hidden="true" className={navSvgClass}>
                <svg viewBox="0 0 32 180" fill="none" className={navArrowClass}>
                  <path
                    d="M28 12L12 90L28 168"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            <button
              type="button"
              onClick={goToNext}
              className={`${navButtonClass} ${navButtonSizeClass} pointer-events-auto absolute top-1/2 right-0 z-30 -translate-y-1/2`}
              aria-label={`Next manifest (${nextItemName || 'next'})`}
              title={nextItemName || 'Next manifest'}
            >
              <span className="sr-only">Next</span>
              <span aria-hidden="true" className={navSvgClass}>
                <svg viewBox="0 0 32 180" fill="none" className={navArrowClass}>
                  <path
                    d="M4 12L20 90L4 168"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
