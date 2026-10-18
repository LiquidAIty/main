/**
 * Entity: Project Knowledge Graph
 * Relationship: Keeps joined Think/Know and opt-in Code views inside one lazy shared renderer workspace, projecting each authority's independent status and read actions.
 */

import { Suspense, lazy, useState } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalEntityFocusRequest } from '../builder/canonicalEntityLinks';
import type {
  GraphProjectionV1,
  ReadProviderFocusNeighborhood,
} from './knowledgeGraphProjection';
import type { CodeGraphSelectedSymbol } from './codeGraphProjection';

const JoinedKnowledgeGraphSurface = lazy(async () => {
  const mod = await import('./KnowledgeAuthorityGraphSurface');
  return { default: mod.JoinedKnowledgeGraphSurface };
});

const CodeGraphSurface = lazy(async () => {
  const mod = await import('./KnowledgeAuthorityGraphSurface');
  return { default: mod.CodeGraphSurface };
});

type Props = {
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  onReadFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  codeGraph: {
    projection: GraphProjectionV1;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    warning: string | null;
    freshness: string;
  };
  onOpenCodeGraph: () => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphFile: (filePath: string) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource: (qualifiedName: string) => Promise<CodeGraphSelectedSymbol | null>;
};

export default function KnowledgeGraphFramework({
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  projections,
  errors,
  statuses,
  onReadFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
  codeGraph,
  onOpenCodeGraph,
  onReadCodeGraphFile,
  onReadCodeGraphSource,
}: Props) {
  const [view, setView] = useState<'knowledge' | 'code'>('knowledge');
  return (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      data-graph-framework="active"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight, overflow: 'hidden' }}
    >
      <GraphPaperBackground />
      <div
        role="tablist"
        aria-label="Graph authority"
        style={{
          position: 'absolute', left: 12, top: 8, zIndex: 8,
          display: 'flex', gap: 6,
        }}
      >
        {(['knowledge', 'code'] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={view === candidate}
            onClick={() => {
              setView(candidate);
              if (candidate === 'code' && codeGraph.status === 'idle') {
                void onOpenCodeGraph();
              }
            }}
            style={{
              minWidth: 76,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid rgba(91, 204, 197, 0.32)',
              background: view === candidate
                ? 'rgba(36, 129, 123, 0.34)'
                : 'rgba(8, 15, 20, 0.76)',
              color: view === candidate ? '#e7ffff' : '#9bb4b6',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {candidate === 'knowledge' ? 'Think + Know' : 'Code'}
          </button>
        ))}
      </div>
      <Suspense
        fallback={
          <div
            aria-busy="true"
            style={{
              width: '100%',
              height: '100%',
              minHeight,
              position: 'relative',
            }}
          />
        }
      >
        {view === 'knowledge' ? <JoinedKnowledgeGraphSurface
            projections={{
              thinkgraph: projections.thinkgraph,
              knowgraph: projections.knowgraph,
            }}
            statuses={{
              thinkgraph: statuses?.thinkgraph
                || (errors.thinkgraph ? 'error' : 'ready'),
              knowgraph: statuses?.knowgraph
                || (errors.knowgraph ? 'error' : 'ready'),
            }}
            errors={{
              ...(errors.thinkgraph ? { thinkgraph: errors.thinkgraph } : {}),
              ...(errors.knowgraph ? { knowgraph: errors.knowgraph } : {}),
            }}
            onReadProviderFocusNeighborhood={onReadFocusNeighborhood}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            entityFocusRequest={entityFocusRequest}
          /> : <CodeGraphSurface
            projection={codeGraph.projection}
            status={codeGraph.status}
            error={codeGraph.error}
            warning={codeGraph.warning}
            freshness={codeGraph.freshness}
            onReadFile={onReadCodeGraphFile}
            onReadSource={onReadCodeGraphSource}
          />}
      </Suspense>
    </div>
  );
}
