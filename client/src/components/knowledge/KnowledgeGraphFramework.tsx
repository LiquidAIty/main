import { Suspense, lazy } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalSubjectFocusRequest } from '../builder/canonicalSubjectLinks';

const JoinedKnowledgeGraphSurface = lazy(async () => {
  const mod = await import('./KnowledgeAuthorityGraphSurface');
  return { default: mod.JoinedKnowledgeGraphSurface };
});

type Props = {
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  projections: Record<KnowledgeGraphKind, import('./KnowledgeAuthorityGraphSurface').GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  onReadFocusNeighborhood?: import('./KnowledgeAuthorityGraphSurface').ReadProviderFocusNeighborhood;
  onExpandNode: (
    authority: KnowledgeGraphKind,
    node: import('./KnowledgeAuthorityGraphSurface').GraphProjectionNode,
  ) => Promise<void>;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
  subjectFocusRequest?: CanonicalSubjectFocusRequest | null;
};

export default function KnowledgeGraphFramework({
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  projections,
  errors,
  statuses,
  onReadFocusNeighborhood,
  onExpandNode,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  subjectFocusRequest,
}: Props) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      data-graph-framework="active"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight, overflow: 'hidden' }}
    >
      <GraphPaperBackground />
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
        <JoinedKnowledgeGraphSurface
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
            onExpand={onExpandNode}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            subjectFocusRequest={subjectFocusRequest}
          />
      </Suspense>
    </div>
  );
}
