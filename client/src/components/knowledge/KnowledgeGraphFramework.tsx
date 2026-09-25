import { Suspense, lazy } from 'react';

import { graphDrawerSectionStyle } from '../graph/graphVisualTokens';
import { GraphPaperBackground } from '../graph/GraphCanvasChrome';
import type { KnowledgeGraphKind } from '../../types/agentgraph';

const NativeCodeGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeCodeGraphSurface };
});
const NativeCombinedGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeCombinedGraphSurface };
});
const NativeKnowGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeKnowGraphSurface };
});
const NativeThinkGraphSurface = lazy(async () => {
  const mod = await import('./NativeAuthorityGraphSurface');
  return { default: mod.NativeThinkGraphSurface };
});

export type KnowledgeSurfaceKind = KnowledgeGraphKind | 'combined';

const GRAPH_VIEWS: ReadonlyArray<{ kind: KnowledgeSurfaceKind; label: string }> = [
  { kind: 'combined', label: 'Combined' },
  { kind: 'thinkgraph', label: 'ThinkGraph' },
  { kind: 'knowgraph', label: 'KnowGraph' },
  { kind: 'codegraph', label: 'CodeGraph' },
];

type Props = {
  codeGraphProjectName: string | null;
  codeGraphProjectError: string | null;
  kind: KnowledgeSurfaceKind;
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
  onUseAttentionNode: (
    authority: KnowledgeGraphKind,
    node: import('./NativeAuthorityGraphSurface').GraphProjectionNode,
  ) => void;
  onKindChange: (kind: KnowledgeSurfaceKind) => void;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
};

export default function KnowledgeGraphFramework({
  codeGraphProjectName,
  codeGraphProjectError,
  kind,
  minHeight = 280,
  surfaceRole = minHeight > 320 ? 'large' : 'companion',
  attentionProjections,
  attentionErrors,
  attentionStatuses,
  jevAttentionVisual,
  onReadNativeFocusNeighborhood,
  onExpandAttentionNode,
  onUseAttentionNode,
  onKindChange,
  onRemoveThinkGraphEvidence,
}: Props) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      data-graph-framework="active"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight, overflow: 'hidden' }}
    >
      <GraphPaperBackground />
      <div role="tablist" aria-label="Knowledge graph view" style={{ position: 'absolute', top: 10, left: 10, zIndex: 7, display: 'flex', gap: 6 }}>
        {GRAPH_VIEWS.map((view) => (
          <button
            key={view.kind}
            type="button"
            role="tab"
            data-testid={`graph-kind-${view.kind}`}
            aria-selected={kind === view.kind}
            onClick={() => onKindChange(view.kind)}
            style={{
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 7,
              cursor: 'pointer',
              border: `1px solid ${kind === view.kind ? '#2dd4bf' : '#26313f'}`,
              background: kind === view.kind
                ? 'rgba(45,212,191,0.12)' : 'rgba(13,18,32,0.7)',
              color: kind === view.kind ? '#a9ecdf' : '#8fb3c8',
            }}
          >
            {view.label}
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
        {kind === 'codegraph' ? (
          codeGraphProjectError ? (
            <div
              data-testid="codegraph-project-error"
              role="alert"
              style={graphDrawerSectionStyle({
                width: '100%',
                height: '100%',
                minHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                borderRadius: 8,
                color: '#fda4af',
                textAlign: 'center',
              })}
            >
              {codeGraphProjectError}
            </div>
          ) : (
            <NativeCodeGraphSurface
              project={codeGraphProjectName}
              projection={attentionProjections.codegraph}
              onExpand={(node) => onExpandAttentionNode('codegraph', node)}
              onUseAsContext={(node) => onUseAttentionNode('codegraph', node)}
            />
          )
        ) : kind === 'combined' ? (
          <NativeCombinedGraphSurface
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
            onUseAsContext={onUseAttentionNode}
            onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
          />
        ) : kind === 'knowgraph' ? (
          <NativeKnowGraphSurface
            projection={attentionProjections.knowgraph}
            status={attentionStatuses?.knowgraph || 'ready'}
            error={attentionErrors.knowgraph || null}
            onExpand={(node) => onExpandAttentionNode('knowgraph', node)}
            onUseAsContext={(node) => onUseAttentionNode('knowgraph', node)}
          />
        ) : (
          <NativeThinkGraphSurface
            projection={attentionProjections.thinkgraph}
            status={attentionStatuses?.thinkgraph
              || (attentionErrors.thinkgraph ? 'error' : 'ready')}
            error={attentionErrors.thinkgraph || null}
            onExpand={(node) => onExpandAttentionNode('thinkgraph', node)}
            onUseAsContext={(node) => onUseAttentionNode('thinkgraph', node)}
            onRemoveEvidence={onRemoveThinkGraphEvidence}
          />
        )}
      </Suspense>
    </div>
  );
}
