import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { colorForCodeGraphLabel } from '../codegraph/colors';
import { CodeGraphFilterPanel } from '../codegraph/CodeGraphFilterPanel';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { getGraphMajorGridGap, GRAPH_WORKSPACE } from '../graph/graphWorkspaceContract';
import {
  GRAPH_THEME,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphDrawerButtonStyle,
  graphGlassPillStyle,
} from '../graph/graphVisualTokens';
import type { CodeGraphData } from '../codegraph/types';
import type {
  GraphViewContract,
  GraphViewData,
  KnowledgeGraphKind,
} from '../../types/agentgraph';

const CodeGraphScene = lazy(async () => {
  const mod = await import('../codegraph/CodeGraphScene');
  return { default: mod.CodeGraphScene };
});

type KnowledgeGraphFrameworkProps = {
  kind: KnowledgeGraphKind;
  availableKinds?: readonly KnowledgeGraphKind[];
  onKindChange: (kind: KnowledgeGraphKind) => void;
  contract: GraphViewContract;
  onContractChange: (contract: GraphViewContract) => void;
  thinkGraphData: GraphViewData;
  knowGraphData: GraphViewData;
  codeGraphProjectName: string;
  minHeight?: number;
  onRefreshRequest?: () => Promise<void> | void;
};

const DEFAULT_FILTERS: Record<
  KnowledgeGraphKind,
  {
    nodeLabelAllowlist: string[];
    edgeTypeAllowlist: string[];
    maxNodes: number;
  }
> = {
  thinkgraph: {
    nodeLabelAllowlist: ['entity', 'concept', 'goal', 'hypothesis'],
    edgeTypeAllowlist: ['related_to', 'supports', 'contradicts', 'depends_on'],
    maxNodes: 6000,
  },
  knowgraph: {
    nodeLabelAllowlist: [
      'entity',
      'document',
      'topic',
      'person',
      'organization',
    ],
    edgeTypeAllowlist: ['related_to', 'references', 'cites', 'evidence_for'],
    maxNodes: 8000,
  },
  codegraph: {
    nodeLabelAllowlist: [],
    edgeTypeAllowlist: [],
    maxNodes: 50000,
  },
};
const KNOWLEDGE_CONTROLS_DEFAULT_WIDTH = 340;
const KNOWLEDGE_CONTROLS_MIN_WIDTH = 320;
const KNOWLEDGE_CONTROLS_MAX_WIDTH = 520;

function compactStatusText(value: unknown, limit = 160): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1).trimEnd()}...`
    : normalized;
}

class CodeGraphSceneErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="knowledge-graph-scene-error"
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          <div
            style={graphGlassPillStyle({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              lineHeight: 1.35,
              maxWidth: 520,
              padding: '7px 10px',
              color: GRAPH_THEME.surface.mutedText,
            })}
          >
            <strong style={{ color: GRAPH_THEME.drawer.inputText }}>
              Graph scene unavailable.
            </strong>
            <span>
              {compactStatusText(
                this.state.error.message || 'The graph renderer failed to load.',
              )}
            </span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function resolveModeDefaultAllowlist(
  available: string[],
  defaults: string[],
): string[] {
  if (available.length === 0) return [];
  const byLower = new Map<string, string>();
  available.forEach((value) => {
    byLower.set(value.toLowerCase(), value);
  });
  const resolved = defaults
    .map((entry) => byLower.get(entry.toLowerCase()) || null)
    .filter((entry): entry is string => Boolean(entry));
  if (resolved.length > 0) return Array.from(new Set(resolved));
  return [...available];
}

type NumericGraphData = {
  graph: CodeGraphData;
  idMap: Map<string, number>;
};

function toNumericGraphData(input: GraphViewData): NumericGraphData {
  const idMap = new Map<string, number>();
  const indexFor = (id: string): number => {
    const existing = idMap.get(id);
    if (existing != null) return existing;
    const next = idMap.size + 1;
    idMap.set(id, next);
    return next;
  };

  const nodes = input.nodes.map((node, index) => {
    const id = indexFor(node.id);
    const radius = Math.sqrt(index + 1) * 18;
    const theta = index * 0.5;
    return {
      id,
      x: node.x ?? Math.cos(theta) * radius,
      y: node.y ?? Math.sin(theta) * radius,
      z: node.z ?? ((index % 17) - 8) * 6,
      label: String(node.type || 'node'),
      name: String(node.label || node.id),
      file_path: node.sourceIds?.[0],
      size: Math.max(2, Number(node.size ?? 8)),
      color: node.color || colorForCodeGraphLabel(String(node.type || 'node')),
    };
  });

  const edges = input.edges
    .map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (source == null || target == null) return null;
      return {
        source,
        target,
        type: String(edge.type || 'related_to'),
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

  return {
    graph: {
      nodes,
      edges,
      total_nodes: nodes.length,
    },
    idMap,
  };
}

async function fetchCodeGraphLayout(
  project: string,
  maxNodes: number,
  signal?: AbortSignal,
): Promise<CodeGraphData> {
  const params = new URLSearchParams({
    project,
    max_nodes: String(maxNodes),
  });
  const response = await fetch(`/api/layout?${params.toString()}`, { signal });
  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function labelSetFromGraph(data: CodeGraphData): string[] {
  return Array.from(new Set(data.nodes.map((node) => node.label))).sort();
}

function edgeSetFromGraph(data: CodeGraphData): string[] {
  return Array.from(new Set(data.edges.map((edge) => edge.type))).sort();
}

export default function KnowledgeGraphFramework({
  kind,
  availableKinds = ['thinkgraph', 'knowgraph', 'codegraph'],
  onKindChange,
  contract,
  onContractChange,
  thinkGraphData,
  knowGraphData,
  codeGraphProjectName,
  minHeight = 360,
  onRefreshRequest,
}: KnowledgeGraphFrameworkProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<{
    token: number;
    action: 'zoom_in' | 'zoom_out' | 'fit_view';
  } | null>(null);
  const [codeGraphData, setCodeGraphData] = useState<CodeGraphData | null>(
    null,
  );
  const [lastGoodCodeGraphData, setLastGoodCodeGraphData] =
    useState<CodeGraphData | null>(null);
  const lastLoadedCodeGraphSignatureRef = useRef<string | null>(null);
  const codeGraphLoadAbortRef = useRef<AbortController | null>(null);
  const codeGraphRefreshAbortRef = useRef<AbortController | null>(null);
  const [loadingCodeGraph, setLoadingCodeGraph] = useState(false);
  const [codeGraphError, setCodeGraphError] = useState<string | null>(null);
  const majorGridGap = getGraphMajorGridGap();

  const effectiveMaxNodes = Math.max(
    1,
    Number(contract.maxNodes || DEFAULT_FILTERS[kind].maxNodes),
  );
  const codeGraphSignature = `${codeGraphProjectName}:${effectiveMaxNodes}`;

  useEffect(() => {
    if (kind !== 'codegraph') return;
    if (
      codeGraphData &&
      lastLoadedCodeGraphSignatureRef.current === codeGraphSignature
    ) {
      setLoadingCodeGraph(false);
      return;
    }
    let cancelled = false;
    codeGraphLoadAbortRef.current?.abort();
    const controller = new AbortController();
    codeGraphLoadAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setLoadingCodeGraph(true);
    setCodeGraphError(null);
    void fetchCodeGraphLayout(
      codeGraphProjectName,
      effectiveMaxNodes,
      controller.signal,
    )
      .then((layout) => {
        if (cancelled) return;
        setCodeGraphData(layout);
        lastLoadedCodeGraphSignatureRef.current = codeGraphSignature;
      })
      .catch((error: any) => {
        if (cancelled) return;
        const isAbort =
          error?.name === 'AbortError' ||
          String(error?.message || '')
            .toLowerCase()
            .includes('aborted');
        setCodeGraphError(
          isAbort
            ? 'CodeGraph request timed out. Press Refresh to retry.'
            : String(error?.message || 'Failed to load graph layout'),
        );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (codeGraphLoadAbortRef.current === controller) {
          codeGraphLoadAbortRef.current = null;
        }
        if (!cancelled) {
          setLoadingCodeGraph(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (codeGraphLoadAbortRef.current === controller) {
        codeGraphLoadAbortRef.current.abort();
        codeGraphLoadAbortRef.current = null;
      }
    };
  }, [
    codeGraphData,
    codeGraphProjectName,
    codeGraphSignature,
    effectiveMaxNodes,
    kind,
  ]);

  const normalized = useMemo(() => {
    if (kind === 'codegraph') {
      return {
        graph: codeGraphData ?? { nodes: [], edges: [], total_nodes: 0 },
        idMap: new Map<string, number>(),
      };
    }
    return toNumericGraphData(
      kind === 'thinkgraph' ? thinkGraphData : knowGraphData,
    );
  }, [kind, codeGraphData, thinkGraphData, knowGraphData]);

  const allLabels = useMemo(
    () => labelSetFromGraph(normalized.graph),
    [normalized.graph],
  );
  const allEdgeTypes = useMemo(
    () => edgeSetFromGraph(normalized.graph),
    [normalized.graph],
  );
  const defaultLabels = useMemo(
    () =>
      resolveModeDefaultAllowlist(
        allLabels,
        DEFAULT_FILTERS[kind].nodeLabelAllowlist,
      ),
    [allLabels, kind],
  );
  const defaultEdgeTypes = useMemo(
    () =>
      resolveModeDefaultAllowlist(
        allEdgeTypes,
        DEFAULT_FILTERS[kind].edgeTypeAllowlist,
      ),
    [allEdgeTypes, kind],
  );

  const labelAllow = useMemo(() => {
    if (
      contract.graphKind === kind &&
      Array.isArray(contract.nodeLabelAllowlist)
    ) {
      return new Set(contract.nodeLabelAllowlist);
    }
    return new Set(defaultLabels);
  }, [contract.graphKind, contract.nodeLabelAllowlist, defaultLabels, kind]);
  const edgeAllow = useMemo(() => {
    if (
      contract.graphKind === kind &&
      Array.isArray(contract.edgeTypeAllowlist)
    ) {
      return new Set(contract.edgeTypeAllowlist);
    }
    return new Set(defaultEdgeTypes);
  }, [contract.edgeTypeAllowlist, contract.graphKind, defaultEdgeTypes, kind]);
  const showLabels =
    typeof contract.showLabels === 'boolean'
      ? contract.showLabels
      : kind !== 'codegraph';

  const filteredData = useMemo<CodeGraphData>(() => {
    const nodes = normalized.graph.nodes.filter((node) =>
      labelAllow.has(node.label),
    );
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = normalized.graph.edges.filter(
      (edge) =>
        edgeAllow.has(edge.type) &&
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target),
    );
    return {
      nodes,
      edges,
      total_nodes: normalized.graph.total_nodes,
    };
  }, [edgeAllow, labelAllow, normalized.graph]);

  useEffect(() => {
    if (kind !== 'codegraph') return;
    if (filteredData.nodes.length === 0) return;
    setLastGoodCodeGraphData(filteredData);
  }, [filteredData, kind]);

  const displayData = useMemo<CodeGraphData>(() => {
    if (kind !== 'codegraph') return filteredData;
    if (filteredData.nodes.length > 0) return filteredData;
    if ((loadingCodeGraph || codeGraphError) && lastGoodCodeGraphData) {
      return lastGoodCodeGraphData;
    }
    return filteredData;
  }, [
    codeGraphError,
    filteredData,
    kind,
    lastGoodCodeGraphData,
    loadingCodeGraph,
  ]);
  const surfaceStatusMessage = useMemo(() => {
    if (kind === 'codegraph') {
      if (loadingCodeGraph) return 'CodeGraph loading...';
      if (codeGraphError) {
        return `CodeGraph unavailable: ${compactStatusText(codeGraphError, 180)}`;
      }
      if (displayData.nodes.length === 0) {
        return 'CodeGraph returned zero nodes for the current project.';
      }
      return null;
    }
    if (kind === 'knowgraph' && filteredData.nodes.length === 0) {
      return 'KnowGraph returned zero nodes for the selected project.';
    }
    if (kind === 'thinkgraph' && filteredData.nodes.length === 0) {
      return 'ThinkGraph returned zero nodes for the selected project.';
    }
    return null;
  }, [
    codeGraphError,
    displayData.nodes.length,
    filteredData.nodes.length,
    kind,
    loadingCodeGraph,
  ]);

  const highlightedIds = useMemo(() => {
    if (!contract.focusNodeIds?.length) return null;
    const ids = new Set<number>();
    contract.focusNodeIds.forEach((rawId) => {
      const str = String(rawId);
      const mapped = normalized.idMap.get(str);
      if (mapped != null) ids.add(mapped);
      const maybeNumeric = Number(str);
      if (Number.isFinite(maybeNumeric)) ids.add(maybeNumeric);
    });
    return ids.size > 0 ? ids : null;
  }, [contract.focusNodeIds, normalized.idMap]);

  const applyContractPatch = (patch: Partial<GraphViewContract>) => {
    onContractChange({
      ...contract,
      ...patch,
      graphKind: kind,
    });
  };

  const refreshCodeGraph = async () => {
    codeGraphRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    codeGraphRefreshAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setLoadingCodeGraph(true);
    setCodeGraphError(null);
    try {
      const layout = await fetchCodeGraphLayout(
        codeGraphProjectName,
        effectiveMaxNodes,
        controller.signal,
      );
      setCodeGraphData(layout);
      lastLoadedCodeGraphSignatureRef.current = codeGraphSignature;
    } catch (error: any) {
      const isAbort =
        error?.name === 'AbortError' ||
        String(error?.message || '')
          .toLowerCase()
          .includes('aborted');
      setCodeGraphError(
        isAbort
          ? 'CodeGraph request timed out. Press Refresh to retry.'
          : String(error?.message || 'Failed to load graph layout'),
      );
    } finally {
      window.clearTimeout(timeout);
      if (codeGraphRefreshAbortRef.current === controller) {
        codeGraphRefreshAbortRef.current = null;
      }
      setLoadingCodeGraph(false);
    }
  };

  const handleRefresh = async () => {
    if (kind === 'codegraph') {
      await refreshCodeGraph();
      return;
    }
    await onRefreshRequest?.();
  };

  const modeButtonStyle = (value: KnowledgeGraphKind) =>
    graphCompanionTabButtonStyle(kind === value, {
      fontSize: 11,
      padding: '6px 8px',
    });

  const visibleKinds = useMemo(
    () =>
      availableKinds.filter(
        (value, index, values) =>
          values.indexOf(value) === index &&
          (value === 'thinkgraph' ||
            value === 'knowgraph' ||
            value === 'codegraph'),
      ),
    [availableKinds],
  );

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: 12,
          zIndex: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          ...graphCompanionTabGroupStyle({
            gap: 6,
            padding: 6,
          }),
        }}
        data-no-surface-promote="true"
      >
        {visibleKinds.includes('thinkgraph') ? (
          <button
            type="button"
            style={modeButtonStyle('thinkgraph')}
            onClick={() => onKindChange('thinkgraph')}
          >
            ThinkGraph
          </button>
        ) : null}
        {visibleKinds.includes('knowgraph') ? (
          <button
            type="button"
            style={modeButtonStyle('knowgraph')}
            onClick={() => onKindChange('knowgraph')}
          >
            KnowGraph
          </button>
        ) : null}
        {visibleKinds.includes('codegraph') ? (
          <button
            type="button"
            style={modeButtonStyle('codegraph')}
            onClick={() => onKindChange('codegraph')}
          >
            CodeGraph
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        data-no-surface-promote="true"
        style={graphDrawerButtonStyle({
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 5,
          fontSize: 11,
          padding: '6px 9px',
        })}
      >
        Controls
      </button>
      <button
        type="button"
        onClick={() => void handleRefresh()}
        data-no-surface-promote="true"
        style={graphDrawerButtonStyle({
          position: 'absolute',
          top: 12,
          right: 92,
          zIndex: 5,
          fontSize: 11,
          padding: '6px 9px',
        })}
      >
        Refresh
      </button>

      <RightGlassDrawer
        isOpen={drawerOpen}
        title="Controls"
        onClose={() => setDrawerOpen(false)}
        defaultWidth={KNOWLEDGE_CONTROLS_DEFAULT_WIDTH}
        minWidth={KNOWLEDGE_CONTROLS_MIN_WIDTH}
        maxWidth={KNOWLEDGE_CONTROLS_MAX_WIDTH}
        storageKey="liquidaity.drawer.knowledge-controls.width"
        dataTestId="knowledge-utility-drawer"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        <div
          data-no-surface-promote="true"
          style={{
            display: 'grid',
            gap: 12,
          }}
        >
          <CodeGraphFilterPanel
            data={normalized.graph}
            enabledLabels={labelAllow}
            enabledEdgeTypes={edgeAllow}
            showLabels={showLabels}
            onToggleLabel={(label) => {
              const next = new Set(labelAllow);
              if (next.has(label)) next.delete(label);
              else next.add(label);
              applyContractPatch({ nodeLabelAllowlist: Array.from(next) });
            }}
            onToggleEdgeType={(edgeType) => {
              const next = new Set(edgeAllow);
              if (next.has(edgeType)) next.delete(edgeType);
              else next.add(edgeType);
              applyContractPatch({ edgeTypeAllowlist: Array.from(next) });
            }}
            onToggleShowLabels={() =>
              applyContractPatch({ showLabels: !showLabels })
            }
            onEnableAll={() =>
              applyContractPatch({
                nodeLabelAllowlist: allLabels,
                edgeTypeAllowlist: allEdgeTypes,
              })
            }
            onDisableAll={() =>
              applyContractPatch({
                nodeLabelAllowlist: [],
                edgeTypeAllowlist: [],
              })
            }
          />
        </div>
      </RightGlassDrawer>

      <div style={{ width: '100%', height: '100%', minHeight }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            backgroundImage: [
              `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
              `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
              `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
              `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
            ].join(', '),
            backgroundSize: [
              `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
              `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
              `${majorGridGap}px ${majorGridGap}px`,
              `${majorGridGap}px ${majorGridGap}px`,
            ].join(', '),
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
          <CodeGraphSceneErrorBoundary key={`knowledge-scene-${kind}`}>
            <Suspense
              fallback={
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    bottom: 12,
                    zIndex: 4,
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={graphGlassPillStyle({
                      fontSize: 11,
                      padding: '7px 10px',
                      color: GRAPH_THEME.surface.mutedText,
                    })}
                  >
                    Loading graph scene...
                  </div>
                </div>
              }
            >
              <CodeGraphScene
                data={displayData}
                showLabels={showLabels}
                highlightedIds={highlightedIds}
                interactionLocked={interactionLocked}
                cameraAction={cameraCommand?.action || null}
                cameraActionToken={cameraCommand?.token || 0}
                onNodeClick={(node) => {
                  const focused = new Set(
                    (contract.focusNodeIds || []).map((value) => String(value)),
                  );
                  const nodeKey = String(node.id);
                  if (focused.has(nodeKey)) {
                    applyContractPatch({ focusNodeIds: [] });
                    return;
                  }
                  applyContractPatch({ focusNodeIds: [nodeKey] });
                }}
              />
            </Suspense>
          </CodeGraphSceneErrorBoundary>
        </div>
      </div>
      <div data-no-surface-promote="true" style={graphControlStackStyle}>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() =>
            setCameraCommand({
              token: Date.now(),
              action: 'zoom_in',
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() =>
            setCameraCommand({
              token: Date.now(),
              action: 'zoom_out',
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Recenter view"
          onClick={() =>
            setCameraCommand({
              token: Date.now(),
              action: 'fit_view',
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label={
            interactionLocked ? 'Unlock interaction' : 'Lock interaction'
          }
          onClick={() => setInteractionLocked((current) => !current)}
          style={graphControlButtonStyle({
            color: interactionLocked
              ? GRAPH_THEME.accent.primary
              : GRAPH_THEME.controls.text,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M4.5 6V4.75a2.5 2.5 0 1 1 5 0V6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
            <rect
              x="3"
              y="6"
              width="8"
              height="6"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
      </div>

      {surfaceStatusMessage ? (
        <div
          data-no-surface-promote="true"
          style={graphGlassPillStyle({
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 4,
            fontSize: 11,
            padding: '6px 8px',
            maxWidth: 520,
            lineHeight: 1.35,
          })}
        >
          {surfaceStatusMessage}
        </div>
      ) : null}
    </div>
  );
}
