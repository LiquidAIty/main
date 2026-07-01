import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { colorForCodeGraphLabel } from '../codegraph/colors';
import { CodeGraphFilterPanel } from '../codegraph/CodeGraphFilterPanel';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import {
  type KnowledgeGraphNode,
  type KnowledgeGraphRelationship,
} from './KnowledgeGraphNVL';
import GraphExplorerCore from '../graph/GraphExplorerCore';
import { knowGraphAdapter, composeSources, type GraphView } from '../graph/graphViewAdapter';
import type { GraphSource } from '../graph/GraphExplorerCore';
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
  /** CBM call-graph slice from /api/codegraph/graph-view (codebase-memory MCP). */
  codeGraphViewData?: GraphViewData;
  /** Honest data-source label for the ThinkGraph tab (e.g. 'thinkgraph-db', 'host-provided',
   * 'thinkgraph-db:no_thinkgraph_records_for_project', 'unavailable:<blocker>'). */
  thinkGraphSource?: string;
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
  // 'knowgraph' has no viz surface mounted right now; kept only so DEFAULT_FILTERS stays a total
  // Record<KnowledgeGraphKind>. Not selectable (availableKinds excludes it).
  knowgraph: {
    nodeLabelAllowlist: [],
    edgeTypeAllowlist: [],
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
  availableKinds = ['thinkgraph', 'codegraph'],
  onKindChange,
  contract,
  onContractChange,
  thinkGraphData,
  codeGraphViewData,
  thinkGraphSource,
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
    return toNumericGraphData(thinkGraphData);
  }, [kind, codeGraphData, thinkGraphData]);

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
  // Runtime/diagnostic state (source/counts/errors) is intentionally NOT painted on
  // the canvas anymore — it lives in the network response and developer console. A
  // genuine renderer crash still surfaces through CodeGraphSceneErrorBoundary; an
  // honest non-canvas dev log keeps a graph/error trail without a UI overlay.
  useEffect(() => {
    if (kind === 'codegraph' && codeGraphError) {
      console.warn(`[graph] CodeGraph (${codeGraphProjectName || 'no-project'}): ${codeGraphError}`);
    } else if (kind === 'thinkgraph') {
      console.debug(`[graph] ThinkGraph source=${thinkGraphSource || 'host-provided'}`);
    }
  }, [kind, codeGraphError, codeGraphProjectName, thinkGraphSource]);

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

  // Reverse of normalized.idMap (numeric scene id → real string node id) so a KnowGraph node
  // click can be reported back to the parent by its real id for neighborhood expansion.
  const numericToStringId = useMemo(() => {
    const reverse = new Map<number, string>();
    normalized.idMap.forEach((numeric, id) => reverse.set(numeric, id));
    return reverse;
  }, [normalized.idMap]);

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
          (value === 'thinkgraph' || value === 'codegraph'),
      ),
    [availableKinds],
  );

  // ThinkGraph view = the canonical word-first :ThinkNode / :THINK_EDGE projection from
  // /api/thinkgraph/graph-view (node.type = reasoning class, edge.type = typed predicate),
  // converted to the same source-neutral GraphView the shared Sigma explorer consumes.
  const thinkGraphView = useMemo<GraphView>(() => {
    const rawNodes = Array.isArray(thinkGraphData?.nodes) ? thinkGraphData.nodes : [];
    const rawEdges = Array.isArray(thinkGraphData?.edges) ? thinkGraphData.edges : [];
    const nodes = rawNodes.map((n) => ({
      id: String(n.id),
      ownerGraph: 'think' as const,
      semanticKind: String(n.type || 'entity'),
      displayLabel: String(n.label || n.id),
      rawIds: [String(n.id)],
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = rawEdges
      .map((e, i) => ({
        id: String(e.id ?? `${e.source}->${e.target}->${i}`),
        source: String(e.source),
        target: String(e.target),
        ownerGraph: 'think' as const,
        predicate: String(e.type || 'leads_to'),
      }))
      .filter((e) => ids.has(e.source) && ids.has(e.target));
    return {
      focus: null,
      activeLayers: ['think'],
      nodes,
      edges,
      availability: [{ layer: 'think', state: nodes.length > 0 ? 'available' : 'unavailable', reason: nodes.length > 0 ? 'ThinkGraph reasoning map' : 'no ThinkGraph reasoning yet' }],
    };
  }, [thinkGraphData]);

  // CodeGraph view = the CBM call-graph slice from /api/codegraph/graph-view (read through the
  // codebase-memory MCP). Same source-neutral GraphView; node ids are CBM qualified_names, so the
  // Harness can graph_focus/graph_highlight the exact symbols it says it will work on.
  const codeGraphView = useMemo<GraphView>(() => {
    const rawNodes = Array.isArray(codeGraphViewData?.nodes) ? codeGraphViewData.nodes : [];
    const rawEdges = Array.isArray(codeGraphViewData?.edges) ? codeGraphViewData.edges : [];
    const nodes = rawNodes.map((n) => ({
      id: String(n.id),
      ownerGraph: 'code' as const,
      semanticKind: String(n.type || 'Function'),
      displayLabel: String(n.label || n.id),
      rawIds: [String(n.id)],
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = rawEdges
      .map((e, i) => ({
        id: String(e.id ?? `${e.source}->${e.target}->${i}`),
        source: String(e.source),
        target: String(e.target),
        ownerGraph: 'code' as const,
        predicate: String(e.type || 'CALLS'),
      }))
      .filter((e) => ids.has(e.source) && ids.has(e.target));
    return {
      focus: null,
      activeLayers: ['code'],
      nodes,
      edges,
      availability: [{ layer: 'code', state: nodes.length > 0 ? 'available' : 'unavailable', reason: nodes.length > 0 ? 'CBM CodeGraph (codebase-memory MCP)' : 'no CodeGraph slice yet' }],
    };
  }, [codeGraphViewData]);

  // Shared-canvas source toggles — your real graphs by their real names.
  const [enabledSources, setEnabledSources] = useState<Record<'thinkgraph' | 'codegraph' | 'skillgraph', boolean>>({ thinkgraph: true, codegraph: false, skillgraph: false });
  const toggleSource = useCallback((id: 'thinkgraph' | 'codegraph' | 'skillgraph' | 'knowgraph') => {
    if (id === 'knowgraph') return;
    setEnabledSources((p) => ({ ...p, [id]: !p[id] }));
  }, []);

  const sources = useMemo<GraphSource[]>(() => [
    { id: 'thinkgraph', name: 'ThinkGraph', enabled: enabledSources.thinkgraph, available: thinkGraphView.nodes.length > 0, nodeCount: thinkGraphView.nodes.length, reason: 'Apache AGE thinkgraph_liq' },
    { id: 'codegraph', name: 'CodeGraph', enabled: enabledSources.codegraph, available: codeGraphView.nodes.length > 0, nodeCount: codeGraphView.nodes.length, reason: 'CBM codebase-memory MCP' },
    { id: 'skillgraph', name: 'SkillGraph', enabled: false, available: false, nodeCount: 0, reason: 'SkillGraph not connected yet' },
  ], [enabledSources, thinkGraphView, codeGraphView]);

  // One canvas: union of the ENABLED real sources. Each node/edge keeps its source identity; no
  // cross-graph edge is invented.
  const composedGraphView = useMemo<GraphView>(() => {
    const views: GraphView[] = [];
    if (enabledSources.thinkgraph) views.push(thinkGraphView);
    if (enabledSources.codegraph) views.push(codeGraphView);
    return views.length ? composeSources(views) : thinkGraphView;
  }, [enabledSources, thinkGraphView, codeGraphView]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
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
          {/* One Sigma explorer — KnowGraph + ThinkGraph as real source toggles on the same canvas. */}
          <GraphExplorerCore
            view={composedGraphView}
            sources={sources}
            onToggleSource={toggleSource}
            height={Math.max(minHeight || 0, 560)}
            onSelectNode={(node) => {
              applyContractPatch({ focusNodeIds: node ? [node.id] : [] });
            }}
          />
        </div>
      </div>
      {/* The zoom/lock control stack drove the removed 3D CodeGraphScene. The shared Sigma canvas
          has native wheel-zoom + its own "Reset view"; no separate camera controls are rendered. */}

    </div>
  );
}
