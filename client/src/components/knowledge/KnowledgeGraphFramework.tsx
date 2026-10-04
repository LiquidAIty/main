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
  attentionProjections: Record<KnowledgeGraphKind, import('./NativeAuthorityGraphSurface').GraphProjectionV1>;
  attentionErrors: Partial<Record<KnowledgeGraphKind, string>>;
  attentionStatuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  jevAttentionVisual?: import('./NativeAuthorityGraphSurface').JevAttentionVisualDescriptorView | null;
  onReadNativeFocusNeighborhood?: import('./NativeAuthorityGraphSurface').ReadNativeFocusNeighborhood;
  onExpandAttentionNode: (
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
  attentionProjections,
  attentionErrors,
  attentionStatuses,
  jevAttentionVisual,
  onReadNativeFocusNeighborhood,
  onExpandAttentionNode,
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
              thinkgraph: attentionProjections.thinkgraph,
              knowgraph: attentionProjections.knowgraph,
            }}
            statuses={{
              thinkgraph: attentionStatuses?.thinkgraph
                || (attentionErrors.thinkgraph ? 'error' : 'ready'),
              knowgraph: attentionStatuses?.knowgraph
                || (attentionErrors.knowgraph ? 'error' : 'ready'),
            }}
            errors={{
              ...(attentionErrors.thinkgraph ? { thinkgraph: attentionErrors.thinkgraph } : {}),
              ...(attentionErrors.knowgraph ? { knowgraph: attentionErrors.knowgraph } : {}),
            }}
            jevAttentionVisual={jevAttentionVisual}
            onReadNativeFocusNeighborhood={onReadNativeFocusNeighborhood}
            onExpand={onExpandAttentionNode}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            subjectFocusRequest={subjectFocusRequest}
          />
      </Suspense>
    </div>
  );
}
