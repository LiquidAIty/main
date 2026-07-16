import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';
import fcose from 'cytoscape-fcose';

import GlassInspectorSection from '../graph/GlassInspectorSection';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GRAPH_THEME, graphGlassCardStyle, graphGlassPillStyle } from '../graph/graphVisualTokens';

let fcoseRegistered = false;
if (!fcoseRegistered) {
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

type AnalysisNode = {
  id: string;
  label: string;
  frequency: number;
  community_id: string;
  influence: number;
  bridge_importance: number;
  supporting_statement_ids: string[];
  supporting_statement_count: number;
  source_document_refs: string[];
};
type AnalysisEdge = { id: string; source: string; target: string; weight: number; occurrences: number };
type AnalysisCommunity = { id: string; label: string; node_ids: string[]; top_concepts: string[] };
type Gap = {
  id: string;
  source: string;
  target: string;
  source_community: string;
  target_community: string;
  path: string[];
  path_length: number;
  score: number;
};
type Analysis = {
  analysis_id: string;
  provider: 'local_cleanroom' | 'infranodus_mcp';
  provider_version?: string | null;
  algorithm_version: string;
  configuration_hash: string;
  source_scope: { project_id: string; document_ids: string[]; chunk_ids: string[] };
  source_statement_count: number;
  source_character_count: number;
  node_count: number;
  edge_count: number;
  modularity?: number | null;
  communities: AnalysisCommunity[];
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  main_concepts: string[];
  conceptual_gateways: string[];
  influential_nodes: string[];
  content_gap_candidates: Gap[];
  warnings: string[];
  limitations: string[];
  runtime_ms: number;
  estimated_cost?: number | null;
  reused: boolean;
};
type EvidenceRecord = {
  chunk_id: string;
  text: string;
  document_id: string;
  source_name?: string;
  pages?: string;
  section?: string;
};

const COMMUNITY_COLORS = ['#37ADAA', '#62B0E8', '#7BC8C4', '#91C4B3', '#A7B0BA', '#4E8F9A', '#76A9B8', '#5E7C8A'];
const panelStyle = graphGlassCardStyle({ padding: 12, borderRadius: 12 });
const buttonStyle = {
  border: `1px solid ${GRAPH_THEME.surface.border}`,
  background: 'rgba(10, 18, 24, 0.78)',
  color: GRAPH_THEME.surface.text,
  borderRadius: 7,
  padding: '6px 9px',
  fontSize: 11,
  cursor: 'pointer',
} as const;

function errorMessage(payload: any, status: number) {
  return String(payload?.error?.message || payload?.error || `HTTP ${status}`);
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return payload;
}

function requestBody(projectId: string) {
  return {
    schema_version: 'knowgraph.analysis.request.v1',
    request_id: crypto.randomUUID(),
    project_id: projectId,
    source_scope: { project_id: projectId, document_ids: [], chunk_ids: [] },
    statements: [],
    language: 'en',
    requested_provider: 'local_cleanroom',
    include_graph: true,
    persist: true,
    external_provider_permission: false,
    options: {
      window_size: 4,
      distance_weighting: 'inverse',
      minimum_topic_frequency: 2,
      minimum_edge_weight: 0.5,
      use_default_stopwords: true,
      stopwords: [],
      phrases: [],
      aliases: {},
      reuse_canonical_concepts: true,
      lowercase: true,
      community_algorithm: 'louvain',
      centrality_algorithm: 'pagerank',
      community_seed: 0,
      gateway_threshold: 0.05,
      gap_min_path: 2,
      gap_max_path: 3,
      node_limit: 350,
      edge_limit: 1200,
      provenance_limit_per_topic: 24,
    },
  };
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, fontSize: 11 }}>
      <span style={{ color: GRAPH_THEME.surface.mutedText }}>{label}</span>
      <span style={{ color: GRAPH_THEME.surface.text, fontVariantNumeric: 'tabular-nums' }}>{String(value ?? '—')}</span>
    </div>
  );
}

export default function KnowGraphAnalysisSurface({ projectId }: { projectId: string }) {
  const scopeOverride = new URLSearchParams(window.location.search).get('kgScope')?.trim();
  const scopeProjectId = scopeOverride || projectId;
  const graphRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [preview, setPreview] = useState<{ statement_count: number; character_count: number; document_refs: string[] } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'running' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [community, setCommunity] = useState('all');
  const [documentRef, setDocumentRef] = useState('all');
  const [gatewaysOnly, setGatewaysOnly] = useState(false);
  const [gapsOnly, setGapsOnly] = useState(false);
  const [focusNeighborhood, setFocusNeighborhood] = useState(false);
  const [selectedNode, setSelectedNode] = useState<AnalysisNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<AnalysisEdge | null>(null);
  const [selectedGap, setSelectedGap] = useState<Gap | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [viewStatus, setViewStatus] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    if (!scopeProjectId) return;
    const controller = new AbortController();
    void jsonRequest(`/api/knowgraph/analysis/source-preview?projectId=${encodeURIComponent(scopeProjectId)}`, { signal: controller.signal }).then((previewPayload) => {
      if (controller.signal.aborted) return;
      setPreview(previewPayload);
    }).catch((nextError) => {
      if (!controller.signal.aborted) setError(String(nextError?.message || nextError));
    });
    return () => controller.abort();
  }, [scopeProjectId]);

  const loadLatest = useCallback(async () => {
    if (!scopeProjectId) return;
    setStatus('loading');
    setError(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEvidence([]);
    try {
      const payload = await jsonRequest(
        `/api/knowgraph/analysis/latest?projectId=${encodeURIComponent(scopeProjectId)}&provider=local_cleanroom`,
      );
      setAnalysis(payload.analysis);
      setStatus('ready');
    } catch (nextError: any) {
      if (String(nextError?.message || nextError).includes('not found')) {
        setAnalysis(null);
        setStatus('empty');
      } else {
        setStatus('error');
        setError(String(nextError?.message || nextError));
      }
    }
  }, [scopeProjectId]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);

  const runAnalysis = async () => {
    if (!scopeProjectId) return;
    setStatus('running');
    setError(null);
    try {
      const payload = await jsonRequest('/api/knowgraph/analysis/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(scopeProjectId)),
      });
      setAnalysis(payload.analysis);
      setStatus('ready');
    } catch (nextError: any) {
      setStatus('error');
      setError(String(nextError?.message || nextError));
    }
  };

  const communityColor = useMemo(() => new Map(
    (analysis?.communities || []).map((item, index) => [item.id, COMMUNITY_COLORS[index % COMMUNITY_COLORS.length]]),
  ), [analysis]);
  const gatewayLabels = useMemo(() => new Set(analysis?.conceptual_gateways || []), [analysis]);
  const gapNodeIds = useMemo(() => new Set(
    (analysis?.content_gap_candidates || []).flatMap((gap) => [gap.source, gap.target, ...gap.path]),
  ), [analysis]);
  const sourceDocuments = useMemo(() => Array.from(new Set(
    (analysis?.nodes || []).flatMap((node) => node.source_document_refs),
  )).sort(), [analysis]);

  useEffect(() => {
    if (!graphRef.current || !analysis) return;
    cyRef.current?.destroy();
    const connectedNodeIds = new Set(analysis.edges.flatMap((edge) => [edge.source, edge.target]));
    const displayNodes = analysis.nodes.filter((node) => connectedNodeIds.has(node.id));
    const importantLabels = new Set(
      [...displayNodes]
        .sort((a, b) => b.influence - a.influence)
        .slice(0, 12)
        .map((node) => node.id),
    );
    const cy = cytoscape({
      container: graphRef.current,
      elements: [
        ...displayNodes.map((node) => ({
          group: 'nodes' as const,
          data: {
            ...node,
            displayLabel: importantLabels.has(node.id) || gatewayLabels.has(node.label) ? node.label : '',
            color: communityColor.get(node.community_id) || GRAPH_THEME.accent.primary,
            displaySize: 18 + Math.min(38, Math.sqrt(Math.max(0, node.influence)) * 140),
            gateway: gatewayLabels.has(node.label) ? 1 : 0,
            gap: gapNodeIds.has(node.id) ? 1 : 0,
          },
        })),
        ...analysis.edges.map((edge) => ({ group: 'edges' as const, data: edge })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(displaySize)',
            height: 'data(displaySize)',
            label: 'data(displayLabel)',
            color: '#E8F4F4',
            'font-size': 10,
            'font-weight': 600,
            'text-outline-color': '#071014',
            'text-outline-width': 2,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'min-zoomed-font-size': 7,
            'border-color': 'rgba(255,255,255,0.54)',
            'border-width': 1,
          },
        },
        {
          selector: 'node[gateway = 1]',
          style: { 'border-color': '#A9ECE8', 'border-width': 3, 'underlay-color': '#37ADAA', 'underlay-opacity': 0.15, 'underlay-padding': 7 },
        },
        {
          selector: 'node[gap = 1]',
          style: { 'shape': 'diamond', 'underlay-color': '#7BC8C4', 'underlay-opacity': 0.12, 'underlay-padding': 5 },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(weight, 0, 12, 0.45, 3.2)',
            'line-color': 'rgba(116, 161, 170, 0.48)',
            opacity: 0.42,
            'curve-style': 'haystack',
          },
        },
        { selector: 'node:selected', style: { 'border-color': '#FFFFFF', 'border-width': 3, opacity: 1, label: 'data(label)' } },
        { selector: 'edge:selected', style: { 'line-color': '#FFFFFF', opacity: 1 } },
        { selector: '.dimmed', style: { opacity: 0.08, 'text-opacity': 0.03 } },
        { selector: '.gap-path', style: { 'border-color': '#7BC8C4', 'border-width': 4, 'line-color': '#7BC8C4', opacity: 1 } },
      ] as any,
      layout: {
        name: 'fcose',
        animate: false,
        randomize: true,
        quality: 'default',
        nodeRepulsion: 11200,
        idealEdgeLength: 90,
        edgeElasticity: 0.42,
        gravity: 0.14,
        fit: true,
        padding: 70,
      } as any,
      minZoom: 0.08,
      maxZoom: 4,
    });
    cy.on('tap', 'node', (event) => {
      const id = String((event.target as NodeSingular).id());
      setSelectedNode(analysis.nodes.find((node) => node.id === id) || null);
      setSelectedEdge(null);
      setEvidence([]);
      setFocusNeighborhood(false);
      setInspectorOpen(true);
    });
    cy.on('mouseover', 'node', (event) => (event.target as NodeSingular).style('label', 'data(label)'));
    cy.on('mouseout', 'node', (event) => (event.target as NodeSingular).removeStyle('label'));
    cy.on('tap', 'edge', (event) => {
      const id = String((event.target as EdgeSingular).id());
      setSelectedEdge(analysis.edges.find((edge) => edge.id === id) || null);
      setSelectedNode(null);
      setEvidence([]);
      setInspectorOpen(true);
    });
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
        setEvidence([]);
        setFocusNeighborhood(false);
      }
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [analysis, communityColor, gapNodeIds, gatewayLabels]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !analysis) return;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const gatewayIds = new Set(analysis.nodes.filter((node) => gatewayLabels.has(node.label)).map((node) => node.id));
    const focused = selectedNode && focusNeighborhood ? cy.getElementById(selectedNode.id).closedNeighborhood() : null;
    cy.batch(() => {
      cy.elements().removeClass('dimmed gap-path');
      cy.nodes().forEach((element) => {
        const node = analysis.nodes.find((candidate) => candidate.id === element.id());
        if (!node) return;
        const visible = (!normalizedQuery || node.label.toLocaleLowerCase().includes(normalizedQuery))
          && (community === 'all' || node.community_id === community)
          && (documentRef === 'all' || node.source_document_refs.includes(documentRef))
          && (!gatewaysOnly || gatewayIds.has(node.id))
          && (!gapsOnly || gapNodeIds.has(node.id));
        element.style('display', visible ? 'element' : 'none');
        if (focused && !focused.contains(element)) element.addClass('dimmed');
      });
      cy.edges().forEach((edge) => {
        const visible = edge.source().style('display') !== 'none' && edge.target().style('display') !== 'none';
        edge.style('display', visible ? 'element' : 'none');
        if (focused && !focused.contains(edge)) edge.addClass('dimmed');
      });
      if (selectedGap) {
        selectedGap.path.forEach((id) => cy.getElementById(id).addClass('gap-path'));
        for (let index = 0; index < selectedGap.path.length - 1; index += 1) {
          cy.edges().filter((edge) => {
            const pair = new Set([edge.source().id(), edge.target().id()]);
            return pair.has(selectedGap.path[index]) && pair.has(selectedGap.path[index + 1]);
          }).addClass('gap-path');
        }
      }
    });
  }, [analysis, community, documentRef, focusNeighborhood, gapNodeIds, gapsOnly, gatewayLabels, gatewaysOnly, query, selectedGap, selectedNode]);

  useEffect(() => {
    if (!selectedNode || !analysis || selectedNode.supporting_statement_ids.length === 0) return;
    const controller = new AbortController();
    void jsonRequest(
      `/api/knowgraph/analysis/${encodeURIComponent(analysis.analysis_id)}/evidence/${encodeURIComponent(selectedNode.id)}`,
      { signal: controller.signal },
    ).then((payload) => {
      if (!controller.signal.aborted) setEvidence(Array.isArray(payload.evidence) ? payload.evidence : []);
    }).catch((nextError) => {
      if (!controller.signal.aborted) setError(String(nextError?.message || nextError));
    });
    return () => controller.abort();
  }, [analysis, selectedNode]);

  const createView = async () => {
    if (!analysis) return;
    setViewStatus('Creating…');
    try {
      const payload = await jsonRequest('/api/knowgraph/analysis-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: analysis.analysis_id,
          project_id: scopeProjectId,
          producing_invocation: crypto.randomUUID(),
        }),
      });
      setViewStatus(`Candidate view ${payload.view.viewId}`);
    } catch (nextError: any) {
      setViewStatus(String(nextError?.message || nextError));
    }
  };

  const runDisabled = !scopeProjectId || status === 'running';

  return (
    <div data-testid="knowgraph-analysis-surface" style={{ width: '100%', height: '100%', minHeight: 620, position: 'relative', background: GRAPH_THEME.background.knowledgeSurface, overflow: 'hidden' }}>
      <GraphPaperBackground />
      <div ref={graphRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      <GraphNavigationControls
        onZoomIn={() => cyRef.current?.zoom((cyRef.current?.zoom() || 1) * 1.2)}
        onZoomOut={() => cyRef.current?.zoom((cyRef.current?.zoom() || 1) / 1.2)}
        onFit={() => cyRef.current?.fit(undefined, 70)}
      />

      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="KnowGraph Inspector"
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open KnowGraph Inspector"
        defaultWidth={320}
        minWidth={300}
        maxWidth={440}
        storageKey="liquidaity.drawer.knowgraph.width"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={panelStyle}>
          <div style={{ color: '#A9ECE8', fontSize: 11, marginBottom: 8 }}>Canonical Neo4j analysis</div>
          <Metric label="Scope statements" value={preview?.statement_count} />
          <Metric label="Scope characters" value={preview?.character_count?.toLocaleString()} />
          <Metric label="Canonical source" value="Neo4j chunks and concepts" />
          {!analysis ? <button type="button" disabled={runDisabled} onClick={() => void runAnalysis()} style={{ ...buttonStyle, width: '100%', marginTop: 9, background: runDisabled ? 'rgba(20,30,36,.55)' : 'rgba(55,173,170,.17)', cursor: runDisabled ? 'not-allowed' : 'pointer' }}>
            {status === 'running' ? 'Analyzing…' : 'Build analysis'}
          </button> : null}
        </div>

        {analysis ? (
          <div style={panelStyle}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search concepts" style={{ width: '100%', boxSizing: 'border-box', ...buttonStyle, cursor: 'text', marginBottom: 7 }} />
            <select value={community} onChange={(event) => setCommunity(event.target.value)} style={{ width: '100%', ...buttonStyle, marginBottom: 6 }}>
              <option value="all">All communities</option>
              {analysis.communities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <select value={documentRef} onChange={(event) => setDocumentRef(event.target.value)} style={{ width: '100%', ...buttonStyle, marginBottom: 7 }}>
              <option value="all">All source documents</option>
              {sourceDocuments.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <button type="button" onClick={() => setGatewaysOnly((value) => !value)} style={{ ...buttonStyle, opacity: gatewaysOnly ? 1 : 0.58 }}>Gateways</button>
              <button type="button" onClick={() => setGapsOnly((value) => !value)} style={{ ...buttonStyle, opacity: gapsOnly ? 1 : 0.58 }}>Gap regions</button>
              <button type="button" disabled={!selectedNode} onClick={() => setFocusNeighborhood((value) => !value)} style={{ ...buttonStyle, opacity: focusNeighborhood ? 1 : 0.58 }}>Neighborhood</button>
            </div>
          </div>
        ) : null}

      </div>

      <div style={panelStyle}>
        {analysis ? (
          <>
            <GlassInspectorSection title="Analysis details" signal={analysis.provider} defaultOpen={false}>
              <Metric label="Analysis" value={analysis.analysis_id} />
              <Metric label="Algorithm" value={analysis.algorithm_version} />
              <Metric label="Nodes / edges" value={`${analysis.node_count} / ${analysis.edge_count}`} />
              <Metric label="Communities" value={analysis.communities.length} />
              <Metric label="Modularity" value={analysis.modularity?.toFixed(4)} />
              <Metric label="Runtime" value={`${analysis.runtime_ms} ms`} />
              <Metric label="Reused" value={analysis.reused ? 'yes' : 'no'} />
              <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, overflowWrap: 'anywhere' }}>Config {analysis.configuration_hash}</div>
              <button type="button" disabled={runDisabled} onClick={() => void runAnalysis()} style={{ ...buttonStyle, marginTop: 7, width: '100%' }}>{status === 'running' ? 'Refreshing…' : 'Refresh analysis'}</button>
              <button type="button" onClick={() => void createView()} style={{ ...buttonStyle, marginTop: 7, width: '100%' }}>Create candidate Graph View</button>
              {viewStatus ? <div style={{ marginTop: 6, fontSize: 10, color: GRAPH_THEME.surface.mutedText, overflowWrap: 'anywhere' }}>{viewStatus}</div> : null}
            </GlassInspectorSection>

            {selectedNode ? (
              <GlassInspectorSection title={selectedNode.label} signal={selectedNode.community_id}>
                <Metric label="Frequency" value={selectedNode.frequency} />
                <Metric label="Influence" value={selectedNode.influence.toFixed(6)} />
                <Metric label="Bridge" value={selectedNode.bridge_importance.toFixed(6)} />
                <Metric label="Evidence chunks" value={selectedNode.supporting_statement_count} />
                {evidence.map((record) => (
                  <div key={record.chunk_id} style={{ marginTop: 8, padding: 9, borderRadius: 8, background: 'rgba(7,16,20,.7)', border: `1px solid ${GRAPH_THEME.surface.border}` }}>
                    <div style={{ fontSize: 10, color: '#A9ECE8' }}>{record.source_name || record.document_id}{record.pages ? ` · ${record.pages}` : ''}</div>
                    <div style={{ fontSize: 11, lineHeight: 1.45, color: GRAPH_THEME.surface.text, marginTop: 4 }}>{record.text}</div>
                    <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, marginTop: 4 }}>{record.chunk_id}</div>
                  </div>
                ))}
                {selectedNode.supporting_statement_ids.length === 0 ? <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>This provider did not return statement-level provenance.</div> : null}
              </GlassInspectorSection>
            ) : selectedEdge ? (
              <GlassInspectorSection title="Weighted relation" signal={selectedEdge.id}>
                <Metric label="Source" value={selectedEdge.source} />
                <Metric label="Target" value={selectedEdge.target} />
                <Metric label="Weight" value={selectedEdge.weight} />
                <Metric label="Occurrences" value={selectedEdge.occurrences} />
              </GlassInspectorSection>
            ) : (
              <GlassInspectorSection title="Main concepts" signal={`${analysis.main_concepts.length}`} defaultOpen={false}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {analysis.main_concepts.map((concept) => <span key={concept} style={graphGlassPillStyle({ fontSize: 10, padding: '4px 7px' })}>{concept}</span>)}
                </div>
              </GlassInspectorSection>
            )}

            <GlassInspectorSection title="Structural gaps" signal={`${analysis.content_gap_candidates.length}`} defaultOpen={false}>
              {analysis.content_gap_candidates.map((gap) => (
                <button key={gap.id} type="button" onClick={() => setSelectedGap(gap)} style={{ ...buttonStyle, width: '100%', textAlign: 'left', marginBottom: 5, borderColor: selectedGap?.id === gap.id ? '#7BC8C4' : GRAPH_THEME.surface.border }}>
                  {gap.source_community} ↔ {gap.target_community} · path {gap.path_length}
                </button>
              ))}
            </GlassInspectorSection>

            <GlassInspectorSection title="Limits & warnings" signal={`${analysis.warnings.length + analysis.limitations.length}`} defaultOpen={false}>
              {[...analysis.warnings, ...analysis.limitations].map((message) => <div key={message} style={{ fontSize: 10, lineHeight: 1.4, color: GRAPH_THEME.surface.mutedText, marginBottom: 5 }}>{message}</div>)}
            </GlassInspectorSection>
          </>
        ) : (
          <GlassInspectorSection title="KnowGraph network analysis" signal={status}>
            <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11, lineHeight: 1.5 }}>
              {status === 'loading' ? 'Loading the latest persisted analysis…' : status === 'empty' ? 'No derived analysis exists for this canonical scope yet. Run Local to build it from the existing Neo4j chunks and concepts.' : error || 'No analysis loaded.'}
            </div>
          </GlassInspectorSection>
        )}
      </div>
      </RightGlassDrawer>

      {error ? <div data-testid="knowgraph-analysis-error" style={{ position: 'absolute', left: 312, bottom: 12, zIndex: 6, ...graphGlassPillStyle({ color: '#FF9AAB', fontSize: 11, padding: '6px 10px' }) }}>{error}</div> : null}
    </div>
  );
}
