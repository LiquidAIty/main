import { Component, Suspense, lazy, type ReactNode } from 'react';

import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME, graphDrawerSectionStyle } from '../graph/graphVisualTokens';
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import type { CanonicalSubjectFocusRequest } from './canonicalSubjectLinks';
import type { GraphProjectionV1 } from './joinedKnowledgeGraphProjection';
import type { ReadProviderFocusNeighborhood } from './knowledgeGraphFocusPresentation';

const JoinedKnowledgeGraphSurface = lazy(async () => {
  const mod = await import('./KnowledgeAuthorityGraphSurface');
  return { default: mod.JoinedKnowledgeGraphSurface };
});

type Props = {
  minHeight?: number;
  surfaceRole?: 'large' | 'companion';
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses?: Partial<Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  onReadFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
  subjectFocusRequest?: CanonicalSubjectFocusRequest | null;
};

class KnowledgeGraphErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        data-testid="knowledge-surface-error"
        style={{
          height: '100%',
          width: '100%',
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: GRAPH_THEME.background.knowledgeSurface,
        }}
      >
        <div
          style={graphDrawerSectionStyle({
            width: 'min(560px, 100%)',
            padding: 16,
            color: GRAPH_THEME.drawer.inputMuted,
            lineHeight: 1.5,
          })}
        >
          <div
            style={{
              color: GRAPH_THEME.drawer.inputText,
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            Knowledge graph unavailable
          </div>
          <div>{this.state.error.message || 'The Knowledge graph failed to load.'}</div>
        </div>
      </div>
    );
  }
}

export default function KnowledgeGraphFramework({
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  projections,
  errors,
  statuses,
  onReadFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  subjectFocusRequest,
}: Props) {
  return (
    <KnowledgeGraphErrorBoundary>
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
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
            onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            subjectFocusRequest={subjectFocusRequest}
            />
        </Suspense>
      </div>
    </KnowledgeGraphErrorBoundary>
  );
}
