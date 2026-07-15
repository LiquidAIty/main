import { useEffect, useMemo, useState } from 'react';

import { CodeGraphScene } from '../codegraph/CodeGraphScene';
import { fetchLayout } from '../codegraph/CodeGraphSurface';
import type { CodeGraphData, CodeGraphEdge, CodeGraphNode } from '../codegraph/types';
import GlassInspectorSection from '../graph/GlassInspectorSection';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphGlassPillStyle,
} from '../graph/graphVisualTokens';
import type { GraphProjectionV1 } from './KnowledgeGraphFramework';
import type { HermesReportView } from './hermesReportView';

type Layer = 'thinkgraph' | 'knowgraph' | 'codegraph';
type InspectorTab = 'controls' | 'node' | 'report';

const LAYER = {
  thinkgraph: { label: 'ThinkGraph', color: '#4AE2DF', z: 170 },
  knowgraph: { label: 'KnowGraph', color: '#B8C8D2', z: 0 },
  codegraph: { label: 'CodeGraph', color: '#5EA8FF', z: -190 },
} as const;

function projectionPosition(index: number, count: number, z: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const spacing = Math.max(28, Math.min(74, 560 / columns));
  return {
    x: (column - (columns - 1) / 2) * spacing,
    y: (row - (Math.ceil(count / columns) - 1) / 2) * spacing,
    z: z + ((index % 5) - 2) * 7,
  };
}

function readableValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function leadFor(node: CodeGraphNode): string {
  const properties = node.properties || {};
  for (const key of ['text', 'summary', 'description', 'goal', 'question', 'decision', 'content']) {
    const value = readableValue(properties[key]);
    if (value) return value;
  }
  if (node.file_path) return `${node.name} is a ${node.label} in ${node.file_path}.`;
  return `${node.name} is a ${node.label} record from ${LAYER[node.authority || 'codegraph'].label}.`;
}

export default function UnifiedGraphSurface({
  projectId,
  codeGraphProject,
  thinkProjection,
  knowProjection,
  activeHermesReport,
  focusedThinkIds,
}: {
  projectId: string;
  codeGraphProject: string;
  thinkProjection?: GraphProjectionV1;
  knowProjection?: GraphProjectionV1;
  activeHermesReport?: HermesReportView | null;
  focusedThinkIds?: string[];
}) {
  const [codeData, setCodeData] = useState<CodeGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<Layer, boolean>>({
    thinkgraph: true,
    knowgraph: true,
    codegraph: true,
  });
  const [codeBudget, setCodeBudget] = useState(750);
  const [reasoningBudget, setReasoningBudget] = useState(300);
  const [showLabels, setShowLabels] = useState(false);
  const [contextOnly, setContextOnly] = useState(false);
  const [pinnedContextRefs, setPinnedContextRefs] = useState<Set<string>>(new Set());
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [goalOnly, setGoalOnly] = useState(false);
  const [hopDepth, setHopDepth] = useState(1);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number> | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('controls');

  useEffect(() => {
    if (!codeGraphProject) {
      setCodeData(null);
      return;
    }
    const controller = new AbortController();
    setError(null);
    void fetchLayout(codeGraphProject, 3000)
      .then((data) => {
        if (!controller.signal.aborted) setCodeData(data);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) setError(String(nextError?.message || nextError));
      });
    return () => controller.abort();
  }, [codeGraphProject]);

  const contextRefs = useMemo(() => {
    const refs = new Set([...(focusedThinkIds || []), ...pinnedContextRefs]);
    for (const id of activeHermesReport?.linkedThinkGraphNodeIds || []) refs.add(id);
    for (const id of activeHermesReport?.linkedKnowGraphRefs || []) refs.add(id);
    for (const id of activeHermesReport?.linkedCodeGraphRefs || []) refs.add(id);
    return refs;
  }, [activeHermesReport, focusedThinkIds, pinnedContextRefs]);

  const combined = useMemo(() => {
    let nextId = 1;
    const nodes: CodeGraphNode[] = [];
    const edges: CodeGraphEdge[] = [];
    const idByRef = new Map<string, number>();

    const addNode = (node: Omit<CodeGraphNode, 'id'>, refs: string[]) => {
      const id = nextId++;
      nodes.push({ ...node, id });
      for (const ref of refs.filter(Boolean)) idByRef.set(ref, id);
      return id;
    };

    if (enabled.codegraph) {
      const selected = (codeData?.nodes || []).slice(0, codeBudget);
      for (const node of selected) {
        addNode(
          {
            ...node,
            x: node.x,
            y: node.y,
            z: node.z + LAYER.codegraph.z,
            color: LAYER.codegraph.color,
            authority: 'codegraph',
            source_id: String(node.id),
          },
          [String(node.id), node.name, node.file_path || ''],
        );
      }
      const sourceId = (original: number) => idByRef.get(String(original));
      for (const edge of codeData?.edges || []) {
        const source = sourceId(edge.source);
        const target = sourceId(edge.target);
        if (source && target) edges.push({ source, target, type: edge.type });
      }
    }

    const addProjection = (projection: GraphProjectionV1 | undefined, authority: 'thinkgraph' | 'knowgraph') => {
      if (!projection || !enabled[authority]) return;
      const selected = projection.nodes.slice(0, reasoningBudget);
      const localIds = new Map<string, number>();
      selected.forEach((node, index) => {
        const position = projectionPosition(index, selected.length, LAYER[authority].z);
        const numericId = addNode(
          {
            ...position,
            label: node.type || node.labels?.[0] || 'Record',
            name: node.title || node.label,
            size: Math.max(5, Math.min(15, 5 + Math.log2((node.mentionCount || 1) + 1) * 2)),
            color: LAYER[authority].color,
            authority,
            source_id: node.id,
            properties: node.properties,
            provenance: node.provenance,
            project_id: node.projectId,
            conversation_id: node.conversationId,
            goal_id: node.goalId,
            episode_id: node.episodeId,
            job_id: node.jobId,
            run_id: node.runId,
            status: node.currentState,
            trust: node.trustState,
            quality: node.qualityState,
            retrieval_reason: node.retrievalReason,
          },
          [node.id, node.canonicalId || ''],
        );
        localIds.set(node.id, numericId);
      });
      for (const edge of projection.edges) {
        const source = localIds.get(edge.source);
        const target = localIds.get(edge.target);
        if (source && target) edges.push({ source, target, type: edge.predicate });
      }
      for (const node of selected) {
        const source = localIds.get(node.id);
        for (const ref of [node.codeGraphRef, node.knowGraphRef]) {
          const target = ref ? idByRef.get(ref) : undefined;
          if (source && target && source !== target) edges.push({ source, target, type: 'GROUNDED_IN' });
        }
      }
    };

    addProjection(knowProjection, 'knowgraph');
    addProjection(thinkProjection, 'thinkgraph');

    const expand = (seedIds: Set<number>, depth: number) => {
      const visibleIds = new Set(seedIds);
      let frontier = new Set(seedIds);
      for (let hop = 0; hop < depth; hop += 1) {
        const next = new Set<number>();
        for (const edge of edges) {
          if (frontier.has(edge.source) && !visibleIds.has(edge.target)) next.add(edge.target);
          if (frontier.has(edge.target) && !visibleIds.has(edge.source)) next.add(edge.source);
        }
        next.forEach((id) => visibleIds.add(id));
        frontier = next;
      }
      return visibleIds;
    };

    let visibleIds = new Set(nodes.map((node) => node.id));
    if (contextOnly && contextRefs.size > 0) {
      const seeds = new Set(nodes
        .filter((node) => contextRefs.has(node.source_id || '') || contextRefs.has(node.name) || contextRefs.has(node.file_path || ''))
        .map((node) => node.id));
      visibleIds = expand(seeds, hopDepth);
    }
    if (selectionOnly && selectedNode) {
      const selected = nodes.find((node) => node.authority === selectedNode.authority && node.source_id === selectedNode.source_id);
      const selectionIds = selected ? expand(new Set([selected.id]), hopDepth) : new Set<number>();
      visibleIds = new Set([...visibleIds].filter((id) => selectionIds.has(id)));
    }
    if (goalOnly) {
      const goalId = selectedNode?.goal_id
        || (selectedNode?.label === 'Goal' ? selectedNode.source_id : undefined)
        || thinkProjection?.nodes.find((node) => node.type === 'Goal' && node.currentState !== 'historical')?.canonicalId;
      if (goalId) {
        visibleIds = new Set(nodes
          .filter((node) => node.goal_id === goalId || node.source_id === goalId)
          .map((node) => node.id)
          .filter((id) => visibleIds.has(id)));
      }
    }
    const visibleNodes = nodes.filter((node) => visibleIds.has(node.id));
    const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    return { nodes: visibleNodes, edges: visibleEdges, total_nodes: nodes.length } satisfies CodeGraphData;
  }, [codeBudget, codeData, contextOnly, contextRefs, enabled, goalOnly, hopDepth, knowProjection, reasoningBudget, selectedNode, selectionOnly, thinkProjection]);

  const selectedRelationships = useMemo(
    () => selectedNode
      ? combined.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      : [],
    [combined.edges, selectedNode],
  );

  const selectedContext = useMemo(() => {
    if (!selectedNode) return null;
    const ref = selectedNode.source_id || '';
    const report = activeHermesReport;
    let reason = selectedNode.retrieval_reason || 'Visible graph record; not selected for Main context';
    if (pinnedContextRefs.has(ref)) reason = 'User included this record in Main context';
    else if ((focusedThinkIds || []).includes(ref)) reason = 'User-selected ThinkGraph focus';
    else if (report?.linkedThinkGraphNodeIds?.includes(ref)) reason = 'Main/Hermes ThinkGraph reference';
    else if (report?.linkedKnowGraphRefs?.includes(ref)) reason = 'Main/Hermes KnowGraph evidence reference';
    else if (report?.linkedCodeGraphRefs?.includes(ref)) reason = 'Main/Hermes CodeGraph reference';
    const score = readableValue(selectedNode.properties?.context_score ?? selectedNode.properties?.score);
    const rank = readableValue(selectedNode.properties?.context_rank ?? selectedNode.properties?.rank);
    const characters = selectedNode.name.length + leadFor(selectedNode).length;
    return {
      included: contextRefs.has(ref),
      reason,
      score,
      rank,
      characters,
      estimatedTokens: Math.max(1, Math.ceil(characters / 4)),
    };
  }, [activeHermesReport, contextRefs, focusedThinkIds, pinnedContextRefs, selectedNode]);

  const selectNode = (node: CodeGraphNode) => {
    setSelectedNode(node);
    setInspectorOpen(true);
    setInspectorTab('node');
    const neighborhood = new Set([node.id]);
    for (const edge of combined.edges) {
      if (edge.source === node.id) neighborhood.add(edge.target);
      if (edge.target === node.id) neighborhood.add(edge.source);
    }
    setHighlightedIds(neighborhood);
  };

  return (
    <div data-testid="unified-graph-surface" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <CodeGraphScene
        data={combined}
        showLabels={showLabels}
        highlightedIds={highlightedIds}
        onNodeClick={selectNode}
        onBackgroundClick={() => {
          setSelectedNode(null);
          setHighlightedIds(null);
        }}
      />

      <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 12, zIndex: 4, padding: '6px 9px' })}>
        {combined.nodes.length.toLocaleString()} / {combined.total_nodes.toLocaleString()} records · {combined.edges.length.toLocaleString()} relationships
      </div>
      {error ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 44, zIndex: 4, color: '#ffb4b4' })}>CodeGraph unavailable: {error}</div> : null}
      {!selectedNode && contextOnly && contextRefs.size > 0 && combined.nodes.length === 0 ? (
        <div style={graphGlassPillStyle({ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 4, padding: '8px 12px' })}>
          No loaded graph record matches Main’s current context references.
        </div>
      ) : null}

      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="Graph"
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open graph panel"
        movable
        defaultWidth={344}
        minWidth={300}
        maxWidth={520}
        storageKey="liquidaity.drawer.unified-graph.v2.width"
        dataTestId="unified-graph-inspector"
        top={48}
        right={12}
        bottom={12}
        zIndex={7}
      >
        <div role="tablist" aria-label="Graph panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 3, marginBottom: 10, border: '1px solid rgba(126,232,226,.12)', borderRadius: 11, background: 'rgba(4,10,15,.24)' }}>
          {(['controls', 'node', 'report'] as InspectorTab[]).map((tab) => {
            const active = inspectorTab === tab;
            const disabled = (tab === 'node' && !selectedNode) || (tab === 'report' && !activeHermesReport);
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setInspectorTab(tab)}
                style={graphDrawerButtonStyle({
                  minHeight: 30,
                  padding: '5px 8px',
                  border: active ? '1px solid rgba(126,232,226,.3)' : '1px solid transparent',
                  background: active ? 'linear-gradient(135deg, rgba(55,173,170,.18), rgba(255,255,255,.035))' : 'transparent',
                  color: active ? GRAPH_THEME.surface.text : GRAPH_THEME.surface.mutedText,
                  opacity: disabled ? .42 : 1,
                })}
              >
                {tab === 'controls' ? 'Controls' : tab === 'node' ? 'Node' : 'Report'}
              </button>
            );
          })}
        </div>
        {inspectorTab === 'controls' ? (
          <div style={{ display: 'grid', gap: 2, padding: '1px 2px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>
              <span>Visible</span><span>{combined.nodes.length} / {combined.total_nodes}</span>
            </div>
          {(Object.keys(LAYER) as Layer[]).map((layer) => (
            <label key={layer} style={{ display: 'grid', gridTemplateColumns: '18px 10px 1fr auto', gap: 7, alignItems: 'center', minHeight: 28, color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>
              <input type="checkbox" checked={enabled[layer]} onChange={() => setEnabled((current) => ({ ...current, [layer]: !current[layer] }))} />
              <span style={{ width: 8, height: 8, borderRadius: 99, background: LAYER[layer].color, boxShadow: `0 0 10px ${LAYER[layer].color}` }} />
              <span>{LAYER[layer].label}</span>
              <span>{combined.nodes.filter((node) => node.authority === layer).length}</span>
            </label>
          ))}
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', color: GRAPH_THEME.surface.text, fontSize: 11, marginTop: 7 }}>
            <input type="checkbox" checked={contextOnly} disabled={contextRefs.size === 0} onChange={(event) => setContextOnly(event.target.checked)} />
            Main context only <span style={{ color: GRAPH_THEME.accent.primary }}>({contextRefs.size})</span>
          </label>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', color: GRAPH_THEME.surface.text, fontSize: 11, marginTop: 6 }}>
            <input type="checkbox" checked={selectionOnly} disabled={!selectedNode} onChange={(event) => setSelectionOnly(event.target.checked)} />
            Selection neighborhood
          </label>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', color: GRAPH_THEME.surface.text, fontSize: 11, marginTop: 6 }}>
            <input type="checkbox" checked={goalOnly} onChange={(event) => setGoalOnly(event.target.checked)} />
            Current Goal
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 7, color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>
            Depth · {hopDepth} {hopDepth === 1 ? 'hop' : 'hops'}
            <input type="range" aria-label="Context depth" min={0} max={3} step={1} value={hopDepth} onChange={(event) => setHopDepth(Number(event.target.value))} style={{ accentColor: LAYER.thinkgraph.color }} />
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 9, color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>
            Code records · {codeBudget.toLocaleString()}
            <input type="range" min={250} max={10000} step={250} value={codeBudget} onChange={(event) => setCodeBudget(Number(event.target.value))} style={{ accentColor: LAYER.codegraph.color }} />
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 7, color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>
            Reasoning records · {reasoningBudget}
            <input type="range" min={50} max={1000} step={50} value={reasoningBudget} onChange={(event) => setReasoningBudget(Number(event.target.value))} style={{ accentColor: LAYER.thinkgraph.color }} />
          </label>
          <button type="button" onClick={() => setShowLabels((value) => !value)} style={graphDrawerButtonStyle({ marginTop: 8, width: '100%' })}>
            {showLabels ? 'Hide labels' : 'Show labels'}
          </button>
          </div>
        ) : inspectorTab === 'report' && activeHermesReport ? (
          <article style={{ display: 'grid', gap: 10 }}>
            <div style={{ padding: '3px 3px 8px' }}>
              <div style={{ color: GRAPH_THEME.surface.text, fontFamily: 'Georgia, Cambria, serif', fontSize: 19, lineHeight: 1.2, marginBottom: 7 }}>
                {activeHermesReport.summary || 'Linked report'}
              </div>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10.5 }}>
                Revision {activeHermesReport.revision} · {activeHermesReport.status}
              </div>
            </div>
            {selectedNode ? (
              <GlassInspectorSection
                title="Selected record"
                signal={[
                  ...activeHermesReport.linkedThinkGraphNodeIds,
                  ...activeHermesReport.linkedKnowGraphRefs,
                  ...activeHermesReport.linkedCodeGraphRefs,
                ].includes(selectedNode.source_id || '') ? 'Linked' : 'Nearby'}
              >
                <InspectorRow label="Record" value={selectedNode.name} />
                <InspectorRow label="Authority" value={LAYER[selectedNode.authority || 'codegraph'].label} />
                <InspectorRow label="Reference" value={selectedNode.source_id} mono />
              </GlassInspectorSection>
            ) : null}
            <GlassInspectorSection title="Report" signal={activeHermesReport.reportId}>
              <div style={{ color: GRAPH_THEME.surface.text, fontSize: 12, lineHeight: 1.62, whiteSpace: 'pre-wrap' }}>
                {activeHermesReport.reportMarkdown || activeHermesReport.summary}
              </div>
            </GlassInspectorSection>
            <GlassInspectorSection title="References" signal={String(activeHermesReport.linkedThinkGraphNodeIds.length + activeHermesReport.linkedKnowGraphRefs.length + activeHermesReport.linkedCodeGraphRefs.length)} defaultOpen={false}>
              <InspectorRow label="ThinkGraph" value={String(activeHermesReport.linkedThinkGraphNodeIds.length)} />
              <InspectorRow label="KnowGraph" value={String(activeHermesReport.linkedKnowGraphRefs.length)} />
              <InspectorRow label="CodeGraph" value={String(activeHermesReport.linkedCodeGraphRefs.length)} />
              <InspectorRow label="Run" value={activeHermesReport.artifactRunId || activeHermesReport.parentRunId} mono />
              <InspectorRow label="Updated" value={activeHermesReport.updatedAt} />
            </GlassInspectorSection>
          </article>
        ) : selectedNode ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ padding: '4px 3px 6px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: LAYER[selectedNode.authority || 'codegraph'].color, boxShadow: `0 0 12px ${LAYER[selectedNode.authority || 'codegraph'].color}` }} />
                <span style={{ color: GRAPH_THEME.accent.primary, fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase' }}>{selectedNode.label}</span>
              </div>
              <div style={{ color: GRAPH_THEME.surface.text, fontFamily: 'Georgia, Cambria, serif', fontSize: 21, lineHeight: 1.15, marginBottom: 9 }}>{selectedNode.name}</div>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 12, lineHeight: 1.55 }}>{leadFor(selectedNode)}</div>
            </div>
            <GlassInspectorSection title="Identity" signal={LAYER[selectedNode.authority || 'codegraph'].label}>
              <InspectorRow label="Record ID" value={selectedNode.source_id || String(selectedNode.id)} />
              <InspectorRow label="Type" value={selectedNode.label} />
              <InspectorRow label="Project" value={projectId || codeGraphProject} />
              <InspectorRow label="File" value={selectedNode.file_path} mono />
            </GlassInspectorSection>
            <GlassInspectorSection
              title={selectedNode.authority === 'thinkgraph' ? 'ThinkGraph record' : selectedNode.authority === 'knowgraph' ? 'KnowGraph evidence' : 'CodeGraph symbol'}
              signal={selectedNode.status || selectedNode.label}
            >
              <InspectorRow label="Goal" value={selectedNode.goal_id} mono />
              <InspectorRow label="Episode" value={selectedNode.episode_id} mono />
              <InspectorRow label="Job / run" value={selectedNode.job_id || selectedNode.run_id} mono />
              <InspectorRow label="Status" value={selectedNode.status} />
              <InspectorRow label="Trust" value={selectedNode.trust} />
              <InspectorRow label="Quality" value={selectedNode.quality} />
              <InspectorRow label="Authority" value={LAYER[selectedNode.authority || 'codegraph'].label} />
            </GlassInspectorSection>
            <GlassInspectorSection title="Main Context" signal={selectedContext?.included ? 'Included' : 'Nearby / excluded'}>
              <button
                type="button"
                onClick={() => {
                  const ref = selectedNode.source_id || '';
                  if (!ref) return;
                  setPinnedContextRefs((current) => {
                    const next = new Set(current);
                    if (next.has(ref)) next.delete(ref);
                    else next.add(ref);
                    return next;
                  });
                }}
                style={graphDrawerButtonStyle({ width: '100%', marginBottom: 8 })}
              >
                {pinnedContextRefs.has(selectedNode.source_id || '') ? 'Exclude from Main context' : 'Include in Main context'}
              </button>
              <InspectorRow label="Selection" value={selectedContext?.reason} />
              <InspectorRow label="Score" value={selectedContext?.score || 'Not supplied by this context run'} />
              <InspectorRow label="Rank" value={selectedContext?.rank || 'Not supplied by this context run'} />
              <InspectorRow label="Contribution" value={selectedContext ? `${selectedContext.characters} characters · ~${selectedContext.estimatedTokens} tokens` : undefined} />
              <InspectorRow label="Visible budget" value={`${reasoningBudget} reasoning · ${codeBudget.toLocaleString()} code records`} />
              <InspectorRow label="Main budget" value="Not supplied by the current run" />
              <InspectorRow label="Excluded" value={`${Math.max(0, combined.total_nodes - combined.nodes.length).toLocaleString()} nearby records`} />
            </GlassInspectorSection>
            <GlassInspectorSection title="Relationships" signal={String(selectedRelationships.length)}>
              {selectedRelationships.length ? selectedRelationships.map((edge, index) => (
                <div key={`${edge.source}:${edge.target}:${edge.type}:${index}`} style={{ color: GRAPH_THEME.surface.text, fontSize: 11.5, lineHeight: 1.45 }}>
                  {edge.source === selectedNode.id ? '→' : '←'} {edge.type}
                </div>
              )) : <span style={{ color: GRAPH_THEME.surface.mutedText }}>No visible relationships.</span>}
            </GlassInspectorSection>
            <GlassInspectorSection title="Properties" defaultOpen={false} signal={String(Object.keys(selectedNode.properties || {}).length)}>
              {Object.entries(selectedNode.properties || {}).map(([key, value]) => {
                const readable = readableValue(value);
                return readable ? <InspectorRow key={key} label={key} value={readable} /> : null;
              })}
            </GlassInspectorSection>
            <GlassInspectorSection title="Provenance" defaultOpen={false}>
              <InspectorRow label="Authority" value={LAYER[selectedNode.authority || 'codegraph'].label} />
              <InspectorRow label="Context" value={contextRefs.has(selectedNode.source_id || '') ? 'Included in current Main context' : 'Not in current Main context'} />
              {Object.entries(selectedNode.provenance || {}).map(([key, value]) => {
                const readable = readableValue(value);
                return readable ? <InspectorRow key={key} label={key} value={readable} /> : null;
              })}
            </GlassInspectorSection>
          </div>
        ) : (
          <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 12, lineHeight: 1.55, padding: '4px 3px' }}>
            Select a graph record to inspect its relationships, authority, and provenance.
          </div>
        )}
      </RightGlassDrawer>
    </div>
  );
}

function InspectorRow({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 9, fontSize: 11.5 }}>
      <span style={{ color: GRAPH_THEME.surface.mutedText }}>{label}</span>
      <span style={{ color: GRAPH_THEME.surface.text, overflowWrap: 'anywhere', fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined }}>{value}</span>
    </div>
  );
}
