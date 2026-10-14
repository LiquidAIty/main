import { Suspense, lazy } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalSubjectFocusRequest } from '../builder/canonicalSubjectLinks';

const NativeJoinedGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeJoinedGraphSurface };
});

type Props = {
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  projections: Record<KnowledgeGraphKind, import('./NativeAuthorityGraphSurface').GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  onReadFocusNeighborhood?: import('./NativeAuthorityGraphSurface').ReadNativeFocusNeighborhood;
  onExpandNode: (
    authority: KnowledgeGraphKind,
    node: import('./NativeAuthorityGraphSurface').GraphProjectionNode,
  ) => Promise<void>;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (nativeFactId: string) => Promise<void>;
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
        <NativeJoinedGraphSurface
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
            onReadNativeFocusNeighborhood={onReadFocusNeighborhood}
            onExpand={onExpandNode}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            subjectFocusRequest={subjectFocusRequest}
          />
      </Suspense>
    </div>
  );
}
