'use client';

import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';
import type { ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';

type ArtemisSnapshot = ArtemisProgramSnapshot | ArtemisMissionSnapshot;

export type ArtemisSystemsGraphNodeStatus = 'nominal' | 'watch' | 'risk' | 'inactive';

export type ArtemisSystemsGraphNode = {
  id: string;
  label: string;
  summary?: string;
  status?: ArtemisSystemsGraphNodeStatus;
  value?: string;
};

export type ArtemisSystemsGraphEdge = {
  id?: string;
  from: string;
  to: string;
  label?: string;
};

export type ArtemisSystemsGraphProps = {
  snapshot?: ArtemisSnapshot;
  nodes?: readonly ArtemisSystemsGraphNode[];
  edges?: readonly ArtemisSystemsGraphEdge[];
  selectedNodeId?: string | null;
  defaultSelectedNodeId?: string | null;
  onSelectNode?: (node: ArtemisSystemsGraphNode) => void;
  title?: string;
  className?: string;
};

const STATUS_CLASS: Record<ArtemisSystemsGraphNodeStatus, string> = {
  nominal: 'border-success/40 bg-[rgba(52,211,153,0.08)]',
  watch: 'border-warning/40 bg-[rgba(251,191,36,0.08)]',
  risk: 'border-danger/40 bg-[rgba(251,113,133,0.08)]',
  inactive: 'border-stroke bg-surface-0'
};

export function ArtemisSystemsGraph({
  snapshot,
  nodes,
  edges,
  selectedNodeId,
  defaultSelectedNodeId = null,
  onSelectNode,
  title = 'Systems graph',
  className
}: ArtemisSystemsGraphProps) {
  const derivedGraph = useMemo(() => buildGraphFromSnapshot(snapshot), [snapshot]);
  const resolvedNodes = useMemo(
    () => (nodes && nodes.length > 0 ? [...nodes] : derivedGraph.nodes),
    [derivedGraph.nodes, nodes]
  );
  const resolvedEdges = useMemo(
    () => (edges && edges.length > 0 ? [...edges] : derivedGraph.edges),
    [derivedGraph.edges, edges]
  );
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(defaultSelectedNodeId);
  const activeNodeId = selectedNodeId ?? internalSelectedNodeId ?? resolvedNodes[0]?.id ?? null;
  const activeIndex = resolvedNodes.findIndex((node) => node.id === activeNodeId);
  const activeNode = activeIndex >= 0 ? resolvedNodes[activeIndex] : resolvedNodes[0] || null;
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridColumns = Math.max(1, Math.min(4, resolvedNodes.length));
  const positionMap = useMemo(() => buildNodePositionMap(resolvedNodes, gridColumns), [resolvedNodes, gridColumns]);

  const selectNode = (index: number, shouldFocus: boolean) => {
    const next = resolvedNodes[index];
    if (!next) return;
    if (selectedNodeId == null) {
      setInternalSelectedNodeId(next.id);
    }
    onSelectNode?.(next);
    if (shouldFocus) {
      buttonRefs.current[index]?.focus();
    }
  };

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!resolvedNodes.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectNode((index + 1) % resolvedNodes.length, true);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectNode((index - 1 + resolvedNodes.length) % resolvedNodes.length, true);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      selectNode(0, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectNode(resolvedNodes.length - 1, true);
    }
  };

  const relatedEdges = activeNode
    ? resolvedEdges.filter((edge) => edge.from === activeNode.id || edge.to === activeNode.id)
    : [];

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
      <h3 className="text-base font-semibold text-text1">{title}</h3>

      {resolvedNodes.length === 0 ? (
        <p className="mt-3 text-sm text-text3">No systems data is available for this scope.</p>
      ) : (
        <>
          <div className="relative mt-3 h-[240px] overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.01)]">
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              {resolvedEdges.map((edge) => {
                const from = positionMap[edge.from];
                const to = positionMap[edge.to];
                if (!from || !to) return null;
                return (
                  <line
                    key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}
                    x1={`${from.x}%`}
                    y1={`${from.y}%`}
                    x2={`${to.x}%`}
                    y2={`${to.y}%`}
                    stroke="rgba(234,240,255,0.24)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeDasharray="4 5"
                  />
                );
              })}
            </svg>

            {resolvedNodes.map((node, index) => {
              const isSelected = (activeNode?.id || '') === node.id;
              const point = positionMap[node.id];
              if (!point) return null;
              return (
                <button
                  key={node.id}
                  ref={(button) => {
                    buttonRefs.current[index] = button;
                  }}
                  type="button"
                  onClick={() => selectNode(index, false)}
                  onKeyDown={(event) => handleNodeKeyDown(event, index)}
                  aria-pressed={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={clsx(
                    'absolute min-w-[122px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                    STATUS_CLASS[node.status || 'inactive'],
                    isSelected && 'border-primary shadow-glow'
                  )}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                >
                  <div className="text-xs font-semibold text-text1">{node.label}</div>
                  {node.value ? <div className="mt-1 text-[11px] text-text3">{node.value}</div> : null}
                </button>
              );
            })}
          </div>

          {activeNode ? (
            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused system</div>
              <div className="mt-1 text-sm font-semibold text-text1">{activeNode.label}</div>
              {activeNode.summary ? <p className="mt-2 text-sm text-text2">{activeNode.summary}</p> : null}
              {relatedEdges.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-text3">
                  {relatedEdges.map((edge) => (
                    <li key={edge.id || `${edge.from}:${edge.to}:${edge.label || ''}`}>{formatEdgeLabel(edge, resolvedNodes)}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}

function buildGraphFromSnapshot(snapshot: ArtemisSnapshot | undefined) {
  if (!snapshot) {
    return { nodes: [] as ArtemisSystemsGraphNode[], edges: [] as ArtemisSystemsGraphEdge[] };
  }

  const nextLaunch = snapshot.nextLaunch;
  const rootId = isMissionSnapshot(snapshot) ? 'mission-core' : 'program-core';
  const rootLabel = isMissionSnapshot(snapshot) ? snapshot.missionName : 'Artemis Program';
  const rootSummary = isMissionSnapshot(snapshot)
    ? `${snapshot.upcoming.length} upcoming, ${snapshot.recent.length} recent mission launches`
    : `${snapshot.upcoming.length} upcoming Artemis launches`;

  const nodes: ArtemisSystemsGraphNode[] = [
    {
      id: rootId,
      label: rootLabel,
      summary: rootSummary,
      value: snapshot.lastUpdated ? `Updated ${formatShortDate(snapshot.lastUpdated)}` : undefined,
      status: statusFromLaunch(nextLaunch)
    }
  ];

  const edges: ArtemisSystemsGraphEdge[] = [];

  if (nextLaunch) {
    pushNode(nodes, edges, rootId, {
      id: 'vehicle',
      label: nextLaunch.vehicle || 'Vehicle',
      summary: nextLaunch.rocket?.description || 'Launch vehicle profile',
      value: nextLaunch.rocket?.family || undefined,
      status: statusFromLaunch(nextLaunch)
    }, 'vehicle');

    pushNode(nodes, edges, rootId, {
      id: 'provider',
      label: nextLaunch.provider || 'Provider',
      summary: nextLaunch.providerDescription || 'Mission provider',
      value: nextLaunch.providerCountryCode || undefined,
      status: 'nominal'
    }, 'provider');

    pushNode(nodes, edges, rootId, {
      id: 'pad',
      label: nextLaunch.pad?.shortCode || nextLaunch.pad?.name || 'Launch pad',
      summary: nextLaunch.pad?.locationName || nextLaunch.pad?.state || 'Pad location',
      value: nextLaunch.pad?.timezone || undefined,
      status: 'nominal'
    }, 'pad');

    if (nextLaunch.mission?.name) {
      pushNode(nodes, edges, rootId, {
        id: 'mission',
        label: nextLaunch.mission.name,
        summary: nextLaunch.mission.description || 'Mission profile',
        value: nextLaunch.mission.type || undefined,
        status: statusFromLaunch(nextLaunch)
      }, 'mission');
    }

    if ((nextLaunch.crew || []).length > 0) {
      pushNode(nodes, edges, 'mission', {
        id: 'crew',
        label: 'Crew',
        summary: `${nextLaunch.crew?.length || 0} listed crew roles`,
        value: `${nextLaunch.crew?.length || 0} crew`,
        status: 'nominal'
      }, 'crew');
    }

    if ((nextLaunch.payloads || []).length > 0) {
      pushNode(nodes, edges, 'mission', {
        id: 'payloads',
        label: 'Payloads',
        summary: `${nextLaunch.payloads?.length || 0} payload records`,
        value: `${nextLaunch.payloads?.length || 0} payloads`,
        status: 'nominal'
      }, 'payloads');
    }
  }

  return { nodes, edges: edges.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)) };
}

function pushNode(
  nodes: ArtemisSystemsGraphNode[],
  edges: ArtemisSystemsGraphEdge[],
  fromId: string,
  node: ArtemisSystemsGraphNode,
  edgeLabel: string
) {
  if (!nodes.some((entry) => entry.id === node.id)) {
    nodes.push(node);
  }
  edges.push({
    id: `${fromId}:${node.id}`,
    from: fromId,
    to: node.id,
    label: edgeLabel
  });
}

function buildNodePositionMap(nodes: ArtemisSystemsGraphNode[], columns: number) {
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const map: Record<string, { x: number; y: number }> = {};

  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = ((col + 0.5) / columns) * 100;
    const y = ((row + 0.5) / rows) * 100;
    map[node.id] = { x, y };
  });

  return map;
}

function formatEdgeLabel(edge: ArtemisSystemsGraphEdge, nodes: ArtemisSystemsGraphNode[]) {
  const from = nodes.find((node) => node.id === edge.from)?.label || edge.from;
  const to = nodes.find((node) => node.id === edge.to)?.label || edge.to;
  if (edge.label) return `${from} -> ${edge.label} -> ${to}`;
  return `${from} -> ${to}`;
}

function statusFromLaunch(launch: Launch | null | undefined): ArtemisSystemsGraphNodeStatus {
  if (!launch) return 'inactive';
  if (launch.status === 'scrubbed') return 'risk';
  if (launch.status === 'hold') return 'watch';
  if (launch.status === 'go') return 'nominal';
  return 'inactive';
}

function isMissionSnapshot(snapshot: ArtemisSnapshot): snapshot is ArtemisMissionSnapshot {
  return 'missionName' in snapshot;
}

function formatShortDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit'
  }).format(new Date(parsed));
}
