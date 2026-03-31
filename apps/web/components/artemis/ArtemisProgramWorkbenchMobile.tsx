'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import type { ArtemisChangeItem, ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { ArtemisChangeLedger } from './ArtemisChangeLedger';
import { ArtemisEventDrawer } from './ArtemisEventDrawer';
import { ArtemisKpiStrip } from './ArtemisKpiStrip';
import { ArtemisMissionRail } from './ArtemisMissionRail';
import { ArtemisModeSwitch, type ArtemisWorkbenchMode } from './ArtemisModeSwitch';
import { ArtemisSystemsGraph } from './ArtemisSystemsGraph';
import { ArtemisTimelineExplorer, type ArtemisTimelineEvent, type ArtemisTimelineFilters } from './ArtemisTimelineExplorer';
import type { ArtemisWorkbenchMission } from './ArtemisProgramWorkbenchDesktop';

export type ArtemisProgramWorkbenchMobileProps = {
  programSnapshot: ArtemisProgramSnapshot;
  missions: readonly ArtemisWorkbenchMission[];
  timelineEvents?: readonly ArtemisTimelineEvent[];
  mode?: ArtemisWorkbenchMode;
  defaultMode?: ArtemisWorkbenchMode;
  onModeChange?: (mode: ArtemisWorkbenchMode) => void;
  missionId?: string | null;
  defaultMissionId?: string | null;
  onMissionChange?: (missionId: string) => void;
  selectedEventId?: string | null;
  defaultSelectedEventId?: string | null;
  onSelectedEventChange?: (event: ArtemisTimelineEvent | null) => void;
  initialFilters?: ArtemisTimelineFilters;
  onFiltersChange?: (filters: ArtemisTimelineFilters) => void;
  className?: string;
};

const DEFAULT_FILTERS: ArtemisTimelineFilters = {
  sourceType: 'all',
  includeSuperseded: false,
  from: null,
  to: null
};

export function ArtemisProgramWorkbenchMobile({
  programSnapshot,
  missions,
  timelineEvents,
  mode,
  defaultMode = 'quick',
  onModeChange,
  missionId,
  defaultMissionId,
  onMissionChange,
  selectedEventId,
  defaultSelectedEventId = null,
  onSelectedEventChange,
  initialFilters,
  onFiltersChange,
  className
}: ArtemisProgramWorkbenchMobileProps) {
  const router = useRouter();
  const [internalMode, setInternalMode] = useState<ArtemisWorkbenchMode>(defaultMode);
  const [internalMissionId, setInternalMissionId] = useState<string | null>(defaultMissionId || missions[0]?.id || null);
  const [activeEvent, setActiveEvent] = useState<ArtemisTimelineEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, setFilters] = useState<ArtemisTimelineFilters>(initialFilters || DEFAULT_FILTERS);

  const activeMode = mode || internalMode;
  const activeMissionId = missionId ?? internalMissionId ?? missions[0]?.id ?? null;
  const activeMission = missions.find((entry) => entry.id === activeMissionId) || missions[0] || null;
  const activeSnapshot = activeMode === 'quick' || !activeMission ? programSnapshot : activeMission.snapshot;
  const timelineById = useMemo(() => {
    const map = new Map<string, ArtemisTimelineEvent>();
    for (const event of timelineEvents || []) {
      map.set(event.id, event);
    }
    return map;
  }, [timelineEvents]);

  useEffect(() => {
    setActiveEvent(null);
    setSheetOpen(false);
    onSelectedEventChange?.(null);
  }, [activeMode, activeMissionId, activeSnapshot.generatedAt, onSelectedEventChange]);

  useEffect(() => {
    const preferredId = selectedEventId || defaultSelectedEventId || null;
    if (!preferredId) return;
    const nextEvent = timelineById.get(preferredId) || null;
    if (!nextEvent) return;
    setActiveEvent(nextEvent);
    onSelectedEventChange?.(nextEvent);
  }, [defaultSelectedEventId, onSelectedEventChange, selectedEventId, timelineById]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('mode', activeMode);
    if (activeMode === 'quick') params.set('mission', 'all');
    else if (activeMissionId) params.set('mission', activeMissionId);
    else params.delete('mission');

    const eventId = activeEvent?.id || selectedEventId || defaultSelectedEventId || null;
    if (eventId) params.set('event', eventId);
    else params.delete('event');

    params.set('sourceType', filters.sourceType);
    if (filters.includeSuperseded) params.set('includeSuperseded', 'true');
    else params.delete('includeSuperseded');
    if (filters.from) params.set('from', filters.from);
    else params.delete('from');
    if (filters.to) params.set('to', filters.to);
    else params.delete('to');

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [activeEvent?.id, activeMissionId, activeMode, defaultSelectedEventId, filters, router, selectedEventId]);

  const modeOptions = useMemo(
    () => [
      {
        id: 'quick' as const,
        label: 'Overview',
        description: 'Program summary',
        badge: `${programSnapshot.upcoming.length}`
      },
      {
        id: 'explorer' as const,
        label: 'Missions',
        description: activeMission ? activeMission.label : 'Mission-by-mission view',
        badge: activeMission ? `${activeMission.snapshot.upcoming.length}` : '0',
        disabled: missions.length === 0
      },
      {
        id: 'technical' as const,
        label: 'Changes',
        description: 'Detailed source and change history',
        badge: String((timelineEvents || []).length)
      }
    ],
    [activeMission, missions.length, programSnapshot.upcoming.length, timelineEvents]
  );

  const missionRailItems = useMemo(
    () =>
      missions.map((entry) => ({
        id: entry.id,
        label: entry.label,
        subtitle: entry.subtitle || entry.snapshot.missionName,
        status: entry.status || entry.snapshot.nextLaunch?.statusText || 'Tracking',
        nextNet: entry.snapshot.nextLaunch?.net || null,
        launchCount: entry.snapshot.upcoming.length
      })),
    [missions]
  );

  const ledgerChanges: ArtemisChangeItem[] = useMemo(() => {
    if (isMissionSnapshot(activeSnapshot)) return [...activeSnapshot.changes];
    return buildProgramChanges(activeSnapshot);
  }, [activeSnapshot]);

  const handleFiltersChange = useCallback(
    (nextFilters: ArtemisTimelineFilters) => {
      setFilters((previousFilters) =>
        areArtemisTimelineFiltersEqual(previousFilters, nextFilters) ? previousFilters : nextFilters
      );
      onFiltersChange?.(nextFilters);
    },
    [onFiltersChange]
  );

  return (
    <section className={clsx('space-y-4', className)}>
      <ArtemisModeSwitch
        options={modeOptions}
        value={activeMode}
        onChange={(nextMode) => {
          if (!mode) setInternalMode(nextMode);
          onModeChange?.(nextMode);
        }}
      />

      <ArtemisMissionRail
        missions={missionRailItems}
        value={activeMissionId}
        orientation="horizontal"
        onChange={(nextMissionId) => {
          if (!missionId) setInternalMissionId(nextMissionId);
          onMissionChange?.(nextMissionId);
        }}
      />

      <ArtemisKpiStrip snapshot={activeSnapshot} />
      <ArtemisTimelineExplorer
        snapshot={activeSnapshot}
        events={timelineEvents}
        selectedEventId={selectedEventId}
        defaultSelectedEventId={defaultSelectedEventId}
        initialSourceType={filters.sourceType}
        initialIncludeSuperseded={filters.includeSuperseded}
        initialFrom={filters.from}
        initialTo={filters.to}
        onFiltersChange={handleFiltersChange}
        onSelectEvent={(event) => {
          setActiveEvent(event);
          setSheetOpen(true);
          onSelectedEventChange?.(event);
        }}
      />

      {activeMode !== 'quick' ? <ArtemisSystemsGraph snapshot={activeSnapshot} /> : null}
      {activeMode === 'technical' ? <ArtemisChangeLedger changes={ledgerChanges} /> : null}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="w-full rounded-xl border border-stroke bg-[rgba(5,6,10,0.88)] px-4 py-3 text-sm font-semibold text-text1 shadow-surface backdrop-blur-xl transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
        >
          {activeEvent ? 'Open evidence drawer' : 'Select timeline event for evidence'}
        </button>
      </div>

      <ArtemisEventDrawer
        variant="sheet"
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Event evidence drawer"
        event={activeEvent}
        faq={activeSnapshot.faq}
      />
    </section>
  );
}

function buildProgramChanges(snapshot: ArtemisProgramSnapshot): ArtemisChangeItem[] {
  const changes = [...snapshot.upcoming, ...snapshot.recent].map((launch) => ({
    title: launch.name,
    summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
    date: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
    href: buildLaunchHref(launch)
  }));
  changes.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
  return changes.slice(0, 12);
}

function parseDateOrZero(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isMissionSnapshot(snapshot: ArtemisProgramSnapshot | ArtemisMissionSnapshot): snapshot is ArtemisMissionSnapshot {
  return 'missionName' in snapshot;
}

function areArtemisTimelineFiltersEqual(a: ArtemisTimelineFilters, b: ArtemisTimelineFilters) {
  return a.sourceType === b.sourceType && a.includeSuperseded === b.includeSuperseded && a.from === b.from && a.to === b.to;
}
